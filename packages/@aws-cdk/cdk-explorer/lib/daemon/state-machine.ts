export type SynthState = 'idle' | 'synthesizing' | 'queued';

export interface TransitionResult {
  readonly newState: SynthState;
  readonly shouldStartSynth: boolean;
}

export class SynthLatch {
  private _state: SynthState = 'idle';

  public get state(): SynthState {
    return this._state;
  }

  public requestSynth(): TransitionResult {
    switch (this._state) {
      case 'idle':
        this._state = 'synthesizing';
        return { newState: 'synthesizing', shouldStartSynth: true };
      case 'synthesizing':
        this._state = 'queued';
        return { newState: 'queued', shouldStartSynth: false };
      case 'queued':
        return { newState: 'queued', shouldStartSynth: false };
    }
  }

  public synthComplete(): TransitionResult {
    switch (this._state) {
      case 'idle':
        return { newState: 'idle', shouldStartSynth: false };
      case 'synthesizing':
        this._state = 'idle';
        return { newState: 'idle', shouldStartSynth: false };
      case 'queued':
        this._state = 'synthesizing';
        return { newState: 'synthesizing', shouldStartSynth: true };
    }
  }
}
