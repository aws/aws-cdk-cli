import { promises as fs } from 'fs';
import * as path from 'path';
import { integTest, withDefaultFixture } from '../../../lib';

integTest(
  'templates on disk contain metadata resource, also in nested assemblies',
  withDefaultFixture(async (fixture) => {
    // Synth first, and switch on version reporting because cdk.json is disabling it
    await fixture.cdk(['synth', '--version-reporting=true']);

    // Load template from disk from root assembly
    const templateContents = await readMatchingFile(path.join(fixture.integTestDir, 'cdk.out'), /^[^\\/]*-lambda\.template\.json$/);

    expect(JSON.parse(templateContents).Resources.CDKMetadata).toBeTruthy();

    // Load template from nested assembly (multiple stage assemblies exist; find the one holding StackInStage)
    const nestedTemplate = await findMatchingFile(
      path.join(fixture.integTestDir, 'cdk.out'),
      /^assembly-.*-stage[\\/].*StackInStage.*\.template\.json$/,
    );
    const nestedTemplateContents = await fs.readFile(nestedTemplate, 'utf-8');

    expect(JSON.parse(nestedTemplateContents).Resources.CDKMetadata).toBeTruthy();
  }),
);

/**
 * Find a file whose path relative to `root` matches `pattern`, searching recursively (like a shell glob)
 */
async function findMatchingFile(root: string, pattern: RegExp): Promise<string> {
  const entries = await fs.readdir(root, { recursive: true, withFileTypes: true });
  const match = entries.find((e) => e.isFile() && pattern.test(path.join(path.relative(root, e.parentPath), e.name)));
  if (!match) {
    throw new Error(`No file matching ${pattern} found in ${root}`);
  }
  return path.join(match.parentPath, match.name);
}

async function readMatchingFile(root: string, pattern: RegExp): Promise<string> {
  return fs.readFile(await findMatchingFile(root, pattern), 'utf-8');
}

