import { GetResourceCommand, InvalidRequestException, ListResourcesCommand, ResourceNotFoundException } from '@aws-sdk/client-cloudcontrol';
import { CcApiContextProviderPlugin } from '../../lib/context-providers/cc-api-provider';
import { mockCloudControlClient, MockSdkProvider, restoreSdkMocksToDefault } from '../util/mock-sdk';

let provider: CcApiContextProviderPlugin;

beforeEach(() => {
  provider = new CcApiContextProviderPlugin(new MockSdkProvider());
  restoreSdkMocksToDefault();
});

/* eslint-disable */
test('looks up RDS instance using CC API getResource', async () => {
  // GIVEN
  mockCloudControlClient.on(GetResourceCommand).resolves({
    TypeName: 'AWS::RDS::DBInstance',
    ResourceDescription: {
      Identifier: 'my-db-instance-1',
      Properties: '{"DBInstanceArn":"arn:aws:rds:us-east-1:123456789012:db:test-instance-1","StorageEncrypted":"true"}',
    },
  });

  // WHEN
  const results = await provider.getValue({
    account: '123456789012',
    region: 'us-east-1',
    typeName: 'AWS::RDS::DBInstance',
    exactIdentifier: 'my-db-instance-1',
    propertiesToReturn: ['DBInstanceArn', 'StorageEncrypted'],
  });

  // THEN
  const propsObj = results[0];
  expect(propsObj).toEqual(expect.objectContaining({
    DBInstanceArn: 'arn:aws:rds:us-east-1:123456789012:db:test-instance-1',
    StorageEncrypted: 'true',
    Identifier: 'my-db-instance-1',
  }));
});

test('looks up RDS instance using CC API getResource - empty response', async () => {
  // GIVEN
  mockCloudControlClient.on(GetResourceCommand).resolves({
  });

  await expect(
    // WHEN
    provider.getValue({
      account: '123456789012',
      region: 'us-east-1',
      typeName: 'AWS::RDS::DBInstance',
      exactIdentifier: 'bad-identifier',
      propertiesToReturn: ['DBInstanceArn', 'StorageEncrypted'],
    }),
  ).rejects.toThrow('Unexpected CloudControl API behavior: returned empty response'); // THEN
});

test('looks up RDS instance using CC API getResource - error in CC API', async () => {
  // GIVEN
  mockCloudControlClient.on(GetResourceCommand).rejects('No data found');

  await expect(
    // WHEN
    provider.getValue({
      account: '123456789012',
      region: 'us-east-1',
      typeName: 'AWS::RDS::DBInstance',
      exactIdentifier: 'bad-identifier',
      propertiesToReturn: ['DBInstanceArn', 'StorageEncrypted'],
    }),
  ).rejects.toThrow('Encountered CC API error while getting AWS::RDS::DBInstance resource bad-identifier'); // THEN
});

test('looks up RDS instance using CC API listResources', async () => {
  // GIVEN
  mockCloudControlClient.on(ListResourcesCommand).resolves({
    ResourceDescriptions: [
      {
        Identifier: 'my-db-instance-1',
        Properties: '{"DBInstanceArn":"arn:aws:rds:us-east-1:123456789012:db:test-instance-1","StorageEncrypted":"true","Endpoint":{"Address":"address1.amazonaws.com","Port":"5432"}}',
      },
      {
        Identifier: 'my-db-instance-2',
        Properties: '{"DBInstanceArn":"arn:aws:rds:us-east-1:123456789012:db:test-instance-2","StorageEncrypted":"false","Endpoint":{"Address":"address2.amazonaws.com","Port":"5432"}}',
      },
      {
        Identifier: 'my-db-instance-3',
        Properties: '{"DBInstanceArn":"arn:aws:rds:us-east-1:123456789012:db:test-instance-3","StorageEncrypted":"true","Endpoint":{"Address":"address3.amazonaws.com","Port":"6000"}}',
      },
    ],
  });

  // WHEN
  const results = await provider.getValue({
    account: '123456789012',
    region: 'us-east-1',
    typeName: 'AWS::RDS::DBInstance',
    propertyMatch: {
      StorageEncrypted: 'true',
    },
    propertiesToReturn: ['DBInstanceArn', 'StorageEncrypted', 'Endpoint.Port'],
  });

  // THEN
  let propsObj = results[0];
  expect(propsObj).toEqual(expect.objectContaining({
    DBInstanceArn: 'arn:aws:rds:us-east-1:123456789012:db:test-instance-1',
    StorageEncrypted: 'true',
    'Endpoint.Port': '5432',
    Identifier: 'my-db-instance-1',
  }));

  propsObj = results[1];
  expect(propsObj).toEqual(expect.objectContaining({
    DBInstanceArn: 'arn:aws:rds:us-east-1:123456789012:db:test-instance-3',
    StorageEncrypted: 'true',
    'Endpoint.Port': '6000',
    Identifier: 'my-db-instance-3',
  }));

  expect(results.length).toEqual(2);
});

test('looks up RDS instance using CC API listResources - nested prop', async () => {
  // GIVEN
  mockCloudControlClient.on(ListResourcesCommand).resolves({
    ResourceDescriptions: [
      {
        Identifier: 'my-db-instance-1',
        Properties: '{"DBInstanceArn":"arn:aws:rds:us-east-1:123456789012:db:test-instance-1","StorageEncrypted":"true","Endpoint":{"Address":"address1.amazonaws.com","Port":"5432"}}',
      },
      {
        Identifier: 'my-db-instance-2',
        Properties: '{"DBInstanceArn":"arn:aws:rds:us-east-1:123456789012:db:test-instance-2","StorageEncrypted":"false","Endpoint":{"Address":"address2.amazonaws.com","Port":"5432"}}',
      },
      {
        Identifier: 'my-db-instance-3',
        Properties: '{"DBInstanceArn":"arn:aws:rds:us-east-1:123456789012:db:test-instance-3","StorageEncrypted":"true","Endpoint":{"Address":"address3.amazonaws.com","Port":"6000"}}',
      },
    ],
  });

  // WHEN
  const results = await provider.getValue({
    account: '123456789012',
    region: 'us-east-1',
    typeName: 'AWS::RDS::DBInstance',
    propertyMatch: {
      'StorageEncrypted': 'true',
      'Endpoint.Port': '5432',
    },
    propertiesToReturn: ['DBInstanceArn', 'StorageEncrypted', 'Endpoint.Port'],
  });

  // THEN
  let propsObj = results[0];
  expect(propsObj).toEqual(expect.objectContaining({
    DBInstanceArn: 'arn:aws:rds:us-east-1:123456789012:db:test-instance-1',
    StorageEncrypted: 'true',
    'Endpoint.Port': '5432',
    Identifier: 'my-db-instance-1',
  }));

  expect(results.length).toEqual(1);
});

test('looks up RDS instance using CC API listResources - error in CC API', async () => {
  // GIVEN
  mockCloudControlClient.on(ListResourcesCommand).rejects('No data found');

  await expect(
    // WHEN
    provider.getValue({
      account: '123456789012',
      region: 'us-east-1',
      typeName: 'AWS::RDS::DBInstance',
      propertyMatch: { 'Endpoint.Port': '5432' },
      propertiesToReturn: ['DBInstanceArn', 'StorageEncrypted'],
    }),
  ).rejects.toThrow('error while listing AWS::RDS::DBInstance resources'); // THEN
});

test.each([
  [undefined],
  ['any'],
  ['at-most-one'],
] as const)('return an empty array for empty result when expectedMatchCount is %s', async (expectedMatchCount) => {
  // GIVEN
  mockCloudControlClient.on(ListResourcesCommand).resolves({
    ResourceDescriptions: [
      { Identifier: 'pl-xxxx', Properties: '{"PrefixListName":"name1","PrefixListId":"pl-xxxx","OwnerId":"123456789012"}' },
      { Identifier: 'pl-yyyy', Properties: '{"PrefixListName":"name1","PrefixListId":"pl-yyyy","OwnerId":"234567890123"}' },
      { Identifier: 'pl-zzzz', Properties: '{"PrefixListName":"name2","PrefixListId":"pl-zzzz","OwnerId":"123456789012"}' },
    ],
  });

  // WHEN
  const results = await provider.getValue({
    account: '123456789012',
    region: 'us-east-1',
    typeName: 'AWS::EC2::PrefixList',
    propertyMatch: { PrefixListName: 'name3' },
    propertiesToReturn: ['PrefixListId'],
    expectedMatchCount,
  });

  // THEN
  expect(results.length).toEqual(0);
});


test.each([
  ['at-least-one'],
  ['exactly-one']
] as const)('throws an error for empty result when expectedMatchCount is %s', async (expectedMatchCount) => {
  // GIVEN
  mockCloudControlClient.on(ListResourcesCommand).resolves({
    ResourceDescriptions: [
      { Identifier: 'pl-xxxx', Properties: '{"PrefixListName":"name1","PrefixListId":"pl-xxxx","OwnerId":"123456789012"}' },
      { Identifier: 'pl-yyyy', Properties: '{"PrefixListName":"name1","PrefixListId":"pl-yyyy","OwnerId":"234567890123"}' },
      { Identifier: 'pl-zzzz', Properties: '{"PrefixListName":"name2","PrefixListId":"pl-zzzz","OwnerId":"123456789012"}' },
    ],
  });

  await expect(
    // WHEN
    provider.getValue({
      account: '123456789012',
      region: 'us-east-1',
      typeName: 'AWS::EC2::PrefixList',
      propertyMatch: { PrefixListName: 'name3' },
      propertiesToReturn: ['PrefixListId'],
      expectedMatchCount,
    }),
  ).rejects.toThrow('Could not find any resources matching {"PrefixListName":"name3"}'); // THEN
});

test.each([
  ['at-most-one'],
  ['exactly-one']
] as const)('throws an error for multiple results when expectedMatchCount is %s', async (expectedMatchCount) => {
  // GIVEN
  mockCloudControlClient.on(ListResourcesCommand).resolves({
    ResourceDescriptions: [
      { Identifier: 'pl-xxxx', Properties: '{"PrefixListName":"name1","PrefixListId":"pl-xxxx","OwnerId":"123456789012"}' },
      { Identifier: 'pl-yyyy', Properties: '{"PrefixListName":"name1","PrefixListId":"pl-yyyy","OwnerId":"234567890123"}' },
      { Identifier: 'pl-zzzz', Properties: '{"PrefixListName":"name2","PrefixListId":"pl-zzzz","OwnerId":"123456789012"}' },
    ],
  });

  await expect(
    // WHEN
    provider.getValue({
      account: '123456789012',
      region: 'us-east-1',
      typeName: 'AWS::EC2::PrefixList',
      propertyMatch: { PrefixListName: 'name1' },
      propertiesToReturn: ['PrefixListId'],
      expectedMatchCount,
    }),
  ).rejects.toThrow('Found 2 resources matching {"PrefixListName":"name1"}'); // THEN
});

test('error by specifying both exactIdentifier and propertyMatch', async () => {
  // GIVEN
  mockCloudControlClient.on(GetResourceCommand).resolves({
  });

  await expect(
    // WHEN
    provider.getValue({
      account: '123456789012',
      region: 'us-east-1',
      typeName: 'AWS::RDS::DBInstance',
      exactIdentifier: 'bad-identifier',
      propertyMatch: {
        'StorageEncrypted': 'true',
        'Endpoint.Port': '5432',
      },
      propertiesToReturn: ['DBInstanceArn', 'StorageEncrypted'],
    }),
  ).rejects.toThrow('specify either exactIdentifier or propertyMatch, but not both'); // THEN
});

test('error by specifying neither exactIdentifier or propertyMatch', async () => {
  // GIVEN
  mockCloudControlClient.on(GetResourceCommand).resolves({
  });

  await expect(
    // WHEN
    provider.getValue({
      account: '123456789012',
      region: 'us-east-1',
      typeName: 'AWS::RDS::DBInstance',
      propertiesToReturn: ['DBInstanceArn', 'StorageEncrypted'],
    }),
  ).rejects.toThrow('neither exactIdentifier nor propertyMatch is specified');
});

describe('dummy value', () => {
  test('returns dummy value when CC API getResource fails', async () => {
    // GIVEN
    mockCloudControlClient.on(GetResourceCommand).rejects(createResourceNotFoundException());

    // WHEN
    const results = await provider.getValue({
      account: '123456789012',
      region: 'us-east-1',
      typeName: 'AWS::RDS::DBInstance',
      exactIdentifier: 'bad-identifier',
      propertiesToReturn: ['DBInstanceArn', 'StorageEncrypted'],
      ignoreErrorOnMissingContext: true,
      dummyValue: [
        {
          DBInstanceArn: 'arn:aws:rds:us-east-1:123456789012:db:dummy-instance',
          StorageEncrypted: 'true',
        },
      ],
    });

    // THEN
    expect(results.length).toEqual(1);
    expect(results[0]).toEqual({
      DBInstanceArn: 'arn:aws:rds:us-east-1:123456789012:db:dummy-instance',
      StorageEncrypted: 'true',
    });
  });

  // TODO: This test can be re-enabled when listResources can be made to fail, after
  // https://github.com/aws/aws-cdk-cli/pull/251 is merged.
  test.skip('returns dummy value when CC API listResources fails', async () => {
    // GIVEN
    mockCloudControlClient.on(ListResourcesCommand).rejects(createResourceNotFoundException());

    // WHEN
    const results = await provider.getValue({
      account: '123456789012',
      region: 'us-east-1',
      typeName: 'AWS::RDS::DBInstance',
      propertyMatch: { 'StorageEncrypted': 'true' },
      propertiesToReturn: ['DBInstanceArn', 'StorageEncrypted'],
      ignoreErrorOnMissingContext: true,
      dummyValue: [
        {
          DBInstanceArn: 'arn:aws:rds:us-east-1:123456789012:db:dummy-instance',
          StorageEncrypted: 'true',
        },
      ],
    });

    // THEN
    expect(results.length).toEqual(1);
    expect(results[0]).toEqual({
      DBInstanceArn: 'arn:aws:rds:us-east-1:123456789012:db:dummy-instance',
      StorageEncrypted: 'true',
      Identifier: 'dummy-id',
    });
  });

  test('throws error when CC API getResource fails but the error is not ResourceNotFoundException', async () => {
    // GIVEN
    mockCloudControlClient.on(GetResourceCommand).rejects(createOtherError());

    // WHEN/THEN
    await expect(
      provider.getValue({
        account: '123456789012',
        region: 'us-east-1',
        typeName: 'AWS::RDS::DBInstance',
        exactIdentifier: 'bad-identifier',
        propertiesToReturn: ['DBInstanceArn', 'StorageEncrypted'],
        ignoreErrorOnMissingContext: true,
        dummyValue: [
          {
            DBInstanceArn: 'arn:aws:rds:us-east-1:123456789012:db:dummy-instance',
            StorageEncrypted: 'true',
          },
      ],
    }),
  ).rejects.toThrow('Encountered CC API error while getting AWS::RDS::DBInstance resource bad-identifier: Other error');
  });

  test('throws error when CC API listResources fails but the error is not ResourceNotFoundException', async () => {
    // GIVEN
    mockCloudControlClient.on(ListResourcesCommand).rejects(createOtherError());

    // WHEN/THEN
    await expect(
      provider.getValue({
        account: '123456789012',
        region: 'us-east-1',
        typeName: 'AWS::RDS::DBInstance',
        propertyMatch: { 'StorageEncrypted': 'true' },
        propertiesToReturn: ['DBInstanceArn', 'StorageEncrypted'],
        ignoreErrorOnMissingContext: true,
        dummyValue: [
          {
            DBInstanceArn: 'arn:aws:rds:us-east-1:123456789012:db:dummy-instance',
            StorageEncrypted: 'true',
          },
        ],
      }),
    ).rejects.toThrow('Encountered CC API error while listing AWS::RDS::DBInstance resources matching {\"StorageEncrypted\":\"true\"}: Other error');
  });

  test('throws error when CC API fails and ignoreErrorOnMissingContext is not provided', async () => {
    // GIVEN
    mockCloudControlClient.on(GetResourceCommand).rejects(createResourceNotFoundException());

    // WHEN/THEN
    await expect(
      provider.getValue({
        account: '123456789012',
        region: 'us-east-1',
        typeName: 'AWS::RDS::DBInstance',
        exactIdentifier: 'bad-identifier',
        propertiesToReturn: ['DBInstanceArn', 'StorageEncrypted'],
        dummyValue: [
          {
            DBInstanceArn: 'arn:aws:rds:us-east-1:123456789012:db:dummy-instance',
            StorageEncrypted: 'true',
          },
        ],
      }),
    ).rejects.toThrow('No resource of type AWS::RDS::DBInstance with identifier: bad-identifier');
  });

  test('throws error when CC API fails and ignoreErrorOnMissingContext is false', async () => {
    // GIVEN
    mockCloudControlClient.on(GetResourceCommand).rejects(createResourceNotFoundException());

    // WHEN/THEN
    await expect(
      provider.getValue({
        account: '123456789012',
        region: 'us-east-1',
        typeName: 'AWS::RDS::DBInstance',
        exactIdentifier: 'bad-identifier',
        propertiesToReturn: ['DBInstanceArn', 'StorageEncrypted'],
        ignoreErrorOnMissingContext: false,
        dummyValue: [
          {
            DBInstanceArn: 'arn:aws:rds:us-east-1:123456789012:db:dummy-instance',
            StorageEncrypted: 'true',
          },
        ],
      }),
    ).rejects.toThrow('No resource of type AWS::RDS::DBInstance with identifier: bad-identifier');
  });

  test('throws error when CC API fails and dummyValue is not provided', async () => {
    // GIVEN
    mockCloudControlClient.on(GetResourceCommand).rejects(createResourceNotFoundException());

    // WHEN/THEN
    await expect(
      provider.getValue({
        account: '123456789012',
        region: 'us-east-1',
        typeName: 'AWS::RDS::DBInstance',
        exactIdentifier: 'bad-identifier',
        propertiesToReturn: ['DBInstanceArn', 'StorageEncrypted'],
        ignoreErrorOnMissingContext: true,
      }),
    ).rejects.toThrow('if ignoreErrorOnMissingContext is set, a dummyValue must be supplied');
  });

  test('throws error when CC API fails and dummyValue is not an array', async () => {
    // GIVEN
    mockCloudControlClient.on(GetResourceCommand).rejects(createResourceNotFoundException());

    // WHEN/THEN
    await expect(
      provider.getValue({
        account: '123456789012',
        region: 'us-east-1',
        typeName: 'AWS::RDS::DBInstance',
        exactIdentifier: 'bad-identifier',
        propertiesToReturn: ['DBInstanceArn', 'StorageEncrypted'],
        ignoreErrorOnMissingContext: true,
        dummyValue: {
          DBInstanceArn: 'arn:aws:rds:us-east-1:123456789012:db:dummy-instance',
          StorageEncrypted: 'true',
        },
      }),
    ).rejects.toThrow('dummyValue must be an array of objects');
  });

  test('throws error when CC API fails and dummyValue is not an object array', async () => {
    // GIVEN
    mockCloudControlClient.on(GetResourceCommand).rejects(createResourceNotFoundException());

    // WHEN/THEN
    await expect(
      provider.getValue({
        account: '123456789012',
        region: 'us-east-1',
        typeName: 'AWS::RDS::DBInstance',
        exactIdentifier: 'bad-identifier',
        propertiesToReturn: ['DBInstanceArn', 'StorageEncrypted'],
        ignoreErrorOnMissingContext: true,
        dummyValue: [
          'not an object',
        ],
      }),
    ).rejects.toThrow('dummyValue must be an array of objects');
  });
});
/* eslint-enable */

function createResourceNotFoundException() {
  return new ResourceNotFoundException({
    $metadata: {},
    message: 'Resource not found',
    Message: 'Resource not found'
  });
}

function createOtherError() {
  return new InvalidRequestException({
    $metadata: {},
    message: 'Other error',
    Message: 'Other error'
  });
}
