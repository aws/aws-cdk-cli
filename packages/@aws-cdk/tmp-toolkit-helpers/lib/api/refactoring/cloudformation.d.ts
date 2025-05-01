import type * as cxapi from '@aws-cdk/cx-api';
export interface CloudFormationTemplate {
    Resources?: {
        [logicalId: string]: {
            Type: string;
            Properties?: any;
            Metadata?: Record<string, any>;
        };
    };
}
export interface CloudFormationStack {
    readonly environment: cxapi.Environment;
    readonly stackName: string;
    readonly template: CloudFormationTemplate;
}
