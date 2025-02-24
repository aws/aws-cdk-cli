import { SuccessfulDeployStackResult as _SuccessfulDeployStackResult } from '../api/aws-cdk';

export interface AssemblyData {
  assemblyDirectory: string;
  stacksCount: number;
  stackIds: string[];
}

export interface SuccessfulDeployStackResult extends _SuccessfulDeployStackResult {
}

export interface StackData extends AssemblyData {
  stack: {
    stackName: string;
    hierarchicalId: string;
    template: any;
    stringifiedJson: string;
    stringifiedYaml: string;
  };
}

export interface Duration {
  duration: number;
}
