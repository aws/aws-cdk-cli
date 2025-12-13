import type { PropertyDifference } from '@aws-cdk/cloudformation-diff';
import type {
  AgentRuntimeArtifact as SdkAgentRuntimeArtifact,
  AgentManagedRuntimeType,
} from '@aws-sdk/client-bedrock-agentcore-control';
import type { HotswapChange } from './common';
import { classifyChanges } from './common';
import type { ResourceChange } from '../../payloads/hotswap';
import { ToolkitError } from '../../toolkit/toolkit-error';
import type { SDK } from '../aws-auth/private';
import type { EvaluateCloudFormationTemplate } from '../cloudformation';

export async function isHotswappableBedrockAgentCoreRuntimeChange(
  logicalId: string,
  change: ResourceChange,
  evaluateCfnTemplate: EvaluateCloudFormationTemplate,
): Promise<HotswapChange[]> {
  if (change.newValue.Type !== 'AWS::BedrockAgentCore::Runtime') {
    return [];
  }

  const ret: HotswapChange[] = [];
  const classifiedChanges = classifyChanges(change, [
    'AgentRuntimeArtifact',
    'EnvironmentVariables',
    'Description',
  ]);
  classifiedChanges.reportNonHotswappablePropertyChanges(ret);

  const namesOfHotswappableChanges = Object.keys(classifiedChanges.hotswappableProps);
  if (namesOfHotswappableChanges.length > 0) {
    const agentRuntimeId = await evaluateCfnTemplate.findPhysicalNameFor(logicalId);

    if (!agentRuntimeId) {
      return ret;
    }
    const runtimeChange = await evaluateBedrockAgentCoreRuntimeProps(
      classifiedChanges.hotswappableProps,
      evaluateCfnTemplate,
    );

    ret.push({
      change: {
        cause: change,
        resources: [{
          logicalId,
          resourceType: change.newValue.Type,
          physicalName: agentRuntimeId,
          metadata: evaluateCfnTemplate.metadataFor(logicalId),
        }],
      },
      hotswappable: true,
      service: 'bedrock-agentcore',
      apply: async (sdk: SDK) => {
        const bedrockAgentCore = sdk.bedrockAgentCoreControl();

        const currentRuntime = await bedrockAgentCore.getAgentRuntime({
          agentRuntimeId: agentRuntimeId,
        });

        // While UpdateAgentRuntimeRequest type allows undefined,
        // the API will fail at runtime if these required properties are not provided.
        if (!currentRuntime.agentRuntimeArtifact) {
          throw new ToolkitError('Current runtime does not have an artifact');
        }
        if (!currentRuntime.roleArn) {
          throw new ToolkitError('Current runtime does not have a roleArn');
        }
        if (!currentRuntime.networkConfiguration) {
          throw new ToolkitError('Current runtime does not have a networkConfiguration');
        }

        // All properties must be explicitly specified, otherwise they will be reset to
        // default values. We pass all properties from the current runtime and override
        // only the ones that have changed.
        await bedrockAgentCore.updateAgentRuntime({
          agentRuntimeId: agentRuntimeId,
          agentRuntimeArtifact: runtimeChange.artifact
            ? toSdkAgentRuntimeArtifact(runtimeChange.artifact)
            : currentRuntime.agentRuntimeArtifact,
          roleArn: currentRuntime.roleArn,
          networkConfiguration: currentRuntime.networkConfiguration,
          description: runtimeChange.description ?? currentRuntime.description,
          authorizerConfiguration: currentRuntime.authorizerConfiguration,
          requestHeaderConfiguration: currentRuntime.requestHeaderConfiguration,
          protocolConfiguration: currentRuntime.protocolConfiguration,
          lifecycleConfiguration: currentRuntime.lifecycleConfiguration,
          environmentVariables: runtimeChange.environmentVariables ?? currentRuntime.environmentVariables,
        });
      },
    });
  }

  return ret;
}

async function evaluateBedrockAgentCoreRuntimeProps(
  hotswappablePropChanges: Record<string, PropertyDifference<unknown>>,
  evaluateCfnTemplate: EvaluateCloudFormationTemplate,
): Promise<BedrockAgentCoreRuntimeChange> {
  const runtimeChange: BedrockAgentCoreRuntimeChange = {};

  for (const updatedPropName in hotswappablePropChanges) {
    const updatedProp = hotswappablePropChanges[updatedPropName];
    
    switch (updatedPropName) {
      case 'AgentRuntimeArtifact':
        runtimeChange.artifact = await evaluateAgentRuntimeArtifact(
          updatedProp.newValue as CfnAgentRuntimeArtifact,
          evaluateCfnTemplate,
        );
        break;

      case 'Description':
        runtimeChange.description = await evaluateCfnTemplate.evaluateCfnExpression(updatedProp.newValue);
        break;

      case 'EnvironmentVariables':
        runtimeChange.environmentVariables = await evaluateCfnTemplate.evaluateCfnExpression(updatedProp.newValue);
        break;

      default:
        throw new ToolkitError(
          'Unexpected hotswappable property for BedrockAgentCore Runtime. Please report this at github.com/aws/aws-cdk/issues/new/choose',
        );
    }
  }

  return runtimeChange;
}

async function evaluateAgentRuntimeArtifact(
  artifactValue: CfnAgentRuntimeArtifact,
  evaluateCfnTemplate: EvaluateCloudFormationTemplate,
): Promise<AgentRuntimeArtifact | undefined> {
  if (artifactValue.CodeConfiguration) {
    const codeConfig = artifactValue.CodeConfiguration;
    const code = codeConfig.Code;

    const s3Location = code.S3 ? {
      bucket: await evaluateCfnTemplate.evaluateCfnExpression(code.S3.Bucket),
      prefix: await evaluateCfnTemplate.evaluateCfnExpression(code.S3.Prefix),
      versionId: code.S3.VersionId
        ? await evaluateCfnTemplate.evaluateCfnExpression(code.S3.VersionId)
        : undefined,
    } : undefined;

    return {
      codeConfiguration: {
        code: s3Location ? { s3: s3Location } : {},
        runtime: await evaluateCfnTemplate.evaluateCfnExpression(codeConfig.Runtime),
        entryPoint: await evaluateCfnTemplate.evaluateCfnExpression(codeConfig.EntryPoint),
      },
    };
  }

  if (artifactValue.ContainerConfiguration) {
    return {
      containerConfiguration: {
        containerUri: await evaluateCfnTemplate.evaluateCfnExpression(
          artifactValue.ContainerConfiguration.ContainerUri,
        ),
      },
    };
  }

  return undefined;
}

function toSdkAgentRuntimeArtifact(artifact: AgentRuntimeArtifact): SdkAgentRuntimeArtifact {
  if (artifact.codeConfiguration) {
    const code = artifact.codeConfiguration.code.s3
      ? { s3: artifact.codeConfiguration.code.s3 }
      : undefined;

    return {
      codeConfiguration: {
        code,
        runtime: artifact.codeConfiguration.runtime as AgentManagedRuntimeType,
        entryPoint: artifact.codeConfiguration.entryPoint,
      },
    };
  }

  if (artifact.containerConfiguration) {
    return {
      containerConfiguration: artifact.containerConfiguration,
    };
  }

  // never reached
  throw new ToolkitError('AgentRuntimeArtifact must have either codeConfiguration or containerConfiguration');
}

interface CfnAgentRuntimeArtifact {
  readonly CodeConfiguration?: {
    readonly Code: {
      readonly S3?: {
        readonly Bucket: unknown;
        readonly Prefix: unknown;
        readonly VersionId?: unknown;
      };
    };
    readonly Runtime: unknown;
    readonly EntryPoint: unknown;
  };
  readonly ContainerConfiguration?: {
    readonly ContainerUri: unknown;
  };
}

interface AgentRuntimeArtifact {
  readonly codeConfiguration?: {
    readonly code: {
      readonly s3?: {
        readonly bucket: string;
        readonly prefix: string;
        readonly versionId?: string;
      };
    };
    readonly runtime: string;
    readonly entryPoint: string[];
  };
  readonly containerConfiguration?: {
    readonly containerUri: string;
  };
}

interface BedrockAgentCoreRuntimeChange {
  artifact?: AgentRuntimeArtifact;
  description?: string;
  environmentVariables?: Record<string, string>;
}
