import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { cdkCredentialsConfig, obtainEcrCredentials } from './docker-credentials';
import type { ShellOptions, ProcessFailedError } from './shell';
import { shell } from './shell';
import { createCriticalSection } from './util';
import type { IECRClient } from '../aws';
import type { SubprocessOutputDestination } from './asset-handler';
import type { EventEmitter } from '../progress';
import { shellEventPublisherFromEventEmitter } from '../progress';

interface BuildOptions {
  readonly directory: string;

  /**
   * Tag the image with a given repoName:tag combination
   */
  readonly tag: string;
  readonly target?: string;
  readonly file?: string;
  readonly buildArgs?: Record<string, string>;
  readonly buildSecrets?: Record<string, string>;
  readonly buildSsh?: string;
  readonly networkMode?: string;
  readonly platform?: string;
  readonly outputs?: string[];
  readonly cacheFrom?: DockerCacheOption[];
  readonly cacheTo?: DockerCacheOption;
  readonly cacheDisabled?: boolean;
}

interface PushOptions {
  readonly tag: string;
}

export interface DockerCredentialsConfig {
  readonly version: string;
  readonly domainCredentials: Record<string, DockerDomainCredentials>;
}

export interface DockerDomainCredentials {
  readonly secretsManagerSecretId?: string;
  readonly ecrRepository?: string;
}

enum InspectImageErrorCode {
  Docker = 1,
  Podman = 125,
}

export interface DockerCacheOption {
  readonly type: string;
  readonly params?: { [key: string]: string };
}

export class Docker {
  private configDir: string | undefined = undefined;

  constructor(
    private readonly eventEmitter: EventEmitter,
    private readonly subprocessOutputDestination: SubprocessOutputDestination,
  ) {
  }

  /**
   * Whether an image with the given tag exists
   */
  public async exists(tag: string) {
    try {
      await this.execute(['inspect', tag], {
        subprocessOutputDestination: 'ignore',
      });
      return true;
    } catch (e: any) {
      const error: ProcessFailedError = e;

      /**
       * The only error we expect to be thrown will have this property and value.
       * If it doesn't, it's unrecognized so re-throw it.
       */
      if (error.code !== 'PROCESS_FAILED') {
        throw error;
      }

      /**
       * If we know the shell command above returned an error, check to see
       * if the exit code is one we know to actually mean that the image doesn't
       * exist.
       */
      switch (error.exitCode) {
        case InspectImageErrorCode.Docker:
        case InspectImageErrorCode.Podman:
          // Docker and Podman will return this exit code when an image doesn't exist, return false
          // context: https://github.com/aws/aws-cdk/issues/16209
          return false;
        default:
          // This is an error but it's not an exit code we recognize, throw.
          throw error;
      }
    }
  }

  public async build(options: BuildOptions) {
    const buildCommand = [
      'build',
      ...flatten(
        Object.entries(options.buildArgs || {}).map(([k, v]) => ['--build-arg', `${k}=${v}`]),
      ),
      ...flatten(
        Object.entries(options.buildSecrets || {}).map(([k, v]) => ['--secret', `id=${k},${v}`]),
      ),
      ...(options.buildSsh ? ['--ssh', options.buildSsh] : []),
      '--tag',
      options.tag,
      ...(options.target ? ['--target', options.target] : []),
      ...(options.file ? ['--file', options.file] : []),
      ...(options.networkMode ? ['--network', options.networkMode] : []),
      ...(options.platform ? ['--platform', options.platform] : []),
      ...(options.outputs ? options.outputs.map((output) => [`--output=${output}`]) : []),
      ...(options.cacheFrom
        ? [
          ...options.cacheFrom
            .map((cacheFrom) => ['--cache-from', this.cacheOptionToFlag(cacheFrom)])
            .flat(),
        ]
        : []),
      ...(options.cacheTo ? ['--cache-to', this.cacheOptionToFlag(options.cacheTo)] : []),
      ...(options.cacheDisabled ? ['--no-cache'] : []),
      '.',
    ];
    await this.execute(buildCommand, {
      cwd: options.directory,
      subprocessOutputDestination: this.subprocessOutputDestination,
      env: {
        BUILDX_NO_DEFAULT_ATTESTATIONS: '1', // Docker Build adds provenance attestations by default that confuse cdk-assets
      },
    });
  }

  /**
   * Get credentials from ECR and run docker login
   */
  public async login(ecr: IECRClient) {
    const credentials = await obtainEcrCredentials(ecr, this.eventEmitter);

    // Use --password-stdin otherwise docker will complain. Loudly.
    await this.execute(
      ['login', '--username', credentials.username, '--password-stdin', credentials.endpoint.replace(/^https?:\/\/|\/$/g, '')],
      {
        input: credentials.password,

        // Need to ignore otherwise Docker will complain
        // 'WARNING! Your password will be stored unencrypted'
        // doesn't really matter since it's a token.
        subprocessOutputDestination: 'ignore',
      },
    );
  }

  public async tag(sourceTag: string, targetTag: string) {
    await this.execute(['tag', sourceTag, targetTag]);
  }

  public async push(options: PushOptions) {
    await this.execute(['push', options.tag], {
      subprocessOutputDestination: this.subprocessOutputDestination,
    });
  }

  /**
   * If a CDK Docker Credentials file exists, creates a new Docker config directory.
   * Sets up `docker-credential-cdk-assets` to be the credential helper for each domain in the CDK config.
   * All future commands (e.g., `build`, `push`) will use this config.
   *
   * See https://docs.docker.com/engine/reference/commandline/login/#credential-helpers for more details on cred helpers.
   *
   * @returns true if CDK config was found and configured, false otherwise
   */
  public configureCdkCredentials(): boolean {
    const config = cdkCredentialsConfig();
    if (!config) {
      return false;
    }

    this.configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cdkDockerConfig'));

    const domains = Object.keys(config.domainCredentials);
    const credHelpers = domains.reduce((map: Record<string, string>, domain) => {
      map[domain] = 'cdk-assets'; // Use docker-credential-cdk-assets for this domain
      return map;
    }, {});
    fs.writeFileSync(path.join(this.configDir, 'config.json'), JSON.stringify({ credHelpers }), {
      encoding: 'utf-8',
    });

    return true;
  }

  /**
   * Removes any configured Docker config directory.
   * All future commands (e.g., `build`, `push`) will use the default config.
   *
   * This is useful after calling `configureCdkCredentials` to reset to default credentials.
   */
  public resetAuthPlugins() {
    this.configDir = undefined;
  }

  private async execute(args: string[], options: Omit<ShellOptions, 'shellEventPublisher'> = {}) {
    const configArgs = this.configDir ? ['--config', this.configDir] : [];

    const pathToCdkAssets = path.resolve(__dirname, '..', '..', 'bin');

    const shellEventPublisher = shellEventPublisherFromEventEmitter(this.eventEmitter);
    try {
      await shell([getDockerCmd(), ...configArgs, ...args], {
        ...options,
        shellEventPublisher: shellEventPublisher,
        env: {
          ...process.env,
          ...options.env,
          PATH: `${pathToCdkAssets}${path.delimiter}${options.env?.PATH ?? process.env.PATH}`,
        },
      });
    } catch (e: any) {
      if (e.code === 'ENOENT') {
        throw new Error(
          `Failed to find and execute '${getDockerCmd()}' while attempting to build a container asset. Please install '${getDockerCmd()}' and try again. (Or set the 'CDK_DOCKER ' environment variable to choose a different compatible container client.)`,
        );
      }
      throw e;
    }
  }

  private cacheOptionToFlag(option: DockerCacheOption): string {
    let flag = `type=${option.type}`;
    if (option.params) {
      flag +=
        ',' +
        Object.entries(option.params)
          .map(([k, v]) => `${k}=${v}`)
          .join(',');
    }
    return flag;
  }
}

export interface DockerFactoryOptions {
  readonly repoUri: string;
  readonly ecr: IECRClient;
  readonly eventEmitter: EventEmitter;
  readonly subprocessOutputDestination: SubprocessOutputDestination;
}

/**
 * Helps get appropriately configured Docker instances during the container
 * image publishing process.
 */
export class DockerFactory {
  private enterLoggedInDestinationsCriticalSection = createCriticalSection();
  private loggedInDestinations = new Set<string>();

  /**
   * Gets a Docker instance for building images.
   */
  public async forBuild(options: DockerFactoryOptions): Promise<Docker> {
    const docker = new Docker(options.eventEmitter, options.subprocessOutputDestination);

    // Default behavior is to login before build so that the Dockerfile can reference images in the ECR repo
    // However, if we're in a pipelines environment (for example),
    // we may have alternative credentials to the default ones to use for the build itself.
    // If the special config file is present, delay the login to the default credentials until the push.
    // If the config file is present, we will configure and use those credentials for the build.
    let cdkDockerCredentialsConfigured = docker.configureCdkCredentials();
    if (!cdkDockerCredentialsConfigured) {
      await this.loginOncePerDestination(docker, options);
    }

    return docker;
  }

  /**
   * Gets a Docker instance for pushing images to ECR.
   */
  public async forEcrPush(options: DockerFactoryOptions) {
    const docker = new Docker(options.eventEmitter, options.subprocessOutputDestination);
    await this.loginOncePerDestination(docker, options);
    return docker;
  }

  private async loginOncePerDestination(docker: Docker, options: DockerFactoryOptions) {
    // Changes: 012345678910.dkr.ecr.us-west-2.amazonaws.com/tagging-test
    // To this: 012345678910.dkr.ecr.us-west-2.amazonaws.com
    const repositoryDomain = options.repoUri.split('/')[0];

    // Ensure one-at-a-time access to loggedInDestinations.
    await this.enterLoggedInDestinationsCriticalSection(async () => {
      if (this.loggedInDestinations.has(repositoryDomain)) {
        return;
      }

      await docker.login(options.ecr);
      this.loggedInDestinations.add(repositoryDomain);
    });
  }
}

function getDockerCmd(): string {
  return process.env.CDK_DOCKER ?? 'docker';
}

function flatten(x: string[][]) {
  return Array.prototype.concat([], ...x);
}
