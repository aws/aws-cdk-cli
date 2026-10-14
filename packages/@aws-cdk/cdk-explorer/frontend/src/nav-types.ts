export type NavigateTrigger = 'tree' | 'diagnostic' | 'source' | 'template';

export interface NavigateEvent {
  trigger: NavigateTrigger;
  constructPath: string;
}

export type NavigateHandler = (opts: NavigateEvent) => void;
