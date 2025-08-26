import {
  CloudFormationClient,
  DeleteStackCommand,
  DescribeStacksCommand,
  UpdateTerminationProtectionCommand,
  type Stack,
} from '@aws-sdk/client-cloudformation';
import { DeleteRepositoryCommand, ECRClient } from '@aws-sdk/client-ecr';
import { ECRPUBLICClient } from '@aws-sdk/client-ecr-public';
import { ECSClient } from '@aws-sdk/client-ecs';
import { CreateRoleCommand, DeleteRoleCommand, DeleteRolePolicyCommand, IAMClient, ListRolePoliciesCommand, PutRolePolicyCommand } from '@aws-sdk/client-iam';
import { LambdaClient } from '@aws-sdk/client-lambda';
import {
  S3Client,
  DeleteObjectsCommand,
  ListObjectVersionsCommand,
  type ObjectIdentifier,
  DeleteBucketCommand,
} from '@aws-sdk/client-s3';
import { SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { SNSClient } from '@aws-sdk/client-sns';
import { SSOClient } from '@aws-sdk/client-sso';
import { AssumeRoleCommand, STSClient, GetCallerIdentityCommand } from '@aws-sdk/client-sts';
import { fromIni, fromNodeProviderChain } from '@aws-sdk/credential-providers';
import type { AwsCredentialIdentity, AwsCredentialIdentityProvider, NodeHttpHandlerOptions } from '@smithy/types';
import { ConfiguredRetryStrategy } from '@smithy/util-retry';

interface ClientConfig {
  readonly credentials: AwsCredentialIdentityProvider | AwsCredentialIdentity;
  readonly region: string;
  readonly retryStrategy: ConfiguredRetryStrategy;
  readonly requestHandler?: NodeHttpHandlerOptions;
}

export class AwsClients {
  public static async forIdentity(randomString: string, region: string, identity: AwsCredentialIdentity, output: NodeJS.WritableStream) {
    return new AwsClients(randomString, region, output, identity);
  }

  public static async forRegion(randomString: string, region: string, output: NodeJS.WritableStream) {
    return new AwsClients(randomString, region, output);
  }

  private readonly cleanup: (() => Promise<void>)[] = [];
  private readonly config: ClientConfig;

  public readonly cloudFormation: CloudFormationClient;
  public readonly s3: S3Client;
  public readonly ecr: ECRClient;
  public readonly ecrPublic: ECRPUBLICClient;
  public readonly ecs: ECSClient;
  public readonly sso: SSOClient;
  public readonly sns: SNSClient;
  public readonly iam: IAMClient;
  public readonly lambda: LambdaClient;
  public readonly sts: STSClient;
  public readonly secretsManager: SecretsManagerClient;

  private constructor(
    /** A random string to use for temporary resources, like roles (should preferably match unique test-specific randomString) */
    private readonly randomString: string,
    public readonly region: string,
    private readonly output: NodeJS.WritableStream,
    public readonly identity?: AwsCredentialIdentity) {
    this.config = {
      credentials: this.identity ?? chainableCredentials(this.region),
      region: this.region,
      retryStrategy: new ConfiguredRetryStrategy(9, (attempt: number) => attempt ** 500),
    };

    this.cloudFormation = new CloudFormationClient(this.config);
    this.s3 = new S3Client(this.config);
    this.ecr = new ECRClient(this.config);
    this.ecrPublic = new ECRPUBLICClient({ ...this.config, region: 'us-east-1' /* public gallery is only available in us-east-1 */ });
    this.ecs = new ECSClient(this.config);
    this.sso = new SSOClient(this.config);
    this.sns = new SNSClient(this.config);
    this.iam = new IAMClient(this.config);
    this.lambda = new LambdaClient(this.config);
    this.sts = new STSClient(this.config);
    this.secretsManager = new SecretsManagerClient(this.config);
  }

  public addCleanup(cleanup: () => Promise<any>) {
    this.cleanup.push(cleanup);
  }

  public async dispose() {
    for (const cleanup of this.cleanup) {
      try {
        await cleanup();
      } catch (e: any) {
        this.output.write(`⚠️ Error during cleanup: ${e.message}\n`);
      }
    }
    this.cleanup.splice(0, this.cleanup.length);
  }

  public async account(): Promise<string> {
    // Reduce # of retries, we use this as a circuit breaker for detecting no-config
    const stsClient = new STSClient({
      credentials: this.config.credentials,
      region: this.config.region,
      maxAttempts: 2,
    });

    return (await stsClient.send(new GetCallerIdentityCommand({}))).Account!;
  }

  /**
   * If the clients already has an established identity (via atmosphere for example),
   * return an environment variable map activating it.
   *
   * Otherwise, returns undefined.
   */
  public identityEnv(): Record<string, string> | undefined {
    return this.identity ? {
      AWS_ACCESS_KEY_ID: this.identity.accessKeyId,
      AWS_SECRET_ACCESS_KEY: this.identity.secretAccessKey,
      AWS_SESSION_TOKEN: this.identity.sessionToken!,

      // unset any previously used profile because the SDK will prefer
      // this over static env credentials. this is relevant for tests running on CodeBuild
      // because we use a profile as our main credentials source.
      AWS_PROFILE: '',
    } : undefined;
  }

  /**
   * Resolve the current identity or identity provider to credentials
   */
  public async credentials() {
    const x = this.config.credentials;
    if (isAwsCredentialIdentity(x)) {
      return x;
    }
    return x();
  }

  public async deleteStacks(...stackNames: string[]) {
    if (stackNames.length === 0) {
      return;
    }

    // We purposely do all stacks serially, because they've been ordered
    // to do the bootstrap stack last.
    for (const stackName of stackNames) {
      await this.cloudFormation.send(
        new UpdateTerminationProtectionCommand({
          EnableTerminationProtection: false,
          StackName: stackName,
        }),
      );
      await this.cloudFormation.send(
        new DeleteStackCommand({
          StackName: stackName,
        }),
      );

      await retry(this.output, `Deleting ${stackName}`, retry.forSeconds(600), async () => {
        const status = await this.stackStatus(stackName);
        if (status !== undefined && status.endsWith('_FAILED')) {
          throw retry.abort(new Error(`'${stackName}' is in state '${status}'`));
        }
        if (status !== undefined) {
          throw new Error(`Delete of '${stackName}' not complete yet, status: '${status}'`);
        }
      });
    }
  }

  public async stackStatus(stackName: string): Promise<string | undefined> {
    try {
      return (
        await this.cloudFormation.send(
          new DescribeStacksCommand({
            StackName: stackName,
          }),
        )
      ).Stacks?.[0].StackStatus;
    } catch (e: any) {
      if (isStackMissingError(e)) {
        return undefined;
      }
      throw e;
    }
  }

  public async emptyBucket(bucketName: string, options?: { bypassGovernance?: boolean }) {
    const objects = await this.s3.send(
      new ListObjectVersionsCommand({
        Bucket: bucketName,
      }),
    );

    const deletes = [...(objects.Versions || []), ...(objects.DeleteMarkers || [])].reduce((acc, obj) => {
      if (typeof obj.VersionId !== 'undefined' && typeof obj.Key !== 'undefined') {
        acc.push({ Key: obj.Key, VersionId: obj.VersionId });
      } else if (typeof obj.Key !== 'undefined') {
        acc.push({ Key: obj.Key });
      }
      return acc;
    }, [] as ObjectIdentifier[]);

    if (deletes.length === 0) {
      return Promise.resolve();
    }

    return this.s3.send(
      new DeleteObjectsCommand({
        Bucket: bucketName,
        Delete: {
          Objects: deletes,
          Quiet: false,
        },
        BypassGovernanceRetention: options?.bypassGovernance ? true : undefined,
      }),
    );
  }

  public async deleteImageRepository(repositoryName: string) {
    await this.ecr.send(
      new DeleteRepositoryCommand({
        repositoryName: repositoryName,
        force: true,
      }),
    );
  }

  public async deleteBucket(bucketName: string) {
    try {
      await this.emptyBucket(bucketName);

      await this.s3.send(
        new DeleteBucketCommand({
          Bucket: bucketName,
        }),
      );
    } catch (e: any) {
      if (isBucketMissingError(e)) {
        return;
      }
      throw e;
    }
  }

  /**
   * Create a role that will be cleaned up when the AwsClients object is cleaned up
   */
  public async temporaryRole(namePrefix: string, assumeRolePolicyStatements: any[], policyStatements: any[]) {
    const response = await this.iam.send(new CreateRoleCommand({
      RoleName: `${namePrefix}-${this.randomString}`,
      AssumeRolePolicyDocument: JSON.stringify({
        Version: '2012-10-17',
        Statement: assumeRolePolicyStatements,
      }, undefined, 2),
      Tags: [
        {
          Key: 'deleteme',
          Value: 'true',
        },
      ],
    }));
    await this.iam.send(new PutRolePolicyCommand({
      RoleName: `${namePrefix}-${this.randomString}`,
      PolicyName: 'DefaultPolicy',
      PolicyDocument: JSON.stringify({
        Version: '2012-10-17',
        Statement: policyStatements,
      }, undefined, 2),
    }));

    this.addCleanup(() => this.deleteRole(response.Role!.RoleName!));

    return response.Role?.Arn ?? '*CreateRole did not return an ARN*';
  }

  public async waitForAssumeRole(roleArn: string) {
    await retryOnMatchingErrors(
      () => this.sts.send(new AssumeRoleCommand({
        RoleArn: roleArn,
        RoleSessionName: 'test-existence',
      })),
      ['AccessDenied'],
      retry.forSeconds(60),
    );
  }

  public async deleteRole(name: string) {
    const policiesResponse = await this.iam.send(new ListRolePoliciesCommand({
      RoleName: name,
    }));

    for (const policyName of policiesResponse.PolicyNames ?? []) {
      await this.iam.send(new DeleteRolePolicyCommand({
        RoleName: name,
        PolicyName: policyName,
      }));
    }

    await this.iam.send(new DeleteRoleCommand({
      RoleName: name,
    }));
  }
}

export function isStackMissingError(e: Error) {
  return e.message.indexOf('does not exist') > -1;
}

export function isBucketMissingError(e: Error) {
  return e.message.indexOf('does not exist') > -1;
}

/**
 * Retry an async operation until a deadline is hit.
 *
 * Use `retry.forSeconds()` to construct a deadline relative to right now.
 *
 * Exceptions will cause the operation to retry. Use `retry.abort` to annotate an exception
 * to stop the retry and end in a failure.
 */
export async function retry<A>(
  output: NodeJS.WritableStream,
  operation: string,
  deadline: Date,
  block: () => Promise<A>,
): Promise<A> {
  let i = 0;
  output.write(`💈 ${operation}\n`);
  while (true) {
    try {
      i++;
      const ret = await block();
      output.write(`💈 ${operation}: succeeded after ${i} attempts\n`);
      return ret;
    } catch (e: any) {
      if (e.abort || Date.now() > deadline.getTime()) {
        throw new Error(`${operation}: did not succeed after ${i} attempts: ${e}`);
      }
      output.write(`⏳ ${operation} (${e.message})\n`);
      await sleep(5000);
    }
  }
}

/**
 * Make a deadline for the `retry` function relative to the current time.
 */
retry.forSeconds = (seconds: number): Date => {
  return new Date(Date.now() + seconds * 1000);
};

/**
 * Annotate an error to stop the retrying
 */
retry.abort = (e: Error): Error => {
  (e as any).abort = true;
  return e;
};

export function outputFromStack(key: string, stack: Stack): string | undefined {
  return (stack.Outputs ?? []).find((o) => o.OutputKey === key)?.OutputValue;
}

export async function sleep(ms: number) {
  return new Promise((ok) => setTimeout(ok, ms));
}

/**
 * Retry an async operation with error filtering until a deadline is hit.
 *
 * Use `retry.forSeconds()` to construct a deadline relative to right now.
 *
 * Only retries on errors with matching names in errorNames array.
 */
export async function retryOnMatchingErrors<T>(
  operation: () => Promise<T>,
  errorNames: string[],
  deadline: Date,
  interval: number = 5000,
): Promise<T> {
  let i = 0;
  while (true) {
    try {
      i++;
      return await operation();
    } catch (e: any) {
      if (Date.now() > deadline.getTime()) {
        throw new Error(`Operation did not succeed after ${i} attempts: ${e}`);
      }
      if (!errorNames.includes(e.name)) {
        throw e;
      }
      await sleep(interval);
    }
  }
}

function chainableCredentials(region: string): AwsCredentialIdentityProvider {
  if ((process.env.CODEBUILD_BUILD_ARN || process.env.GITHUB_RUN_ID) && process.env.AWS_PROFILE) {
    // in codebuild we must assume the role that the cdk uses
    // otherwise credentials will just be picked up by the normal sdk
    // heuristics and expire after an hour.
    return fromIni({
      clientConfig: { region },
    });
  }

  // Otherwise just get what's default
  return fromNodeProviderChain({ clientConfig: { region } });
}

function isAwsCredentialIdentity(x: any): x is AwsCredentialIdentity {
  return Boolean(x && typeof x === 'object' && x.accessKeyId);
}
