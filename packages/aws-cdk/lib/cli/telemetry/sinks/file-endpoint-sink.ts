import { EndpointTelemetrySink, EndpointTelemetrySinkProps } from "../endpoint-sink";
import { FileTelemetrySink, FileTelemetrySinkProps } from "../file-sink";
import { TelemetrySchema } from "../schema";

export interface FileEndpointTelemetrySinkProps extends FileTelemetrySinkProps, EndpointTelemetrySinkProps {}

export class FileEndpointTelemetrySink {
  private fileSink: FileTelemetrySink;
  private endpointSink: EndpointTelemetrySink;

  constructor(props: FileEndpointTelemetrySinkProps) {
    this.fileSink = new FileTelemetrySink(props);
    this.endpointSink = new EndpointTelemetrySink(props);
  }

  public async emit(event: TelemetrySchema): Promise<void> {
    await this.fileSink.emit(event);
    await this.endpointSink.emit(event);
  }

  public async flush(): Promise<void> {
    await this.fileSink.flush();
    await this.endpointSink.flush();
  }
}
