import * as path from 'path';
import * as fs from 'fs-extra';

export async function createSingleLanguageTemplate(baseDir: string, templateName: string, language: string): Promise<string> {
  const templateDir = path.join(baseDir, templateName);
  const langDir = path.join(templateDir, language);
  await fs.mkdirp(langDir);

  const fileContent = getLanguageFileContent(language);
  const fileName = getLanguageFileName(language);

  await fs.writeFile(path.join(langDir, fileName), fileContent);
  return templateDir;
}

export async function createMultiLanguageTemplate(baseDir: string, templateName: string, languages: string[]): Promise<string> {
  const templateDir = path.join(baseDir, templateName);

  for (const language of languages) {
    const langDir = path.join(templateDir, language);
    await fs.mkdirp(langDir);

    const fileContent = getLanguageFileContent(language);
    const fileName = getLanguageFileName(language);

    await fs.writeFile(path.join(langDir, fileName), fileContent);
  }

  return templateDir;
}

export async function createMultiTemplateRepository(baseDir: string, templates: Array<{ name: string; languages: string[] }>): Promise<string> {
  const repoDir = path.join(baseDir, 'template-repo');

  for (const template of templates) {
    await createMultiLanguageTemplate(repoDir, template.name, template.languages);
  }

  return repoDir;
}

function getLanguageFileContent(language: string): string {
  switch (language) {
    case 'typescript':
      return 'console.log("TypeScript template");';
    case 'javascript':
      return 'console.log("JavaScript template");';
    case 'python':
      return 'print("Python template")';
    case 'java':
      return 'public class App { }';
    case 'csharp':
      return 'public class App { }';
    case 'fsharp':
      return 'module App';
    case 'go':
      return 'package main';
    default:
      return `// ${language} template`;
  }
}

function getLanguageFileName(language: string): string {
  switch (language) {
    case 'typescript':
      return 'app.ts';
    case 'javascript':
      return 'app.js';
    case 'python':
      return 'app.py';
    case 'java':
      return 'App.java';
    case 'csharp':
      return 'App.cs';
    case 'fsharp':
      return 'App.fs';
    case 'go':
      return 'app.go';
    default:
      return 'app.txt';
  }
}
