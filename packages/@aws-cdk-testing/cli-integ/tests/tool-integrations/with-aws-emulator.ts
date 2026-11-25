import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { AwsContext, DisableBootstrapContext, TestContext } from '../../lib';
import { AwsClients, ShellHelper } from '../../lib';
import eventually from '../../lib/eventually';

const IMAGE_TAG = 'cdk-integ-aws-emulator:latest';
/**
 * The port inside the container. On the host, Docker picks a free one.
 */
const PORT = 9297;

/**
 * Like `withAws`, but against the latest release of the AWS Emulator instead of a real AWS account
 *
 * The emulator runs in a Docker container, and the clients (and the environment of every
 * `cdk` command run through a fixture) point at it. No real AWS credentials are used.
 *
 * The emulator starts empty, so a fixture bootstraps it like it would a fresh account.
 */
export function withAwsEmulator<A extends TestContext>(
  block: (context: A & AwsContext & DisableBootstrapContext) => Promise<void>,
): (context: A) => Promise<void> {
  return async (context: A) => {
    const docker = process.env.CDK_DOCKER ?? 'docker';
    const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'aws-emulator-'));
    const shell = new ShellHelper(workDir, context.output);
    const containerName = `cdk-integ-aws-emulator-${context.randomString}`;

    // The emulator does not publish an image; build one from the latest Linux package.
    // See https://docs.aws.amazon.com/emulator/latest/userguide/
    await fs.writeFile(path.join(workDir, 'Dockerfile'), `
FROM public.ecr.aws/amazonlinux/amazonlinux:2023-minimal
ARG TARGETARCH
RUN case "$TARGETARCH" in arm64) a=aarch64 ;; amd64) a=x86_64 ;; *) exit 1 ;; esac \\
    && curl -fsSLo /tmp/aws-emulator.rpm \\
       "https://downloads.aws.com/aws-emulator/packages/aws-emulator/LTS/latest/aws-emulator-$a.rpm" \\
    && rpm -i /tmp/aws-emulator.rpm && rm /tmp/aws-emulator.rpm \\
    && mkdir -p /home/emulator && chown 1000 /home/emulator
USER 1000
ENV HOME=/home/emulator
ENV PATH=/opt/aws-emulator/bin:$PATH
ENTRYPOINT ["aws-emulator", "-b", "0.0.0.0"]
`, { encoding: 'utf-8' });
    // --pull --no-cache: always test against the latest emulator release
    await shell.shell([docker, 'build', '--pull', '--no-cache', '-t', IMAGE_TAG, workDir]);

    // The emulator writes this run's TLS certificate ('ca.pem') here.
    // Create it before mounting, otherwise Docker creates it owned by root.
    const filesDir = path.join(workDir, `${PORT}`);
    await fs.mkdir(filesDir);
    const caBundlePath = path.join(filesDir, 'ca.pem');

    try {
      await shell.shell([
        docker, 'run', '-d',
        '--name', containerName,
        '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--read-only',
        '-e', 'EMULATOR_TELEMETRY=off',
        // Loopback only, which is what makes it safe to turn off signature checks
        '-p', `127.0.0.1::${PORT}`,
        '-v', `${filesDir}:/home/emulator/.aws/emulator/${PORT}`,
        // Make the generated files readable by the host user
        ...(process.getuid && process.getgid ? ['--user', `${process.getuid()}:${process.getgid()}`] : []),
        IMAGE_TAG,
        '-p', `${PORT}`,
        '--auth', 'off',
        // Exit by itself if the test forgets to stop it
        '--idle-timeout', '1800',
      ]);

      // 'docker port' prints the host address, e.g. '127.0.0.1:49153'
      const url = `https://${(await shell.shell([docker, 'port', containerName, `${PORT}`], { show: 'never' })).trim()}`;

      await eventually(
        () => shell.shell(['curl', '-sf', '--cacert', caBundlePath, `${url}/__admin/health`], { show: 'never' }),
        { maxAttempts: 60 },
      );

      // The emulator runs without signature checks, so any key pair works
      const aws = await AwsClients.forIdentity(context.randomString, 'us-east-1', context.testTags, {
        accessKeyId: 'test',
        secretAccessKey: 'test',
      }, context.output, { url, caBundlePath });
      try {
        await block({ ...context, aws });
      } finally {
        await aws.dispose();
      }
    } catch (e) {
      await shell.shell([docker, 'logs', containerName], { allowErrExit: true });
      throw e;
    } finally {
      // Not 'docker run --rm': some Docker-compatible CLIs don't allow it together with '-d'
      await shell.shell([docker, 'rm', '--force', containerName], { allowErrExit: true });
      await fs.rm(workDir, { recursive: true, force: true });
    }
  };
}
