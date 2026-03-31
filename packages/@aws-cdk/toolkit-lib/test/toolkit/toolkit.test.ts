/**
 * NOTE: This test suite should only contain tests for creating the Toolkit and its methods.
 *
 *  - Actions: Tests for each action go into the `test/actions` directory
 *  - Source Builders: Tests for the Cloud Assembly Source Builders are in `test/api/cloud-assembly/source-builder.test.ts`
 */

import * as cdk from 'aws-cdk-lib';
import * as chalk from 'chalk';
import { Toolkit } from '../../lib/toolkit/toolkit';
import { TestIoHost } from '../_helpers';

const ioHost: TestIoHost = new TestIoHost();
let toolkit: Toolkit;
beforeEach(() => {
  ioHost.clear();
  toolkit = new Toolkit({ ioHost, color: false });
});

describe('message formatting', () => {
  test('emojis can be stripped from message', async () => {
    toolkit = new Toolkit({ ioHost, emojis: false });

    await toolkit.ioHost.notify({
      message: '💯Smile123😀',
      action: 'deploy',
      level: 'info',
      code: 'CDK_TOOLKIT_I0000',
      time: new Date(),
      data: undefined,
    });

    expect(ioHost.notifySpy).toHaveBeenCalledWith(expect.objectContaining({
      action: 'deploy',
      level: 'info',
      code: 'CDK_TOOLKIT_I0000',
      message: 'Smile123',
    }));
  });

  test('color can be stripped from message', async () => {
    await toolkit.ioHost.notify({
      message: chalk.red('RED') + chalk.bold('BOLD') + chalk.blue('BLUE'),
      action: 'deploy',
      level: 'info',
      code: 'CDK_TOOLKIT_I0000',
      time: new Date(),
      data: undefined,
    });

    expect(ioHost.notifySpy).toHaveBeenCalledWith(expect.objectContaining({
      action: 'deploy',
      level: 'info',
      code: 'CDK_TOOLKIT_I0000',
      message: 'REDBOLDBLUE',
    }));
  });

  test('whitespace is always trimmed from a message', async () => {
    await toolkit.ioHost.notify({
      message: '   test message\n\n',
      action: 'deploy',
      level: 'info',
      code: 'CDK_TOOLKIT_I0000',
      time: new Date(),
      data: undefined,
    });

    expect(ioHost.notifySpy).toHaveBeenCalledWith(expect.objectContaining({
      action: 'deploy',
      level: 'info',
      code: 'CDK_TOOLKIT_I0000',
      message: 'test message',
    }));
  });
});

test('outputs of assembly are measured', async () => {
  const builder = await toolkit.fromAssemblyBuilder(async (props) => {
    const app = new cdk.App({
      outdir: props.outdir,
      context: props.context,
    });

    const s1 = new cdk.Stack(app, 'Stack1');
    new cdk.Stack(app, 'Stack2');

    cdk.Annotations.of(s1)._addTrackableError('SomeErrorCode', 'This is bad mkay');

    return app.synth();
  });

  await expect(() => toolkit.synth(builder)).rejects.toThrow(/Found errors/);

  expect(ioHost.notifySpy).toHaveBeenCalledWith(expect.objectContaining({
    data: expect.objectContaining({
      counters: expect.objectContaining({
        'errorAnn:SomeErrorCode': 1,
        'assemblies': 1,
        'errorAnns': 1,
        'stacks': 2,
      }),
    }),
  }));
});

declare module 'aws-cdk-lib' {
  interface Annotations {
    // Declare this private function, which definitely exists (pinky promise)
    _addTrackableError(id: string, message: string): void;
  }
}
