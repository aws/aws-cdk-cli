import type { AwsDestination } from '@aws-cdk/cloud-assembly-schema';
import type { ClientOptions } from '../../aws';

export function destinationToClientOptions(destination: AwsDestination): ClientOptions {
  return {
    assumeRoleArn: destination.assumeRoleArn,
    assumeRoleExternalId: destination.assumeRoleExternalId,
    assumeRoleAdditionalOptions: destination.assumeRoleAdditionalOptions,
    region: destination.region,
  };
}
