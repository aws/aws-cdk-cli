import type { PropertyDifference } from '@aws-cdk/cloudformation-diff';
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
  if (namesOfHotswappableChanges.length === 0) {
    return ret;
  }

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
      const currentResource = await sdk.cloudControl().getResource({
        TypeName: 'AWS::BedrockAgentCore::Runtime',
        Identifier: agentRuntimeId,
      });

      const currentProps = JSON.parse(currentResource.ResourceDescription?.Properties ?? '{}');

      const desiredState: Record<string, any> = {
        ...currentProps,
      };

      if (runtimeChange.artifact) {
        desiredState.AgentRuntimeArtifact = toCfnAgentRuntimeArtifact(runtimeChange.artifact);
      }
      if (runtimeChange.description !== undefined) {
        desiredState.Description = runtimeChange.description;
      }
      if (runtimeChange.environmentVariables !== undefined) {
        desiredState.EnvironmentVariables = runtimeChange.environmentVariables;
      }

      const patchOps = Object.entries(desiredState).map(([key, value]) => ({
        op: 'replace', path: `/${key}`, value,
      }));

      await sdk.cloudControl().updateResource({
        TypeName: 'AWS::BedrockAgentCore::Runtime',
        Identifier: agentRuntimeId,
        PatchDocument: JSON.stringify(patchOps),
      });
    },
  });

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
        // never reached
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

// function toSdkAgentRuntimeArtifact(artifact: AgentRuntimeArtifact): SdkAgentRuntimeArtifact {
//   if (artifact.codeConfiguration) {
//     const code = artifact.codeConfiguration.code.s3
//       ? { s3: artifact.codeConfiguration.code.s3 }
//       : undefined;

//     return {
//       codeConfiguration: {
//         code,
//         runtime: artifact.codeConfiguration.runtime as AgentManagedRuntimeType,
//         entryPoint: artifact.codeConfiguration.entryPoint,
//       },
//     };
//   }

//   if (artifact.containerConfiguration) {
//     return {
//       containerConfiguration: artifact.containerConfiguration,
//     };
//   }

//   // never reached
//   throw new ToolkitError('AgentRuntimeArtifact must have either codeConfiguration or containerConfiguration');
// }

function toCfnAgentRuntimeArtifact(artifact: AgentRuntimeArtifact): Record<string, any> {
  if (artifact.codeConfiguration) {
    const code = artifact.codeConfiguration.code.s3
      ? {
        S3: {
          Bucket: artifact.codeConfiguration.code.s3.bucket,
          Prefix: artifact.codeConfiguration.code.s3.prefix,
          ...(artifact.codeConfiguration.code.s3.versionId && {
            VersionId: artifact.codeConfiguration.code.s3.versionId,
          }),
        },
      }
      : {};

    return {
      CodeConfiguration: {
        Code: code,
        Runtime: artifact.codeConfiguration.runtime,
        EntryPoint: artifact.codeConfiguration.entryPoint,
      },
    };
  }

  if (artifact.containerConfiguration) {
    return {
      ContainerConfiguration: {
        ContainerUri: artifact.containerConfiguration.containerUri,
      },
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
