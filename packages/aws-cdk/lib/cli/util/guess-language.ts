import * as fs from 'fs-extra';
import * as path from 'path';

/**
 * Guess the CDK app language based on the files in the given directory
 *
 * Returns `undefined` if our guess fails.
 */
export async function guessLanguage(dir: string): Promise<string | undefined> {
  try {
    const files = new Set(await listFiles(dir, 2));

    if (files.has('package.json')) {
      const pjContents = await JSON.parse(await fs.readFile(path.join(dir, 'package.json'), 'utf-8'));
      const deps = new Set([
        ...Object.keys(pjContents.dependencies ?? {}),
        ...Object.keys(pjContents.devDependencies ?? {}),
      ]);
      if (deps.has('typescript') || deps.has('ts-node') || deps.has('tsx') || deps.has('swc')) {
        return 'typescript';
      } else {
        return 'javascript';
      }
    }

    if (files.has('requirements.txt') || files.has('setup.py') || files.has('pyproject.toml')) {
      return 'python';
    }

    if (files.has('pom.xml') || files.has('build.xml') || files.has('settings.gradle')) {
      return 'java';
    }

    if (Array.from(files).some(n => n.endsWith('.sln') || n.endsWith('.csproj') || n.endsWith('.fsproj') || n.endsWith('.vbproj'))) {
      return 'dotnet';
    }

    if (files.has('go.mod')) {
      return 'go';
    }
  } catch {
    // Swallow failure
  }
  return undefined;

  async function listFiles(dir: string, depth: number): Promise<string[]> {
    const ret = await fs.readdir(dir, { encoding: 'utf-8', withFileTypes: true });

    return (await Promise.all(ret.map(async (f) => {
      if (f.isDirectory()) {
        if (depth <= 1) {
          return Promise.resolve([]);
        }
        return await listFiles(path.join(dir, f.name), depth - 1);
      } else {
        return Promise.resolve([f.name]);
      }
    }))).flatMap(xs => xs);
  }
}