import * as childProcess from 'child_process';
import * as path from 'path';
import { ToolkitError } from '@aws-cdk/toolkit-lib';
import * as chalk from 'chalk';
import * as fs from 'fs-extra';
import { invokeBuiltinHooks } from './init-hooks';
import type { IoHelper } from '../../api-private';
import { cliRootDir } from '../../cli/root-dir';
import { versionNumber } from '../../cli/version';
import { cdkHomeDir, formatErrorMessage, rangeFromSemver } from '../../util';

/* eslint-disable @typescript-eslint/no-var-requires */ // Packages don't have @types module
// eslint-disable-next-line @typescript-eslint/no-require-imports
const camelCase = require('camelcase');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const decamelize = require('decamelize');

export interface CliInitOptions {
  /**
   * Template name to initialize
   * @default undefined
   */
  readonly type?: string;

  /**
   * Programming language for the project
   * @default - Optional/auto-detected if template supports only one language, otherwise required
   */
  readonly language?: string;

  /**
   * @default true
   */
  readonly canUseNetwork?: boolean;

  /**
   * @default false
   */
  readonly generateOnly?: boolean;

  /**
   * @default process.cwd()
   */
  readonly workDir?: string;

  /**
   * @default undefined
   */
  readonly stackName?: string;

  /**
   * @default undefined
   */
  readonly migrate?: boolean;

  /**
   * Override the built-in CDK version
   * @default undefined
   */
  readonly libVersion?: string;

  /**
   * Path to a local custom template directory
   * @default undefined
   */
  readonly fromPath?: string;

  /**
   * Path to a specific template within a multi-template repository.
   * This parameter requires --from-path to be specified.
   * @default undefined
   */
  readonly templatePath?: string;

  readonly ioHelper: IoHelper;
}

/**
 * Initialize a CDK package in the current directory
 */
export async function cliInit(options: CliInitOptions) {
  const ioHelper = options.ioHelper;
  const canUseNetwork = options.canUseNetwork ?? true;
  const generateOnly = options.generateOnly ?? false;
  const workDir = options.workDir ?? process.cwd();

  // Step 1: Load template
  let template: InitTemplate;
  if (options.fromPath) {
    template = await loadLocalTemplate(options.fromPath, options.templatePath);
  } else {
    template = await loadBuiltinTemplate(ioHelper, options.type, options.language);
  }

  // Step 2: Resolve language
  const language = await resolveLanguage(ioHelper, template, options.language);

  // Step 3: Initialize project following standard process
  await initializeProject(
    ioHelper,
    template,
    language,
    canUseNetwork,
    generateOnly,
    workDir,
    options.stackName,
    options.migrate,
    options.libVersion,
  );
}

/**
 * Load a local custom template from file system path
 * @param fromPath - Path to the local template directory or multi-template repository
 * @param templatePath - Optional path to a specific template within a multi-template repository
 * @returns Promise resolving to the loaded InitTemplate
 */
async function loadLocalTemplate(fromPath: string, templatePath?: string): Promise<InitTemplate> {
  try {
    let actualTemplatePath = fromPath;

    // If templatePath is provided, it's a multi-template repository
    if (templatePath) {
      actualTemplatePath = path.join(fromPath, templatePath);

      if (!await fs.pathExists(actualTemplatePath)) {
        throw new ToolkitError(`Template path does not exist: ${actualTemplatePath}`);
      }
    }

    const template = await InitTemplate.fromPath(actualTemplatePath);

    if (template.languages.length === 0) {
      // Check if this might be a multi-template repository
      if (!templatePath) {
        const availableTemplates = await findPotentialTemplates(fromPath);
        if (availableTemplates.length > 0) {
          throw new ToolkitError(
            'Use --template-path to specify which template to use.',
          );
        }
      }
      throw new ToolkitError('Custom template must contain at least one language directory');
    }

    return template;
  } catch (error: any) {
    const displayPath = templatePath ? `${fromPath}/${templatePath}` : fromPath;
    throw new ToolkitError(`Failed to load template from path: ${displayPath}. ${error.message}`);
  }
}

/**
 * Load a built-in template by name
 */
async function loadBuiltinTemplate(ioHelper: IoHelper, type?: string, language?: string): Promise<InitTemplate> {
  const templateType = type || 'default'; // "default" is the default type (and maps to "app")

  const template = (await availableInitTemplates()).find((t) => t.hasName(templateType));
  if (!template) {
    await printAvailableTemplates(ioHelper, language);
    throw new ToolkitError(`Unknown init template: ${templateType}`);
  }

  return template;
}

/**
 * Resolve the programming language for the template
 * @param ioHelper - IO helper for user interaction
 * @param template - The template to resolve language for
 * @param requestedLanguage - User-requested language (optional)
 * @default undefined
 * @returns Promise resolving to the selected language
 */
async function resolveLanguage(ioHelper: IoHelper, template: InitTemplate, requestedLanguage?: string): Promise<string> {
  if (requestedLanguage) {
    return requestedLanguage;
  }
  if (template.languages.length === 1) {
    const templateLanguage = template.languages[0];
    // Only show auto-detection message for built-in templates
    if (template.templateType !== TemplateType.CUSTOM) {
      await ioHelper.defaults.warn(
        `No --language was provided, but '${template.name}' supports only '${templateLanguage}', so defaulting to --language=${templateLanguage}`,
      );
    }
    return templateLanguage;
  }
  await ioHelper.defaults.info(
    `Available languages for ${chalk.green(template.name)}: ${template.languages.map((l) => chalk.blue(l)).join(', ')}`,
  );
  throw new ToolkitError('No language was selected');
}

/**
 * Find potential template directories in a multi-template repository
 * @param repositoryPath - Path to the repository root
 * @returns Promise resolving to array of potential template directory names
 */
async function findPotentialTemplates(repositoryPath: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(repositoryPath, { withFileTypes: true });
    const potentialTemplates: string[] = [];

    for (const entry of entries) {
      if (entry.isDirectory() && !entry.name.startsWith('.')) {
        const templatePath = path.join(repositoryPath, entry.name);
        const languages = await getLanguageDirectories(templatePath);
        if (languages.length > 0) {
          potentialTemplates.push(entry.name);
        }
      }
    }

    return potentialTemplates;
  } catch (error: any) {
    return [];
  }
}

/**
 * Get valid CDK language directories from a template path
 * @param templatePath - Path to the template directory
 * @returns Promise resolving to array of supported language names
 */
async function getLanguageDirectories(templatePath: string): Promise<string[]> {
  const cdkSupportedLanguages = ['typescript', 'javascript', 'python', 'java', 'csharp', 'fsharp', 'go'];
  const languageExtensions: Record<string, string[]> = {
    typescript: ['.ts', '.js'],
    javascript: ['.js'],
    python: ['.py'],
    java: ['.java'],
    csharp: ['.cs'],
    fsharp: ['.fs'],
    go: ['.go'],
  };

  try {
    const entries = await fs.readdir(templatePath, { withFileTypes: true });

    const languageValidationPromises = entries
      .filter(directoryEntry => directoryEntry.isDirectory() && cdkSupportedLanguages.includes(directoryEntry.name))
      .map(async (directoryEntry) => {
        const languageDirectoryPath = path.join(templatePath, directoryEntry.name);
        try {
          const hasValidLanguageFiles = await hasLanguageFiles(languageDirectoryPath, languageExtensions[directoryEntry.name]);
          return hasValidLanguageFiles ? directoryEntry.name : null;
        } catch (error: any) {
          throw new ToolkitError(`Cannot read language directory '${directoryEntry.name}': ${error.message}`);
        }
      });

    /* eslint-disable-next-line @cdklabs/promiseall-no-unbounded-parallelism */ // Limited to supported CDK languages (7 max)
    const validationResults = await Promise.all(languageValidationPromises);
    return validationResults.filter((languageName): languageName is string => languageName !== null);
  } catch (error: any) {
    throw new ToolkitError(`Cannot read template directory '${templatePath}': ${error.message}`);
  }
}

/**
 * Iteratively check if a directory contains files with the specified extensions
 * @param directoryPath - Path to search for language files
 * @param extensions - Array of file extensions to look for
 * @returns Promise resolving to true if language files are found
 */
async function hasLanguageFiles(directoryPath: string, extensions: string[]): Promise<boolean> {
  const dirsToCheck = [directoryPath];

  while (dirsToCheck.length > 0) {
    const currentDir = dirsToCheck.pop()!;

    try {
      const entries = await fs.readdir(currentDir, { withFileTypes: true });

      for (const entry of entries) {
        if (entry.isFile() && extensions.some(ext => entry.name.endsWith(ext))) {
          return true;
        } else if (entry.isDirectory()) {
          dirsToCheck.push(path.join(currentDir, entry.name));
        }
      }
    } catch (error: any) {
      throw error;
    }
  }

  return false;
}

/**
 * Returns the name of the Python executable for this OS
 * @returns The Python executable name for the current platform
 */
function pythonExecutable() {
  let python = 'python3';
  if (process.platform === 'win32') {
    python = 'python';
  }
  return python;
}
const INFO_DOT_JSON = 'info.json';

interface TemplateInitInfo {
  readonly description: string;
  readonly aliases?: string[];
}

enum TemplateType {
  BUILT_IN = 'builtin',
  CUSTOM = 'custom',
}

export class InitTemplate {
  public static async fromName(templatesDir: string, name: string) {
    const basePath = path.join(templatesDir, name);
    const languages = await listDirectory(basePath);
    const initInfo = await fs.readJson(path.join(basePath, INFO_DOT_JSON));
    return new InitTemplate(basePath, name, languages, initInfo, TemplateType.BUILT_IN);
  }

  public static async fromPath(templatePath: string) {
    const basePath = path.resolve(templatePath);

    if (!await fs.pathExists(basePath)) {
      throw new ToolkitError(`Template path does not exist: ${basePath}`);
    }

    const languages = await getLanguageDirectories(basePath);
    const name = path.basename(basePath);

    return new InitTemplate(basePath, name, languages, null, TemplateType.CUSTOM);
  }

  public readonly description?: string;
  public readonly aliases = new Set<string>();
  public readonly templateType: TemplateType;

  constructor(
    private readonly basePath: string,
    public readonly name: string,
    public readonly languages: string[],
    initInfo: TemplateInitInfo | null,
    templateType: TemplateType,
  ) {
    this.templateType = templateType;
    // Only built-in templates have descriptions and aliases from info.json
    if (templateType === TemplateType.BUILT_IN && initInfo) {
      this.description = initInfo.description;
      for (const alias of initInfo.aliases || []) {
        this.aliases.add(alias);
      }
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
   * @param language - the language to instantiate this template with
   * @param targetDirectory - the directory where the template is to be instantiated into
   * @param stackName - the name of the stack to create
   * @default undefined
   * @param libVersion - the version of the CDK library to use
   * @default undefined
   */
  public async install(ioHelper: IoHelper, language: string, targetDirectory: string, stackName?: string, libVersion?: string) {
    if (this.languages.indexOf(language) === -1) {
      await ioHelper.defaults.error(
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

    if (this.templateType === TemplateType.CUSTOM) {
      // For custom templates, copy files without processing placeholders
      await this.installFilesWithoutProcessing(sourceDirectory, targetDirectory);
    } else {
      // For built-in templates, process placeholders as usual
      await this.installFiles(sourceDirectory, targetDirectory, language, projectInfo);
      await this.applyFutureFlags(targetDirectory);
      await invokeBuiltinHooks(
        ioHelper,
        { targetDirectory, language, templateName: this.name },
        {
          substitutePlaceholdersIn: async (...fileNames: string[]) => {
            const fileProcessingPromises = fileNames.map(async (fileName) => {
              const fullPath = path.join(targetDirectory, fileName);
              const template = await fs.readFile(fullPath, { encoding: 'utf-8' });
              await fs.writeFile(fullPath, expandPlaceholders(template, language, projectInfo));
            });
            /* eslint-disable-next-line @cdklabs/promiseall-no-unbounded-parallelism */ // Processing a small, known set of template files
            await Promise.all(fileProcessingPromises);
          },
          placeholder: (ph: string) => expandPlaceholders(`%${ph}%`, language, projectInfo),
        },
      );
    }
  }

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

  private async installProcessed(templatePath: string, toFile: string, language: string, project: ProjectInfo) {
    const template = await fs.readFile(templatePath, { encoding: 'utf-8' });
    await fs.writeFile(toFile, expandPlaceholders(template, language, project));
  }

  /**
   * Copy template files without processing placeholders (for custom templates)
   */
  private async installFilesWithoutProcessing(sourceDirectory: string, targetDirectory: string) {
    await fs.copy(sourceDirectory, targetDirectory, {
      filter: (src: string) => {
        const filename = path.basename(src);
        return !filename.match(/^.*\.hook\.(d.)?[^.]+$/);
      },
    });
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

export async function availableInitTemplates(): Promise<InitTemplate[]> {
  try {
    const templatesDir = path.join(cliRootDir(), 'lib', 'init-templates');
    const templateNames = await listDirectory(templatesDir);
    const templatePromises = templateNames.map(templateName =>
      InitTemplate.fromName(templatesDir, templateName),
    );
    /* eslint-disable-next-line @cdklabs/promiseall-no-unbounded-parallelism */ // Built-in templates are limited in number
    return await Promise.all(templatePromises);
  } catch (error: any) {
    // Return empty array if templates directory doesn't exist or can't be read
    // This allows the CLI to gracefully handle missing built-in templates
    if (error.code === 'ENOENT' || error.code === 'EACCES') {
      return [];
    }
    throw error;
  }
}

export async function availableInitLanguages(): Promise<string[]> {
  const templates = await availableInitTemplates();
  const result = new Set<string>();
  for (const template of templates) {
    for (const language of template.languages) {
      result.add(language);
    }
  }
  return [...result];
}

/**
 * @param dirPath - is the directory to be listed.
 * @returns the list of file or directory names contained in ``dirPath``, excluding any dot-file, and sorted.
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
 * Print available templates to the user
 * @param ioHelper - IO helper for user interaction
 * @param language - Programming language filter
 * @default undefined
 */
export async function printAvailableTemplates(ioHelper: IoHelper, language?: string) {
  await ioHelper.defaults.info('Available templates:');
  for (const template of await availableInitTemplates()) {
    if (language && template.languages.indexOf(language) === -1) {
      continue;
    }
    await ioHelper.defaults.info(`* ${chalk.green(template.name)}: ${template.description!}`);
    const languageArg = language
      ? chalk.bold(language)
      : template.languages.length > 1
        ? `[${template.languages.map((t) => chalk.bold(t)).join('|')}]`
        : chalk.bold(template.languages[0]);
    await ioHelper.defaults.info(`   └─ ${chalk.blue(`cdk init ${chalk.bold(template.name)} --language=${languageArg}`)}`);
  }
}

async function initializeProject(
  ioHelper: IoHelper,
  template: InitTemplate,
  language: string,
  canUseNetwork: boolean,
  generateOnly: boolean,
  workDir: string,
  stackName?: string,
  migrate?: boolean,
  cdkVersion?: string,
) {
  // Step 1: Ensure target directory is empty
  await assertIsEmptyDirectory(workDir);

  // Step 2: Copy template files
  await ioHelper.defaults.info(`Applying project template ${chalk.green(template.name)} for ${chalk.blue(language)}`);
  await template.install(ioHelper, language, workDir, stackName, cdkVersion);

  if (migrate) {
    await template.addMigrateContext(workDir);
  }

  if (await fs.pathExists(`${workDir}/README.md`)) {
    const readme = await fs.readFile(`${workDir}/README.md`, { encoding: 'utf-8' });
    await ioHelper.defaults.info(chalk.green(readme));
  }

  if (!generateOnly) {
    // Step 3: Initialize Git repository and create initial commit
    await initializeGitRepository(ioHelper, workDir);

    // Step 4: Post-install steps
    await postInstall(ioHelper, language, canUseNetwork, workDir);
  }

  await ioHelper.defaults.info('✅ All done!');
}

async function assertIsEmptyDirectory(workDir: string) {
  try {
    const files = await fs.readdir(workDir);
    if (files.filter((f) => !f.startsWith('.')).length !== 0) {
      throw new ToolkitError('`cdk init` cannot be run in a non-empty directory!');
    }
  } catch (e: any) {
    if (e.code === 'ENOENT') {
      throw new ToolkitError(`Directory does not exist: ${workDir}. Please create the directory first.`);
    } else {
      throw e;
    }
  }
}

async function initializeGitRepository(ioHelper: IoHelper, workDir: string) {
  if (await isInGitRepository(workDir)) {
    return;
  }
  await ioHelper.defaults.info('Initializing a new git repository...');
  try {
    await execute(ioHelper, 'git', ['init'], { cwd: workDir });
    await execute(ioHelper, 'git', ['add', '.'], { cwd: workDir });
    await execute(ioHelper, 'git', ['commit', '--message="Initial commit"', '--no-gpg-sign'], { cwd: workDir });
  } catch {
    await ioHelper.defaults.warn('Unable to initialize git repository for your project.');
  }
}

async function postInstall(ioHelper: IoHelper, language: string, canUseNetwork: boolean, workDir: string) {
  switch (language) {
    case 'javascript':
      return postInstallJavascript(ioHelper, canUseNetwork, workDir);
    case 'typescript':
      return postInstallTypescript(ioHelper, canUseNetwork, workDir);
    case 'java':
      return postInstallJava(ioHelper, canUseNetwork, workDir);
    case 'python':
      return postInstallPython(ioHelper, workDir);
    case 'go':
      return postInstallGo(ioHelper, canUseNetwork, workDir);
    case 'csharp':
    case 'fsharp':
      // .NET languages don't need post-install steps for custom templates
      return;
  }
}

async function postInstallJavascript(ioHelper: IoHelper, canUseNetwork: boolean, cwd: string) {
  return postInstallTypescript(ioHelper, canUseNetwork, cwd);
}

async function postInstallTypescript(ioHelper: IoHelper, canUseNetwork: boolean, cwd: string) {
  const command = 'npm';

  if (!canUseNetwork) {
    await ioHelper.defaults.warn(`Please run '${command} install'!`);
    return;
  }

  await ioHelper.defaults.info(`Executing ${chalk.green(`${command} install`)}...`);
  try {
    await execute(ioHelper, command, ['install'], { cwd });
  } catch (e: any) {
    await ioHelper.defaults.warn(`${command} install failed: ` + formatErrorMessage(e));
  }
}

async function postInstallJava(ioHelper: IoHelper, canUseNetwork: boolean, cwd: string) {
  const mvnPackageWarning = "Please run 'mvn package'!";
  if (!canUseNetwork) {
    await ioHelper.defaults.warn(mvnPackageWarning);
    return;
  }

  await ioHelper.defaults.info("Executing 'mvn package'");
  try {
    await execute(ioHelper, 'mvn', ['package'], { cwd });
  } catch {
    await ioHelper.defaults.warn('Unable to package compiled code as JAR');
    await ioHelper.defaults.warn(mvnPackageWarning);
  }
}

async function postInstallPython(ioHelper: IoHelper, cwd: string) {
  const python = pythonExecutable();
  await ioHelper.defaults.warn(`Please run '${python} -m venv .venv'!`);
  await ioHelper.defaults.info(`Executing ${chalk.green('Creating virtualenv...')}`);
  try {
    await execute(ioHelper, python, ['-m venv', '.venv'], { cwd });
  } catch {
    await ioHelper.defaults.warn('Unable to create virtualenv automatically');
    await ioHelper.defaults.warn(`Please run '${python} -m venv .venv'!`);
  }
}

async function postInstallGo(ioHelper: IoHelper, canUseNetwork: boolean, cwd: string) {
  if (!canUseNetwork) {
    await ioHelper.defaults.warn('Please run \'go mod tidy\'!');
    return;
  }

  await ioHelper.defaults.info(`Executing ${chalk.green('go mod tidy')}...`);
  try {
    await execute(ioHelper, 'go', ['mod', 'tidy'], { cwd });
  } catch (e: any) {
    await ioHelper.defaults.warn('\'go mod tidy\' failed: ' + formatErrorMessage(e));
  }
}

/**
 * @param dir - a directory to be checked
 * @returns true if ``dir`` is within a git repository.
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
function isRoot(dir: string) {
  return path.dirname(dir) === dir;
}

/**
 * Executes `command`. STDERR is emitted in real-time.
 *
 * If command exits with non-zero exit code, an exception is thrown and includes
 * the contents of STDOUT.
 *
 * @returns STDOUT (if successful).
 */
async function execute(ioHelper: IoHelper, cmd: string, args: string[], { cwd }: { cwd: string }) {
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
        return fail(new ToolkitError(`${cmd} exited with status ${status}`));
      }
    });
  }).catch(async (err) => {
    await ioHelper.defaults.error(stdout);
    throw err;
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
async function loadInitVersions(): Promise<Versions> {
  const initVersionFile = path.join(cliRootDir(), 'lib', 'init-templates', '.init-version.json');
  const contents = JSON.parse(await fs.readFile(initVersionFile, { encoding: 'utf-8' }));

  const ret = {
    'aws-cdk-lib': contents['aws-cdk-lib'],
    'constructs': contents.constructs,
    'aws-cdk': versionNumber(),
  };
  for (const [key, value] of Object.entries(ret)) {
    if (!value) {
      throw new ToolkitError(`Missing init version from ${initVersionFile}: ${key}`);
    }
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
