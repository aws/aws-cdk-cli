import type { DescribeChangeSetCommandOutput } from '@aws-sdk/client-cloudformation';
import { ChangeSetStatus, ValidationStatus } from '@aws-sdk/client-cloudformation';
import type { ValidationReporter } from './cfn-api';
import { ToolkitError } from '../../toolkit/toolkit-error';
import type { SDK } from '../aws-auth/sdk';
import type { EnvironmentResources } from '../environment/index';

export class EarlyValidationReporter implements ValidationReporter {
  constructor(private readonly sdk: SDK, private readonly environmentResources: EnvironmentResources) {
  }

  public async check(description: DescribeChangeSetCommandOutput, changeSetName: string, stackName: string) {
    if (description.Status === ChangeSetStatus.FAILED && description.StatusReason?.includes('AWS::EarlyValidation')) {
      await this.checkBootstrapVersion();
      const eventsOutput = await this.sdk.cloudFormation().describeEvents({
        ChangeSetName: changeSetName,
        StackName: stackName,
      });

      const failures = (eventsOutput.OperationEvents ?? [])
        .filter((event) => event.ValidationStatus === ValidationStatus.FAILED)
        .map((event) => `  - ${event.ValidationStatusReason} (at ${event.ValidationPath})`)
        .join('\n');

      const message = `ChangeSet '${changeSetName}' on stack '${stackName}' failed early validation:\n${failures}`;
      throw new ToolkitError(message);
    }
  }

  private async checkBootstrapVersion() {
    const environment = this.environmentResources.environment;
    let bootstrapVersion: number | undefined = undefined;
    try {
      // Try to get the bootstrap version
      bootstrapVersion = (await this.environmentResources.lookupToolkit()).version;
    } catch (e) {
      // But if we can't, keep going. Maybe we can still succeed.
    }
    if (bootstrapVersion != null && bootstrapVersion < 30) {
      const env = `aws://${environment.account}/${environment.region}`;
      throw new ToolkitError(
        'While creating the change set, CloudFormation detected errors in the generated templates.\n' +
        `To see details about these errors, re-bootstrap your environment with 'cdk bootstrap ${env}', and run 'cdk deploy' again.`,
      );
    }
  }
}
