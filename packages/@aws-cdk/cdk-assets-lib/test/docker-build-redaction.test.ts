// Integration test: exercises the real `docker build` path (no child_process
// mock) to prove that a `--build-arg` value is redacted from the logged command
// line while the real value is still passed to docker. Skipped when the docker
// daemon is not reachable.
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Docker } from '../lib/private/docker';
import { EventType } from '../lib/progress';

function dockerAvailable(): boolean {
  try {
    execFileSync('docker', ['info'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const suite = dockerAvailable() ? describe : describe.skip;

suite('docker build --build-arg redaction (real docker)', () => {
  let dir: string;
  const tag = `cdk-assets-redaction-test:${Date.now()}`;
  const SECRET = 'supersecretvalue';

  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'redaction-integ'));
    // `FROM scratch` needs no registry pull (runs offline). The LABEL bakes the
    // build-arg into the image so we can read it back and prove docker received
    // the real value.
    fs.writeFileSync(path.join(dir, 'Dockerfile'), 'FROM scratch\nARG SECRET\nLABEL testsecret=$SECRET\n');
  });

  afterAll(() => {
    try {
      execFileSync('docker', ['image', 'rm', '-f', tag], { stdio: 'ignore' });
    } catch {
      // ignore cleanup failures
    }
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('masks the --build-arg value in the logged command but passes it to docker', async () => {
    const events = new Array<[EventType, string]>();
    const docker = new Docker((type, message) => events.push([type, message]), 'publish');

    await docker.build({ directory: dir, tag, buildArgs: { SECRET } });

    // The command line surfaced to the user (the SHELL_OPEN event) is redacted.
    const loggedCommand = events
      .filter(([t]) => t === EventType.SHELL_OPEN)
      .map(([, m]) => m)
      .join('\n');

    // Evidence for the human reading the test log:
    // eslint-disable-next-line no-console
    console.log('\n[redaction integ] logged command line:\n  ' + loggedCommand + '\n');

    expect(loggedCommand).toContain('--build-arg');
    expect(loggedCommand).toContain('SECRET=<redacted>');
    expect(loggedCommand).not.toContain(SECRET);

    // ...but docker actually received the real value (baked into the image label).
    const label = execFileSync(
      'docker',
      ['inspect', '--format', '{{index .Config.Labels "testsecret"}}', tag],
      { encoding: 'utf-8' },
    ).trim();

    // eslint-disable-next-line no-console
    console.log('[redaction integ] image label testsecret=' + JSON.stringify(label) + ' (real value reached docker)\n');

    expect(label).toEqual(SECRET);
  }, 120000);
});
