import type { IoMessage, IoMessageCode, IoMessageLevel } from '@aws-cdk/toolkit-lib';

export interface MessageFilter {
  level?: IoMessageLevel;
  action?: string;
  code?: IoMessageCode;
}

export interface MessageListener {
  off(): void;
}

export interface ListenerOptions {
  /**
   * Prevent execution of default events for this message.
   */
  readonly preventDefault?: boolean;
}

type ListenerFunction = (message: IoMessage<unknown>) => void;

interface InternalListener {
  filter: MessageFilter;
  fn: ListenerFunction;
  type: 'on' | 'once';
  preventDefault: boolean;
}

export class IoEventEmitter {
  private listeners: InternalListener[] = [];

  /**
   *
   * @returns whether to stop processing
   */
  protected async emit(message: IoMessage<unknown>): Promise<boolean> {
    const toRemove: InternalListener[] = [];

    let stop = false;

    for (const listener of this.listeners) {
      if (this.matches(message, listener.filter)) {
        await listener.fn(message);
        if (listener.type === 'once') {
          toRemove.push(listener);
        }
        if (listener.preventDefault) {
          stop = true;
        }
      }
    }

    // Remove 'once' listeners that have been called
    for (const listener of toRemove) {
      const index = this.listeners.indexOf(listener);
      if (index !== -1) {
        this.listeners.splice(index, 1);
      }
    }

    return stop;
  }

  public on(filter: MessageFilter, fn: ListenerFunction, options: ListenerOptions = {}): MessageListener {
    return this.addListener('on', filter, fn, options);
  }

  public once(filter: MessageFilter, fn: ListenerFunction, options: ListenerOptions = {}): MessageListener {
    return this.addListener('once', filter, fn, options);
  }

  public any(fn: ListenerFunction, options: ListenerOptions = {}): MessageListener {
    return this.addListener('on', {}, fn, options);
  }

  public many(filters: MessageFilter[], fn: ListenerFunction, options: ListenerOptions = {}): MessageListener {
    const added: MessageListener[] = [];
    for (const filter of filters) {
      added.push(this.addListener('on', filter, fn, options));
    }

    return {
      off: () => added.forEach(l => l.off()),
    };
  }

  private addListener(type: 'on' | 'once', filter: MessageFilter, fn: ListenerFunction, options: ListenerOptions = {}): MessageListener {
    const listener: InternalListener = { filter, fn, type, preventDefault: options.preventDefault ?? false };
    this.listeners.push(listener);

    return {
      off: () => {
        const index = this.listeners.indexOf(listener);
        if (index !== -1) {
          this.listeners.splice(index, 1);
        }
      },
    };
  }

  private matches(message: IoMessage<unknown>, filter: MessageFilter): boolean {
    if (filter.level && message.level !== filter.level) {
      return false;
    }
    if (filter.action && message.action !== filter.action) {
      return false;
    }
    if (filter.code && message.code !== filter.code) {
      return false;
    }
    return true;
  }
}
