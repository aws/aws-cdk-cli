import * as fs from 'fs';
import * as path from 'path';
import * as cxschema from '@aws-cdk/cloud-assembly-schema/lib';
import { rimraf } from './util';
import * as cxapi from '../lib';

const stackBase = {
  type: cxschema.ArtifactType.AWS_CLOUDFORMATION_STACK,
  environment: 'aws://1222344/us-east-1',
  properties: {
    templateFile: 'bla.json',
  },
};

let builder: cxapi.CloudAssemblyBuilder;
beforeEach(() => {
  builder = new cxapi.CloudAssemblyBuilder();
});

afterEach(() => {
  rimraf(builder.outdir);
});

test('read notification arns from artifact properties', () => {
// GIVEN
  const NOTIFICATION_ARNS = ['arn:aws:sns:bermuda-triangle-1337:123456789012:MyTopic'];
  builder.addArtifact('Stack', {
    ...stackBase,
    properties: {
      ...stackBase.properties,
      notificationArns: NOTIFICATION_ARNS,
    },
  });

  // WHEN
  const assembly = builder.buildAssembly();

  // THEN
  expect(assembly.getStackByName('Stack').notificationArns).toEqual(NOTIFICATION_ARNS);
});

test('read tags from artifact properties', () => {
  // GIVEN
  builder.addArtifact('Stack', {
    ...stackBase,
    properties: {
      ...stackBase.properties,
      tags: {
        foo: 'bar',
      },
    },
  });

  // WHEN
  const assembly = builder.buildAssembly();

  // THEN
  expect(assembly.getStackByName('Stack').tags).toEqual({ foo: 'bar' });
});

test('already uppercased stack tags get left alone', () => {
  // Backwards compatibility test
  // GIVEN
  builder.addArtifact('Stack', {
    ...stackBase,
    metadata: {
      '/Stack': [
        {
          type: 'aws:cdk:stack-tags',
          data: [{ Key: 'foo', Value: 'bar' } as any],
        },
      ],
    },
  });

  // WHEN
  const assembly = builder.buildAssembly();

  // THEN
  const manifestStructure = JSON.parse(fs.readFileSync(path.join(assembly.directory, 'manifest.json'), { encoding: 'utf-8' }));
  expect(manifestStructure.artifacts.Stack.metadata['/Stack']).toEqual([
    {
      type: 'aws:cdk:stack-tags',
      data: [
        {
          // Note: uppercase due to historical accident
          Key: 'foo',
          Value: 'bar',
        },
      ],
    },
  ]);
});

test('tags are NO LONGER read from stack metadata', () => {
  // Backwards compatibility test
  // GIVEN
  builder.addArtifact('Stack', {
    ...stackBase,
    metadata: {
      '/Stack': [
        {
          type: 'aws:cdk:stack-tags',
          data: [{ key: 'foo', value: 'bar' }],
        },
      ],
    },
  });

  // WHEN
  const assembly = builder.buildAssembly();

  // THEN
  expect(assembly.getStackByName('Stack').tags).toEqual({});
});

test('stack metadata can be read both from artifact and a file', () => {
  // Backwards compatibility test
  // GIVEN
  builder.addArtifact('Stack', {
    ...stackBase,
    metadata: {
      '/Stack': [
        {
          type: 'custom:metadata',
          data: 'custom 1',
        },
      ],
    },
    additionalMetadataFile: 'addl-meta.json',
  });

  fs.writeFileSync(path.join(builder.outdir, 'addl-meta.json'), JSON.stringify({
    '/Stack': [
      {
        type: 'custom:metadata',
        data: 'custom 2',
      },
    ],
    '/Stack/Sub': [
      {
        type: 'custom:metadata',
        data: 'custom 3',
      },
    ],
  }), 'utf-8');

  // WHEN
  const assembly = builder.buildAssembly();

  // THEN
  expect(assembly.getStackByName('Stack').metadata).toEqual({
    '/Stack': [
      {
        type: 'custom:metadata',
        data: 'custom 2',
      },
      {
        type: 'custom:metadata',
        data: 'custom 1',
      },
    ],
    '/Stack/Sub': [
      {
        type: 'custom:metadata',
        data: 'custom 3',
      },
    ],
  });
});

test('user friendly id is the assembly display name', () => {
  // GIVEN
  builder.addArtifact('Stack', {
    ...stackBase,
    displayName: 'some/path/to/the/stack',
  });

  // WHEN
  const assembly = builder.buildAssembly();

  // THEN
  expect(assembly.getStackByName('Stack').hierarchicalId).toEqual('some/path/to/the/stack');
});

test('user friendly id is the id itself if no display name is given', () => {
  // GIVEN
  builder.addArtifact('Stack', {
    ...stackBase,
  });

  // WHEN
  const assembly = builder.buildAssembly();

  // THEN
  expect(assembly.getStackByName('Stack').hierarchicalId).toEqual('Stack');
});
