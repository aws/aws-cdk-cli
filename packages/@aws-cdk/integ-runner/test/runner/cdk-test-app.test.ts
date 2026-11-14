import { AVAILABILITY_ZONE_FALLBACK_CONTEXT_KEY } from '@aws-cdk/cloud-assembly-api';
import { CdkTestApp, IntegTest } from '../../lib/runner';
import { MockCdkProvider } from '../helpers';

let cdkMock: MockCdkProvider;
let app: CdkTestApp;

beforeEach(async () => {
  cdkMock = new MockCdkProvider({ directory: 'test/test-data' });
  app = await CdkTestApp.forGoldenSnapshot({
    cdk: cdkMock.cdk,
    region: 'eu-west-1',
    test: new IntegTest({
      fileName: 'test/test-data/xxxxx.test-with-snapshot.js',
      discoveryRoot: 'test/test-data',
    }),
  });
});

test('deploys a loaded golden snapshot without synthesizing it first', async () => {
  const suite = await app.loadExistingSuite();
  expect(suite?.testSuite['xxxxx.test-with-snapshot'].stacks).toEqual(['test-stack']);

  await expect(app.deploy({ stacks: ['test-stack'], context: { custom: 'value' } })).resolves.toEqual({ deleteFailures: [] });

  expect(cdkMock.mocks.synth).not.toHaveBeenCalled();
  expect(cdkMock.mocks.deploy).toHaveBeenCalledTimes(1);
  expect(cdkMock.mocks.deploy).toHaveBeenCalledWith(expect.objectContaining({
    output: 'test/test-data/xxxxx.test-with-snapshot.js.snapshot',
    stacks: ['test-stack'],
    context: expect.objectContaining({
      'custom': 'value',
      'aws:cdk:disable-creation-stack-traces': true,
    }),
  }));
  expect(cdkMock.mocks.deploy!.mock.calls[0][0].context).not.toHaveProperty(AVAILABILITY_ZONE_FALLBACK_CONTEXT_KEY);
});

test('preserves explicit deployment context overrides', async () => {
  await app.deploy({ stacks: ['test-stack'], context: { 'aws:cdk:disable-creation-stack-traces': 'false' } });

  expect(cdkMock.mocks.deploy).toHaveBeenCalledWith(expect.objectContaining({
    context: expect.objectContaining({ 'aws:cdk:disable-creation-stack-traces': 'false' }),
  }));
});

test('destroys without requiring snapshot synthesis settings', async () => {
  await app.destroy({ stacks: ['test-stack'] });

  expect(cdkMock.mocks.destroy).toHaveBeenCalledWith(expect.objectContaining({
    stacks: ['test-stack'],
    context: expect.objectContaining({ 'aws:cdk:disable-creation-stack-traces': true }),
  }));
});

test('watches without requiring snapshot synthesis settings', async () => {
  await app.watch({ stacks: ['test-stack'] }, {});

  expect(cdkMock.mocks.watch).toHaveBeenCalledWith(expect.objectContaining({
    stacks: ['test-stack'],
    context: expect.objectContaining({ 'aws:cdk:disable-creation-stack-traces': true }),
  }), {});
});

test('still requires lookup initialization for snapshot context', () => {
  expect(() => app.getContext('snapshot')).toThrow('Must call configureLegacyEnableLookups before synthing');
});

test.each([false, true, 'dont-care'] as const)('preserves configured lookup mode %s', (mode) => {
  app.configureLegacyEnableLookups(mode);

  expect(app.getContext('deployment')).not.toHaveProperty(AVAILABILITY_ZONE_FALLBACK_CONTEXT_KEY);
  expect(app.getContext('snapshot')[AVAILABILITY_ZONE_FALLBACK_CONTEXT_KEY]).toEqual(
    mode === false ? undefined : ['test-region-1a', 'test-region-1b', 'test-region-1c'],
  );
});
