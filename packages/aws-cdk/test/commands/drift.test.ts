import type { DriftResult, FormattedDrift } from '@aws-cdk/toolkit-lib';
import { Deployments } from '../../lib/api';
import { CdkToolkit } from '../../lib/cli/cdk-toolkit';
import { CliIoHost } from '../../lib/cli/io-host';
import { instanceMockFrom, MockCloudExecutable } from '../_helpers';

describe('drift', () => {
  let cloudExecutable: MockCloudExecutable;
  let cloudFormation: jest.Mocked<Deployments>;
  let toolkit: CdkToolkit;
  let ioHost = CliIoHost.instance();
  let notifySpy: jest.SpyInstance<Promise<void>>;

  const stack1Output: FormattedDrift = {
    modified: `
Modified Resources
[~] AWS::Lambda::Function HelloWorldFunction HelloWorldFunctionB2AB6E79
 └─ [~] /Description
     ├─ [-] A simple hello world Lambda function
     └─ [+] A simple, drifted hello world Lambda function
`,
  };
  const stack2Output: FormattedDrift = {};

  beforeEach(async () => {
    notifySpy = jest.spyOn(ioHost, 'notify');
    notifySpy.mockClear();

    cloudExecutable = await MockCloudExecutable.create({
      stacks: [
        {
          stackName: 'Stack1',
          template: {
            Resources: {
              HelloWorldFunction: { Type: 'AWS::Lambda::Function' },
            },
          },
        },
        {
          stackName: 'Stack2',
          template: {
            Resources: {
              HelloWorldFunction: { Type: 'AWS::Lambda::Function' },
            },
          },
        },
      ],
    }, undefined, ioHost);

    cloudFormation = instanceMockFrom(Deployments);

    const mockSdk = {
      cloudFormation: () => ({
        detectStackDrift: jest.fn(),
        describeStackDriftDetectionStatus: jest.fn(),
        describeStackResourceDrifts: jest.fn(),
      }),
    };

    const mockSdkProvider = {
      forEnvironment: jest.fn().mockResolvedValue({ sdk: mockSdk }),
    };

    toolkit = new CdkToolkit({
      cloudExecutable,
      // ioHost,
      deployments: cloudFormation,
      configuration: cloudExecutable.configuration,
      sdkProvider: mockSdkProvider as any,
    });

    // Mock the toolkit.drift method from toolkit-lib
    jest.spyOn((toolkit as any).toolkit, 'drift').mockImplementation(async (_, options: any) => {
      if (options.stacks.patterns?.includes('Stack1')) {
        return {
          Stack1: {
            numResourcesWithDrift: 1,
            numResourcesUnchecked: 0,
            formattedDrift: stack1Output,
          },

          // formattedDrift: stack1Output,
        } satisfies { [name: string]: DriftResult };
      } else {
        return {
          Stack2: {
            numResourcesWithDrift: 0,
            numResourcesUnchecked: 0,
            formattedDrift: stack2Output,
          },
        } satisfies { [name: string]: DriftResult };
      }
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('exits with code 1 when drift is detected and fail flag is set', async () => {
    // WHEN
    const exitCode = await toolkit.drift({
      selector: { patterns: ['Stack1'] },
      fail: true,
    });

    // THEN
    expect(exitCode).toBe(1);
  });

  test('exits with code 0 when no drift is detected and fail flag is set', async () => {
    // WHEN
    const exitCode = await toolkit.drift({
      selector: { patterns: ['Stack2'] },
      fail: true,
    });

    // THEN
    expect(exitCode).toBe(0);
  });
});
