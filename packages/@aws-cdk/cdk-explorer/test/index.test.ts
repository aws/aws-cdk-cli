import { PROTOCOL_VERSION, SynthLatch, socketPathForProject } from '../lib';

test('package exports protocol version', () => {
  expect(typeof PROTOCOL_VERSION).toBe('string');
  expect(PROTOCOL_VERSION.length).toBeGreaterThan(0);
});

test('package exports SynthLatch', () => {
  const latch = new SynthLatch();
  expect(latch.state).toBe('idle');
});

test('package exports socket path utilities', () => {
  expect(socketPathForProject('/test')).toContain('cdk-synth-');
});
