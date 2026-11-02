import * as path from 'path';
import { StackSelectionStrategy } from '@aws-cdk/toolkit-lib';
import * as fs from 'fs-extra';
import { Deployments } from '../../lib/api';
import { CdkToolkit } from '../../lib/cli/cdk-toolkit';
import { CliIoHost } from '../../lib/cli/io-host';
import type { TestStackArtifact } from '../_helpers';
import { instanceMockFrom, MockCloudExecutable } from '../_helpers';
import { IoHostRecorder } from '../_helpers/io-recorder';

// These tests snapshot the entire ordered stream of messages that `cdk validate`
// sends to the CliIoHost. Any future reroute or refactor that changes user-visible
// output shows up as a snapshot diff. See test/_helpers/io-recorder.ts.

const STACK_A: TestStackArtifact = {
  stackName: 'Test-Stack-A',
  template: { Resources: { MyBucket: { Type: 'AWS::S3::Bucket' } } },
  env: 'aws://123456789012/bermuda-triangle-1',
  displayName: 'Test-Stack-A-Display-Name',
};

const STACK_B: TestStackArtifact = {
  stackName: 'Test-Stack-B',
  template: { Resources: { MyTopic: { Type: 'AWS::SNS::Topic' } } },
  env: 'aws://123456789012/bermuda-triangle-1',
};

let cloudExecutable: MockCloudExecutable;
let toolkit: CdkToolkit;
let ioHost: CliIoHost;
let recorder: IoHostRecorder;

beforeEach(async () => {
  jest.resetAllMocks();

  ioHost = CliIoHost.instance();
  ioHost.isCI = false;
  ioHost.currentAction = 'validate';

  cloudExecutable = await MockCloudExecutable.create({
    stacks: [STACK_A, STACK_B],
  }, undefined, ioHost, 'validate');

  toolkit = new CdkToolkit({
    ioHost,
    cloudExecutable,
    configuration: cloudExecutable.configuration,
    sdkProvider: cloudExecutable.sdkProvider,
    deployments: instanceMockFrom(Deployments),
  });

  recorder = IoHostRecorder.create(ioHost);
});

afterEach(() => {
  recorder.matchSnapshot();
});

describe('no violations', () => {
  test('reports success when no validation report exists', async () => {
    const exitCode = await toolkit.validate({
      stacks: { patterns: [], strategy: StackSelectionStrategy.ALL_STACKS },
      online: false,
    });

    expect(exitCode).toBe(0);
  });
});

describe('with violations', () => {
  test('reports failure when validation report has violations', async () => {
    // Pre-synthesize to get the assembly directory, then write a validation
    // report there so the validate action discovers it.
    // Note: constructPath must use the stack's hierarchicalId (displayName or
    // artifactId) since the validation report filtering matches on
    // `constructPath.split('/')[0]` against `stacks.hierarchicalIds`.
    const assembly = await cloudExecutable.synthesize();
    await fs.writeJSON(path.join(assembly.directory, 'validation-report.json'), {
      version: '1.0.0',
      pluginReports: [{
        pluginName: 'TestPlugin',
        conclusion: 'failure',
        violations: [{
          ruleName: 'no-public-buckets',
          description: 'S3 Buckets must not be publicly accessible',
          severity: 'error',
          violatingConstructs: [{
            constructPath: 'Test-Stack-A-Display-Name/MyBucket/Resource',
            cloudFormationResource: {
              templatePath: 'Test-Stack-A.template.json',
              logicalId: 'MyBucket',
            },
          }],
        }],
      }],
    });

    const exitCode = await toolkit.validate({
      stacks: { patterns: [], strategy: StackSelectionStrategy.ALL_STACKS },
      online: false,
    });

    expect(exitCode).toBe(1);
  });

  test('reports multiple violations from multiple plugins', async () => {
    const assembly = await cloudExecutable.synthesize();
    await fs.writeJSON(path.join(assembly.directory, 'validation-report.json'), {
      version: '1.0.0',
      pluginReports: [
        {
          pluginName: 'SecurityPlugin',
          conclusion: 'failure',
          violations: [{
            ruleName: 'no-public-buckets',
            description: 'S3 Buckets must not be publicly accessible',
            severity: 'error',
            violatingConstructs: [{
              constructPath: 'Test-Stack-A-Display-Name/MyBucket/Resource',
              cloudFormationResource: {
                templatePath: 'Test-Stack-A.template.json',
                logicalId: 'MyBucket',
              },
            }],
          }],
        },
        {
          pluginName: 'CostPlugin',
          conclusion: 'failure',
          violations: [{
            ruleName: 'require-cost-tags',
            description: 'All resources must have cost allocation tags',
            severity: 'warning',
            violatingConstructs: [{
              constructPath: 'Test-Stack-B/MyTopic/Resource',
              cloudFormationResource: {
                templatePath: 'Test-Stack-B.template.json',
                logicalId: 'MyTopic',
              },
            }],
          }],
        },
      ],
    });

    const exitCode = await toolkit.validate({
      stacks: { patterns: [], strategy: StackSelectionStrategy.ALL_STACKS },
      online: false,
    });

    expect(exitCode).toBe(1);
  });
});

describe('stack selection', () => {
  test('validates a single selected stack', async () => {
    const exitCode = await toolkit.validate({
      stacks: { patterns: ['Test-Stack-A-Display-Name'], strategy: StackSelectionStrategy.PATTERN_MATCH },
      online: false,
    });

    expect(exitCode).toBe(0);
  });
});
