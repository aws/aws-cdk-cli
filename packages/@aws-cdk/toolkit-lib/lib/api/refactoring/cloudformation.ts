import type { TypedMapping } from '@aws-cdk/cloudformation-diff';
import { deepEqual } from '@aws-cdk/cloudformation-diff';
import type * as cxapi from '@aws-cdk/cx-api';
import { ToolkitError } from '../../toolkit/toolkit-error';

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
}

export interface ResourceReference {
  equals(other: ResourceReference): boolean;

  replace(mappings: ResourceMapping[]): ResourceReference;

  toCfn(): any;
}

export class Ref implements ResourceReference {
  public static fromCfn(stackName: string, value: any): ResourceReference {
    if (!('Ref' in value)) {
      throw new ToolkitError(`Expected a Ref object, got ${JSON.stringify(value)}`);
    }
    return new Ref(stackName, value.Ref);
  }

  constructor(public readonly stackName: string, public readonly logicalResourceId: string) {
  }

  public equals(other: ResourceReference): boolean {
    return (
      other instanceof Ref && this.stackName === other.stackName && this.logicalResourceId === other.logicalResourceId
    );
  }

  public map(stackName: string, logicalId: string): ResourceReference {
    return new Ref(stackName, logicalId);
  }

  public replace(mappings: ResourceMapping[]): ResourceReference {
    for (const mapping of mappings) {
      if (
        mapping.source.logicalResourceId === this.logicalResourceId &&
        mapping.source.stack.stackName === this.stackName
      ) {
        const logicalId = mapping.destination.logicalResourceId;
        const stackName = mapping.destination.stack.stackName;
        return new Ref(stackName, logicalId);
      }
    }
    return this;
  }

  toCfn(): any {
    return { Ref: this.logicalResourceId };
  }
}

export class GetAtt implements ResourceReference {
  public static fromCfn(stackName: string, value: any): ResourceReference {
    if (!('Fn::GetAtt' in value)) {
      throw new ToolkitError(`Expected a Fn::GetAtt object, got ${JSON.stringify(value)}`);
    }
    const att = value['Fn::GetAtt'];
    if (typeof att === 'string') {
      const [id, attributeName] = att.split('.');
      return new GetAtt(stackName, id, attributeName);
    } else if (Array.isArray(att) && att.length === 2) {
      return new GetAtt(stackName, att[0], att[1]);
    } else {
      throw new ToolkitError(`Invalid Fn::GetAtt format: ${JSON.stringify(value)}`);
    }
  }

  constructor(
    private readonly stackName: string,
    private readonly logicalResourceId: string,
    private readonly attributeName: string,
  ) {
  }

  public equals(other: ResourceReference): boolean {
    return (
      other instanceof GetAtt &&
      this.stackName === other.stackName &&
      this.logicalResourceId === other.logicalResourceId &&
      this.attributeName === other.attributeName
    );
  }

  public replace(mappings: ResourceMapping[]): ResourceReference {
    for (const mapping of mappings) {
      if (
        mapping.source.logicalResourceId === this.logicalResourceId &&
        mapping.source.stack.stackName === this.stackName
      ) {
        const logicalId = mapping.destination.logicalResourceId;
        const stackName = mapping.destination.stack.stackName;
        return new GetAtt(stackName, logicalId, this.attributeName);
      }
    }
    return this;
  }

  toCfn(): any {
    return { 'Fn::GetAtt': [this.logicalResourceId, this.attributeName] };
  }
}

export class DependsOn implements ResourceReference {
  public static fromString(stackName: string, logicalId: string): ResourceReference {
    return DependsOn.fromArray(stackName, [logicalId]);
  }

  public static fromArray(stackName: string, logicalIds: string[]): ResourceReference {
    return new DependsOn(stackName, logicalIds);
  }

  constructor(private readonly stackName: string, private readonly logicalIds: string[]) {
  }

  public equals(other: ResourceReference): boolean {
    return (
      other instanceof DependsOn &&
      this.stackName === other.stackName &&
      other.logicalIds.length === this.logicalIds.length &&
      this.logicalIds.every((id) => other.logicalIds.includes(id))
    );
  }

  replace(mappings: ResourceMapping[]): ResourceReference {
    const newLogicalIds = this.logicalIds.map((logicalId) => {
      for (const mapping of mappings) {
        if (mapping.source.logicalResourceId === logicalId && mapping.source.stack.stackName === this.stackName) {
          return mapping.destination.logicalResourceId;
        }
      }
      return logicalId; // No mapping found, return original logical ID
    });

    return new DependsOn(this.stackName, newLogicalIds);
  }

  toCfn(): any {
    return this.logicalIds;
  }
}

export class FnSub implements ResourceReference {
  constructor(
    private readonly stackName: string,
    private readonly inputString: any,
    private readonly variableMap: Record<string, string> = {},
  ) {
  }

  equals(other: ResourceReference): boolean {
    return (
      other instanceof FnSub &&
      this.stackName === other.stackName &&
      deepEqual(this.inputString, other.inputString) &&
      deepEqual(this.variableMap, other.variableMap)
    );
  }

  replace(mappings: ResourceMapping[]): ResourceReference {
    if (typeof this.inputString !== 'string') {
      return this;
    }

    const newInputString = this.inputString.replace(/\${([a-zA-Z0-9_.]+)}/g, (_: any, varName: string) => {
      if (varName.includes('.')) {
        const [logicalId, attr] = varName.split('.');
        const mappedResource = replaceIfFound(mappings, this.stackName, logicalId);
        return `\${${mappedResource}.${attr}}`;
      } else {
        return `\${${replaceIfFound(mappings, this.stackName, varName)}}`;
      }
    });
    return new FnSub(this.stackName, newInputString, this.variableMap);
  }

  toCfn(): any {
    const array = this.variableMap ? [this.inputString, this.variableMap] : [this.inputString];
    return {
      'Fn::Sub': array,
    };
  }
}

export function resourceReferenceFromCfn(stackName: string, value: any): ResourceReference {
  if ('Ref' in value) {
    return Ref.fromCfn(stackName, value);
  } else if ('Fn::GetAtt' in value) {
    return GetAtt.fromCfn(stackName, value);
  } else {
    throw new ToolkitError(`Unsupported resource reference type: ${JSON.stringify(value)}`);
  }
}

function replaceIfFound(mappings: ResourceMapping[], stackName: string, logicalId: string): string {
  for (const mapping of mappings) {
    if (mapping.source.logicalResourceId === logicalId && mapping.source.stack.stackName === stackName) {
      return mapping.destination.logicalResourceId;
    }
  }
  return logicalId;
}
