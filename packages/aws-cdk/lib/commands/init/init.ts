import * as childProcess from 'child_process';
import * as os from 'os';
import * as path from 'path';
import { ToolkitError } from '@aws-cdk/toolkit-lib';
import * as chalk from 'chalk';
import * as fs from 'fs-extra';
import { invokeBuiltinHooks } from './init-hooks';
import { cliRootDir } from '../../cli/root-dir';
import { versionNumber } from '../../cli/version';
import { error, info, warning } from '../../logging';
import { cdkHomeDir, formatErrorMessage, rangeFromSemver } from '../../util';

/* eslint-disable @typescript-eslint/no-var-requires */ // Packages don't have @types module
// eslint-disable-next-line @typescript-eslint/no-require-imports
const camelCase = require('camelcase');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const decamelize = require('decamelize');

/**
 * Config options for the CDK init command.
 * - Built-in templates: use 'type' (e.g., 'app', 'lib')
 * - Local templates: use 'templatePath'
 * - Git templates: use 'gitUrl' (optionally with 'templateName')
 * - NPM templates: use 'npmPackage' (optionally with 'templateName')
 */
export interface CliInitOptions {
  readonly type?: string;
  
  readonly language?: string;
  
  readonly canUseNetwork?: boolean;
  
  readonly generateOnly?: boolean;
  
  readonly workDir?: string;
  
  readonly stackName?: string;
  
  readonly migrate?: boolean;

  readonly libVersion?: string;

  // Path to a local template directory containing info.json
  readonly templatePath?: string;

  // Git repository URL containing templates
  readonly gitUrl?: string;

  /** 
   * Template name when Git repo or NPM package contains multiple templates.
   * Required if multiple templates found and ignored if only one template exists.
   */
  readonly templateName?: string;

  // NPM package name containing templates
  readonly npmPackage?: string;
}

/**
 * Initialize a CDK package in the current directory
 */
export async function cliInit(options: CliInitOptions) {
  const canUseNetwork = options.canUseNetwork ?? true;  // Default: allow network access
  const generateOnly = options.generateOnly ?? false;   // Default: run full initialization
  const workDir = options.workDir ?? process.cwd();     // Default: current directory

  // If no template source and language specified, display available templates
  if (!options.type && !options.language && !options.templatePath && !options.gitUrl && !options.npmPackage) {
    await printAvailableTemplates(undefined, options.templatePath);
    return;
  }

  let template: InitTemplate | undefined;  // Will hold the loaded template object
  let language = options.language;         // Auto detected for single language templates
  let tempDir: string | undefined;         // Tracks temporary directories for cleanup

  try {
    // BRANCH 1: Git Repository Template Source
    if (options.gitUrl) {
      // Validates that network access is available for Git operations
      if (!canUseNetwork) {
        throw new ToolkitError('Cannot use Git URL without network access');
      }

      try {
        const gitUrl = options.gitUrl;

        // Clone repository to temp directory
        tempDir = await cloneGitRepository(gitUrl);

        let templatePath = tempDir;              // Start searching from repo root
        let templateName = options.templateName; // User specified template name

        // Template discovery for Git repositories
        if (!templateName) {
          // If no specific template name provided by user
          // Check if repository root contains info.json which indicates single template at root
          const hasInfoJson = await fs.pathExists(path.join(tempDir, INFO_DOT_JSON));

          if (hasInfoJson) {
            // CASE 1: Single template at repository root
            // Extract template name from Git URL
            templateName = path.basename(gitUrl.replace(/\.git$/, '').split('/').pop() || 'git-template');
            template = await InitTemplate.fromPath(templatePath, templateName);
          } else {
            // CASE 2: Multiple templates in subdirectories
            // Scan for subdirectories
            const subdirs = (await fs.readdir(tempDir)).filter(p => !p.startsWith('.'));
            const templateDirs = [];

            // Find all valid template directories that contain an info.json file
            for (const subdir of subdirs) {
              const subdirPath = path.join(tempDir, subdir);
              const isDir = (await fs.stat(subdirPath)).isDirectory();
              const hasTemplateInfoJson = await fs.pathExists(path.join(subdirPath, INFO_DOT_JSON));

              if (isDir && hasTemplateInfoJson) {
                templateDirs.push(subdir);
              }
            }

            if (templateDirs.length === 0) {
              // If no templates are found, throw error
              throw new ToolkitError('Git repository does not contain any valid templates');
            } else if (templateDirs.length === 1) {
              // If only one template found, use it automatically
              templateName = templateDirs[0];
              templatePath = path.join(tempDir, templateName);
              template = await InitTemplate.fromPath(templatePath, templateName);
            } else {
              // If multiple templates found, require user to pass in template-name
              throw new ToolkitError(`Git repository contains multiple templates: ${templateDirs.join(', ')}. Please specify --template-name`);
            }
          }
        } else {
          // If user provides specific template name via --template-name parameter
          const specificTemplatePath = path.join(tempDir, templateName);
          
          // Validate template exists and has required info.json
          if (await fs.pathExists(specificTemplatePath) && await fs.pathExists(path.join(specificTemplatePath, INFO_DOT_JSON))) {
            templatePath = specificTemplatePath;
            template = await InitTemplate.fromPath(templatePath, templateName);
          } else {
            throw new ToolkitError(`Template '${templateName}' not found in the Git repository`);
          }
        }

        // Validate that template has at least one CDK supported language subdirectory
        if (template.languages.length === 0) {
          throw new ToolkitError('Git template must contain at least one language directory');
        }
      } catch (e: any) {
        throw new ToolkitError(`Failed to load template from Git repository: ${e.message}`);
      }
      
    // BRANCH 2: NPM Package Template Source  
    } else if (options.npmPackage) {
      // Validate network access is available for NPM operations
      if (!canUseNetwork) {
        throw new ToolkitError('Cannot use NPM package without network access');
      }

      try {
        // Install NPM package to temporary directory
        tempDir = await installNpmPackage(options.npmPackage);

        let templatePath = tempDir;              // Start searching from package root
        let templateName = options.templateName; // User specified template name

        // Template discovery for NPM Packages
        if (!templateName) {
          // If no specific template name provided by user
          // Check if repository root contains info.json which indicates single template at root
          const hasInfoJson = await fs.pathExists(path.join(templatePath, INFO_DOT_JSON));

          if (hasInfoJson) {
            // CASE 1: Single template at package root
            // Extract template name from package name
            templateName = options.npmPackage.split('/').pop() || options.npmPackage;
          } else {
            // CASE 2: Multiple templates in subdirectories
            // Use listDirectory helper to filter out hidden files and metadata**
            const subdirs = await listDirectory(templatePath);
            const templateDirs = [];

            // Find all valid template directories that contain an info.json file
            for (const subdir of subdirs) {
              const subdirPath = path.join(templatePath, subdir);
              const isDir = (await fs.stat(subdirPath)).isDirectory();
              const hasTemplateInfoJson = await fs.pathExists(path.join(subdirPath, INFO_DOT_JSON));

              if (isDir && hasTemplateInfoJson) {
                templateDirs.push(subdir);
              }
            }

            if (templateDirs.length === 0) {
              // If no templates are found, throw error
              throw new ToolkitError('NPM package does not contain any valid templates');
            } else if (templateDirs.length === 1) {
              // If only one template found, use it automatically
              templateName = templateDirs[0];
              templatePath = path.join(templatePath, templateName);
            } else {
              // If multiple templates found, require user to pass in template-name
              throw new ToolkitError(`NPM package contains multiple templates: ${templateDirs.join(', ')}. Please specify --template-name`);
            }
          }
        } else {
          // If user provides specific template name via --template-name parameter
          const specificTemplatePath = path.join(templatePath, templateName);
          
          // Validate template exists and has required info.json
          if (await fs.pathExists(specificTemplatePath) && await fs.pathExists(path.join(specificTemplatePath, INFO_DOT_JSON))) {
            templatePath = specificTemplatePath;
          } else {
            throw new ToolkitError(`Template '${templateName}' not found in the NPM package`);
          }
        }

        // Load the discovered template
        template = await InitTemplate.fromPath(templatePath, templateName);

        // Validate that the template has at least one CDK supported language subdirectory
        if (template.languages.length === 0) {
          throw new ToolkitError('NPM package template must contain at least one language directory');
        }
      } catch (e: any) {
        throw new ToolkitError(`Failed to load template from NPM package: ${e.message}`);
      }
      
    // BRANCH 3: Local File Path Template Source
    } else if (options.templatePath) {
      try {
        // Get local template file path
        const templatePath = path.resolve(options.templatePath);
        
        // Extract template name from directory name
        const templateName = path.basename(templatePath);

        // Load template directly from local file path
        template = await InitTemplate.fromPath(templatePath, templateName);

        // Validate the template has at least one CDK supported language subdirectory
        if (template.languages.length === 0) {
          throw new ToolkitError('Custom template must contain at least one language directory');
        }
      } catch (e: any) {
        throw new ToolkitError(`Failed to load template from path: ${options.templatePath}`);
      }
    }

    // BRANCH 4: Built-in Template Source (Default/Fallback)
    if (!template) {
      if (!options.type) {
        // If no template source and language specified, display available templates
        await printAvailableTemplates(options.language);
        throw new ToolkitError('No template specified. Please specify a template name or use a custom template option.');
      }

      // Search built-in templates (lib/init-templates/ directory) for matching name or alias
      template = (await availableInitTemplates()).find((t) => t.hasName(options.type!));

      if (!template) {
        // If no built-in template found, display available options and exit
        await printAvailableTemplates(options.language);
        throw new ToolkitError(`Unknown init template: ${options.type}`);
      }
    }

    // Handle automatic language detection for single-language templates
    if (!language && template.languages.length === 1) {
      // If template only supports one language, use it automatically
      language = template.languages[0];
      info(
        `No --language was provided, but '${template.name}' supports only '${language}', so defaulting to --language=${language}`,
      );
    }
    
    // Does final language validation to make sure one is selected at this point
    if (!language) {
      // Display available languages for the selected template and exit
      info(`Available languages for ${chalk.green(template.name)}: ${template.languages.map((l) => chalk.blue(l)).join(', ')}`);
      throw new ToolkitError('No language was selected');
    }

    // Create the CDK project using the selected template and language
    await initializeProject(
      template,        // Loaded template object
      language,        // CDK supported programming language
      canUseNetwork,   // Whether network operations are allowed
      generateOnly,    // Whether to skip post-install steps
      workDir,         // Target directory for project creation
      options.stackName,  // Custom stack name
      options.migrate,    // Whether to add migration context
      options.libVersion, // CDK version override
    );
  } finally {
    // Removes temp directories created during Git/NPM operations
    if (tempDir) {
      await fs.remove(tempDir).catch(() => {
      });
    }
  }
}

/**
 * Returns the name of the Python executable for this OS
 */
export function pythonExecutable() {
  let python = 'python3';
  if (process.platform === 'win32') {
    python = 'python';
  }
  return python;
}
// Template metadata file name
const INFO_DOT_JSON = 'info.json';

/**
 * Represents a CDK project template that can be instantiated
 */
export class InitTemplate {
  /**
   * Load a built-in template by name from the templates directory
   */
  public static async fromName(templatesDir: string, name: string) {
    const basePath = path.join(templatesDir, name);
    const languages = await listDirectory(basePath);
    const initInfo = await fs.readJson(path.join(basePath, INFO_DOT_JSON));
    return new InitTemplate(basePath, name, languages, initInfo);
  }

  /**
   * Load a custom template from a file system path
   */
  public static async fromPath(templatePath: string, name: string) {
    if (!await fs.pathExists(templatePath)) {
      throw new ToolkitError(`Template path does not exist: ${templatePath}`);
    }

    const languages = await listDirectory(templatePath);
    let initInfo;
    try {
      initInfo = await fs.readJson(path.join(templatePath, INFO_DOT_JSON));
    } catch (e: any) {
      throw new ToolkitError(`Invalid template: missing or invalid ${INFO_DOT_JSON} in ${templatePath}`);
    }

    return new InitTemplate(templatePath, name, languages, initInfo);
  }

  public readonly description: string;
  public readonly aliases = new Set<string>();

  constructor(
    private readonly basePath: string,
    public readonly name: string,
    public readonly languages: string[],
    initInfo: any,
  ) {
    this.description = initInfo.description;
    for (const alias of initInfo.aliases || []) {
      this.aliases.add(alias);
    }
  }

  /**
   * @param name - the name that is being checked
   * @returns ``true`` if ``name`` is the name of this template or an alias of it.
   */
  public hasName(name: string): boolean {
    return name === this.name || this.aliases.has(name);
  }

  /**
   * Creates a new instance of this ``InitTemplate`` for a given language to a specified folder.
   *
   * @param language    - the language to instantiate this template with
   * @param targetDirectory - the directory where the template is to be instantiated into
   */
  public async install(language: string, targetDirectory: string, stackName?: string, libVersion?: string) {
    if (this.languages.indexOf(language) === -1) {
      error(
        `The ${chalk.blue(language)} language is not supported for ${chalk.green(this.name)} ` +
          `(it supports: ${this.languages.map((l) => chalk.blue(l)).join(', ')})`,
      );
      throw new ToolkitError(`Unsupported language: ${language}`);
    }

    const projectInfo: ProjectInfo = {
      name: decamelize(path.basename(path.resolve(targetDirectory))),
      stackName,
      versions: await loadInitVersions(),
    };

    if (libVersion) {
      projectInfo.versions['aws-cdk-lib'] = libVersion;
    }

    const sourceDirectory = path.join(this.basePath, language);

    await this.installFiles(sourceDirectory, targetDirectory, language, projectInfo);
    await this.applyFutureFlags(targetDirectory);
    await invokeBuiltinHooks(
      { targetDirectory, language, templateName: this.name },
      {
        substitutePlaceholdersIn: async (...fileNames: string[]) => {
          for (const fileName of fileNames) {
            const fullPath = path.join(targetDirectory, fileName);
            const template = await fs.readFile(fullPath, { encoding: 'utf-8' });
            await fs.writeFile(fullPath, expandPlaceholders(template, language, projectInfo));
          }
        },
        placeholder: (ph: string) => expandPlaceholders(`%${ph}%`, language, projectInfo),
      },
    );
  }

  /**
   * Recursively copy and process template files from source to target directory
   */
  private async installFiles(sourceDirectory: string, targetDirectory: string, language: string, project: ProjectInfo) {
    for (const file of await fs.readdir(sourceDirectory)) {
      const fromFile = path.join(sourceDirectory, file);
      const toFile = path.join(targetDirectory, expandPlaceholders(file, language, project));
      if ((await fs.stat(fromFile)).isDirectory()) {
        await fs.mkdir(toFile);
        await this.installFiles(fromFile, toFile, language, project);
        continue;
      } else if (file.match(/^.*\.template\.[^.]+$/)) {
        await this.installProcessed(fromFile, toFile.replace(/\.template(\.[^.]+)$/, '$1'), language, project);
        continue;
      } else if (file.match(/^.*\.hook\.(d.)?[^.]+$/)) {
        // Ignore
        continue;
      } else {
        await fs.copy(fromFile, toFile);
      }
    }
  }

  /**
   * Process a template file by replacing placeholders and write to target location
   */
  private async installProcessed(templatePath: string, toFile: string, language: string, project: ProjectInfo) {
    const template = await fs.readFile(templatePath, { encoding: 'utf-8' });
    await fs.writeFile(toFile, expandPlaceholders(template, language, project));
  }

  /**
   * Adds context variables to `cdk.json` in the generated project directory to
   * enable future behavior for new projects.
   */
  private async applyFutureFlags(projectDir: string) {
    const cdkJson = path.join(projectDir, 'cdk.json');
    if (!(await fs.pathExists(cdkJson))) {
      return;
    }

    const config = await fs.readJson(cdkJson);
    config.context = {
      ...config.context,
      ...await currentlyRecommendedAwsCdkLibFlags(),
    };

    await fs.writeJson(cdkJson, config, { spaces: 2 });
  }

  public async addMigrateContext(projectDir: string) {
    const cdkJson = path.join(projectDir, 'cdk.json');
    if (!(await fs.pathExists(cdkJson))) {
      return;
    }

    const config = await fs.readJson(cdkJson);
    config.context = {
      ...config.context,
      'cdk-migrate': true,
    };

    await fs.writeJson(cdkJson, config, { spaces: 2 });
  }
}

/**
 * Replace all placeholders in template content with actual project values
 */
export function expandPlaceholders(template: string, language: string, project: ProjectInfo) {
  const cdkVersion = project.versions['aws-cdk-lib'];
  const cdkCliVersion = project.versions['aws-cdk'];
  let constructsVersion = project.versions.constructs;

  switch (language) {
    case 'java':
    case 'csharp':
    case 'fsharp':
      constructsVersion = rangeFromSemver(constructsVersion, 'bracket');
      break;
    case 'python':
      constructsVersion = rangeFromSemver(constructsVersion, 'pep');
      break;
  }
  return template
    .replace(/%name%/g, project.name)
    .replace(/%stackname%/, project.stackName ?? '%name.PascalCased%Stack')
    .replace(
      /%PascalNameSpace%/,
      project.stackName ? camelCase(project.stackName + 'Stack', { pascalCase: true }) : '%name.PascalCased%',
    )
    .replace(
      /%PascalStackProps%/,
      project.stackName ? camelCase(project.stackName, { pascalCase: true }) + 'StackProps' : 'StackProps',
    )
    .replace(/%name\.camelCased%/g, camelCase(project.name))
    .replace(/%name\.PascalCased%/g, camelCase(project.name, { pascalCase: true }))
    .replace(/%cdk-version%/g, cdkVersion)
    .replace(/%cdk-cli-version%/g, cdkCliVersion)
    .replace(/%constructs-version%/g, constructsVersion)
    .replace(/%cdk-home%/g, cdkHomeDir())
    .replace(/%name\.PythonModule%/g, project.name.replace(/-/g, '_'))
    .replace(/%python-executable%/g, pythonExecutable())
    .replace(/%name\.StackName%/g, project.name.replace(/[^A-Za-z0-9-]/g, '-'));
}

interface ProjectInfo {
  /** The value used for %name% */
  readonly name: string;
  readonly stackName?: string;

  readonly versions: Versions;
}

/**
 * Get all available templates (built-in and custom)
 */
export async function availableInitTemplates(customTemplatePath?: string): Promise<InitTemplate[]> {
  return new Promise(async (resolve) => {
    try {
      let templates = new Array<InitTemplate>();

      // Add built-in templates
      const templatesDir = path.join(cliRootDir(), 'lib', 'init-templates');
      const templateNames = await listDirectory(templatesDir);

      for (const templateName of templateNames) {
        templates.push(await InitTemplate.fromName(templatesDir, templateName));
      }

      // Add custom template if path is provided
      if (customTemplatePath && await fs.pathExists(customTemplatePath)) {
        try {
          // Check if the path is directly to a template - has info.json
          const hasInfoJson = await fs.pathExists(path.join(customTemplatePath, INFO_DOT_JSON));

          if (hasInfoJson) {
            // Extract template name from path
            const templateName = path.basename(customTemplatePath);
            templates.push(await InitTemplate.fromPath(customTemplatePath, templateName));
          } else {
            // Path is to a directory containing templates
            const customTemplateNames = await listDirectory(customTemplatePath);

            for (const templateName of customTemplateNames) {
              const templateDir = path.join(customTemplatePath, templateName);
              const isDir = (await fs.stat(templateDir)).isDirectory();
              const hasTemplateInfoJson = await fs.pathExists(path.join(templateDir, INFO_DOT_JSON));

              if (isDir && hasTemplateInfoJson) {
                templates.push(await InitTemplate.fromPath(templateDir, templateName));
              }
            }
          }
        } catch (e: any) {
          warning(`Failed to load custom templates from ${customTemplatePath}: ${e}`);
        }
      }

      resolve(templates);
    } catch (e: any) {
      resolve([]);
    }
  });
}

/**
 * Get all supported programming languages across all templates
 */
export async function availableInitLanguages(): Promise<string[]> {
  return new Promise(async (resolve) => {
    const templates = await availableInitTemplates();
    const result = new Set<string>();
    for (const template of templates) {
      for (const language of template.languages) {
        result.add(language);
      }
    }
    resolve([...result]);
  });
}

/**
 * @param dirPath - is the directory to be listed.
 * @returns the list of file or directory names contained in ``dirPath``, excluding any dot-file, and sorted.
 */
/**
 * List directory contents, excluding hidden files and metadata
 */
async function listDirectory(dirPath: string) {
  return (
    (await fs.readdir(dirPath))
      .filter((p) => !p.startsWith('.'))
      .filter((p) => !(p === 'LICENSE'))
      // if, for some reason, the temp folder for the hook doesn't get deleted we don't want to display it in this list
      .filter((p) => !(p === INFO_DOT_JSON))
      .sort()
  );
}

/**
 * Display all available templates and usage examples to the user
 */
export async function printAvailableTemplates(language?: string, customTemplatePath?: string) {
  info('Available templates:');
  const templates = await availableInitTemplates(customTemplatePath);

  for (const template of templates) {
    if (language && template.languages.indexOf(language) === -1) {
      continue;
    }
    info(`* ${chalk.green(template.name)}: ${template.description}`);
    const languageArg = language
      ? chalk.bold(language)
      : template.languages.length > 1
        ? `[${template.languages.map((t) => chalk.bold(t)).join('|')}]`
        : chalk.bold(template.languages[0]);
    info(`   └─ ${chalk.blue(`cdk init ${chalk.bold(template.name)} --language=${languageArg}`)}`);
  }

  // Add information about custom template options
  info('\nCustom template options:');
  info(`* ${chalk.blue('cdk init --template-path=/path/to/template [--language=LANGUAGE]')}`);
  info('  Use a template from a local directory (language auto-detected if template has only one)');
  info(`* ${chalk.blue('cdk init --git-url=https://github.com/user/repo [--language=LANGUAGE]')}`);
  info('  Use a template from a Git repository (language auto-detected if template has only one)');
  info(`* ${chalk.blue('cdk init --git-url=https://github.com/user/repo --template-name=my-template [--language=LANGUAGE]')}`);
  info('  Use a specific template from a Git repository with multiple templates');
  info(`* ${chalk.blue('cdk init --npm-package=my-cdk-template [--language=LANGUAGE]')}`);
  info('  Use a template from an NPM package (language auto-detected if template has only one)');
  info(`* ${chalk.blue('cdk init --npm-package=my-cdk-templates --template-name=api-service [--language=LANGUAGE]')}`);
  info('  Use a specific template from an NPM package with multiple templates');
}

/**
 * Create and set up a new CDK project from the selected template.
 * 
 * This is the common initialization flow used by all template sources.
 * Handles file generation, Git setup, and language-specific post-processing.
 * 
 * @param template - Loaded template object (from any source)
 * @param language - Validated programming language
 * @param canUseNetwork - Whether network operations are allowed
 * @param generateOnly - If true, skip post-install steps (npm install, etc.)
 * @param workDir - Target directory for project creation
 * @param stackName - Optional custom stack name
 * @param migrate - Whether to add cdk-migrate context flag
 * @param cdkVersion - Optional CDK version override
 */
async function initializeProject(
  template: InitTemplate,
  language: string,
  canUseNetwork: boolean,
  generateOnly: boolean,
  workDir: string,
  stackName?: string,
  migrate?: boolean,
  cdkVersion?: string,
) {
  // SAFETY CHECK: Ensure target directory is empty to prevent accidental overwrites
  await assertIsEmptyDirectory(workDir);
  
  // PHASE 1: TEMPLATE INSTALLATION
  info(`Applying project template ${chalk.green(template.name)} for ${chalk.blue(language)}`);
  
  // Core template processing: copy files, replace placeholders, run hooks
  await template.install(language, workDir, stackName, cdkVersion);
  
  // Add migration-specific context if requested
  if (migrate) {
    await template.addMigrateContext(workDir);
  }
  
  // Display README content if generated (helpful for next steps)
  if (await fs.pathExists(`${workDir}/README.md`)) {
    const readme = await fs.readFile(`${workDir}/README.md`, { encoding: 'utf-8' });
    info(chalk.green(readme));
  }

  // PHASE 2: POST-INSTALLATION (skipped if generateOnly=true)
  if (!generateOnly) {
    // Initialize Git repository and make initial commit
    await initializeGitRepository(workDir);
    
    // Run language-specific setup (npm install, mvn package, etc.)
    await postInstall(language, canUseNetwork, workDir);
  }

  info('✅ All done!');
}

/**
 * Ensure the target directory is empty before creating a new project
 */
async function assertIsEmptyDirectory(workDir: string) {
  const files = await fs.readdir(workDir);
  if (files.filter((f) => !f.startsWith('.')).length !== 0) {
    throw new ToolkitError('`cdk init` cannot be run in a non-empty directory!');
  }
}

/**
 * Initialize a new Git repository and make initial commit
 */
async function initializeGitRepository(workDir: string) {
  if (await isInGitRepository(workDir)) {
    return;
  }
  info('Initializing a new git repository...');
  try {
    await execute('git', ['init'], { cwd: workDir });
    await execute('git', ['add', '.'], { cwd: workDir });
    await execute('git', ['commit', '--message="Initial commit"', '--no-gpg-sign'], { cwd: workDir });
  } catch {
    warning('Unable to initialize git repository for your project.');
  }
}

/**
 * Run language-specific post-installation steps (install dependencies, etc.).
 * 
 * This function handles the final setup phase for each supported language.
 * Only languages with specific tooling requirements are handled here.
 * Languages not listed (like Go, C#, F#) don't require additional setup.
 * 
 * @param language - Programming language requiring post-install steps
 * @param canUseNetwork - Whether network access is available for package managers
 * @param workDir - Project directory where commands should be executed
 */
async function postInstall(language: string, canUseNetwork: boolean, workDir: string) {
  switch (language) {
    case 'javascript':
      return postInstallJavascript(canUseNetwork, workDir);
    case 'typescript':
      return postInstallTypescript(canUseNetwork, workDir);
    case 'java':
      return postInstallJava(canUseNetwork, workDir);
    case 'python':
      return postInstallPython(workDir);
    // Note: Go, C#, F# don't require post-install steps
    // Their tooling handles dependencies differently or they're self-contained
  }
}

/**
 * JavaScript post-install: run npm install
 */
async function postInstallJavascript(canUseNetwork: boolean, cwd: string) {
  return postInstallTypescript(canUseNetwork, cwd);
}

/**
 * TypeScript post-install: run npm install
 */
async function postInstallTypescript(canUseNetwork: boolean, cwd: string) {
  const command = 'npm';

  if (!canUseNetwork) {
    warning(`Please run '${command} install'!`);
    return;
  }

  info(`Executing ${chalk.green(`${command} install`)}...`);
  try {
    await execute(command, ['install'], { cwd });
  } catch (e: any) {
    warning(`${command} install failed: ` + formatErrorMessage(e));
  }
}

/**
 * Java post-install: run mvn package
 */
async function postInstallJava(canUseNetwork: boolean, cwd: string) {
  const mvnPackageWarning = "Please run 'mvn package'!";
  if (!canUseNetwork) {
    warning(mvnPackageWarning);
    return;
  }

  info("Executing 'mvn package'");
  try {
    await execute('mvn', ['package'], { cwd });
  } catch {
    warning('Unable to package compiled code as JAR');
    warning(mvnPackageWarning);
  }
}

/**
 * Python post-install: create virtual environment
 */
async function postInstallPython(cwd: string) {
  const python = pythonExecutable();
  warning(`Please run '${python} -m venv .venv'!`);
  info(`Executing ${chalk.green('Creating virtualenv...')}`);
  try {
    await execute(python, ['-m venv', '.venv'], { cwd });
  } catch {
    warning('Unable to create virtualenv automatically');
    warning(`Please run '${python} -m venv .venv'!`);
  }
}

/**
 * @param dir - a directory to be checked
 * @returns true if ``dir`` is within a git repository.
 */
/**
 * Check if directory is already inside a Git repository
 */
async function isInGitRepository(dir: string) {
  while (true) {
    if (await fs.pathExists(path.join(dir, '.git'))) {
      return true;
    }
    if (isRoot(dir)) {
      return false;
    }
    dir = path.dirname(dir);
  }
}

/**
 * @param dir - a directory to be checked.
 * @returns true if ``dir`` is the root of a filesystem.
 */
/**
 * Check if directory is the filesystem root
 */
function isRoot(dir: string) {
  return path.dirname(dir) === dir;
}

/**
 * Clone a Git repository containing CDK templates
 *
 * @param gitUrl - URL of the Git repository
 * @returns Path to the cloned repository
 */
export async function cloneGitRepository(gitUrl: string): Promise<string> {
  // Create a temporary directory for cloning
  const tempDir = path.join(os.tmpdir(), `cdk-git-template-${Date.now()}`);
  await fs.mkdirp(tempDir);

  // Normalize Git URL
  // Support formats like:
  // - https://github.com/user/repo
  // - github.com/user/repo
  // - user/repo (GitHub only)
  // - https://gitlab.com/user/repo
  // - https://bitbucket.org/user/repo
  let normalizedUrl = gitUrl;
  if (!normalizedUrl.startsWith('http')) {
    if (!normalizedUrl.includes('/')) {
      throw new ToolkitError('Invalid Git URL format');
    }

    // Handle GitHub shorthand format (user/repo)
    if (!normalizedUrl.includes('.')) {
      normalizedUrl = `https://github.com/${normalizedUrl}`;
    } else if (normalizedUrl.includes('github.com')) {
      normalizedUrl = `https://${normalizedUrl}`;
    } else if (normalizedUrl.includes('gitlab.com')) {
      normalizedUrl = `https://${normalizedUrl}`;
    } else if (normalizedUrl.includes('bitbucket.org')) {
      normalizedUrl = `https://${normalizedUrl}`;
    } else {
      normalizedUrl = `https://${normalizedUrl}`;
    }
  }

  info(`Cloning Git repository from ${normalizedUrl}...`);

  try {
    // Clone the repository
    await execute('git', ['clone', '--depth', '1', normalizedUrl, tempDir], { cwd: process.cwd() });
    return tempDir;
  } catch (e: any) {
    // Clean up if there was an error
    await fs.remove(tempDir).catch(() => {
    });
    throw new ToolkitError(`Failed to clone Git repository: ${e.message}`);
  }
}

/**
 * Install an NPM package containing CDK templates
 *
 * @param npmPackage - Name of the NPM package
 * @returns Path to the installed package
 */
export async function installNpmPackage(npmPackage: string): Promise<string> {
  // Create a temporary directory for npm install
  const tempDir = path.join(os.tmpdir(), `cdk-npm-template-${Date.now()}`);
  await fs.mkdirp(tempDir);

  info(`Installing NPM package ${npmPackage}...`);

  try {
    // Create a package.json file
    await fs.writeJson(path.join(tempDir, 'package.json'), {
      name: 'cdk-template-installer',
      version: '1.0.0',
      private: true,
    }, { spaces: 2 });

    try {
      // Install the package
      await execute('npm', ['install', npmPackage, '--no-save'], { cwd: tempDir });
    } catch (e: any) {
      throw new ToolkitError(`Failed to install package: ${e.message}`);
    }

    // Get the package path in node_modules
    const packagePath = path.join(tempDir, 'node_modules', npmPackage);

    // Verify the package exists
    if (!await fs.pathExists(packagePath)) {
      throw new ToolkitError(`Package directory not found at ${packagePath}`);
    }

    return packagePath;
  } catch (e: any) {
    // Clean up if there was an error
    await fs.remove(tempDir).catch(() => {
    });
    throw new ToolkitError(`Failed to install NPM package: ${e.message}`);
  }
}

/**
 * Executes `command`. STDERR is emitted in real-time.
 *
 * If command exits with non-zero exit code, an exceprion is thrown and includes
 * the contents of STDOUT.
 *
 * @returns STDOUT (if successful).
 */
export async function execute(cmd: string, args: string[], { cwd }: { cwd: string }) {
  const child = childProcess.spawn(cmd, args, {
    cwd,
    shell: true,
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  let stdout = '';
  child.stdout.on('data', (chunk) => (stdout += chunk.toString()));
  return new Promise<string>((ok, fail) => {
    child.once('error', (err) => fail(err));
    child.once('exit', (status) => {
      if (status === 0) {
        return ok(stdout);
      } else {
        error(stdout);
        return fail(new ToolkitError(`${cmd} exited with status ${status}`));
      }
    });
  });
}

interface Versions {
  ['aws-cdk']: string;
  ['aws-cdk-lib']: string;
  constructs: string;
}

/**
 * Return the 'aws-cdk-lib' version we will init
 *
 * This has been built into the CLI at build time.
 */
/**
 * Load CDK and dependency versions from build-time configuration
 */
async function loadInitVersions(): Promise<Versions> {
  const initVersionFile = path.join(cliRootDir(), 'lib', 'init-templates', '.init-version.json');
  const contents = JSON.parse(await fs.readFile(initVersionFile, { encoding: 'utf-8' }));

  const ret = {
    'aws-cdk-lib': contents['aws-cdk-lib'],
    'constructs': contents.constructs,
    'aws-cdk': versionNumber(),
  };
  for (const [key, value] of Object.entries(ret)) {
    /* c8 ignore start */
    if (!value) {
      throw new ToolkitError(`Missing init version from ${initVersionFile}: ${key}`);
    }
    /* c8 ignore stop */
  }

  return ret;
}

/**
 * Return the currently recommended flags for `aws-cdk-lib`.
 *
 * These have been built into the CLI at build time.
 */
export async function currentlyRecommendedAwsCdkLibFlags() {
  const recommendedFlagsFile = path.join(cliRootDir(), 'lib', 'init-templates', '.recommended-feature-flags.json');
  return JSON.parse(await fs.readFile(recommendedFlagsFile, { encoding: 'utf-8' }));
}
