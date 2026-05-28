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

  expect(output.map(x => x.trim())).toEqual([
    `stack-name | 0/4 | ${HUMAN_TIME} | ${chalk.reset('CREATE_IN_PROGRESS  ')} | AWS::CloudFormation::Stack | ${chalk.reset(chalk.bold('stack1'))}`,
  ]);
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

  expect(output.map(x => x.trim())).toEqual([
    `stack-name | 0/2 | ${HUMAN_TIME} | ${chalk.reset('UPDATE_IN_PROGRESS  ')} | AWS::CloudFormation::Stack | ${chalk.reset(chalk.bold('stack1'))}`,
    `stack-name | 0/2 | ${HUMAN_TIME} | ${chalk.red('UPDATE_FAILED       ')} | AWS::CloudFormation::Stack | ${chalk.red(chalk.bold('stack1'))}`,
    'Failed resources:',
    `stack-name | ${HUMAN_TIME} | ${chalk.red('UPDATE_FAILED       ')} | AWS::CloudFormation::Stack | ${chalk.red(chalk.bold('stack1'))}`,
  ]);
});

test('DELETE_FAILED during stack update is shown as provisional in dim, without reason or stack trace', () => {
  const historyActivityPrinter = new HistoryActivityPrinter({
    stream: process.stderr,
  });

  const output = stderr.inspectSync(() => {
    (historyActivityPrinter as any).isStackUpdate = true;
    historyActivityPrinter.start({ stack: testStack({ stackName: 'stack-name' }) });
    historyActivityPrinter.activity({
      event: {
        LogicalResourceId: 'MyResource',
        ResourceStatus: ResourceStatus.DELETE_FAILED,
        ResourceStatusReason: 'Resource cannot be deleted',
        Timestamp: new Date(TIMESTAMP),
        ResourceType: 'AWS::S3::Bucket',
        StackId: 'stack-id',
        EventId: '',
        StackName: 'stack-name',
      },
      deployment: 'test',
      metadata: {
        constructPath: 'MyConstruct/MyResource',
        entry: { trace: ['line1', 'line2'] },
      } as any,
      progress: {
        completed: 1,
        total: 2,
        formatted: '1/2',
      },
    });
    historyActivityPrinter.stop();
  });

  // Should show "(provisional)", no reason, no stack trace, no "Failed resources:" section
  const joined = output.join('\n');
  expect(joined).toContain('DELETE_FAILED (provisional)');
  expect(joined).not.toContain('Resource cannot be deleted');
  expect(joined).not.toContain('line1');
  expect(joined).not.toContain('line2');
  expect(joined).not.toContain('Failed resources:');
});

test('DELETE_FAILED during stack create is shown normally in red with reason and stack trace', () => {
  const historyActivityPrinter = new HistoryActivityPrinter({
    stream: process.stderr,
  });

  const output = stderr.inspectSync(() => {
    historyActivityPrinter.start({ stack: testStack({ stackName: 'stack-name' }) });
    historyActivityPrinter.activity({
      event: {
        LogicalResourceId: 'MyResource',
        ResourceStatus: ResourceStatus.DELETE_FAILED,
        ResourceStatusReason: 'Resource cannot be deleted',
        Timestamp: new Date(TIMESTAMP),
        ResourceType: 'AWS::S3::Bucket',
        StackId: 'stack-id',
        EventId: '',
        StackName: 'stack-name',
      },
      deployment: 'test',
      metadata: {
        constructPath: 'MyConstruct/MyResource',
        entry: { trace: ['line1', 'line2'] },
      } as any,
      progress: {
        completed: 1,
        total: 2,
        formatted: '1/2',
      },
    });
    historyActivityPrinter.stop();
  });

  // Should show reason, stack trace, and "Failed resources:" recap
  const joined = output.join('\n');
  expect(joined).toContain('Resource cannot be deleted');
  expect(joined).toContain('line1');
  expect(joined).not.toContain('(provisional)');
  expect(joined).toContain('Failed resources:');
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

  expect(output.map(x => x.trim())).toEqual([
    `stack-name | 0/2 | ${HUMAN_TIME} | ${chalk.reset('UPDATE_IN_PROGRESS  ')} | AWS::CloudFormation::Stack | ${chalk.reset(chalk.bold('stack1'))}`,
    `stack-name | 0/2 | ${HUMAN_TIME} | ${chalk.red('UPDATE_FAILED       ')} | AWS::CloudFormation::Stack | ${chalk.red(chalk.bold('stack1'))} ${chalk.red(chalk.bold('The following hook(s) failed: hook1 : stack1 must obey certain rules'))}`,
    'Failed resources:',
    `stack-name | ${HUMAN_TIME} | ${chalk.red('UPDATE_FAILED       ')} | AWS::CloudFormation::Stack | ${chalk.red(chalk.bold('stack1'))} ${chalk.red(chalk.bold('The following hook(s) failed: hook1 : stack1 must obey certain rules'))}`,
  ]);
});
