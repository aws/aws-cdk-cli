import { ResourceStatus } from '@aws-sdk/client-cloudformation';
import * as chalk from 'chalk';
import { HistoryActivityPrinter } from '../../lib/private/activity-printer';
import { testStack } from '../_helpers/assembly';
import { stderr } from '../_helpers/console-listener';

let TIMESTAMP: number;
let HUMAN_TIME: string;

beforeAll(() => {
  TIMESTAMP = new Date().getTime();
  HUMAN_TIME = new Date(TIMESTAMP).toLocaleTimeString();
});

test('prints "IN_PROGRESS" ResourceStatus', () => {
  const historyActivityPrinter = new HistoryActivityPrinter({
    stream: process.stderr,
  });

  const output = stderr.inspectSync(async () => {
    historyActivityPrinter.start({ stack: testStack({ stackName: 'stack-name' }) });
    historyActivityPrinter.activity({
      event: {
        LogicalResourceId: 'stack1',
        ResourceStatus: ResourceStatus.CREATE_IN_PROGRESS,
        Timestamp: new Date(TIMESTAMP),
        ResourceType: 'AWS::CloudFormation::Stack',
        StackId: '',
        EventId: '',
        StackName: 'stack-name',
      },
      deployment: 'test',
      progress: {
        completed: 0,
        total: 2,
        formatted: '0/4',
      },
    });
    historyActivityPrinter.stop();
  });

  expect(output[0].trim()).toStrictEqual(
    `stack-name | 0/4 | ${HUMAN_TIME} | ${chalk.reset('CREATE_IN_PROGRESS  ')} | AWS::CloudFormation::Stack | ${chalk.reset(chalk.bold('stack1'))}`,
  );
});

test('prints "Failed Resources:" list, when at least one deployment fails', () => {
  const historyActivityPrinter = new HistoryActivityPrinter({
    stream: process.stderr,
  });

  const output = stderr.inspectSync(() => {
    historyActivityPrinter.start({ stack: testStack({ stackName: 'stack-name' }) });
    historyActivityPrinter.activity({
      event: {
        LogicalResourceId: 'stack1',
        ResourceStatus: ResourceStatus.UPDATE_IN_PROGRESS,
        Timestamp: new Date(TIMESTAMP),
        ResourceType: 'AWS::CloudFormation::Stack',
        StackId: '',
        EventId: '',
        StackName: 'stack-name',
      },
      deployment: 'test',
      progress: {
        completed: 0,
        total: 2,
        formatted: '0/2',
      },
    });
    historyActivityPrinter.activity({
      event: {
        LogicalResourceId: 'stack1',
        ResourceStatus: ResourceStatus.UPDATE_FAILED,
        Timestamp: new Date(TIMESTAMP),
        ResourceType: 'AWS::CloudFormation::Stack',
        StackId: '',
        EventId: '',
        StackName: 'stack-name',
      },
      deployment: 'test',
      progress: {
        completed: 0,
        total: 2,
        formatted: '0/2',
      },
    });
    historyActivityPrinter.stop();
  });

  expect(output.length).toStrictEqual(4);
  expect(output[0].trim()).toStrictEqual(
    `stack-name | 0/2 | ${HUMAN_TIME} | ${chalk.reset('UPDATE_IN_PROGRESS  ')} | AWS::CloudFormation::Stack | ${chalk.reset(chalk.bold('stack1'))}`,
  );
  expect(output[1].trim()).toStrictEqual(
    `stack-name | 0/2 | ${HUMAN_TIME} | ${chalk.red('UPDATE_FAILED       ')} | AWS::CloudFormation::Stack | ${chalk.red(chalk.bold('stack1'))}`,
  );
  expect(output[2].trim()).toStrictEqual('Failed resources:');
  expect(output[3].trim()).toStrictEqual(
    `stack-name | ${HUMAN_TIME} | ${chalk.red('UPDATE_FAILED       ')} | AWS::CloudFormation::Stack | ${chalk.red(chalk.bold('stack1'))}`,
  );
});

test('print failed resources because of hook failures', () => {
  const historyActivityPrinter = new HistoryActivityPrinter({
    stream: process.stderr,
  });

  const output = stderr.inspectSync(async () => {
    historyActivityPrinter.start({ stack: testStack({ stackName: 'stack-name' }) });
    historyActivityPrinter.activity({
      event: {
        LogicalResourceId: 'stack1',
        ResourceStatus: ResourceStatus.UPDATE_IN_PROGRESS,
        Timestamp: new Date(TIMESTAMP),
        ResourceType: 'AWS::CloudFormation::Stack',
        StackId: '',
        EventId: '',
        StackName: 'stack-name',
        HookStatus: 'HOOK_COMPLETE_FAILED',
        HookType: 'hook1',
        HookStatusReason: 'stack1 must obey certain rules',
      },
      deployment: 'test',
      progress: {
        completed: 0,
        total: 2,
        formatted: '0/2',
      },
    });
    historyActivityPrinter.activity({
      event: {
        LogicalResourceId: 'stack1',
        ResourceStatus: ResourceStatus.UPDATE_FAILED,
        Timestamp: new Date(TIMESTAMP),
        ResourceType: 'AWS::CloudFormation::Stack',
        StackId: '',
        EventId: '',
        StackName: 'stack-name',
        ResourceStatusReason: 'The following hook(s) failed: hook1',
      },
      deployment: 'test',
      progress: {
        completed: 0,
        total: 2,
        formatted: '0/2',
      },
    });
    historyActivityPrinter.stop();
  });

  expect(output.length).toStrictEqual(4);
  expect(output[0].trim()).toStrictEqual(
    `stack-name | 0/2 | ${HUMAN_TIME} | ${chalk.reset('UPDATE_IN_PROGRESS  ')} | AWS::CloudFormation::Stack | ${chalk.reset(chalk.bold('stack1'))}`,
  );
  expect(output[1].trim()).toStrictEqual(
    `stack-name | 0/2 | ${HUMAN_TIME} | ${chalk.red('UPDATE_FAILED       ')} | AWS::CloudFormation::Stack | ${chalk.red(chalk.bold('stack1'))} ${chalk.red(chalk.bold('The following hook(s) failed: hook1 : stack1 must obey certain rules'))}`,
  );
  expect(output[2].trim()).toStrictEqual('Failed resources:');
  expect(output[3].trim()).toStrictEqual(
    `stack-name | ${HUMAN_TIME} | ${chalk.red('UPDATE_FAILED       ')} | AWS::CloudFormation::Stack | ${chalk.red(chalk.bold('stack1'))} ${chalk.red(chalk.bold('The following hook(s) failed: hook1 : stack1 must obey certain rules'))}`,
  );
});
