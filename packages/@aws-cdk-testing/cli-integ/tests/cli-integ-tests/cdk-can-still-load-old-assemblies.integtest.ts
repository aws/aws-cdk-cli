import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { integTest, RESOURCES_DIR, shell, withDefaultFixture, cloneDirectory } from '../../lib';

jest.setTimeout(2 * 60 * 60_000); // Includes the time to acquire locks, worst-case single-threaded runtime

integTest(
  'can still load old assemblies',
  withDefaultFixture(async (fixture) => {
    const cxAsmDir = path.join(os.tmpdir(), 'cdk-integ-cx');

    const testAssembliesDirectory = path.join(RESOURCES_DIR, 'cloud-assemblies');
    for (const asmdir of await listChildDirs(testAssembliesDirectory)) {
      fixture.log(`ASSEMBLY ${asmdir}`);
      await cloneDirectory(asmdir, cxAsmDir);

      // Some files in the asm directory that have a .js extension are
      // actually treated as templates. Evaluate them using NodeJS.
      const templates = await listChildren(cxAsmDir, (fullPath) => Promise.resolve(fullPath.endsWith('.js')));
      for (const template of templates) {
        const targetName = template.replace(/.js$/, '');
        await shell([process.execPath, template, '>', targetName], {
          cwd: cxAsmDir,
          outputs: [fixture.output],
          modEnv: {
            TEST_ACCOUNT: await fixture.aws.account(),
            TEST_REGION: fixture.aws.region,
          },
        });
      }

      // Use this directory as a Cloud Assembly
      const output = await fixture.cdk(['--app', cxAsmDir, '-v', 'synth']);

      // Assert that there was no providerError in CDK's stderr
      // Because we rely on the app/framework to actually error in case the
      // provider fails, we inspect the logs here.
      expect(output).not.toContain('$providerError');
    }
  }),
);

async function listChildren(parent: string, pred: (x: string) => Promise<boolean>) {
  const ret = new Array<string>();
  for (const child of await fs.readdir(parent, { encoding: 'utf-8' })) {
    const fullPath = path.join(parent, child.toString());
    if (await pred(fullPath)) {
      ret.push(fullPath);
    }
  }
  return ret;
}

async function listChildDirs(parent: string) {
  return listChildren(parent, async (fullPath: string) => (await fs.stat(fullPath)).isDirectory());
}
