/**
 * NOTE: This test suite should only contain tests for creating the Toolkit and its methods.
 *
 *  - Actions: Tests for each action go into the `test/actions` directory
 *  - Source Builders: Tests for the Cloud Assembly Source Builders are in `test/api/cloud-assembly/source-builder.test.ts`
 */

import * as chalk from 'chalk';
import { Toolkit } from '../../lib';
import { TestCloudAssemblySource, TestIoHost } from '../_helpers';

describe('message formatting', () => {
  test('emojis can be stripped from message', async () => {
    const ioHost = new TestIoHost();
    const toolkit = new Toolkit({ ioHost, emojis: false });

    await toolkit.ioHost.notify({
      message: '💯Smile123😀',
      action: 'deploy',
      level: 'info',
      code: 'CDK_TOOLKIT_I0000',
      time: new Date(),
    });

    expect(ioHost.notifySpy).toHaveBeenCalledWith(expect.objectContaining({
      action: 'deploy',
      level: 'info',
      code: 'CDK_TOOLKIT_I0000',
      message: 'Smile123',
    }));
  });

  test('color can be stripped from message', async () => {
    const ioHost = new TestIoHost();
    const toolkit = new Toolkit({ ioHost, color: false });

    await toolkit.ioHost.notify({
      message: chalk.red('RED') + chalk.bold('BOLD') + chalk.blue('BLUE'),
      action: 'deploy',
      level: 'info',
      code: 'CDK_TOOLKIT_I0000',
      time: new Date(),
    });

    expect(ioHost.notifySpy).toHaveBeenCalledWith(expect.objectContaining({
      action: 'deploy',
      level: 'info',
      code: 'CDK_TOOLKIT_I0000',
      message: 'REDBOLDBLUE',
    }));
  });

  test('whitespace is always trimmed from a message', async () => {
    const ioHost = new TestIoHost();
    const toolkit = new Toolkit({ ioHost, color: false });

    await toolkit.ioHost.notify({
      message: '   test message\n\n',
      action: 'deploy',
      level: 'info',
      code: 'CDK_TOOLKIT_I0000',
      time: new Date(),
    });

    expect(ioHost.notifySpy).toHaveBeenCalledWith(expect.objectContaining({
      action: 'deploy',
      level: 'info',
      code: 'CDK_TOOLKIT_I0000',
      message: 'test message',
    }));
  });
});

describe('metadata message formatting', () => {
  test('converts object data for log message to string', async () => {
    const ioHost = new TestIoHost();
    const toolkit = new Toolkit({ ioHost });

    const source = new TestCloudAssemblySource({
      stacks: [{
        stackName: 'test-stack',
        metadata: {
          'test-stack': [{
            type: 'aws:cdk:warning',
            data: {
              'Fn::Join': [
                '',
                [
                  'stackId: ',
                  {
                    'Ref': "AWS::StackId"
                  }
                ]
              ],
            } as any,
          }],
        },
      }],
    });

    await toolkit.synth(source);

    expect(ioHost.notifySpy).toHaveBeenCalledWith(expect.objectContaining({
      level: 'warn',
      message: expect.stringContaining('{"Fn::Join":["",["stackId: ",{"Ref":"AWS::StackId"}]]}'),
      data: {
        entry: {
          type: 'aws:cdk:warning',
          data: { 'Fn::Join': ['', ['stackId: ', { 'Ref': 'AWS::StackId' }]] }
        },
        id: 'test-stack',
        level: 'warning'
      }
    }));
  });

  test('keeps non-object data for log message as-is', async () => {
    const ioHost = new TestIoHost();
    const toolkit = new Toolkit({ ioHost });

    const source = new TestCloudAssemblySource({
      stacks: [{
        stackName: 'test-stack',
        metadata: {
          'test-stack': [{
            type: 'aws:cdk:info',
            data: 'simple string message'
          }]
        }
      }]
    });

    await toolkit.synth(source);

    expect(ioHost.notifySpy).toHaveBeenCalledWith(expect.objectContaining({
      level: 'info',
      message: expect.stringContaining('simple string message'),
      data: {
        entry: {
          type: 'aws:cdk:info',
          data: 'simple string message'
        },
        id: 'test-stack',
        level: 'info'
      }
    }));
  });
});
