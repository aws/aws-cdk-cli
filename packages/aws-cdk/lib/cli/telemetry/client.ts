import { request } from 'https';
import * as fs from 'fs';
import * as path from 'path';

export interface TelemetryClientProps {
  readonly endpoint: URL;
  readonly localFilePath: string;
}

export class TelemetryClient {
  private endpoint: URL;
  private filePath: string;

  public constructor(props: TelemetryClientProps) {
    this.endpoint = props.endpoint;
    this.filePath = props.localFilePath;

    // Ensure the directory exists
    const directory = path.dirname(this.filePath);
    if (!fs.existsSync(directory)) {
      fs.mkdirSync(directory, { recursive: true });
    }
  }

  public async sendData(data: any) {
    // Save data locally first
    await this.saveData(data);
    // Then send it to the endpoint
    return this.https(this.endpoint, data);
  }

  private async https(
    url: URL,
    body: any, // to be schema
  ): Promise<void> {
    // TODO: Handle retries and stuff
    return requestPromise(url, body);
  }

  private async saveData(data: any): Promise<void> {
    try {
      // Read existing data if file exists
      let existingData: any[] = [];
      if (fs.existsSync(this.filePath)) {
        try {
          const fileContent = fs.readFileSync(this.filePath, 'utf8');
          existingData = JSON.parse(fileContent);
          if (!Array.isArray(existingData)) {
            existingData = [existingData];
          }
        } catch (err) {
          // If file exists but can't be parsed, start with empty array
          existingData = [];
        }
      }
      
      // Add new data to existing data
      existingData.push(data);
      
      // Write combined data back to file
      fs.writeFileSync(this.filePath, JSON.stringify(existingData, null, 2), 'utf8');
    } catch (err) {
      /* noop */
    }
  }
}

/**
 * A Promisified version of `https.request()`
 */
function requestPromise(
  url: URL,
  data: any // to be schema
) {
  return new Promise<void>((resolve) => {
    const payload: string = JSON.stringify(data);
    const req = request({
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': payload.length,
      },
    });
    req.on('error', () => {
      /* noop */
    });
    req.setTimeout(2000, () => {
      // 2 seconds
      resolve();
    });

    req.write(payload);
    req.end(() => {
      resolve();
    });
  });
}
