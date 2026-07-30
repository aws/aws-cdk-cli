import { promises as fs } from 'fs';
import * as path from 'path';
import { integTest, withDefaultFixture } from '../../../lib';

integTest(
  'templates on disk contain metadata resource, also in nested assemblies',
  withDefaultFixture(async (fixture) => {
    // Synth first, and switch on version reporting because cdk.json is disabling it
    await fixture.cdk(['synth', '--version-reporting=true']);

    // Load template from disk from root assembly
    const templateContents = await readMatchingFile(path.join(fixture.integTestDir, 'cdk.out'), /-lambda\.template\.json$/);

    expect(JSON.parse(templateContents).Resources.CDKMetadata).toBeTruthy();

    // Load template from nested assembly
    const assemblyDir = await findMatchingFile(path.join(fixture.integTestDir, 'cdk.out'), /^assembly-.*-stage$/);
    const nestedTemplateContents = await readMatchingFile(assemblyDir, /StackInStage.*\.template\.json$/);

    expect(JSON.parse(nestedTemplateContents).Resources.CDKMetadata).toBeTruthy();
  }),
);

async function findMatchingFile(dir: string, pattern: RegExp): Promise<string> {
  const entries = await fs.readdir(dir);
  const match = entries.find((e) => pattern.test(e));
  if (!match) {
    throw new Error(`No file matching ${pattern} found in ${dir}`);
  }
  return path.join(dir, match);
}

async function readMatchingFile(dir: string, pattern: RegExp): Promise<string> {
  return fs.readFile(await findMatchingFile(dir, pattern), 'utf-8');
}

