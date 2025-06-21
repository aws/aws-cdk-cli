import type { TelemetrySchema } from './schema';

/**
 * Interface for all Telemetry Clients.
 *
 * A telemtry client receives event data and determines
 * when and where to send it.
 */
export interface ITelemetryClient {
  /**
   * Send data to the client
   */
  emit(event: TelemetrySchema): Promise<boolean>;
}
