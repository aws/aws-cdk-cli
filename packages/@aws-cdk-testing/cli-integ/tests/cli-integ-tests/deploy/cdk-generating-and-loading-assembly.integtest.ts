import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { integTest, withDefaultFixture } from '../../../lib';

integTest(
  'generating and loading assembly',
  withDefaultFixture(async (fixture) => {
    const asmOutputDir = `${fixture.integTestDir}-cdk-integ-asm`;
    await fs.rm(asmOutputDir, { recursive: true, force: true });

    // Synthesize a Cloud Assembly tothe default directory (cdk.out) and a specific directory.
    await fixture.cdk(['synth']);
    await fixture.cdk(['synth', '--output', asmOutputDir]);

    // cdk.out in the current directory and the indicated --output should be the same
    await assertDirsEqual(path.join(fixture.integTestDir, 'cdk.out'), asmOutputDir);

    // Check that we can 'ls' the synthesized asm.
    // Change to some random directory to make sure we're not accidentally loading cdk.json
    const list = await fixture.cdk(['--app', asmOutputDir, 'ls'], { cwd: os.tmpdir() });
    // Same stacks we know are in the app
    expect(list).toContain(`${fixture.stackNamePrefix}-lambda`);
    expect(list).toContain(`${fixture.stackNamePrefix}-test-1`);
    expect(list).toContain(`${fixture.stackNamePrefix}-test-2`);

    // Check that we can use '.' and just synth ,the generated asm
    const stackTemplate = await fixture.cdk(['--app', '.', 'synth', fixture.fullStackName('test-2')], {
      cwd: asmOutputDir,
    });
    expect(stackTemplate).toContain('topic152D84A37');

    // Deploy a Lambda from the copied asm
    await fixture.cdkDeploy('lambda', { options: ['-a', '.'], cwd: asmOutputDir });

    // Remove (rename) the original custom docker file that was used during synth.
    // this verifies that the assemly has a copy of it and that the manifest uses
    // relative paths to reference to it.
    const customDockerFile = path.join(fixture.integTestDir, 'docker', 'Dockerfile.Custom');
    await fs.rename(customDockerFile, `${customDockerFile}~`);
    try {
      // deploy a docker image with custom file without synth (uses assets)
      await fixture.cdkDeploy('docker-with-custom-file', { options: ['-a', '.'], cwd: asmOutputDir });
    } finally {
      // Rename back to restore fixture to original state
      await fs.rename(`${customDockerFile}~`, customDockerFile);
    }
  }),
);

/**
 * Assert that two directories have the same files with the same contents (like `diff -r`)
 */
async function assertDirsEqual(dirA: string, dirB: string) {
  const filesA = await relativeFiles(dirA);
  const filesB = await relativeFiles(dirB);
  expect(filesB).toEqual(filesA);

  for (const file of filesA) {
    const contentsA = await fs.readFile(path.join(dirA, file), 'utf-8');
    const contentsB = await fs.readFile(path.join(dirB, file), 'utf-8');
    if (contentsA !== contentsB) {
      throw new Error(`File ${file} differs between ${dirA} and ${dirB}`);
    }
  }
}

async function relativeFiles(root: string): Promise<string[]> {
  const entries = await fs.readdir(root, { recursive: true, withFileTypes: true });
  return entries
    .filter((e) => e.isFile())
    .map((e) => path.join(path.relative(root, e.parentPath), e.name))
    .sort();
}

