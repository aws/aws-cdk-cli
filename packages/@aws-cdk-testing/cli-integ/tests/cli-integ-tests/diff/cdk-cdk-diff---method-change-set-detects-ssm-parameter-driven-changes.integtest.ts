import { DeleteParameterCommand, PutParameterCommand } from '@aws-sdk/client-ssm';
import { integTest, withDefaultFixture } from '../../../lib';

/**
 * Regression test for https://github.com/aws/aws-cdk-cli/issues/641
 *
 * When a resource's name (or any property) is resolved at deploy time from an SSM parameter,
 * the synthesized CloudFormation template is identical regardless of the parameter's value.
 * A template-only diff therefore reports "no differences", but the change set that
 * `--method=change-set` creates *does* know the value changed.
 *
 * This test deploys a queue whose name comes from an SSM parameter, changes the parameter
 * out-of-band, and asserts that the change-set diff surfaces the (replacing) change while the
 * template-only diff does not.
 */
integTest(
  'cdk diff --method=change-set detects SSM-parameter-driven changes that template diff misses',
  withDefaultFixture(async (fixture) => {
    const parameterName = `/cdk-integ/${fixture.randomString}/queue-name`;
    const queueNameV1 = `cdktest-${fixture.randomString}-q1`;
    const queueNameV2 = `cdktest-${fixture.randomString}-q2`;
    const stackName = fixture.fullStackName('ssm-resolve-queue');

    // GIVEN - an SSM parameter with an initial value, and a deployed stack that names its queue after it
    await fixture.aws.ssm.send(new PutParameterCommand({
      Name: parameterName,
      Type: 'String',
      Value: queueNameV1,
    }));
    fixture.aws.addCleanup(() => fixture.aws.ssm.send(new DeleteParameterCommand({ Name: parameterName })));

    await fixture.cdkDeploy('ssm-resolve-queue', {
      modEnv: { SSM_PARAMETER_NAME: parameterName },
    });

    // WHEN - the SSM parameter value changes out-of-band (the CDK app/template is unchanged)
    await fixture.aws.ssm.send(new PutParameterCommand({
      Name: parameterName,
      Type: 'String',
      Value: queueNameV2,
      Overwrite: true,
    }));

    // THEN - a template-only diff sees nothing, because the template is byte-for-byte identical
    const templateDiff = await fixture.cdk(['diff', '--method=template', stackName], {
      modEnv: { SSM_PARAMETER_NAME: parameterName },
    });
    expect(templateDiff).toContain('There were no differences');

    // ...but the change-set diff surfaces the queue change (a replacement, since QueueName is immutable)
    const changeSetDiff = await fixture.cdk(['diff', '--method=change-set', stackName], {
      modEnv: { SSM_PARAMETER_NAME: parameterName },
    });
    expect(changeSetDiff).not.toContain('There were no differences');
    expect(changeSetDiff).toContain('AWS::SQS::Queue');
  }),
);
