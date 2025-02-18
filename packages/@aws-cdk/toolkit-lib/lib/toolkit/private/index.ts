
import { SdkProvider } from '../../api/aws-cdk';
import { ActionAwareIoHost } from '../../api/io/private';

/**
 * Helper struct to pass internal services around.
 */
export interface ToolkitServices {
  sdkProvider: SdkProvider;
  ioHost: ActionAwareIoHost;
}

export interface StackData {
  assemblyDirectory: string;
  stacksCount: number;
  stackIds: string[];
  stack: {
    stackName: string;
    hierarchicalId: string;
    template: any;
    stringifiedJson: string;
    stringifiedYaml: string;
  };
}
