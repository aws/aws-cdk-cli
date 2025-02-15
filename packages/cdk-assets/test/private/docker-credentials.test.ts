import * as crypto from 'crypto';
import * as os from 'os';
import * as path from 'path';
import { GetAuthorizationTokenCommand } from '@aws-sdk/client-ecr';
import { GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { IAws } from '../../lib/aws';
import {
  _clearCdkCredentialsConfigCache,
  cdkCredentialsConfig,
  cdkCredentialsConfigFile,
  DockerCredentialsConfig,
  fetchDockerLoginCredentials,
} from '../../lib/private/docker-credentials';
import { MockAws, mockEcr, mockSecretsManager } from '../mock-aws';
import mockfs from '../mock-fs';

const _ENV = process.env;

let aws: IAws;
beforeEach(() => {
  jest.resetModules();
  jest.resetAllMocks();
  mockSecretWithSecretString({ username: 'secretUser', secret: 'secretPass' });
  _clearCdkCredentialsConfigCache();

  aws = new MockAws();

  process.env = { ..._ENV };
});

afterEach(() => {
  mockfs.restore();
  process.env = _ENV;
});

describe('cdkCredentialsConfigFile', () => {
  test('Can be overridden by CDK_DOCKER_CREDS_FILE', () => {
    const credsFile = '/tmp/insertfilenamehere_cdk_config.json';
    process.env.CDK_DOCKER_CREDS_FILE = credsFile;

    expect(cdkCredentialsConfigFile()).toEqual(credsFile);
  });

  test('Uses homedir if no process env is set', () => {
    expect(cdkCredentialsConfigFile()).toEqual(
      path.join(os.userInfo().homedir, '.cdk', 'cdk-docker-creds.json'),
    );
  });
});

describe('cdkCredentialsConfig', () => {
  let credsFile: string;
  beforeEach(() => {
    credsFile = `/tmp/foo/bar/does/not/exist/config${crypto.randomUUID()}.json`;
    process.env.CDK_DOCKER_CREDS_FILE = mockfs.path(credsFile);
  });

  test('returns undefined if no config exists', () => {
    expect(cdkCredentialsConfig()).toBeUndefined();
  });

  test('returns parsed config if it exists', () => {
    mockfs({
      [credsFile]: JSON.stringify({
        version: '0.1',
        domainCredentials: {
          'test1.example.com': { secretsManagerSecretId: 'mySecret' },
          'test2.example.com': { ecrRepository: 'arn:aws:ecr:bar' },
        },
      }),
    });

    const config = cdkCredentialsConfig();
    expect(config).toBeDefined();
    expect(config?.version).toEqual('0.1');
    expect(config?.domainCredentials['test1.example.com']?.secretsManagerSecretId).toEqual(
      'mySecret',
    );
    expect(config?.domainCredentials['test2.example.com']?.ecrRepository).toEqual(
      'arn:aws:ecr:bar',
    );
  });
});

describe('fetchDockerLoginCredentials', () => {
  let config: DockerCredentialsConfig;

  beforeEach(() => {
    config = {
      version: '0.1',
      domainCredentials: {
        'misconfigured.example.com': {},
        'secret.example.com': { secretsManagerSecretId: 'mySecret' },
        'secretwithrole.example.com': {
          secretsManagerSecretId: 'mySecret',
          assumeRoleArn: 'arn:aws:iam::0123456789012:role/my-role',
        },
        'secretwithcustomfields.example.com': {
          secretsManagerSecretId: 'mySecret',
          secretsUsernameField: 'name',
          secretsPasswordField: 'apiKey',
          assumeRoleArn: 'arn:aws:iam::0123456789012:role/my-role',
        },
        'ecr.example.com': { ecrRepository: true },
        'ecrwithrole.example.com': {
          ecrRepository: true,
          assumeRoleArn: 'arn:aws:iam::0123456789012:role/my-role',
        },
      },
    };
  });

  test('throws on unknown domain', async () => {
    await expect(
      fetchDockerLoginCredentials(aws, config, 'unknowndomain.example.com'),
    ).rejects.toThrow(/unknown domain/);
  });

  test('throws on misconfigured domain (no ECR or SM)', async () => {
    await expect(
      fetchDockerLoginCredentials(aws, config, 'misconfigured.example.com'),
    ).rejects.toThrow(/unknown credential type/);
  });

  test('does not throw on correctly configured raw domain', async () => {
    await expect(
      fetchDockerLoginCredentials(aws, config, 'https://secret.example.com/v1/'),
    ).resolves.toBeTruthy();
  });

  describe('SecretsManager', () => {
    test('returns the credentials successfully if configured correctly - domain', async () => {
      const creds = await fetchDockerLoginCredentials(aws, config, 'secret.example.com');

      expect(creds).toEqual({ Username: 'secretUser', Secret: 'secretPass' });
    });

    test('returns the credentials successfully if configured correctly - raw domain', async () => {
      const creds = await fetchDockerLoginCredentials(aws, config, 'https://secret.example.com');

      expect(creds).toEqual({ Username: 'secretUser', Secret: 'secretPass' });
    });

    test('supports assuming a role', async () => {
      const secretsManagerClient = jest.spyOn(aws, 'secretsManagerClient');

      const creds = await fetchDockerLoginCredentials(aws, config, 'secretwithrole.example.com');
      expect(creds).toEqual({ Username: 'secretUser', Secret: 'secretPass' });

      expect(secretsManagerClient).toHaveBeenCalledWith({
        assumeRoleArn: 'arn:aws:iam::0123456789012:role/my-role',
      });
    });

    test('supports configuring the secret fields', async () => {
      mockSecretWithSecretString({ name: 'secretUser', apiKey: '01234567' });

      const creds = await fetchDockerLoginCredentials(
        aws,
        config,
        'secretwithcustomfields.example.com',
      );

      expect(creds).toEqual({ Username: 'secretUser', Secret: '01234567' });
    });

    test('throws when SecretsManager returns an error', async () => {
      const errMessage = "Secrets Manager can't find the specified secret.";
      const err = new Error(errMessage);
      err.name = 'ResourceNotFoundException';
      mockSecretsManager.on(GetSecretValueCommand).rejects(err);

      await expect(fetchDockerLoginCredentials(aws, config, 'secret.example.com')).rejects.toThrow(
        errMessage,
      );
    });

    test('throws when secret does not have the correct fields - key/value', async () => {
      mockSecretWithSecretString({ principal: 'foo', credential: 'bar' });

      await expect(fetchDockerLoginCredentials(aws, config, 'secret.example.com')).rejects.toThrow(
        /malformed secret string/,
      );
    });

    test('throws when secret does not have the correct fields - plaintext', async () => {
      mockSecretWithSecretString('myAPIKey');

      await expect(fetchDockerLoginCredentials(aws, config, 'secret.example.com')).rejects.toThrow(
        /malformed secret string/,
      );
    });
  });

  describe('ECR getAuthorizationToken', () => {
    test('returns the credentials successfully', async () => {
      mockEcrAuthorizationData(Buffer.from('myFoo:myBar', 'utf-8').toString('base64'));

      const creds = await fetchDockerLoginCredentials(aws, config, 'ecr.example.com');

      expect(creds).toEqual({ Username: 'myFoo', Secret: 'myBar' });
    });

    test('throws if ECR errors', async () => {
      const err = new Error('uhoh');
      err.name = 'ServerException';
      mockEcr.on(GetAuthorizationTokenCommand).rejects(err);

      await expect(fetchDockerLoginCredentials(aws, config, 'ecr.example.com')).rejects.toThrow(
        /uhoh/,
      );
    });

    test('supports assuming a role', async () => {
      mockEcrAuthorizationData(Buffer.from('myFoo:myBar', 'utf-8').toString('base64'));
      const ecrClient = jest.spyOn(aws, 'ecrClient');

      const creds = await fetchDockerLoginCredentials(aws, config, 'ecrwithrole.example.com');
      expect(creds).toEqual({ Username: 'myFoo', Secret: 'myBar' });

      expect(ecrClient).toHaveBeenCalledWith({
        assumeRoleArn: 'arn:aws:iam::0123456789012:role/my-role',
      });
    });

    test('throws if ECR returns no authData', async () => {
      mockEcr.on(GetAuthorizationTokenCommand).resolves({ authorizationData: [] });

      await expect(fetchDockerLoginCredentials(aws, config, 'ecr.example.com')).rejects.toThrow(
        /No authorization data received from ECR/,
      );
    });

    test('throws if ECR authData is in an incorrect format', async () => {
      mockEcrAuthorizationData('notabase64encodedstring');

      await expect(fetchDockerLoginCredentials(aws, config, 'ecr.example.com')).rejects.toThrow(
        /unexpected ECR authData format/,
      );
    });
  });
});

function mockSecretWithSecretString(secretString: any) {
  mockSecretsManager.on(GetSecretValueCommand).resolves({
    ARN: 'arn:aws:secretsmanager:eu-west-1:0123456789012:secret:mySecret',
    Name: 'mySecret',
    VersionId: 'fa81fe61-c167-4aca-969e-4d8df74d4814',
    SecretString: JSON.stringify(secretString),
    VersionStages: ['AWSCURRENT'],
  });
}

function mockEcrAuthorizationData(authorizationToken: string) {
  mockEcr.on(GetAuthorizationTokenCommand).resolves({
    authorizationData: [
      {
        authorizationToken,
        proxyEndpoint: 'https://0123456789012.dkr.ecr.eu-west-1.amazonaws.com',
      },
    ],
  });
}
