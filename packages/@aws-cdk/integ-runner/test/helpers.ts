import * as path from 'path';
import type { CdkCliWrapperOptions, DeployOptions, ICdk, ListOptions, SynthFastOptions, SynthOptions } from '@aws-cdk/cdk-cli-wrapper';
import type { DestroyOptions } from '@aws-cdk/cloud-assembly-schema/lib/integ-tests';
import { IntegSnapshotRunner, IntegTest } from '../lib/runner';
import type { DestructiveChange, Diagnostic } from '../lib/workers';

export interface MockCdkMocks {
  deploy?: jest.MockedFn<(options: DeployOptions) => Promise<void>>;
  watch?: jest.MockedFn<(options: DeployOptions) => Promise<void>>;
  synth?: jest.MockedFn<(options: SynthOptions) => Promise<void>>;
  synthFast?: jest.MockedFn<(options: SynthFastOptions) => Promise<void>>;
  destroy?: jest.MockedFn<(options: DestroyOptions) => Promise<void>>;
  list?: jest.MockedFn<(options: ListOptions) => Promise<string[]>>;
}

export class MockCdkProvider {
  public readonly cdk: ICdk;
  public readonly mocks: MockCdkMocks = {};

  constructor(_options: CdkCliWrapperOptions) {
    this.cdk = {
      deploy: jest.fn().mockImplementation(),
      watch: jest.fn().mockImplementation(),
      synth: jest.fn().mockImplementation(),
      synthFast: jest.fn().mockImplementation(),
      destroy: jest.fn().mockImplementation(),
      list: jest.fn().mockResolvedValue([]),
    };
    this.mockAll();
  }

  public mockDeploy(mock?: MockCdkMocks['deploy']) {
    this.mocks.deploy = mock ?? jest.fn().mockImplementation();
    this.cdk.deploy = this.mocks.deploy;
  }
  public mockWatch(mock?: MockCdkMocks['watch']) {
    this.mocks.watch = mock ?? jest.fn().mockImplementation(jest.fn((_args, events) => {
      if (events.onClose) {
        events.onClose(0);
      }
    }));
    this.cdk.watch = this.mocks.watch;
  }
  public mockSynth(mock?: MockCdkMocks['synth']) {
    this.mocks.synth = mock ?? jest.fn().mockImplementation();
    this.cdk.synth = this.mocks.synth;
  }
  public mockSynthFast(mock?: MockCdkMocks['synthFast']) {
    this.mocks.synthFast = mock ?? jest.fn().mockImplementation();
    this.cdk.synthFast = this.mocks.synthFast;
  }
  public mockDestroy(mock?: MockCdkMocks['destroy']) {
    this.mocks.destroy = mock ?? jest.fn().mockImplementation();
    this.cdk.destroy = this.mocks.destroy;
  }
  public mockList(mock?: MockCdkMocks['list']) {
    this.mocks.list = mock ?? jest.fn().mockResolvedValue([]);
    this.cdk.list = this.mocks.list;
  }
  public mockAll(mocks: MockCdkMocks = {}): Required<MockCdkMocks> {
    this.mockDeploy(mocks.deploy);
    this.mockWatch(mocks.watch);
    this.mockSynth(mocks.synth);
    this.mockSynthFast(mocks.synthFast);
    this.mockDestroy(mocks.destroy);
    this.mockList(mocks.list);

    return this.mocks as Required<MockCdkMocks>;
  }

  /**
   * Run a test of the testSnapshot method
   * @param integTestFile - This name is used to determined the expected (committed) snapshot
   * @param actualSnapshot - The directory of the snapshot that is used for of the actual (current) app
   * @returns Diagnostics as they would be returned by testSnapshot
   */
  public async snapshotTest(integTestFile: string, actualSnapshot?: string): Promise<{
    diagnostics: Diagnostic[];
    destructiveChanges: DestructiveChange[];
  }> {
    // WHEN
    const integTest = new IntegSnapshotRunner({
      cdk: this.cdk,
      test: new IntegTest({
        fileName: 'test/test-data/' + integTestFile,
        discoveryRoot: 'test/test-data',
      }),
      integOutDir: actualSnapshot ? 'test/test-data/' + actualSnapshot : undefined,
    });

    const results = await integTest.testSnapshot();

    // THEN
    expect(this.mocks.synthFast).toHaveBeenCalledTimes(2);
    expect(this.mocks.synthFast).toHaveBeenCalledWith({
      env: expect.objectContaining({
        CDK_INTEG_ACCOUNT: '12345678',
        CDK_INTEG_REGION: 'test-region',
      }),
      context: expect.any(Object),
      execCmd: ['node', integTestFile],
      output: actualSnapshot ?? `cdk-integ.out.${integTestFile}.snapshot`,
    });

    return results;
  }
}

/**
 * Get the absolute path to a data located the test-data directory
 */
export function testDataPath(...location: string[]): string {
  return path.join(__dirname, 'test-data', ...location);
}
