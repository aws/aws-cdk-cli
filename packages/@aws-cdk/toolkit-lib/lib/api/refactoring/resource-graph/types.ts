export interface CloudFormationTemplate {
  AWSTemplateFormatVersion?: string;
  Description?: string;
  Parameters?: Record<string, any>;
  Resources: Record<string, Resource>;
  Outputs?: Record<string, Output>;
  Mappings?: Record<string, any>;
  Conditions?: Record<string, any>;
  Rules?: Record<string, any>;
}

export interface Resource {
  Type: string;
  Properties?: Record<string, any>;
  DependsOn?: string | string[];
  Condition?: string;
  Metadata?: Record<string, any>;
  CreationPolicy?: Record<string, any>;
  DeletionPolicy?: string;
  UpdatePolicy?: Record<string, any>;
  UpdateReplacePolicy?: string;
}

export interface Output {
  Value: any;
  Export?: {
    Name: string | any;
  };
  Description?: string;
  Condition?: string;
}

export interface GraphNode {
  id: string;
  type: string;
  properties: Record<string, any>;
  metadata?: Record<string, any>;
  stackId?: string;
}

export interface GraphEdge {
  from: string;
  to: string;
  type: EdgeType;
  crossStack?: boolean;
  attribute?: string;
}

export interface StackTemplate {
  stackId: string;
  template: CloudFormationTemplate;
}

export interface NodeLocation {
  stackId: string;
  logicalId: string;
}

export enum EdgeType {
  DEPENDS_ON = 'DependsOn',
  REFERENCE = 'Reference',
  GET_ATT = 'GetAtt',
  IMPORT_VALUE = 'ImportValue',
  EXPORT = 'Export',
}
