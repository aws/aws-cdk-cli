import { once } from 'events';
import { promises as fs } from 'fs';
import * as net from 'net';
import * as os from 'os';
import * as path from 'path';
import type { AwsContext, DisableBootstrapContext, TestContext } from '../../lib';
import { AwsClients, ecrPublicLogin, ShellHelper } from '../../lib';
import eventually from '../../lib/eventually';

const IMAGE_TAG = 'cdk-integ-aws-emulator:latest';

/**
 * Like `withAws`, but against the latest release of the AWS Emulator instead of a real AWS account
 *
 * The emulator runs in a Docker container, and the clients (and the environment of every
 * `cdk` command run through a fixture) point at it. Real AWS credentials are only used to
 * log in to ECR Public for pulling the emulator's base image.
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

    // The base image comes from ECR Public, so log in with the runner's own AWS credentials
    // to avoid the anonymous pull limits. These are the only real credentials the test uses.
    const realAws = await AwsClients.forRegion(context.randomString, 'us-east-1', context.testTags, context.output);
    try {
      await ecrPublicLogin(shell, realAws.ecrPublic);
    } finally {
      await realAws.dispose();
    }

    // --pull --no-cache: always test against the latest emulator release
    await shell.shell([docker, 'build', '--pull', '--no-cache', '-t', IMAGE_TAG, workDir]);

    // The emulator writes its port into the URLs it returns, so the host and the container
    // must use the same one. See https://docs.aws.amazon.com/emulator/latest/userguide/getting-started-docker.html
    const port = await findFreePort();
    const url = `https://127.0.0.1:${port}`;

    // The emulator writes this run's TLS certificate ('ca.pem') here.
    // Create it before mounting, otherwise Docker creates it owned by root.
    const filesDir = path.join(workDir, `${port}`);
    await fs.mkdir(filesDir);
    const caBundlePath = path.join(filesDir, 'ca.pem');

    try {
      await shell.shell([
        docker, 'run', '-d',
        '--name', containerName,
        '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--read-only',
        '-e', 'EMULATOR_TELEMETRY=off',
        // Loopback only, which is what makes it safe to turn off signature checks
        '-p', `127.0.0.1:${port}:${port}`,
        '-v', `${filesDir}:/home/emulator/.aws/emulator/${port}`,
        // Make the generated files readable by the host user
        ...(process.getuid && process.getgid ? ['--user', `${process.getuid()}:${process.getgid()}`] : []),
        IMAGE_TAG,
        '-p', `${port}`,
        '--auth', 'off',
        // Exit by itself if the test forgets to stop it
        '--idle-timeout', '1800',
      ]);

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

async function findFreePort(): Promise<number> {
  const server = net.createServer().listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = (server.address() as net.AddressInfo).port;
  server.close();
  return port;
}
