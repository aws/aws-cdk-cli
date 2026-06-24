import { DeleteParameterCommand, PutParameterCommand } from '@aws-sdk/client-ssm';
import { integTest, withDefaultFixture } from '../../../lib';

/**
 * Regression test for https://github.com/aws/aws-cdk-cli/issues/641 (the "mixed" case).
 *
 * A single resource has BOTH a template-visible change (ReceiveMessageWaitTimeSeconds) AND a change
 * that only the change set knows about (QueueName, resolved at deploy time from an SSM parameter).
 * The change-set diff must surface both - in particular it must not let the visible change hide the
 * (replacing) hidden change.
 */
integTest(
  'cdk diff --method=change-set surfaces change-set-only changes alongside template changes on the same resource',
  withDefaultFixture(async (fixture) => {
    const parameterName = `/cdk-integ/${fixture.randomString}/queue-name-mixed`;
    const queueNameV1 = `cdktest-${fixture.randomString}-m1`;
    const queueNameV2 = `cdktest-${fixture.randomString}-m2`;
    const stackName = fixture.fullStackName('ssm-resolve-queue');

    // GIVEN - deployed with an initial SSM value and an initial receive-wait-time
    await fixture.aws.ssm.send(new PutParameterCommand({
      Name: parameterName,
      Type: 'String',
      Value: queueNameV1,
    }));
    fixture.aws.addCleanup(() => fixture.aws.ssm.send(new DeleteParameterCommand({ Name: parameterName })));

    await fixture.cdkDeploy('ssm-resolve-queue', {
      modEnv: { SSM_PARAMETER_NAME: parameterName, SSM_RESOLVE_QUEUE_WAIT_TIME: '10' },
    });

    // WHEN - the SSM value changes out-of-band (queue name -> replacement, only in the change set)
    await fixture.aws.ssm.send(new PutParameterCommand({
      Name: parameterName,
      Type: 'String',
      Value: queueNameV2,
      Overwrite: true,
    }));

    // ...and the template also changes the receive-wait-time (a normal, template-visible update)
    const diff = await fixture.cdk(['diff', '--method=change-set', stackName], {
      modEnv: { SSM_PARAMETER_NAME: parameterName, SSM_RESOLVE_QUEUE_WAIT_TIME: '20' },
    });

    // THEN - both the template-visible change and the change-set-only change are reported
    expect(diff).not.toContain('There were no differences');
    expect(diff).toContain('AWS::SQS::Queue');
    expect(diff).toContain('ReceiveMessageWaitTimeSeconds'); // template-detected update
    expect(diff).toContain('QueueName'); // change-set-only replacement
  }),
);
