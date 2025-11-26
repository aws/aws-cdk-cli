import * as os from 'os';
import * as path from 'path';
import * as cxapi from '@aws-cdk/cx-api';
import * as fs from 'fs-extra';
import { availableInitLanguages, availableInitTemplates, cliInit, currentlyRecommendedAwsCdkLibFlags, expandPlaceholders, printAvailableTemplates } from '../../lib/commands/init';
import { createSingleLanguageTemplate, createMultiLanguageTemplate, createMultiTemplateRepository } from '../_fixtures/init-templates/template-helpers';
import { TestIoHost } from '../_helpers/io-host';

const ioHost = new TestIoHost();
const ioHelper = ioHost.asHelper('init');

describe('constructs version', () => {
  cliTest('shows available templates when no parameters provided', async (workDir) => {
    // Test that calling cdk init without any parameters shows available templates
    await cliInit({
      ioHelper,
      workDir,
    });

    // Verify that printAvailableTemplates was called by checking the output
    // The function should return early without creating any files
    const files = await fs.readdir(workDir);
    const visibleFiles = files.filter(f => !f.startsWith('.'));
    expect(visibleFiles.length).toBe(0); // No files should be created
  });

  cliTest('create a TypeScript library project', async (workDir) => {
    await cliInit({
      ioHelper,
      type: 'lib',
      language: 'typescript',
      workDir,
    });

    // Check that package.json and lib/ got created in the current directory
    expect(await fs.pathExists(path.join(workDir, 'package.json'))).toBeTruthy();
    expect(await fs.pathExists(path.join(workDir, 'lib'))).toBeTruthy();
  });

  cliTest("when type is 'lib' and language is not specified, it default language to TypeScript", async (workDir) => {
    await cliInit({
      ioHelper,
      type: 'lib',
      workDir,
    });

    // Check that tsconfig.json and lib/ got created in the current directory
    expect(await fs.pathExists(path.join(workDir, 'tsconfig.json'))).toBeTruthy();
    expect(await fs.pathExists(path.join(workDir, 'lib'))).toBeTruthy();
  });

  cliTest('can override requested version with environment variable', async (workDir) => {
    await cliInit({
      ioHelper,
      type: 'lib',
      language: 'typescript',
      workDir,
      libVersion: '2.100',
    });

    // Check that package.json and lib/ got created in the current directory
    const pj = JSON.parse(await fs.readFile(path.join(workDir, 'package.json'), 'utf-8'));
    expect(Object.entries(pj.devDependencies)).toContainEqual(['aws-cdk-lib', '2.100']);
  });

  cliTest('asking for a nonexistent template fails', async (workDir) => {
    await expect(cliInit({
      ioHelper,
      type: 'banana',
      language: 'typescript',
      workDir,
    })).rejects.toThrow(/Unknown init template/);
  });

  cliTest('asking for a template but no language prints and throws', async (workDir) => {
    await expect(cliInit({
      ioHelper,
      type: 'app',
      workDir,
    })).rejects.toThrow(/No language/);
  });

  cliTest('cdk init --language defaults to app template with specified language', async (workDir) => {
    await cliInit({
      ioHelper,
      language: 'typescript',
      canUseNetwork: false,
      generateOnly: true,
      workDir,
    });

    // Verify app template structure was created
    expect(await fs.pathExists(path.join(workDir, 'package.json'))).toBeTruthy();
    expect(await fs.pathExists(path.join(workDir, 'bin'))).toBeTruthy();

    // Verify it uses the specified language (TypeScript)
    const binFiles = await fs.readdir(path.join(workDir, 'bin'));
    expect(binFiles.some(file => file.endsWith('.ts'))).toBeTruthy();
  });

  cliTest('create a TypeScript app project', async (workDir) => {
    await cliInit({
      ioHelper,
      type: 'app',
      language: 'typescript',
      workDir,
    });

    // Check that package.json and bin/ got created in the current directory
    expect(await fs.pathExists(path.join(workDir, 'package.json'))).toBeTruthy();
    expect(await fs.pathExists(path.join(workDir, 'bin'))).toBeTruthy();
  });

  cliTest('create a JavaScript app project', async (workDir) => {
    await cliInit({
      ioHelper,
      type: 'app',
      language: 'javascript',
      workDir,
    });

    // Check that package.json and bin/ got created in the current directory
    expect(await fs.pathExists(path.join(workDir, 'package.json'))).toBeTruthy();
    expect(await fs.pathExists(path.join(workDir, 'bin'))).toBeTruthy();
    expect(await fs.pathExists(path.join(workDir, '.git'))).toBeTruthy();
  });

  cliTest('create a Java app project', async (workDir) => {
    await cliInit({
      ioHelper,
      type: 'app',
      language: 'java',
      canUseNetwork: false,
      generateOnly: true,
      workDir,
    });

    expect(await fs.pathExists(path.join(workDir, 'pom.xml'))).toBeTruthy();

    const pom = (await fs.readFile(path.join(workDir, 'pom.xml'), 'utf8')).split(/\r?\n/);
    const matches = pom.map(line => line.match(/\<constructs\.version\>(.*)\<\/constructs\.version\>/))
      .filter(l => l);

    expect(matches.length).toEqual(1);
    matches.forEach(m => {
      const version = m && m[1];
      expect(version).toMatch(/\[10\.[\d]+\.[\d]+,11\.0\.0\)/);
    });
  });

  cliTest('create a .NET app project in csharp', async (workDir) => {
    await cliInit({
      ioHelper,
      type: 'app',
      language: 'csharp',
      canUseNetwork: false,
      generateOnly: true,
      workDir,
    });

    const csprojFile = (await recursiveListFiles(workDir)).filter(f => f.endsWith('.csproj'))[0];
    const slnFile = (await recursiveListFiles(workDir)).filter(f => f.endsWith('.sln'))[0];
    expect(csprojFile).toBeDefined();
    expect(slnFile).toBeDefined();

    const csproj = (await fs.readFile(csprojFile, 'utf8')).split(/\r?\n/);
    const sln = (await fs.readFile(slnFile, 'utf8')).split(/\r?\n/);

    expect(csproj).toContainEqual(expect.stringMatching(/\<PackageReference Include="Constructs" Version="\[10\..*,11\..*\)"/));
    expect(csproj).toContainEqual(expect.stringMatching(/\<TargetFramework>net8.0<\/TargetFramework>/));
    expect(sln).toContainEqual(expect.stringMatching(/\"AwsCdkTest[a-zA-Z0-9]{6}\\AwsCdkTest[a-zA-Z0-9]{6}.csproj\"/));
  });

  cliTest('create a .NET app project in fsharp', async (workDir) => {
    await cliInit({
      ioHelper,
      type: 'app',
      language: 'fsharp',
      canUseNetwork: false,
      generateOnly: true,
      workDir,
    });

    const fsprojFile = (await recursiveListFiles(workDir)).filter(f => f.endsWith('.fsproj'))[0];
    const slnFile = (await recursiveListFiles(workDir)).filter(f => f.endsWith('.sln'))[0];
    expect(fsprojFile).toBeDefined();
    expect(slnFile).toBeDefined();

    const fsproj = (await fs.readFile(fsprojFile, 'utf8')).split(/\r?\n/);
    const sln = (await fs.readFile(slnFile, 'utf8')).split(/\r?\n/);

    expect(fsproj).toContainEqual(expect.stringMatching(/\<PackageReference Include="Constructs" Version="\[10\..*,11\..*\)"/));
    expect(fsproj).toContainEqual(expect.stringMatching(/\<TargetFramework>net8.0<\/TargetFramework>/));
    expect(sln).toContainEqual(expect.stringMatching(/\"AwsCdkTest[a-zA-Z0-9]{6}\\AwsCdkTest[a-zA-Z0-9]{6}.fsproj\"/));
  });

  cliTestWithDirSpaces('csharp app with spaces', async (workDir) => {
    await cliInit({
      ioHelper,
      type: 'app',
      language: 'csharp',
      canUseNetwork: false,
      generateOnly: true,
      workDir,
    });

    const csprojFile = (await recursiveListFiles(workDir)).filter(f => f.endsWith('.csproj'))[0];
    expect(csprojFile).toBeDefined();

    const csproj = (await fs.readFile(csprojFile, 'utf8')).split(/\r?\n/);

    expect(csproj).toContainEqual(expect.stringMatching(/\<PackageReference Include="Constructs" Version="\[10\..*,11\..*\)"/));
    expect(csproj).toContainEqual(expect.stringMatching(/\<TargetFramework>net8.0<\/TargetFramework>/));
  });

  cliTestWithDirSpaces('fsharp app with spaces', async (workDir) => {
    await cliInit({
      ioHelper,
      type: 'app',
      language: 'fsharp',
      canUseNetwork: false,
      generateOnly: true,
      workDir,
    });

    const fsprojFile = (await recursiveListFiles(workDir)).filter(f => f.endsWith('.fsproj'))[0];
    expect(fsprojFile).toBeDefined();

    const fsproj = (await fs.readFile(fsprojFile, 'utf8')).split(/\r?\n/);

    expect(fsproj).toContainEqual(expect.stringMatching(/\<PackageReference Include="Constructs" Version="\[10\..*,11\..*\)"/));
    expect(fsproj).toContainEqual(expect.stringMatching(/\<TargetFramework>net8.0<\/TargetFramework>/));
  });

  cliTest('create a Python app project', async (workDir) => {
    await cliInit({
      ioHelper,
      type: 'app',
      language: 'python',
      canUseNetwork: false,
      generateOnly: true,
      workDir,
    });

    expect(await fs.pathExists(path.join(workDir, 'requirements.txt'))).toBeTruthy();
    const setupPy = (await fs.readFile(path.join(workDir, 'requirements.txt'), 'utf8')).split(/\r?\n/);
    // return RegExpMatchArray (result of line.match()) for every lines that match re.
    const matches = setupPy.map(line => line.match(/^constructs(.*)/))
      .filter(l => l);

    expect(matches.length).toEqual(1);
    matches.forEach(m => {
      const version = m && m[1];
      expect(version).toMatch(/>=10\.\d+\.\d,<11\.0\.0/);
    });
  });

  cliTest('--generate-only should skip git init', async (workDir) => {
    await cliInit({
      ioHelper,
      type: 'app',
      language: 'javascript',
      canUseNetwork: false,
      generateOnly: true,
      workDir,
    });

    // Check that package.json and bin/ got created in the current directory
    expect(await fs.pathExists(path.join(workDir, 'package.json'))).toBeTruthy();
    expect(await fs.pathExists(path.join(workDir, 'bin'))).toBeTruthy();
    expect(await fs.pathExists(path.join(workDir, '.git'))).toBeFalsy();
  });

  cliTest('git directory does not throw off the initer!', async (workDir) => {
    fs.mkdirSync(path.join(workDir, '.git'));

    await cliInit({
      ioHelper,
      type: 'app',
      language: 'typescript',
      canUseNetwork: false,
      workDir,
    });

    // Check that package.json and bin/ got created in the current directory
    expect(await fs.pathExists(path.join(workDir, 'package.json'))).toBeTruthy();
    expect(await fs.pathExists(path.join(workDir, 'bin'))).toBeTruthy();
  });

  cliTest('create project from single local custom template', async (workDir) => {
    const templateDir = await createSingleLanguageTemplate(workDir, 'my-template', 'typescript');
    const projectDir = path.join(workDir, 'my-project');
    await fs.mkdirp(projectDir);

    await cliInit({
      ioHelper,
      fromPath: templateDir,
      language: 'typescript',
      canUseNetwork: false,
      generateOnly: true,
      workDir: projectDir,
    });

    expect(await fs.pathExists(path.join(projectDir, 'app.ts'))).toBeTruthy();
  });

  cliTest('single template auto-detects language when template has single language', async (workDir) => {
    const templateDir = await createSingleLanguageTemplate(workDir, 'my-template', 'typescript');
    const projectDir = path.join(workDir, 'my-project');
    await fs.mkdirp(projectDir);

    await cliInit({
      ioHelper,
      fromPath: templateDir,
      canUseNetwork: false,
      generateOnly: true,
      workDir: projectDir,
    });

    expect(await fs.pathExists(path.join(projectDir, 'app.ts'))).toBeTruthy();
  });

  cliTest('custom template with multiple languages fails if language not provided', async (workDir) => {
    const templateDir = await createMultiLanguageTemplate(workDir, 'multi-lang-template', ['typescript', 'python']);
    const projectDir = path.join(workDir, 'my-project');
    await fs.mkdirp(projectDir);

    await expect(cliInit({
      ioHelper,
      fromPath: templateDir,
      canUseNetwork: false,
      generateOnly: true,
      workDir: projectDir,
    })).rejects.toThrow(/No language was selected/);
  });

  cliTest('custom template path does not exist throws error', async (workDir) => {
    const projectDir = path.join(workDir, 'my-project');
    await fs.mkdirp(projectDir);

    await expect(cliInit({
      ioHelper,
      fromPath: '/nonexistent/path',
      language: 'typescript',
      workDir: projectDir,
    })).rejects.toThrow(/Template path does not exist/);
  });

  cliTest('create project from multi-template repository with template-path', async (workDir) => {
    const repoDir = await createMultiTemplateRepository(workDir, [
      { name: 'my-custom-template', languages: ['typescript', 'python'] },
      { name: 'web-app-template', languages: ['java'] },
    ]);

    // Test 1: Initialize from my-custom-template with TypeScript
    const projectDir1 = path.join(workDir, 'project1');
    await fs.mkdirp(projectDir1);

    await cliInit({
      ioHelper,
      fromPath: repoDir,
      templatePath: 'my-custom-template',
      language: 'typescript',
      canUseNetwork: false,
      generateOnly: true,
      workDir: projectDir1,
    });

    expect(await fs.pathExists(path.join(projectDir1, 'app.ts'))).toBeTruthy();
    expect(await fs.pathExists(path.join(projectDir1, 'app.py'))).toBeFalsy();

    // Test 2: Initialize from web-app-template with Java
    const projectDir2 = path.join(workDir, 'project2');
    await fs.mkdirp(projectDir2);

    await cliInit({
      ioHelper,
      fromPath: repoDir,
      templatePath: 'web-app-template',
      language: 'java',
      canUseNetwork: false,
      generateOnly: true,
      workDir: projectDir2,
    });

    expect(await fs.pathExists(path.join(projectDir2, 'App.java'))).toBeTruthy();
    expect(await fs.pathExists(path.join(projectDir2, 'app.ts'))).toBeFalsy();
  });

  cliTest('multi-template repository with non-existent template-path throws error', async (workDir) => {
    const repoDir = await createMultiTemplateRepository(workDir, [
      { name: 'valid-template', languages: ['typescript'] },
    ]);

    const projectDir = path.join(workDir, 'my-project');
    await fs.mkdirp(projectDir);

    await expect(cliInit({
      ioHelper,
      fromPath: repoDir,
      templatePath: 'nonexistent-template',
      language: 'typescript',
      workDir: projectDir,
    })).rejects.toThrow(/Template path does not exist/);
  });

  cliTest('template validation requires at least one language directory', async (workDir) => {
    // Test that templates must contain at least one language subdirectory
    const repoDir = path.join(workDir, 'cdk-templates');
    const invalidTemplateDir = path.join(repoDir, 'invalid-template');
    await fs.mkdirp(invalidTemplateDir);
    // Create a file but no language directories
    await fs.writeFile(path.join(invalidTemplateDir, 'README.md'), 'This template has no language directories');

    const projectDir = path.join(workDir, 'my-project');
    await fs.mkdirp(projectDir);

    await expect(cliInit({
      ioHelper,
      fromPath: repoDir,
      templatePath: 'invalid-template',
      language: 'typescript',
      workDir: projectDir,
    })).rejects.toThrow(/Custom template must contain at least one language directory/);
  });

  cliTest('template validation requires language files in language directory', async (workDir) => {
    // Test that language directories must contain files of the matching language type
    const repoDir = path.join(workDir, 'cdk-templates');
    const invalidTemplateDir = path.join(repoDir, 'empty-lang-template');
    const emptyTsDir = path.join(invalidTemplateDir, 'typescript');
    await fs.mkdirp(emptyTsDir);
    // Create language directory but no files with matching extensions
    await fs.writeFile(path.join(emptyTsDir, 'README.md'), 'No TypeScript files here');

    const projectDir = path.join(workDir, 'my-project');
    await fs.mkdirp(projectDir);

    await expect(cliInit({
      ioHelper,
      fromPath: repoDir,
      templatePath: 'empty-lang-template',
      language: 'typescript',
      workDir: projectDir,
    })).rejects.toThrow(/Found 'typescript' directory but it doesn't contain the expected language files. Ensure the template contains typescript source files./);
  });

  cliTest('multi-template repository without template-path suggests using template-path', async (workDir) => {
    // Test that when using a multi-template repository without specifying template-path,
    // it suggests using --template-path to specify which template to use
    const repoDir = await createMultiTemplateRepository(workDir, [
      { name: 'template-one', languages: ['typescript'] },
      { name: 'template-two', languages: ['python'] },
    ]);

    const projectDir = path.join(workDir, 'my-project');
    await fs.mkdirp(projectDir);

    await expect(cliInit({
      ioHelper,
      fromPath: repoDir,
      // Note: no templatePath specified
      language: 'typescript',
      workDir: projectDir,
    })).rejects.toThrow(/Use --template-path to specify which template to use./);
  });

  cliTest('handles repository path access errors gracefully', async (workDir) => {
    // Test error handling when repository path doesn't exist
    const nonExistentRepo = path.join(workDir, 'nonexistent-repo');
    const projectDir = path.join(workDir, 'my-project');
    await fs.mkdirp(projectDir);

    await expect(cliInit({
      ioHelper,
      fromPath: nonExistentRepo,
      language: 'typescript',
      workDir: projectDir,
    })).rejects.toThrow(/Template path does not exist/);
  });

  cliTest('handles repository permission errors gracefully', async (workDir) => {
    // Test error handling when repository path has permission issues
    const restrictedRepo = path.join(workDir, 'restricted-repo');
    await fs.mkdirp(restrictedRepo);
    await fs.chmod(restrictedRepo, 0o000); // Remove all permissions

    const projectDir = path.join(workDir, 'my-project');
    await fs.mkdirp(projectDir);

    try {
      await expect(cliInit({
        ioHelper,
        fromPath: restrictedRepo,
        language: 'typescript',
        workDir: projectDir,
      })).rejects.toThrow(/permission denied/);
    } finally {
      // Restore permissions for cleanup
      await fs.chmod(restrictedRepo, 0o755);
    }
  });

  cliTest('skips corrupted template directories in multi-template repository', async (workDir) => {
    // Test that corrupted template directories are skipped gracefully
    const repoDir = path.join(workDir, 'mixed-repo');
    await fs.mkdirp(repoDir);

    // Create a valid template
    const validTemplateDir = path.join(repoDir, 'valid-template');
    const validTsDir = path.join(validTemplateDir, 'typescript');
    await fs.mkdirp(validTsDir);
    await fs.writeFile(path.join(validTsDir, 'app.ts'), 'console.log("valid");');

    // Create a corrupted template directory (will cause getLanguageDirectories to fail)
    const corruptedTemplateDir = path.join(repoDir, 'corrupted-template');
    await fs.mkdirp(corruptedTemplateDir);
    // Create a typescript directory but make it unreadable
    const corruptedTsDir = path.join(corruptedTemplateDir, 'typescript');
    await fs.mkdirp(corruptedTsDir);
    await fs.chmod(corruptedTsDir, 0o000); // Remove all permissions to cause read failure

    const projectDir = path.join(workDir, 'my-project');
    await fs.mkdirp(projectDir);

    try {
      // Should still work by using the valid template and skipping the corrupted one
      await expect(cliInit({
        ioHelper,
        fromPath: repoDir,
        // Note: no templatePath specified, should suggest using template-path
        language: 'typescript',
        workDir: projectDir,
      })).rejects.toThrow(/Use --template-path to specify which template to use./);
    } finally {
      // Restore permissions for cleanup
      await fs.chmod(corruptedTsDir, 0o755);
    }
  });

  cliTest('handles generic filesystem errors in findPotentialTemplates', async (workDir) => {
    // Test generic error handling in findPotentialTemplates by creating a file where a directory is expected
    const repoFile = path.join(workDir, 'not-a-directory');
    await fs.writeFile(repoFile, 'this is a file, not a directory');

    const projectDir = path.join(workDir, 'my-project');
    await fs.mkdirp(projectDir);

    await expect(cliInit({
      ioHelper,
      fromPath: repoFile,
      language: 'typescript',
      workDir: projectDir,
    })).rejects.toThrow(/Cannot read template directory.*not a directory/);
  });

  cliTest('multi-template repository auto-detects language when template has single language', async (workDir) => {
    const repoDir = await createMultiTemplateRepository(workDir, [
      { name: 'single-lang-template', languages: ['typescript'] },
    ]);

    const projectDir = path.join(workDir, 'my-project');
    await fs.mkdirp(projectDir);

    await cliInit({
      ioHelper,
      fromPath: repoDir,
      templatePath: 'single-lang-template',
      canUseNetwork: false,
      generateOnly: true,
      workDir: projectDir,
    });

    expect(await fs.pathExists(path.join(projectDir, 'app.ts'))).toBeTruthy();
  });

  cliTest('multi-template repository supports all CDK languages', async (workDir) => {
    const repoDir = await createMultiTemplateRepository(workDir, [
      { name: 'multi-lang-template', languages: ['typescript', 'javascript', 'python', 'java', 'csharp', 'fsharp', 'go'] },
    ]);

    // Test TypeScript selection
    const tsProjectDir = path.join(workDir, 'ts-project');
    await fs.mkdirp(tsProjectDir);

    await cliInit({
      ioHelper,
      fromPath: repoDir,
      templatePath: 'multi-lang-template',
      language: 'typescript',
      canUseNetwork: false,
      generateOnly: true,
      workDir: tsProjectDir,
    });

    expect(await fs.pathExists(path.join(tsProjectDir, 'app.ts'))).toBeTruthy();
    expect(await fs.pathExists(path.join(tsProjectDir, 'app.js'))).toBeFalsy();
    expect(await fs.pathExists(path.join(tsProjectDir, 'app.py'))).toBeFalsy();

    // Test Python selection
    const pyProjectDir = path.join(workDir, 'py-project');
    await fs.mkdirp(pyProjectDir);

    await cliInit({
      ioHelper,
      fromPath: repoDir,
      templatePath: 'multi-lang-template',
      language: 'python',
      canUseNetwork: false,
      generateOnly: true,
      workDir: pyProjectDir,
    });

    expect(await fs.pathExists(path.join(pyProjectDir, 'app.py'))).toBeTruthy();
    expect(await fs.pathExists(path.join(pyProjectDir, 'app.ts'))).toBeFalsy();
  });

  cliTest('CLI uses recommended feature flags from data file to initialize context', async (workDir) => {
    const recommendedFlagsFile = path.join(__dirname, '..', '..', 'lib', 'init-templates', '.recommended-feature-flags.json');
    await withReplacedFile(recommendedFlagsFile, JSON.stringify({ banana: 'yellow' }), () => cliInit({
      ioHelper,
      type: 'app',
      language: 'typescript',
      canUseNetwork: false,
      generateOnly: true,
      workDir,
    }));

    const cdkFile = await fs.readJson(path.join(workDir, 'cdk.json'));
    expect(cdkFile.context).toEqual({ banana: 'yellow' });
  });

  cliTest('CLI uses init versions file to initialize template', async (workDir) => {
    const recommendedFlagsFile = path.join(__dirname, '..', '..', 'lib', 'init-templates', '.init-version.json');
    await withReplacedFile(recommendedFlagsFile, JSON.stringify({ 'aws-cdk-lib': '100.1.1', 'constructs': '^200.2.2' }), () => cliInit({
      ioHelper,
      type: 'app',
      language: 'typescript',
      canUseNetwork: false,
      generateOnly: true,
      workDir,
    }));

    const packageJson = await fs.readJson(path.join(workDir, 'package.json'));
    expect(packageJson.dependencies['aws-cdk-lib']).toEqual('100.1.1');
    expect(packageJson.dependencies.constructs).toEqual('^200.2.2');
  });

  test('verify "future flags" are added to cdk.json', async () => {
    for (const templ of await availableInitTemplates()) {
      for (const lang of templ.languages) {
        await withTempDir(async tmpDir => {
          await cliInit({
            ioHelper,
            type: templ.name,
            language: lang,
            canUseNetwork: false,
            generateOnly: true,
            workDir: tmpDir,
          });

          // ok if template doesn't have a cdk.json file (e.g. the "lib" template)
          if (!await fs.pathExists(path.join(tmpDir, 'cdk.json'))) {
            return;
          }

          const config = await fs.readJson(path.join(tmpDir, 'cdk.json'));
          const context = config.context || {};
          const recommendedFlags = await currentlyRecommendedAwsCdkLibFlags();
          for (const [key, actual] of Object.entries(context)) {
            expect(key in recommendedFlags).toBeTruthy();
            expect(recommendedFlags[key]).toEqual(actual);
          }

          // assert that expired future flags are not part of the cdk.json
          Object.keys(context).forEach(k => {
            expect(cxapi.CURRENT_VERSION_EXPIRED_FLAGS.includes(k)).toEqual(false);
          });
        });
      }
    }
  },
  // This is a lot to test, and it can be slow-ish, especially when ran with other tests.
  30_000);

  cliTest('unstable flag functionality works correctly', async (workDir) => {
    const { exec } = await import('child_process');
    const { promisify } = await import('util');
    const execAsync = promisify(exec);
    const cdkBin = path.join(__dirname, '..', '..', 'bin', 'cdk');

    const repoDir = await createMultiTemplateRepository(workDir, [
      { name: 'unstable-test', languages: ['typescript'] },
    ]);
    const projectDir1 = path.join(workDir, 'project-without-unstable');
    const projectDir2 = path.join(workDir, 'project-with-unstable');
    await fs.mkdirp(projectDir1);
    await fs.mkdirp(projectDir2);

    // Test that template-path fails WITHOUT --unstable=init flag
    await expect(execAsync(`node ${cdkBin} init --from-path ${repoDir} --template-path unstable-test --language typescript --generate-only`, {
      cwd: projectDir1,
      env: { ...process.env, CDK_DISABLE_VERSION_CHECK: '1' },
    })).rejects.toThrow();

    // Test that template-path succeeds WITH --unstable=init flag
    const { stderr } = await execAsync(`node ${cdkBin} init --from-path ${repoDir} --template-path unstable-test --language typescript --unstable init --generate-only`, {
      cwd: projectDir2,
      env: { ...process.env, CDK_DISABLE_VERSION_CHECK: '1' },
    });

    expect(stderr).not.toContain('error');
    expect(await fs.pathExists(path.join(projectDir2, 'app.ts'))).toBeTruthy();
  });

  cliTest('conflict between lib-version and from-path is enforced', async (workDir) => {
    const { exec } = await import('child_process');
    const { promisify } = await import('util');
    const execAsync = promisify(exec);

    const templateDir = await createSingleLanguageTemplate(workDir, 'conflict-test', 'typescript');

    const cdkBin = path.join(__dirname, '..', '..', 'bin', 'cdk');

    // Test that using both flags together causes an error
    await expect(execAsync(`node ${cdkBin} init app --language typescript --lib-version 2.0.0 --from-path ${templateDir} --generate-only`, {
      cwd: workDir,
      env: { ...process.env, CDK_DISABLE_VERSION_CHECK: '1' },
    })).rejects.toThrow();
  });

  cliTest('template-path implies from-path validation works', async (workDir) => {
    // Test that the implication is properly configured
    const { makeConfig } = await import('../../lib/cli/cli-config');
    const config = await makeConfig();
    expect(config.commands.init.implies).toEqual({ 'template-path': 'from-path' });

    // Test that template-path functionality works when from-path is provided
    const repoDir = await createMultiTemplateRepository(workDir, [
      { name: 'implies-test', languages: ['typescript'] },
    ]);
    const projectDir = path.join(workDir, 'my-project');
    await fs.mkdirp(projectDir);

    await cliInit({
      ioHelper,
      fromPath: repoDir,
      templatePath: 'implies-test',
      language: 'typescript',
      canUseNetwork: false,
      generateOnly: true,
      workDir: projectDir,
    });

    expect(await fs.pathExists(path.join(projectDir, 'app.ts'))).toBeTruthy();
  });

  cliTest('hook files are ignored during template copy', async (workDir) => {
    const templateDir = path.join(workDir, 'template-with-hooks');
    const tsDir = path.join(templateDir, 'typescript');
    await fs.mkdirp(tsDir);

    await fs.writeFile(path.join(tsDir, 'app.ts'), 'console.log("Hello CDK");');
    await fs.writeFile(path.join(tsDir, 'package.json'), '{}');
    await fs.writeFile(path.join(tsDir, 'setup.hook.js'), 'console.log("setup hook");');
    await fs.writeFile(path.join(tsDir, 'build.hook.d.ts'), 'export {};');
    await fs.writeFile(path.join(tsDir, 'deploy.hook.sh'), '#!/bin/bash\necho "deploy"');

    const projectDir = path.join(workDir, 'my-project');
    await fs.mkdirp(projectDir);

    await cliInit({
      ioHelper,
      fromPath: templateDir,
      language: 'typescript',
      canUseNetwork: false,
      generateOnly: true,
      workDir: projectDir,
    });

    expect(await fs.pathExists(path.join(projectDir, 'app.ts'))).toBeTruthy();
    expect(await fs.pathExists(path.join(projectDir, 'package.json'))).toBeTruthy();
    expect(await fs.pathExists(path.join(projectDir, 'setup.hook.js'))).toBeFalsy();
    expect(await fs.pathExists(path.join(projectDir, 'build.hook.d.ts'))).toBeFalsy();
    expect(await fs.pathExists(path.join(projectDir, 'deploy.hook.sh'))).toBeFalsy();
  });

  cliTest('handles file permission failures gracefully', async (workDir) => {
    const templateDir = await createSingleLanguageTemplate(workDir, 'permission-test-template', 'typescript');
    const projectDir = path.join(workDir, 'my-project');
    await fs.mkdirp(projectDir);

    await fs.chmod(projectDir, 0o444);

    try {
      await expect(cliInit({
        ioHelper,
        fromPath: templateDir,
        language: 'typescript',
        canUseNetwork: false,
        generateOnly: true,
        workDir: projectDir,
      })).rejects.toThrow();
    } finally {
      await fs.chmod(projectDir, 0o755);
    }
  });

  cliTest('handles relative vs absolute paths correctly', async (workDir) => {
    const templateDir = await createSingleLanguageTemplate(workDir, 'path-test-template', 'typescript');
    const projectDir = path.join(workDir, 'my-project');
    await fs.mkdirp(projectDir);

    await cliInit({
      ioHelper,
      fromPath: path.resolve(templateDir),
      language: 'typescript',
      canUseNetwork: false,
      generateOnly: true,
      workDir: projectDir,
    });

    expect(await fs.pathExists(path.join(projectDir, 'app.ts'))).toBeTruthy();

    await fs.remove(projectDir);
    await fs.mkdirp(projectDir);

    const relativePath = path.relative(process.cwd(), templateDir);
    await cliInit({
      ioHelper,
      fromPath: relativePath,
      language: 'typescript',
      canUseNetwork: false,
      generateOnly: true,
      workDir: projectDir,
    });

    expect(await fs.pathExists(path.join(projectDir, 'app.ts'))).toBeTruthy();
  });

  cliTest('fails when target directory is a file not a directory', async (workDir) => {
    // Test error handling when workDir is a file instead of a directory
    const templateDir = await createSingleLanguageTemplate(workDir, 'test-template', 'typescript');
    const targetFile = path.join(workDir, 'target-file');
    await fs.writeFile(targetFile, 'this is a file, not a directory');

    await expect(cliInit({
      ioHelper,
      fromPath: templateDir,
      language: 'typescript',
      canUseNetwork: false,
      generateOnly: true,
      workDir: targetFile,
    })).rejects.toThrow(/Path exists but is not a directory/);
  });

  cliTest('fails when target directory does not exist', async (workDir) => {
    // Test error handling when workDir doesn't exist
    const templateDir = await createSingleLanguageTemplate(workDir, 'test-template', 'typescript');
    const nonExistentDir = path.join(workDir, 'nonexistent-target-dir');

    await expect(cliInit({
      ioHelper,
      fromPath: templateDir,
      language: 'typescript',
      canUseNetwork: false,
      generateOnly: true,
      workDir: nonExistentDir,
    })).rejects.toThrow(/Directory does not exist:[\s\S]*Please create the directory/);
  });

  cliTest('fails when target directory is not empty', async (workDir) => {
    // Test error handling when workDir contains visible files
    const templateDir = await createSingleLanguageTemplate(workDir, 'test-template', 'typescript');
    const nonEmptyDir = path.join(workDir, 'non-empty-dir');
    await fs.mkdirp(nonEmptyDir);
    await fs.writeFile(path.join(nonEmptyDir, 'existing-file.txt'), 'existing content');
    await fs.writeFile(path.join(nonEmptyDir, 'another-file.js'), 'more content');

    await expect(cliInit({
      ioHelper,
      fromPath: templateDir,
      language: 'typescript',
      canUseNetwork: false,
      generateOnly: true,
      workDir: nonEmptyDir,
    })).rejects.toThrow(/* cdk init.*cannot be run in a non-empty directory.*Found 2 visible files*/);
  });

  cliTest('handles generic filesystem errors in directory validation', async (workDir) => {
    // Test generic error handling in assertIsEmptyDirectory
    const templateDir = await createSingleLanguageTemplate(workDir, 'test-template', 'typescript');
    const targetDir = path.join(workDir, 'target-dir');
    await fs.mkdirp(targetDir);

    // Remove read permissions to cause a different type of error
    await fs.chmod(targetDir, 0o000);

    try {
      await expect(cliInit({
        ioHelper,
        fromPath: templateDir,
        language: 'typescript',
        canUseNetwork: false,
        generateOnly: true,
        workDir: targetDir,
      })).rejects.toThrow(/Failed to validate directory/);
    } finally {
      // Restore permissions for cleanup
      await fs.chmod(targetDir, 0o755);
    }
  });

  cliTest('fails when requesting unsupported language for template', async (workDir) => {
    // Test error handling when requesting a language not supported by the template
    const templateDir = await createSingleLanguageTemplate(workDir, 'typescript-only-template', 'typescript');
    const projectDir = path.join(workDir, 'my-project');
    await fs.mkdirp(projectDir);

    await expect(cliInit({
      ioHelper,
      fromPath: templateDir,
      language: 'python', // Request Python for a TypeScript-only template
      canUseNetwork: false,
      generateOnly: true,
      workDir: projectDir,
    })).rejects.toThrow(/Unsupported language: python/);
  });

  cliTest('detects language files in subdirectories', async (workDir) => {
    // Test that hasLanguageFiles can find files in subdirectories (recursive traversal)
    const templateDir = path.join(workDir, 'nested-template');
    const tsDir = path.join(templateDir, 'typescript');
    const srcDir = path.join(tsDir, 'src');
    const libDir = path.join(srcDir, 'lib');
    await fs.mkdirp(libDir);

    // Put the TypeScript file in a nested subdirectory
    await fs.writeFile(path.join(libDir, 'index.ts'), 'export * from "./main";');
    await fs.writeFile(path.join(srcDir, 'main.ts'), 'console.log("nested");');
    await fs.writeFile(path.join(tsDir, 'package.json'), '{}');

    const projectDir = path.join(workDir, 'my-project');
    await fs.mkdirp(projectDir);

    await cliInit({
      ioHelper,
      fromPath: templateDir,
      language: 'typescript',
      canUseNetwork: false,
      generateOnly: true,
      workDir: projectDir,
    });

    // Should successfully create project since TypeScript files were found in subdirectories
    expect(await fs.pathExists(path.join(projectDir, 'src', 'main.ts'))).toBeTruthy();
    expect(await fs.pathExists(path.join(projectDir, 'src', 'lib', 'index.ts'))).toBeTruthy();
  });

  cliTest('handles npm install failure in TypeScript post-install', async (workDir) => {
    // Test npm install failure handling
    const templateDir = await createSingleLanguageTemplate(workDir, 'ts-fail-template', 'typescript');
    const projectDir = path.join(workDir, 'ts-project');
    await fs.mkdirp(projectDir);

    // Create a package.json that will cause npm install to fail
    await fs.writeFile(path.join(templateDir, 'typescript', 'package.json'),
      JSON.stringify({
        name: 'test-project',
        dependencies: { 'nonexistent-package-that-will-fail': '999.999.999' },
      }, null, 2),
    );

    // This should complete without throwing, but npm install will fail internally
    await cliInit({
      ioHelper,
      fromPath: templateDir,
      language: 'typescript',
      canUseNetwork: true, // Allow network to trigger npm install
      generateOnly: false,
      workDir: projectDir,
    });

    expect(await fs.pathExists(path.join(projectDir, 'app.ts'))).toBeTruthy();
  });

  cliTest('handles Java Gradle project without network', async (workDir) => {
    // Test Gradle project when network is disabled
    const templateDir = path.join(workDir, 'gradle-template');
    const javaDir = path.join(templateDir, 'java');
    await fs.mkdirp(javaDir);

    await fs.writeFile(path.join(javaDir, 'App.java'), 'public class App {}');
    await fs.writeFile(path.join(javaDir, 'build.gradle'), 'plugins { id "java" }');

    const projectDir = path.join(workDir, 'gradle-project');
    await fs.mkdirp(projectDir);

    await cliInit({
      ioHelper,
      fromPath: templateDir,
      language: 'java',
      canUseNetwork: false, // Disable network to test warning path
      generateOnly: false,
      workDir: projectDir,
    });

    expect(await fs.pathExists(path.join(projectDir, 'App.java'))).toBeTruthy();
    expect(await fs.pathExists(path.join(projectDir, 'build.gradle'))).toBeTruthy();
  });

  cliTest('handles Java Maven project without network', async (workDir) => {
    // Test Maven project when network is disabled
    const templateDir = path.join(workDir, 'maven-template');
    const javaDir = path.join(templateDir, 'java');
    await fs.mkdirp(javaDir);

    await fs.writeFile(path.join(javaDir, 'App.java'), 'public class App {}');
    await fs.writeFile(path.join(javaDir, 'pom.xml'), '<project></project>');

    const projectDir = path.join(workDir, 'maven-project');
    await fs.mkdirp(projectDir);

    await cliInit({
      ioHelper,
      fromPath: templateDir,
      language: 'java',
      canUseNetwork: false, // Disable network to test warning path
      generateOnly: false,
      workDir: projectDir,
    });

    expect(await fs.pathExists(path.join(projectDir, 'App.java'))).toBeTruthy();
    expect(await fs.pathExists(path.join(projectDir, 'pom.xml'))).toBeTruthy();
  });

  cliTest('handles Java project with no build file', async (workDir) => {
    // Test Java project without build.gradle or pom.xml
    const templateDir = path.join(workDir, 'plain-java-template');
    const javaDir = path.join(templateDir, 'java');
    await fs.mkdirp(javaDir);

    await fs.writeFile(path.join(javaDir, 'App.java'), 'public class App {}');
    // No build.gradle or pom.xml

    const projectDir = path.join(workDir, 'plain-java-project');
    await fs.mkdirp(projectDir);

    await cliInit({
      ioHelper,
      fromPath: templateDir,
      language: 'java',
      canUseNetwork: true,
      generateOnly: false,
      workDir: projectDir,
    });

    expect(await fs.pathExists(path.join(projectDir, 'App.java'))).toBeTruthy();
  });

  cliTest('handles Python project without requirements.txt', async (workDir) => {
    // Test Python project without requirements.txt
    const templateDir = path.join(workDir, 'plain-python-template');
    const pythonDir = path.join(templateDir, 'python');
    await fs.mkdirp(pythonDir);

    await fs.writeFile(path.join(pythonDir, 'app.py'), 'print("hello")');
    // No requirements.txt

    const projectDir = path.join(workDir, 'plain-python-project');
    await fs.mkdirp(projectDir);

    await cliInit({
      ioHelper,
      fromPath: templateDir,
      language: 'python',
      canUseNetwork: true,
      generateOnly: false,
      workDir: projectDir,
    });

    expect(await fs.pathExists(path.join(projectDir, 'app.py'))).toBeTruthy();
  });

  cliTest('handles Go project without network', async (workDir) => {
    // Test Go project when network is disabled
    const templateDir = path.join(workDir, 'go-template');
    const goDir = path.join(templateDir, 'go');
    await fs.mkdirp(goDir);

    await fs.writeFile(path.join(goDir, 'main.go'), 'package main\nfunc main() {}');
    await fs.writeFile(path.join(goDir, 'go.mod'), 'module test');

    const projectDir = path.join(workDir, 'go-project');
    await fs.mkdirp(projectDir);

    await cliInit({
      ioHelper,
      fromPath: templateDir,
      language: 'go',
      canUseNetwork: false, // Disable network to test warning path
      generateOnly: false,
      workDir: projectDir,
    });

    expect(await fs.pathExists(path.join(projectDir, 'main.go'))).toBeTruthy();
    expect(await fs.pathExists(path.join(projectDir, 'go.mod'))).toBeTruthy();
  });

  cliTest('handles C# project without network', async (workDir) => {
    // Test C# project when network is disabled
    const templateDir = path.join(workDir, 'csharp-template');
    const csharpDir = path.join(templateDir, 'csharp');
    await fs.mkdirp(csharpDir);

    await fs.writeFile(path.join(csharpDir, 'Program.cs'), 'class Program { static void Main() {} }');
    await fs.writeFile(path.join(csharpDir, 'test.csproj'), '<Project Sdk="Microsoft.NET.Sdk"></Project>');

    const projectDir = path.join(workDir, 'csharp-project');
    await fs.mkdirp(projectDir);

    await cliInit({
      ioHelper,
      fromPath: templateDir,
      language: 'csharp',
      canUseNetwork: false, // Disable network to test warning path
      generateOnly: false,
      workDir: projectDir,
    });

    expect(await fs.pathExists(path.join(projectDir, 'Program.cs'))).toBeTruthy();
    expect(await fs.pathExists(path.join(projectDir, 'test.csproj'))).toBeTruthy();
  });

  cliTest('handles F# project delegation to C# post-install', async (workDir) => {
    // Test F# project (should delegate to C# post-install logic)
    const templateDir = path.join(workDir, 'fsharp-template');
    const fsharpDir = path.join(templateDir, 'fsharp');
    await fs.mkdirp(fsharpDir);

    await fs.writeFile(path.join(fsharpDir, 'Program.fs'), '[<EntryPoint>]\nlet main argv = 0');
    await fs.writeFile(path.join(fsharpDir, 'test.fsproj'), '<Project Sdk="Microsoft.NET.Sdk"></Project>');

    const projectDir = path.join(workDir, 'fsharp-project');
    await fs.mkdirp(projectDir);

    await cliInit({
      ioHelper,
      fromPath: templateDir,
      language: 'fsharp',
      canUseNetwork: false, // Disable network to test warning path
      generateOnly: false,
      workDir: projectDir,
    });

    expect(await fs.pathExists(path.join(projectDir, 'Program.fs'))).toBeTruthy();
    expect(await fs.pathExists(path.join(projectDir, 'test.fsproj'))).toBeTruthy();
  });

  cliTest('handles Gradle build failure with network enabled', async (workDir) => {
    // Test Gradle build failure handling when network is enabled
    const templateDir = path.join(workDir, 'gradle-fail-template');
    const javaDir = path.join(templateDir, 'java');
    await fs.mkdirp(javaDir);

    await fs.writeFile(path.join(javaDir, 'App.java'), 'public class App {}');
    // Create an invalid build.gradle that will cause build to fail
    await fs.writeFile(path.join(javaDir, 'build.gradle'), 'invalid gradle syntax that will fail');

    const projectDir = path.join(workDir, 'gradle-fail-project');
    await fs.mkdirp(projectDir);

    // Should complete without throwing even if gradle build fails
    await cliInit({
      ioHelper,
      fromPath: templateDir,
      language: 'java',
      canUseNetwork: true, // Enable network to trigger gradle build
      generateOnly: false,
      workDir: projectDir,
    });

    expect(await fs.pathExists(path.join(projectDir, 'App.java'))).toBeTruthy();
    expect(await fs.pathExists(path.join(projectDir, 'build.gradle'))).toBeTruthy();
  });

  cliTest('handles Maven build failure with network enabled', async (workDir) => {
    // Test Maven build failure handling when network is enabled
    const templateDir = path.join(workDir, 'maven-fail-template');
    const javaDir = path.join(templateDir, 'java');
    await fs.mkdirp(javaDir);

    await fs.writeFile(path.join(javaDir, 'App.java'), 'public class App {}');
    // Create an invalid pom.xml that will cause build to fail
    await fs.writeFile(path.join(javaDir, 'pom.xml'), '<invalid>xml</invalid>');

    const projectDir = path.join(workDir, 'maven-fail-project');
    await fs.mkdirp(projectDir);

    // Should complete without throwing even if maven build fails
    await cliInit({
      ioHelper,
      fromPath: templateDir,
      language: 'java',
      canUseNetwork: true, // Enable network to trigger maven build
      generateOnly: false,
      workDir: projectDir,
    });

    expect(await fs.pathExists(path.join(projectDir, 'App.java'))).toBeTruthy();
    expect(await fs.pathExists(path.join(projectDir, 'pom.xml'))).toBeTruthy();
  });

  cliTest('handles Python virtualenv creation failure', async (workDir) => {
    // Test Python virtualenv creation failure handling
    const templateDir = path.join(workDir, 'python-fail-template');
    const pythonDir = path.join(templateDir, 'python');
    await fs.mkdirp(pythonDir);

    await fs.writeFile(path.join(pythonDir, 'app.py'), 'print("hello")');
    // Create requirements.txt with invalid package to cause pip install to fail
    await fs.writeFile(path.join(pythonDir, 'requirements.txt'), 'nonexistent-package-that-will-fail==999.999.999');

    const projectDir = path.join(workDir, 'python-fail-project');
    await fs.mkdirp(projectDir);

    // Should complete without throwing even if python setup fails
    await cliInit({
      ioHelper,
      fromPath: templateDir,
      language: 'python',
      canUseNetwork: true, // Enable network to trigger python setup
      generateOnly: false,
      workDir: projectDir,
    });

    expect(await fs.pathExists(path.join(projectDir, 'app.py'))).toBeTruthy();
    expect(await fs.pathExists(path.join(projectDir, 'requirements.txt'))).toBeTruthy();
  });

  cliTest('handles Go mod tidy failure with network enabled', async (workDir) => {
    // Test Go mod tidy failure handling when network is enabled
    const templateDir = path.join(workDir, 'go-fail-template');
    const goDir = path.join(templateDir, 'go');
    await fs.mkdirp(goDir);

    await fs.writeFile(path.join(goDir, 'main.go'), 'package main\nfunc main() {}');
    // Create an invalid go.mod that will cause mod tidy to fail
    await fs.writeFile(path.join(goDir, 'go.mod'), 'invalid go.mod syntax');

    const projectDir = path.join(workDir, 'go-fail-project');
    await fs.mkdirp(projectDir);

    // Should complete without throwing even if go mod tidy fails
    await cliInit({
      ioHelper,
      fromPath: templateDir,
      language: 'go',
      canUseNetwork: true, // Enable network to trigger go mod tidy
      generateOnly: false,
      workDir: projectDir,
    });

    expect(await fs.pathExists(path.join(projectDir, 'main.go'))).toBeTruthy();
    expect(await fs.pathExists(path.join(projectDir, 'go.mod'))).toBeTruthy();
  });

  cliTest('handles dotnet restore/build failure with network enabled', async (workDir) => {
    // Test dotnet restore/build failure handling when network is enabled
    const templateDir = path.join(workDir, 'dotnet-fail-template');
    const csharpDir = path.join(templateDir, 'csharp');
    await fs.mkdirp(csharpDir);

    await fs.writeFile(path.join(csharpDir, 'Program.cs'), 'class Program { static void Main() {} }');
    // Create an invalid csproj that will cause dotnet commands to fail
    await fs.writeFile(path.join(csharpDir, 'test.csproj'), '<invalid>project</invalid>');

    const projectDir = path.join(workDir, 'dotnet-fail-project');
    await fs.mkdirp(projectDir);

    // Should complete without throwing even if dotnet commands fail
    await cliInit({
      ioHelper,
      fromPath: templateDir,
      language: 'csharp',
      canUseNetwork: true, // Enable network to trigger dotnet commands
      generateOnly: false,
      workDir: projectDir,
    });

    expect(await fs.pathExists(path.join(projectDir, 'Program.cs'))).toBeTruthy();
    expect(await fs.pathExists(path.join(projectDir, 'test.csproj'))).toBeTruthy();
  });

  cliTest('adds migrate context when migrate option is enabled', async (workDir) => {
    // Test that migrate context is added to cdk.json when migrate option is true
    await cliInit({
      ioHelper,
      type: 'app',
      language: 'typescript',
      canUseNetwork: false,
      generateOnly: true,
      migrate: true, // Enable migrate option
      workDir,
    });

    // Check that cdk.json was created and contains migrate context
    expect(await fs.pathExists(path.join(workDir, 'cdk.json'))).toBeTruthy();
    const cdkJson = await fs.readJson(path.join(workDir, 'cdk.json'));
    expect(cdkJson.context).toHaveProperty('cdk-migrate', true);
  });

  cliTest('handles migrate context when no cdk.json exists', async (workDir) => {
    // Test that addMigrateContext handles missing cdk.json gracefully
    const templateDir = path.join(workDir, 'no-cdk-json-template');
    const tsDir = path.join(templateDir, 'typescript');
    await fs.mkdirp(tsDir);

    await fs.writeFile(path.join(tsDir, 'app.ts'), 'console.log("no cdk.json");');
    await fs.writeFile(path.join(tsDir, 'package.json'), '{}');
    // Intentionally don't create cdk.json

    const projectDir = path.join(workDir, 'no-cdk-json-project');
    await fs.mkdirp(projectDir);

    await cliInit({
      ioHelper,
      fromPath: templateDir,
      language: 'typescript',
      canUseNetwork: false,
      generateOnly: true,
      migrate: true, // Enable migrate option
      workDir: projectDir,
    });

    // Should complete successfully even without cdk.json
    expect(await fs.pathExists(path.join(projectDir, 'app.ts'))).toBeTruthy();
    // cdk.json should not exist since template didn't have one
    expect(await fs.pathExists(path.join(projectDir, 'cdk.json'))).toBeFalsy();
  });

  describe('package-manager option', () => {
    test.each([
      ['typescript', 'npm', 'package-lock.json'],
      ['typescript', 'yarn', 'yarn.lock'],
      ['typescript', 'pnpm', 'pnpm-lock.yaml'],
      ['javascript', 'npm', 'package-lock.json'],
      ['javascript', 'yarn', 'yarn.lock'],
      ['javascript', 'pnpm', 'pnpm-lock.yaml'],
    ])('creates %s project with %s (verifying %s)', async (language, packageManager, lockFile) => {
      // Check if the package manager is available
      const { exec } = await import('child_process');
      const { promisify } = await import('util');
      const execAsync = promisify(exec);

      try {
        await execAsync(`${packageManager} --version`);
      } catch {
        // Skip test if package manager is not installed
        console.log(`Skipping test: ${packageManager} is not installed`);
        return;
      }

      await withTempDir(async (workDir) => {
        await cliInit({
          ioHelper,
          type: 'app',
          language,
          packageManager: packageManager as any,
          canUseNetwork: true,
          generateOnly: false,
          workDir,
        });

        // Verify that the correct lock file was created
        expect(await fs.pathExists(path.join(workDir, lockFile))).toBeTruthy();
        expect(await fs.pathExists(path.join(workDir, 'package.json'))).toBeTruthy();
      });
    });

    cliTest('uses npm as default when package manager not specified', async (workDir) => {
      await cliInit({
        ioHelper,
        type: 'app',
        language: 'typescript',
        canUseNetwork: false,
        generateOnly: true,
        workDir,
      });

      expect(await fs.pathExists(path.join(workDir, 'package.json'))).toBeTruthy();
    });

    cliTest('ignores package manager option for non-JavaScript languages', async (workDir) => {
      await cliInit({
        ioHelper,
        type: 'app',
        language: 'python',
        packageManager: 'yarn' as any,
        canUseNetwork: false,
        generateOnly: true,
        workDir,
      });

      expect(await fs.pathExists(path.join(workDir, 'requirements.txt'))).toBeTruthy();
    });
  });
});

test('when no version number is present (e.g., local development), the v2 templates are chosen by default', async () => {
  expect((await availableInitTemplates()).length).toBeGreaterThan(0);
});

test('check available init languages', async () => {
  const langs = await availableInitLanguages();
  expect(langs.length).toBeGreaterThan(0);
  expect(langs).toContain('typescript');
  expect(langs).toContain('ts');
});

test('exercise printing available templates', async () => {
  await printAvailableTemplates(ioHelper);
});

describe('expandPlaceholders', () => {
  test('distinguish library and CLI version', () => {
    const translated = expandPlaceholders('%cdk-version% and %cdk-cli-version%', 'javascript', {
      name: 'test',
      versions: {
        'aws-cdk': '1',
        'aws-cdk-lib': '2',
        'constructs': '3',
      },
    });

    expect(translated).toEqual('2 and 1');
  });
});

function cliTest(name: string, handler: (dir: string) => void | Promise<any>): void {
  test(name, () => withTempDir(handler));
}

async function withTempDir(cb: (dir: string) => void | Promise<any>) {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'aws-cdk-test'));
  try {
    await cb(tmpDir);
  } finally {
    await fs.remove(tmpDir);
  }
}

function cliTestWithDirSpaces(name: string, handler: (dir: string) => void | Promise<any>): void {
  test(name, () => withTempDirWithSpaces(handler));
}

async function withTempDirWithSpaces(cb: (dir: string) => void | Promise<any>) {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'aws-cdk-test with-space'));
  try {
    await cb(tmpDir);
  } finally {
    await fs.remove(tmpDir);
  }
}

/**
 * List all files underneath dir
 */
async function recursiveListFiles(rdir: string): Promise<string[]> {
  const ret = new Array<string>();
  await recurse(rdir);
  return ret;

  async function recurse(dir: string) {
    for (const name of await fs.readdir(dir)) {
      const fullPath = path.join(dir, name);
      if ((await fs.stat(fullPath)).isDirectory()) {
        await recurse(fullPath);
      } else {
        ret.push(fullPath);
      }
    }
  }
}

async function withReplacedFile(fileName: string, contents: any, cb: () => Promise<void>): Promise<void> {
  const oldContents = await fs.readFile(fileName, 'utf8');
  await fs.writeFile(fileName, contents);
  try {
    await cb();
  } finally {
    await fs.writeFile(fileName, oldContents);
  }
}
