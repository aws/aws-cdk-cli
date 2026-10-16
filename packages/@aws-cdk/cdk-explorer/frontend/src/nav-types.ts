import type { WebSourceLocation, WebTemplateLocation } from '../../lib/web-shared/protocol';

export type NavigateTrigger = 'tree' | 'diagnostic' | 'source' | 'template';

export interface NavigateEvent {
  trigger: NavigateTrigger;
  constructPath: string;
  sourceLocation?: WebSourceLocation;
  templateLocation?: WebTemplateLocation;
}

export type NavigateHandler = (opts: NavigateEvent) => void;
