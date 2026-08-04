import { ResourceStatus } from '@aws-sdk/client-cloudformation';
import chalk from 'chalk';
import { QuietActivityPrinter } from '../../lib/private/activity-printer';
import { testStack } from '../_helpers/assembly';
import { stderr } from '../_helpers/console-listener';

let TIMESTAMP: number;

beforeAll(() => {
  TIMESTAMP = new Date().getTime();
});

function activity(props: {
  status: ResourceStatus;
  reason?: string;
  logicalId?: string;
  metadata?: any;
}) {
  return {
    event: {
      LogicalResourceId: props.logicalId ?? 'MyResource',
      ResourceStatus: props.status,
      ResourceStatusReason: props.reason,
      Timestamp: new Date(TIMESTAMP),
      ResourceType: 'AWS::S3::Bucket',
      StackId: 'stack-id',
      EventId: '',
      StackName: 'stack-name',
      PhysicalResourceId: 'physical-id',
    },
    deployment: 'test',
    metadata: props.metadata,
    progress: {
      completed: 1,
      total: 2,
      formatted: '1/2',
    },
  };
}

function runPrinter(block: (printer: QuietActivityPrinter) => void) {
  const printer = new QuietActivityPrinter({ stream: process.stderr });
  return stderr.inspectSync(() => {
    printer.start({ stack: testStack({ stackName: 'stack-name' }) });
    block(printer);
    printer.stop();
  });
}

test('prints nothing for a successful deployment', () => {
  const output = runPrinter((printer) => {
    printer.activity(activity({ status: ResourceStatus.CREATE_IN_PROGRESS }));
    printer.activity(activity({ status: ResourceStatus.CREATE_COMPLETE }));
    printer.activity(activity({ status: ResourceStatus.UPDATE_IN_PROGRESS }));
    printer.activity(activity({ status: ResourceStatus.UPDATE_COMPLETE }));
  });

  expect(output).toEqual([]);
});

test('prints failure events as they happen', () => {
  const output = runPrinter((printer) => {
    printer.activity(activity({ status: ResourceStatus.CREATE_IN_PROGRESS }));
    printer.activity(activity({ status: ResourceStatus.CREATE_FAILED, reason: 'it broke' }));
  });

  expect(output.map(x => x.trim())).toEqual([
    `stack-name | ${chalk.red('CREATE_FAILED')} | AWS::S3::Bucket | ${chalk.red(chalk.bold('MyResource'))} ${chalk.red(chalk.bold('it broke'))}`,
  ]);
});

test('does not print the same failure twice', () => {
  const output = runPrinter((printer) => {
    printer.activity(activity({ status: ResourceStatus.CREATE_FAILED, reason: 'it broke' }));
    printer.activity(activity({ status: ResourceStatus.CREATE_IN_PROGRESS, logicalId: 'OtherResource' }));
    printer.activity(activity({ status: ResourceStatus.CREATE_COMPLETE, logicalId: 'OtherResource' }));
  });

  expect(output).toHaveLength(1);
});

test('does not print cancelled resources', () => {
  const output = runPrinter((printer) => {
    printer.activity(activity({ status: ResourceStatus.CREATE_FAILED, reason: 'Resource creation cancelled' }));
  });

  expect(output).toEqual([]);
});

test('prints construct path and stack trace from metadata', () => {
  const output = runPrinter((printer) => {
    printer.activity(activity({
      status: ResourceStatus.CREATE_FAILED,
      reason: 'it broke',
      metadata: {
        constructPath: 'MyConstruct/MyResource',
        entry: { trace: ['line1', 'line2'] },
      },
    }));
  });

  const joined = output.join('\n');
  expect(joined).toContain('MyConstruct/MyResource');
  expect(joined).toContain('(MyResource)');
  expect(joined).toContain('line1');
  expect(joined).toContain('line2');
});

test('DELETE_FAILED during stack update prints only the skip warning', () => {
  const output = runPrinter((printer) => {
    (printer as any).isStackUpdate = true;
    printer.activity(activity({ status: ResourceStatus.DELETE_FAILED, reason: 'Resource cannot be deleted' }));
  });

  const joined = output.join('\n');
  expect(joined).toContain('failed to delete but were skipped');
  expect(joined).not.toContain('DELETE_FAILED |');
  expect(joined).not.toContain('Resource cannot be deleted');
});

test('DELETE_FAILED during stack create prints the failure', () => {
  const output = runPrinter((printer) => {
    printer.activity(activity({ status: ResourceStatus.DELETE_FAILED, reason: 'Resource cannot be deleted' }));
  });

  const joined = output.join('\n');
  expect(joined).toContain('DELETE_FAILED');
  expect(joined).toContain('Resource cannot be deleted');
  expect(joined).not.toContain('skipped');
});

test('includes hook failure reasons', () => {
  const output = runPrinter((printer) => {
    printer.activity({
      ...activity({ status: ResourceStatus.UPDATE_IN_PROGRESS }),
      event: {
        ...activity({ status: ResourceStatus.UPDATE_IN_PROGRESS }).event,
        HookStatus: 'HOOK_COMPLETE_FAILED',
        HookType: 'hook1',
        HookStatusReason: 'resource must obey certain rules',
      },
    });
    printer.activity(activity({
      status: ResourceStatus.UPDATE_FAILED,
      reason: 'The following hook(s) failed: hook1',
    }));
  });

  expect(output.join('\n')).toContain('The following hook(s) failed: hook1 : resource must obey certain rules');
});
