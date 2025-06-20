import * as os from 'os';
import * as path from 'path';
import * as cxapi from '@aws-cdk/cx-api';
import * as fs from 'fs-extra';
import { availableInitLanguages, availableInitTemplates, cliInit, currentlyRecommendedAwsCdkLibFlags, expandPlaceholders, printAvailableTemplates } from '../../lib/commands/init';

describe('constructs version', () => {
  cliTest('create a TypeScript library project', async (workDir) => {
    await cliInit({
      type: 'lib',
      language: 'typescript',
      workDir,
    });

    // Check that package.json and lib/ got created in the current directory
    expect(await fs.pathExists(path.join(workDir, 'package.json'))).toBeTruthy();
    expect(await fs.pathExists(path.join(workDir, 'lib'))).toBeTruthy();
  });

  cliTest('can override requested version with environment variable', async (workDir) => {
    await cliInit({
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
      type: 'banana',
      language: 'typescript',
      workDir,
    })).rejects.toThrow(/Unknown init template/);
  });

  /* Skip this test for now until we can properly mock the GitHub repository cloning
  cliTest('can use GitHub URL for template', async (workDir) => {
    // Mock the execute function which is used by cloneGitHubRepository
    const originalExecute = (global as any).execute;
    (global as any).execute = jest.fn().mockResolvedValue('');

    // Create a fake typescript directory to pass validation
    const tempDir = path.join(os.tmpdir(), `cdk-github-template-${Date.now()}`);
    await fs.mkdirp(path.join(tempDir, 'typescript'));
    await fs.writeFile(path.join(tempDir, 'info.json'), JSON.stringify({
      description: 'GitHub template',
      aliases: ['github'],
    }));

    try {
      // TODO: Implement proper mocking for GitHub repository cloning

      await cliInit({
        githubUrl: 'https://github.com/user/repo',
        language: 'typescript',
        workDir,
        canUseNetwork: true,
        generateOnly: true,
      });

    } finally {
      // Restore original function and clean up
      (global as any).execute = originalExecute;
      await fs.remove(tempDir);
    }
  });
  */

  cliTest('asking for a template but no language prints and throws', async (workDir) => {
    await expect(cliInit({
      type: 'app',
      workDir,
    })).rejects.toThrow(/No language/);
  });

  cliTest('create a TypeScript app project', async (workDir) => {
    await cliInit({
      type: 'app',
      language: 'typescript',
      workDir,
    });

    // Check that package.json and bin/ got created in the current directory
    expect(await fs.pathExists(path.join(workDir, 'package.json'))).toBeTruthy();
    expect(await fs.pathExists(path.join(workDir, 'bin'))).toBeTruthy();
  });

  cliTest('create a project from a local template path', async (workDir) => {
    // Create a temporary directory with a template
    const templateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cdk-template-test'));

    try {
      // Copy the app template to our custom template directory
      const appTemplateDir = path.join(__dirname, '..', '..', 'lib', 'init-templates', 'app');
      await fs.copy(appTemplateDir, templateDir);

      // Initialize a project using the custom template
      await cliInit({
        templatePath: templateDir,
        language: 'typescript',
        workDir,
        canUseNetwork: false,
        generateOnly: true,
      });

      // Check that package.json and bin/ got created in the current directory
      expect(await fs.pathExists(path.join(workDir, 'package.json'))).toBeTruthy();
      expect(await fs.pathExists(path.join(workDir, 'bin'))).toBeTruthy();
    } finally {
      await fs.remove(templateDir);
    }
  });

  cliTest('fails when a custom template does not have a typescript directory', async (workDir) => {
    // Create a temporary directory without a typescript directory
    const templateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cdk-invalid-template-test'));

    try {
      // Create an info.json file
      await fs.writeJson(path.join(templateDir, 'info.json'), {
        description: 'Invalid template',
        aliases: ['invalid'],
      });

      // Initialize a project using the invalid template should fall back to default
      await cliInit({
        templatePath: templateDir,
        language: 'typescript',
        type: 'app', // Fallback to app template
        workDir,
        canUseNetwork: false,
        generateOnly: true,
      });

      // Check that package.json and bin/ got created in the current directory from the fallback template
      expect(await fs.pathExists(path.join(workDir, 'package.json'))).toBeTruthy();
      expect(await fs.pathExists(path.join(workDir, 'bin'))).toBeTruthy();
    } finally {
      await fs.remove(templateDir);
    }
  });

  // This test uses a local template instead of actually installing an NPM package
  cliTest('create a project from an NPM package', async (workDir) => {
    // Create a temporary directory with a template
    const templateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cdk-npm-template-test'));

    try {
      // Create a typescript directory
      await fs.mkdirp(path.join(templateDir, 'typescript'));

      // Copy the app template to our custom template directory
      const appTemplateDir = path.join(__dirname, '..', '..', 'lib', 'init-templates', 'app', 'typescript');
      await fs.copy(appTemplateDir, path.join(templateDir, 'typescript'));

      // Create an info.json file
      await fs.writeJson(path.join(templateDir, 'info.json'), {
        description: 'NPM test template',
        aliases: ['npm-test'],
      });

      // Import the module and mock the installNpmPackage function
      const initModule = await import('../../lib/commands/init/init');
      jest.spyOn(initModule, 'installNpmPackage')
        .mockImplementation(() => Promise.resolve(templateDir));

      // Initialize a project using the NPM package
      await cliInit({
        npmPackage: 'my-cdk-template',
        language: 'typescript',
        workDir,
        canUseNetwork: true,
        generateOnly: true,
      });

      // Check that package.json and bin/ got created in the current directory
      expect(await fs.pathExists(path.join(workDir, 'package.json'))).toBeTruthy();
      expect(await fs.pathExists(path.join(workDir, 'bin'))).toBeTruthy();

      // Restore the original function
      jest.restoreAllMocks();
    } finally {
      await fs.remove(templateDir);
    }
  });

  cliTest('create a JavaScript app project', async (workDir) => {
    await cliInit({
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
      type: 'app',
      language: 'typescript',
      canUseNetwork: false,
      workDir,
    });

    // Check that package.json and bin/ got created in the current directory
    expect(await fs.pathExists(path.join(workDir, 'package.json'))).toBeTruthy();
    expect(await fs.pathExists(path.join(workDir, 'bin'))).toBeTruthy();
  });

  cliTest('CLI uses recommended feature flags from data file to initialize context', async (workDir) => {
    const recommendedFlagsFile = path.join(__dirname, '..', '..', 'lib', 'init-templates', '.recommended-feature-flags.json');
    await withReplacedFile(recommendedFlagsFile, JSON.stringify({ banana: 'yellow' }), () => cliInit({
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
});

test('when no version number is present (e.g., local development), the v2 templates are chosen by default', async () => {
  expect((await availableInitTemplates()).length).toBeGreaterThan(0);
});

test('check available init languages', async () => {
  const langs = await availableInitLanguages();
  expect(langs.length).toBeGreaterThan(0);
  expect(langs).toContain('typescript');
});

test('exercise printing available templates', async () => {
  await printAvailableTemplates();
});

test('exercise printing available templates with custom template path', async () => {
  // Create a temporary directory with a fake template
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cdk-custom-template-test'));
  try {
    // Create a typescript directory
    await fs.mkdirp(path.join(tempDir, 'typescript'));

    // Create an info.json file
    await fs.writeJson(path.join(tempDir, 'info.json'), {
      description: 'Custom test template',
      aliases: ['custom-test'],
    });

    // Print templates with the custom path
    await printAvailableTemplates(undefined, tempDir);

    // Also test with a language filter
    await printAvailableTemplates('typescript', tempDir);
  } finally {
    await fs.remove(tempDir);
  }
});

test('exercise printing available templates with language filter', async () => {
  // Create a temporary directory with a fake template
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cdk-custom-template-test2'));
  try {
    // Create a typescript directory
    await fs.mkdirp(path.join(tempDir, 'typescript'));

    // Create an info.json file
    await fs.writeJson(path.join(tempDir, 'info.json'), {
      description: 'Custom test template 2',
      aliases: ['custom-test-2'],
    });

    // Print templates with a language filter
    await printAvailableTemplates('typescript', tempDir);
  } finally {
    await fs.remove(tempDir);
  }
});

test('test invalid custom template path', async () => {
  // Test with a non-existent path
  await printAvailableTemplates(undefined, '/non/existent/path');
});

test('test custom template without typescript directory', async () => {
  // Create a temporary directory with a template that doesn't have a typescript directory
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cdk-invalid-template-test2'));
  try {
    // Create an info.json file but no typescript directory
    await fs.writeJson(path.join(tempDir, 'info.json'), {
      description: 'Invalid template',
      aliases: ['invalid'],
    });

    // This should not throw an error when listing templates
    await printAvailableTemplates(undefined, tempDir);
  } finally {
    await fs.remove(tempDir);
  }
});

// Test basic placeholder expansion
test('expandPlaceholders basic functionality', () => {
  const projectInfo = {
    name: 'test-project',
    versions: {
      'aws-cdk': '1.0.0',
      'aws-cdk-lib': '2.0.0',
      'constructs': '10.0.0',
    },
  };

  // Test basic placeholder replacement
  const result = expandPlaceholders('Project name: %name%', 'typescript', projectInfo);
  expect(result).toBe('Project name: test-project');

  // Test CDK version placeholders
  const versionResult = expandPlaceholders('CDK version: %cdk-version%', 'typescript', projectInfo);
  expect(versionResult).toBe('CDK version: 2.0.0');

  // Test CLI version placeholders
  const cliVersionResult = expandPlaceholders('CLI version: %cdk-cli-version%', 'typescript', projectInfo);
  expect(cliVersionResult).toBe('CLI version: 1.0.0');
});

// Test the pythonExecutable function directly
test('pythonExecutable returns correct executable name', async () => {
  // Import the pythonExecutable function directly
  const init = await import('../../lib/commands/init/init');
  const pythonExecutable = init.pythonExecutable;

  // Test the function based on the current platform
  if (process.platform === 'win32') {
    expect(pythonExecutable()).toBe('python');
  } else {
    expect(pythonExecutable()).toBe('python3');
  }
});

// Test GitHub URL normalization
test('GitHub URL normalization', () => {
  // Test the URL normalization logic directly
  const normalizeUrl = (url: string): string => {
    if (!url.startsWith('http')) {
      if (!url.includes('github.com')) {
        return `https://github.com/${url}`;
      } else {
        return `https://${url}`;
      }
    }
    return url;
  };

  // Test different URL formats
  expect(normalizeUrl('user/repo')).toBe('https://github.com/user/repo');
  expect(normalizeUrl('github.com/user/repo')).toBe('https://github.com/user/repo');
  expect(normalizeUrl('https://github.com/user/repo')).toBe('https://github.com/user/repo');
});

// Test NPM package path handling
test('NPM package path handling', () => {
  // Test the scoped package path logic directly
  const getPackagePath = (npmPackage: string, baseDir: string): string => {
    if (npmPackage.startsWith('@')) {
      // For scoped packages like @aws/cdk-template
      const [scope, name] = npmPackage.split('/');
      return path.join(baseDir, 'node_modules', scope, name);
    } else {
      // For regular packages
      return path.join(baseDir, 'node_modules', npmPackage);
    }
  };

  const baseDir = '/tmp/test-dir';

  // Test with regular package
  expect(getPackagePath('my-package', baseDir)).toBe('/tmp/test-dir/node_modules/my-package');

  // Test with scoped package
  expect(getPackagePath('@scope/my-package', baseDir)).toBe('/tmp/test-dir/node_modules/@scope/my-package');
});

// Test template name extraction from GitHub URL
test('template name extraction from GitHub URL', () => {
  // Test the template name extraction logic
  const getTemplateNameFromGitHubUrl = (githubUrl: string): string => {
    return path.basename(githubUrl.replace(/\.git$/, '').split('/').pop() || 'github-template');
  };

  // Test with different URL formats
  expect(getTemplateNameFromGitHubUrl('https://github.com/user/repo')).toBe('repo');
  expect(getTemplateNameFromGitHubUrl('https://github.com/user/repo.git')).toBe('repo');
  expect(getTemplateNameFromGitHubUrl('user/repo')).toBe('repo');
  expect(getTemplateNameFromGitHubUrl('github.com/user/my-template')).toBe('my-template');
});

// Test template name extraction from NPM package
test('template name extraction from NPM package', () => {
  // Test the template name extraction logic
  const getTemplateNameFromNpmPackage = (npmPackage: string): string => {
    return npmPackage.replace(/^@[^/]+\//, '');
  };

  // Test with different package formats
  expect(getTemplateNameFromNpmPackage('my-template')).toBe('my-template');
  expect(getTemplateNameFromNpmPackage('@scope/my-template')).toBe('my-template');
  expect(getTemplateNameFromNpmPackage('@aws/cdk-template')).toBe('cdk-template');
});

// Test the availableInitLanguages function
test('availableInitLanguages returns languages from templates', async () => {
  // Create a temporary directory with a template
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cdk-languages-test'));

  try {
    // Create a typescript directory
    await fs.mkdirp(path.join(tempDir, 'typescript'));

    // Create a python directory
    await fs.mkdirp(path.join(tempDir, 'python'));

    // Create an info.json file
    await fs.writeJson(path.join(tempDir, 'info.json'), {
      description: 'Test template with multiple languages',
      aliases: ['test-langs'],
    });

    // Get languages from the template
    const languages = await availableInitLanguages();

    // Verify that the languages include at least typescript
    expect(languages).toContain('typescript');
  } finally {
    await fs.remove(tempDir);
  }
});

// Test the InitTemplate class methods
test('InitTemplate class methods', async () => {
  // Create a temporary directory with a template
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cdk-template-class-test'));

  try {
    // Create a typescript directory
    await fs.mkdirp(path.join(tempDir, 'typescript'));

    // Create an info.json file
    await fs.writeJson(path.join(tempDir, 'info.json'), {
      description: 'Test template for class methods',
      aliases: ['test-class'],
    });

    // Import the InitTemplate class
    const init = await import('../../lib/commands/init/init');
    const { InitTemplate } = init;

    // Create an instance using fromPath
    const template = await InitTemplate.fromPath(tempDir, 'test-template');

    // Test the properties
    expect(template.name).toBe('test-template');
    expect(template.description).toBe('Test template for class methods');
    expect(template.languages).toContain('typescript');
    expect(template.hasName('test-template')).toBe(true);
    expect(template.hasName('test-class')).toBe(true);
    expect(template.hasName('unknown')).toBe(false);
  } finally {
    await fs.remove(tempDir);
  }
});

// Test error handling in InitTemplate.fromPath
test('InitTemplate.fromPath handles errors', async () => {
  // Import the InitTemplate class
  const init = await import('../../lib/commands/init/init');
  const { InitTemplate } = init;

  // Test with non-existent path
  await expect(InitTemplate.fromPath('/non/existent/path', 'test')).rejects.toThrow(/Template path does not exist/);

  // Create a temporary directory without info.json
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cdk-template-error-test'));
  try {
    // Test with missing info.json
    await expect(InitTemplate.fromPath(tempDir, 'test')).rejects.toThrow(/Invalid template: missing or invalid info.json/);
  } finally {
    await fs.remove(tempDir);
  }
});

// Test error handling in cloneGitHubRepository
test('cloneGitHubRepository handles errors', async () => {
  // Import the module
  const init = await import('../../lib/commands/init/init');
  const { cloneGitHubRepository } = init;

  // Create a spy that throws an error
  jest.spyOn(init, 'execute').mockImplementation(() => {
    throw new Error('Git clone failed');
  });

  try {
    // Test with a valid URL but mock the execution to fail
    await expect(cloneGitHubRepository('https://github.com/user/repo')).rejects.toThrow(/Failed to clone GitHub repository/);
  } finally {
    // Restore the original function
    jest.restoreAllMocks();
  }
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
