/**
 * Interface for all Telemetry Clients.
 *
 * A telemtry client receives event data and determines
 * when and where to send it.
 */
export interface ITelemetryClient<T> {
  /**
   * Add event data to the client
   */
  addEvent(event: T): Promise<boolean>;

  /**
   * Send event data stored in the client to the endpoint.
   */
  flush(): Promise<void>;
}
