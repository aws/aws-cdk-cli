import type { TelemetrySchema } from '../schema';
import type { ITelemetrySink } from './sink-interface';

export interface FunnelProps {
  readonly sinks: ITelemetrySink[];
}

export class Funnel {
  private readonly sinks: ITelemetrySink[];

  constructor(props: FunnelProps) {
    this.sinks = props.sinks;
  }

  public async emit(event: TelemetrySchema): Promise<void> {
    // There is a limited set of sinks
    // eslint-disable-next-line @cdklabs/promiseall-no-unbounded-parallelism
    await Promise.all(this.sinks.map(sink => sink.emit(event)));
  }

  public async flush(): Promise<void> {
    // There is a limited set of sinks
    // eslint-disable-next-line @cdklabs/promiseall-no-unbounded-parallelism
    await Promise.all(this.sinks.map(sink => sink.flush()));
  }
}
