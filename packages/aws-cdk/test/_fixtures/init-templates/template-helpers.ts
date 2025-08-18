import * as path from 'path';
import * as fs from 'fs-extra';

const FIXTURES_DIR = path.join(__dirname, '.');

/**
 * Helper function to create a custom template structure for testing
 */
export async function createCustomTemplate(baseDir: string, templateName: string, languages: string[]): Promise<string> {
  const templateDir = path.join(baseDir, templateName);
  
  for (const language of languages) {
    const langDir = path.join(templateDir, language);
    await fs.mkdirp(langDir);
    
    // Copy appropriate fixtures based on language
    if (language === 'typescript') {
      await copyTypescriptFixtures(langDir);
    }
    // Add other languages as needed
  }
  
  return templateDir;
}

/**
 * Copy TypeScript template fixtures to the specified directory
 */
async function copyTypescriptFixtures(targetDir: string): Promise<void> {
  // Create directory structure
  await fs.mkdirp(path.join(targetDir, 'bin'));
  await fs.mkdirp(path.join(targetDir, 'lib'));
  
  // Copy fixture files
  await fs.copy(
    path.join(FIXTURES_DIR, 'package.json'),
    path.join(targetDir, 'package.json')
  );
  
  await fs.copy(
    path.join(FIXTURES_DIR, 'app.ts'),
    path.join(targetDir, 'bin', 'app.ts')
  );
  
  await fs.copy(
    path.join(FIXTURES_DIR, 'stack.ts'),
    path.join(targetDir, 'lib', 'my-custom-stack.ts')
  );
}

/**
 * Create a multi-template repository structure for testing
 */
export async function createMultiTemplateRepository(baseDir: string): Promise<string> {
  const repoDir = path.join(baseDir, 'multi-template-repo');
  
  // Create multiple templates
  await createCustomTemplate(repoDir, 'template1', ['typescript']);
  await createCustomTemplate(repoDir, 'template2', ['typescript']);
  
  return repoDir;
}