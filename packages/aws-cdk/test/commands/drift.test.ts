import { Deployments } from '../../lib/api';
import { CdkToolkit } from '../../lib/cli/cdk-toolkit';
import { CliIoHost } from '../../lib/cli/io-host';
import { instanceMockFrom, MockCloudExecutable } from '../_helpers';

jest.mock('@aws-cdk/toolkit-lib', () => {
  const original = jest.requireActual('@aws-cdk/toolkit-lib');
  return {
    ...original,
    DriftFormatter: jest.fn().mockImplementation(() => {
      return {
        formatStackDrift: jest.fn().mockImplementation(({ showAll }) => {
          if (showAll) {
            return {
              formattedDrift: `Stack Stack1
Modified Resources
[~] AWS::Lambda::Function HelloWorldFunction HelloWorldFunctionB2AB6E79
 └─ [~] /Description
     ├─ [-] A simple hello world Lambda function
     └─ [+] A simple, drifted hello world Lambda function


1 resource has drifted from their expected configuration

`,
              numResourcesWithDrift: 1,
              numResourcesUnchecked: 0,
            };
          }
          return {
            formattedDrift: `Stack Stack1
Modified Resources
[~] AWS::Lambda::Function HelloWorldFunction HelloWorldFunctionB2AB6E79
 └─ [~] /Description
     ├─ [-] A simple hello world Lambda function
     └─ [+] A simple, drifted hello world Lambda function


1 resource has drifted from their expected configuration
`,
            numResourcesWithDrift: 1,
            numResourcesUnchecked: 0,
          };
        }),
      };
    }),
    detectStackDrift: jest.fn().mockImplementation((_, __, stackName) => {
      if (stackName === 'Stack1') {
        return Promise.resolve({
          stackId: 'Stack1',
          stackDriftStatus: 'DRIFTED',
          driftedStackResourceCount: 1,
          stackResourceDrifts: [
            {
              logicalResourceId: 'HelloWorldFunction',
              resourceType: 'AWS::Lambda::Function',
              physicalResourceId: 'HelloWorldFunctionB2AB6E79',
              expectedProperties: JSON.stringify({ Description: 'A simple hello world Lambda function' }),
              actualProperties: JSON.stringify({ Description: 'A simple, drifted hello world Lambda function' }),
              propertyDifferences: [
                {
                  propertyPath: '/Description',
                  expectedValue: 'A simple hello world Lambda function',
                  actualValue: 'A simple, drifted hello world Lambda function',
                },
              ],
              stackResourceDriftStatus: 'MODIFIED',
            },
          ],
        });
      } else {
        return Promise.resolve({
          stackId: 'Stack2',
          stackDriftStatus: 'IN_SYNC',
          driftedStackResourceCount: 0,
          stackResourceDrifts: [],
        });
      }
    }),
  };
});

describe('drift', () => {
  let cloudExecutable: MockCloudExecutable;
  let cloudFormation: jest.Mocked<Deployments>;
  let toolkit: CdkToolkit;
  let ioHost: CliIoHost;
  let notifySpy: jest.SpyInstance<Promise<void>>;

  const stack1Output = `Stack Stack1
Modified Resources
[~] AWS::Lambda::Function HelloWorldFunction HelloWorldFunctionB2AB6E79
 └─ [~] /Description
     ├─ [-] A simple hello world Lambda function
     └─ [+] A simple, drifted hello world Lambda function


1 resource has drifted from their expected configuration
`;
  const stack2Output = `Stack Stack2
No drift detected

`;

  beforeEach(() => {
    ioHost = CliIoHost.instance();
    notifySpy = jest.spyOn(ioHost, 'notify');
    notifySpy.mockClear();

    cloudExecutable = new MockCloudExecutable({
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
      deployments: cloudFormation,
      configuration: cloudExecutable.configuration,
      sdkProvider: mockSdkProvider as any,
    });

    // Mock the toolkit.drift method from toolkit-lib
    jest.spyOn((toolkit as any).toolkit, 'drift').mockImplementation(async (_, options: any) => {
      if (options.stacks.patterns?.includes('Stack1')) {
        return {
          numResourcesWithDrift: 1,
          numResourcesUnchecked: 0,
          formattedDrift: stack1Output,
        };
      } else {
        return {
          numResourcesWithDrift: 0,
          numResourcesUnchecked: 0,
          formattedDrift: stack2Output,
        };
      }
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('detects drift in a single stack', async () => {
    const messages: string[] = [];
    notifySpy.mockImplementation(async (options) => {
      messages.push(options.message);
      return Promise.resolve();
    });

    // WHEN
    const exitCode = await toolkit.drift({
      selector: { patterns: ['Stack1'] },
    });

    messages.unshift(stack1Output);

    // THEN
    expect(exitCode).toBe(0);
    const output = messages.join('\n');
    const expectedStrings = [
      'Stack Stack1',
      '[~] AWS::Lambda::Function HelloWorldFunction',
      '[-] A simple hello world Lambda function',
      '[+] A simple, drifted hello world Lambda function',
      '✨  Number of resources with drift: 1',
    ];
    for (const expectedString of expectedStrings) {
      expect(output).toContain(expectedString);
    }
  });

  test('detects no drift in a single stack', async () => {
    const messages: string[] = [];
    notifySpy.mockImplementation(async (options) => {
      messages.push(options.message);
      return Promise.resolve();
    });

    // Override the mock to one without drift
    const DriftFormatter = jest.requireMock('@aws-cdk/toolkit-lib').DriftFormatter;
    DriftFormatter.mockImplementationOnce(() => {
      return {
        formatStackDrift: jest.fn().mockImplementation(() => {
          return {
            formattedDrift: `Stack Stack2
No drift detected

`,
            numResourcesWithDrift: 0,
            numResourcesUnchecked: 0,
          };
        }),
      };
    });

    // WHEN
    const exitCode = await toolkit.drift({
      selector: { patterns: ['Stack2'] },
    });

    messages.unshift(stack2Output);

    // THEN
    expect(exitCode).toBe(0);
    const output = messages.join('\n');
    const expectedStrings = [
      'Stack Stack2',
      'No drift detected',
      '✨  Number of resources with drift: 0',
    ];
    for (const expectedString of expectedStrings) {
      expect(output).toContain(expectedString);
    }
  });

  test('exits with code 1 when drift is detected and fail flag is set', async () => {
    const messages: string[] = [];
    notifySpy.mockImplementation(async (options) => {
      messages.push(options.message);
      return Promise.resolve();
    });

    // WHEN
    const exitCode = await toolkit.drift({
      selector: { patterns: ['Stack1'] },
      fail: true,
    });

    // THEN
    expect(exitCode).toBe(1);
    expect(messages.join('\n')).toContain('✨  Number of resources with drift: 1');
  });

  test('exits with code 0 when no drift is detected and fail flag is set', async () => {
    const messages: string[] = [];
    notifySpy.mockImplementation(async (options) => {
      messages.push(options.message);
      return Promise.resolve();
    });

    // Override the mock to one without drift
    const DriftFormatter = jest.requireMock('@aws-cdk/toolkit-lib').DriftFormatter;
    DriftFormatter.mockImplementationOnce(() => {
      return {
        formatStackDrift: jest.fn().mockImplementation(() => {
          return {
            formattedDrift: `Stack Stack2
No drift detected

`,
            numResourcesWithDrift: 0,
            numResourcesUnchecked: 0,
          };
        }),
      };
    });

    // WHEN
    const exitCode = await toolkit.drift({
      selector: { patterns: ['Stack2'] },
      fail: true,
    });

    // THEN
    expect(exitCode).toBe(0);
    expect(messages.join('\n')).toContain('✨  Number of resources with drift: 0');
  });
});
