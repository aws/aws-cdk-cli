import type { TypedMapping } from '@aws-cdk/cloudformation-diff';
import type * as cxapi from '@aws-cdk/cx-api';
import type { ResourceMapping as CfnResourceMapping } from '@aws-sdk/client-cloudformation';

export interface CloudFormationResource {
  Type: string;
  Properties?: any;
  Metadata?: Record<string, any>;
  DependsOn?: string | string[];
}

export interface CloudFormationTemplate {
  Resources?: {
    [logicalId: string]: CloudFormationResource;
  };
  Outputs?: Record<string, any>;
}

export interface CloudFormationStack {
  readonly environment: cxapi.Environment;
  readonly stackName: string;
  readonly template: CloudFormationTemplate;
}

export function hasResource(stack: CloudFormationStack, logicalId: string): boolean {
  return stack.template.Resources?.[logicalId] != null;
}

/**
 * This class mirrors the `ResourceLocation` interface from CloudFormation,
 * but is richer, since it has a reference to the stack object, rather than
 * merely the stack name.
 */
export class ResourceLocation {
  constructor(public readonly stack: CloudFormationStack, public readonly logicalResourceId: string) {
  }

  public toPath(): string {
    const stack = this.stack;
    const resource = stack.template.Resources?.[this.logicalResourceId];
    const result = resource?.Metadata?.['aws:cdk:path'];

    if (result != null) {
      return result;
    }

    // If the path is not available, we can use stack name and logical ID
    return `${stack.stackName}.${this.logicalResourceId}`;
  }

  public getType(): string {
    const resource = this.stack.template.Resources?.[this.logicalResourceId ?? ''];
    return resource?.Type ?? 'Unknown';
  }

  public equalTo(other: ResourceLocation): boolean {
    return this.logicalResourceId === other.logicalResourceId && this.stack.stackName === other.stack.stackName;
  }

  public toString(): string {
    return `${this.stack.stackName}.${this.logicalResourceId}`;
  }
}

/**
 * A mapping between a source and a destination location.
 */
export class ResourceMapping {
  constructor(public readonly source: ResourceLocation, public readonly destination: ResourceLocation) {
  }

  public toTypedMapping(): TypedMapping {
    return {
      // the type is the same in both source and destination,
      // so we can use either one
      type: this.source.getType(),
      sourcePath: this.source.toPath(),
      destinationPath: this.destination.toPath(),
    };
  }

  public toCloudFormation(): CfnResourceMapping {
    return {
      Source: {
        StackName: this.source.stack.stackName,
        LogicalResourceId: this.source.logicalResourceId,
      },
      Destination: {
        StackName: this.destination.stack.stackName,
        LogicalResourceId: this.destination.logicalResourceId,
      },
    };
  }
}
