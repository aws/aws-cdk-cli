import * as path from 'path';
import * as fs from 'fs-extra';
import { listFiles } from './directories';

const DISPLAY_NAMES: Record<string, string> = {
  typescript: 'TypeScript',
  javascript: 'JavaScript',
  python: 'Python',
  java: 'Java',
  dotnet: '.NET',
  go: 'Go',
};

/**
 * Return the display name for a language identifier.
 */
export function languageDisplayName(language: string): string {
  return DISPLAY_NAMES[language] ?? language;
}

/**
 * Guess the CDK app language based on the files in the given directory.
 *
 * Returns `undefined` if our guess fails.
 */
export async function guessLanguage(dir: string): Promise<string | undefined> {
  try {
    const files = new Set(await listFiles(dir, 2, ['node_modules']));

    if (files.has('package.json')) {
      const pjContents = JSON.parse(await fs.readFile(path.join(dir, 'package.json'), 'utf-8'));
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
}
