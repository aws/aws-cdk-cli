import { ToolkitError } from '@aws-cdk/toolkit-lib';
import type { TelemetrySchema } from '../schema';
import type { ITelemetrySink } from './sink-interface';

export interface FunnelProps {
  readonly sinks: ITelemetrySink[];
}

/**
 * A funnel is a combination of one or more sinks.
 * The sink functions are executed in parallel, and a maximum of 5
 * sinks are supported per funnel.
 */
export class Funnel {
  private readonly sinks: ITelemetrySink[];

  constructor(props: FunnelProps) {
    if (props.sinks.length > 5) {
      throw new ToolkitError(`Funnel class supports a maximum of 5 parallel sinks, got ${props.sinks.length} sinks.`);
    }

    this.sinks = props.sinks;
  }

  public async emit(event: TelemetrySchema): Promise<void> {
    // Funnel class enforces a maximum of 5 parallel sinks
    // eslint-disable-next-line @cdklabs/promiseall-no-unbounded-parallelism
    await Promise.all(this.sinks.map(sink => sink.emit(event)));
  }

  public async flush(): Promise<void> {
    // Funnel class enforces a maximum of 5 parallel sinks
    // eslint-disable-next-line @cdklabs/promiseall-no-unbounded-parallelism
    await Promise.all(this.sinks.map(sink => sink.flush()));
  }
}
