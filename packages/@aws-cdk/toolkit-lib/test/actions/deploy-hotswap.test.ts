import { Toolkit } from '../../lib/toolkit';
import { builderFixture, TestIoHost } from '../_helpers';

const ioHost = new TestIoHost();
const toolkit = new Toolkit({ ioHost });

let mockDeployStack = jest.fn().mockResolvedValue({
  type: 'did-deploy-stack',
  stackArn: 'arn:aws:cloudformation:region:account:stack/test-stack',
  outputs: {},
  noOp: false,
});

jest.mock('../../lib/api/deployments', () => {
  return {
    ...jest.requireActual('../../lib/api/deployments'),
    Deployments: jest.fn().mockImplementation(() => ({
      deployStack: mockDeployStack,
      resolveEnvironment: jest.fn().mockResolvedValue({}),
      isSingleAssetPublished: jest.fn().mockResolvedValue(true),
      readCurrentTemplate: jest.fn().mockResolvedValue({ Resources: {} }),
      describeChangeSet: jest.fn().mockResolvedValue({
        ChangeSetName: 'test-changeset',
        Changes: [],
        Status: 'CREATE_COMPLETE',
      }),
      deleteChangeSet: jest.fn().mockResolvedValue({}),
    })),
  };
});

beforeEach(() => {
  ioHost.notifySpy.mockClear();
  ioHost.requestSpy.mockClear();
  jest.clearAllMocks();
});

describe('deploy with hotswap', () => {
  test('does print hotswap warnings for hotswap with fallback', async () => {
    // WHEN
    const cx = await builderFixture(toolkit, 'two-empty-stacks');
    await toolkit.deploy(cx, {
      deploymentMethod: {
        method: 'hotswap',
        fallback: { method: 'change-set' },
      },
    });

    // THEN
    expect(ioHost.notifySpy).toHaveBeenCalledWith(expect.objectContaining({
      level: 'warn',
      message: expect.stringMatching(/hotswap deployments/i),
    }));
  });

  test('does print hotswap warnings for hotswap only', async () => {
    // WHEN
    const cx = await builderFixture(toolkit, 'two-empty-stacks');
    await toolkit.deploy(cx, {
      deploymentMethod: {
        method: 'hotswap',
      },
    });

    // THEN
    expect(ioHost.notifySpy).toHaveBeenCalledWith(expect.objectContaining({
      level: 'warn',
      message: expect.stringMatching(/hotswap deployments/i),
    }));
  });

  test('hotswap property overrides', async () => {
    // WHEN
    const cx = await builderFixture(toolkit, 'stack-with-role');
    await toolkit.deploy(cx, {
      deploymentMethod: {
        method: 'hotswap',
        properties: {
          ecs: {
            maximumHealthyPercent: 100,
            minimumHealthyPercent: 0,
          },
        },
      },
    });

    // THEN
    // passed through correctly to Deployments
    expect(mockDeployStack).toHaveBeenCalledWith(expect.objectContaining({
      deploymentMethod: {
        method: 'hotswap',
        properties: {
          ecs: {
            maximumHealthyPercent: 100,
            minimumHealthyPercent: 0,
          },
        },
      },
    }));

    expect(ioHost.notifySpy).toHaveBeenCalledWith(expect.objectContaining({
      action: 'deploy',
      level: 'info',
      code: 'CDK_TOOLKIT_I5000',
      message: expect.stringContaining('Deployment time:'),
    }));
  });
});

describe('deploy without hotswap', () => {
  test('does not print hotswap warnings for default method', async () => {
    // WHEN
    const cx = await builderFixture(toolkit, 'two-empty-stacks');
    await toolkit.deploy(cx);

    // THEN
    expect(ioHost.notifySpy).not.toHaveBeenCalledWith(expect.objectContaining({
      level: 'warn',
      message: expect.stringContaining('hotswap'),
    }));
  });

  test('does not print hotswap warnings for change-set method', async () => {
    // WHEN
    const cx = await builderFixture(toolkit, 'two-empty-stacks');
    await toolkit.deploy(cx, {
      deploymentMethod: { method: 'change-set' },
    });

    // THEN
    expect(ioHost.notifySpy).not.toHaveBeenCalledWith(expect.objectContaining({
      level: 'warn',
      message: expect.stringContaining('hotswap'),
    }));
  });
});
