import { Duration, ErrorPayload } from '@aws-cdk/toolkit-lib';
import * as make from '../../api-private';

export interface EventResult extends Duration, Partial<ErrorPayload> {
  readonly success: boolean;
}

export const CLI_PRIVATE_IO = {
  CDK_CLI_I1000: make.trace<EventResult>({
    code: 'CDK_CLI_I1000',
    description: 'Cloud Executable Result',
    interface: 'EventResult',
  }),

  CDK_CLI_I2000: make.trace<EventResult>({
    code: 'CDK_CLI_I2000',
    description: 'Command has finished executing',
    interface: 'EventResult',
  }),
}
