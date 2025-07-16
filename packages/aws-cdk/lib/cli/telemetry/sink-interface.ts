import type { TelemetrySchema } from './schema';

/**
 * All Telemetry Clients are Sinks.
 *
 * A telemtry client receives event data via 'emit'
 * and sends batched events via 'flush'
 */
export interface ITelemetrySink {
  /**
   * Recieve an event
   */
  emit(event: TelemetrySchema): Promise<void>;

  /**
   * If the implementer of ITelemetrySink batches events,
   * flush sends the data and clears the cache.
   */
  flush(): Promise<void>;
}
