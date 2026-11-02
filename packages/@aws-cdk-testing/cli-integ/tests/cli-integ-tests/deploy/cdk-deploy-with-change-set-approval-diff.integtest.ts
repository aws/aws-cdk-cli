import { DescribeStacksCommand, ListChangeSetsCommand } from '@aws-sdk/client-cloudformation';
import { integTest, withDefaultFixture } from '../../../lib';

integTest(
  'deploy with change-set method uses change set for approval diff',
  withDefaultFixture(async (fixture) => {
    let changeSetVerified = false;
    const stackName = fixture.fullStackName('test-2');
    const changeSetName = `${fixture.stackNamePrefix}-approval-diff-test`;

    // Deploy with --require-approval=any-change without --yes.
    // The CLI will create a change set for the approval diff, pause for confirmation,
    // and then execute the same change set after the user confirms.
    const output = await fixture.cdkDeploy('test-2', {
      options: ['--require-approval=any-change', '--method=change-set', `--change-set-name=${changeSetName}`],
      neverRequireApproval: false,
      interact: [
        {
          prompt: /Do you wish to deploy these changes/,
          input: 'y',
          beforeInput: async () => {
            // While the CLI is paused at the approval prompt, verify that
            // the named change set has been created and is ready for execution.
            const response = await fixture.aws.cloudFormation.send(
              new ListChangeSetsCommand({ StackName: stackName }),
            );
            const changeSets = response.Summaries ?? [];
            const namedChangeSet = changeSets.find(cs => cs.ChangeSetName === changeSetName);
            expect(namedChangeSet).toBeDefined();
            expect(namedChangeSet?.Status).toEqual('CREATE_COMPLETE');
            changeSetVerified = true;
          },
        },
      ],
      modEnv: {
        FORCE_COLOR: '0',
      },
    });

    // The approval diff should contain resource information from the change set
    expect(output).toContain('AWS::SNS::Topic');
    expect(output).toContain('Do you wish to deploy these changes');

    // Verify the beforeInput callback actually ran
    expect(changeSetVerified).toBe(true);

    // Verify the stack was actually deployed
    const response = await fixture.aws.cloudFormation.send(
      new DescribeStacksCommand({ StackName: fixture.fullStackName('test-2') }),
    );
    expect(response.Stacks?.[0].StackStatus).toEqual('CREATE_COMPLETE');
  }),
);
