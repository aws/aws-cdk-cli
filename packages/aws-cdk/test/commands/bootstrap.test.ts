import { Bootstrapper } from '../../lib/api/bootstrap';
import { exec } from '../../lib/cli/cli';

beforeEach(() => {
  jest.clearAllMocks();
});

describe('cdk bootstrap', () => {
  const bootstrapEnvironmentMock = jest.spyOn(Bootstrapper.prototype, 'bootstrapEnvironment');

  test('will bootstrap the a provided environment', async () => {
    bootstrapEnvironmentMock.mockResolvedValueOnce({
      noOp: false,
      outputs: {},
      type: 'did-deploy-stack',
      stackArn: 'fake-arn',
    });

    await exec(['bootstrap', 'aws://123456789012/us-east-1']);
    expect(bootstrapEnvironmentMock).toHaveBeenCalledTimes(1);
    expect(bootstrapEnvironmentMock).toHaveBeenCalledWith({
      name: 'aws://123456789012/us-east-1',
      account: '123456789012',
      region: 'us-east-1',
    }, expect.anything(), expect.anything());
  });

  test('will pass denyExternalId parameter when --deny-external-id is provided', async () => {
    bootstrapEnvironmentMock.mockResolvedValueOnce({
      noOp: false,
      outputs: {},
      type: 'did-deploy-stack',
      stackArn: 'fake-arn',
    });

    await exec(['bootstrap', 'aws://123456789012/us-east-1', '--deny-external-id']);
    expect(bootstrapEnvironmentMock).toHaveBeenCalledTimes(1);
    expect(bootstrapEnvironmentMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({
        parameters: expect.objectContaining({
          denyExternalId: true,
        }),
      }),
    );
  });

  test('will pass denyExternalId=false when --no-deny-external-id is provided', async () => {
    bootstrapEnvironmentMock.mockResolvedValueOnce({
      noOp: false,
      outputs: {},
      type: 'did-deploy-stack',
      stackArn: 'fake-arn',
    });

    await exec(['bootstrap', 'aws://123456789012/us-east-1', '--no-deny-external-id']);
    expect(bootstrapEnvironmentMock).toHaveBeenCalledTimes(1);
    expect(bootstrapEnvironmentMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({
        parameters: expect.objectContaining({
          denyExternalId: false,
        }),
      }),
    );
  });
});

describe('cdk bootstrap --show-template', () => {
  const stdoutSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => {
    return true;
  });

  test('prints the default bootstrap template', async () => {
    await exec(['bootstrap', '--show-template']);
    expect(stdoutSpy).toHaveBeenCalledWith(expect.stringContaining('BootstrapVersion'));
  });

  test('bootstrap template contains DenyExternalId parameter', async () => {
    await exec(['bootstrap', '--show-template']);
    expect(stdoutSpy).toHaveBeenCalledWith(expect.stringContaining('DenyExternalId'));
  });

  test('bootstrap template contains ShouldDenyExternalId condition', async () => {
    await exec(['bootstrap', '--show-template']);
    expect(stdoutSpy).toHaveBeenCalledWith(expect.stringContaining('ShouldDenyExternalId'));
  });
});
