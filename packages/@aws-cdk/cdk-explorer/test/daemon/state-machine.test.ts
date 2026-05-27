import { SynthLatch } from '../../lib/daemon/state-machine';

describe('SynthLatch', () => {
  let latch: SynthLatch;

  beforeEach(() => {
    latch = new SynthLatch();
  });

  test('starts in idle state', () => {
    expect(latch.state).toBe('idle');
  });

  test('idle + requestSynth → synthesizing, shouldStartSynth', () => {
    const result = latch.requestSynth();
    expect(result).toEqual({ newState: 'synthesizing', shouldStartSynth: true });
    expect(latch.state).toBe('synthesizing');
  });

  test('synthesizing + requestSynth → queued, no synth', () => {
    latch.requestSynth();
    const result = latch.requestSynth();
    expect(result).toEqual({ newState: 'queued', shouldStartSynth: false });
    expect(latch.state).toBe('queued');
  });

  test('queued + requestSynth → queued, no synth (idempotent)', () => {
    latch.requestSynth();
    latch.requestSynth();
    const result = latch.requestSynth();
    expect(result).toEqual({ newState: 'queued', shouldStartSynth: false });
    expect(latch.state).toBe('queued');
  });

  test('synthesizing + synthComplete → idle, no synth', () => {
    latch.requestSynth();
    const result = latch.synthComplete();
    expect(result).toEqual({ newState: 'idle', shouldStartSynth: false });
    expect(latch.state).toBe('idle');
  });

  test('queued + synthComplete → synthesizing, shouldStartSynth', () => {
    latch.requestSynth();
    latch.requestSynth();
    const result = latch.synthComplete();
    expect(result).toEqual({ newState: 'synthesizing', shouldStartSynth: true });
    expect(latch.state).toBe('synthesizing');
  });

  test('idle + synthComplete → idle, no synth (no-op)', () => {
    const result = latch.synthComplete();
    expect(result).toEqual({ newState: 'idle', shouldStartSynth: false });
    expect(latch.state).toBe('idle');
  });

  test('full cycle: request → complete → request → request → complete → complete', () => {
    expect(latch.requestSynth().shouldStartSynth).toBe(true);
    expect(latch.synthComplete().shouldStartSynth).toBe(false);
    expect(latch.state).toBe('idle');

    expect(latch.requestSynth().shouldStartSynth).toBe(true);
    expect(latch.requestSynth().shouldStartSynth).toBe(false);
    expect(latch.state).toBe('queued');

    expect(latch.synthComplete().shouldStartSynth).toBe(true);
    expect(latch.state).toBe('synthesizing');

    expect(latch.synthComplete().shouldStartSynth).toBe(false);
    expect(latch.state).toBe('idle');
  });
});
