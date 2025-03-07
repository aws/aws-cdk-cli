
import { inspect } from 'util';
import type { Logger } from '@smithy/types';
import { IO } from './messages';
import { replacerBufferWithInfo } from '../../../private/util';
import type { IoHelper } from '../../shared-private';

/**
 * An SDK logging trace.
 *
 * Only info, warn and error level messages are emitted.
 * SDK traces are emitted as traces to the IoHost, but contain the original SDK logging level.
 */
export interface SdkTrace {
  /**
   * The level the SDK has emitted the original message with
   */
  readonly sdkLevel: 'info' | 'warn' | 'error';

  /**
   * The content of the SDK trace
   *
   * This will include the request and response data for API calls, including potentially sensitive information.
   *
   * @see https://docs.aws.amazon.com/sdk-for-javascript/v3/developer-guide/logging-sdk-calls.html
   */
  readonly content: any;
}

export function asSdkLogger(ioHost: IoHelper): Logger {
  return new class implements Logger {
    // This is too much detail for our logs
    public trace(..._content: any[]) {
    }
    public debug(..._content: any[]) {
    }

    /**
     * Info is called mostly (exclusively?) for successful API calls
     *
     * Payload:
     *
     * (Note the input contains entire CFN templates, for example)
     *
     * ```
     * {
     *   clientName: 'S3Client',
     *   commandName: 'GetBucketLocationCommand',
     *   input: {
     *     Bucket: '.....',
     *     ExpectedBucketOwner: undefined
     *   },
     *   output: { LocationConstraint: 'eu-central-1' },
     *   metadata: {
     *     httpStatusCode: 200,
     *     requestId: '....',
     *     extendedRequestId: '...',
     *     cfId: undefined,
     *     attempts: 1,
     *     totalRetryDelay: 0
     *   }
     * }
     * ```
     */
    public info(...content: any[]) {
      void ioHost.notify(IO.CDK_SDK_I0100.msg(`[sdk info] ${formatSdkLoggerContent(content)}`, {
        sdkLevel: 'info',
        content,
      }));
    }

    public warn(...content: any[]) {
      void ioHost.notify(IO.CDK_SDK_I0100.msg(`[sdk warn] ${formatSdkLoggerContent(content)}`, {
        sdkLevel: 'warn',
        content,
      }));
    }

    /**
     * Error is called mostly (exclusively?) for failing API calls
     *
     * Payload (input would be the entire API call arguments).
     *
     * ```
     * {
     *   clientName: 'STSClient',
     *   commandName: 'GetCallerIdentityCommand',
     *   input: {},
     *   error: AggregateError [ECONNREFUSED]:
     *       at internalConnectMultiple (node:net:1121:18)
     *       at afterConnectMultiple (node:net:1688:7) {
     *     code: 'ECONNREFUSED',
     *     '$metadata': { attempts: 3, totalRetryDelay: 600 },
     *     [errors]: [ [Error], [Error] ]
     *   },
     *   metadata: { attempts: 3, totalRetryDelay: 600 }
     * }
     * ```
     */
    public error(...content: any[]) {
      void ioHost.notify(IO.CDK_SDK_I0100.msg(`[sdk error] ${formatSdkLoggerContent(content)}`, {
        sdkLevel: 'error',
        content,
      }));
    }
  };
}

/**
 * This can be anything.
 *
 * For debug, it seems to be mostly strings.
 * For info, it seems to be objects.
 *
 * Stringify and join without separator.
 */
function formatSdkLoggerContent(content: any[]) {
  if (content.length === 1) {
    const apiFmt = formatApiCall(content[0]);
    if (apiFmt) {
      return apiFmt;
    }
  }
  return content.map((x) => typeof x === 'string' ? x : inspect(x)).join('');
}

function formatApiCall(content: any): string | undefined {
  if (!isSdkApiCallSuccess(content) && !isSdkApiCallError(content)) {
    return undefined;
  }

  const service = content.clientName.replace(/Client$/, '');
  const api = content.commandName.replace(/Command$/, '');

  const parts = [];
  if ((content.metadata?.attempts ?? 0) > 1) {
    parts.push(`[${content.metadata?.attempts} attempts, ${content.metadata?.totalRetryDelay}ms retry]`);
  }

  parts.push(`${service}.${api}(${JSON.stringify(content.input, replacerBufferWithInfo)})`);

  if (isSdkApiCallSuccess(content)) {
    parts.push('-> OK');
  } else {
    parts.push(`-> ${content.error}`);
  }

  return parts.join(' ');
}

interface SdkApiCallBase {
  clientName: string;
  commandName: string;
  input: Record<string, unknown>;
  metadata?: {
    httpStatusCode?: number;
    requestId?: string;
    extendedRequestId?: string;
    cfId?: string;
    attempts?: number;
    totalRetryDelay?: number;
  };
}

type SdkApiCallSuccess = SdkApiCallBase & { output: Record<string, unknown> };
type SdkApiCallError = SdkApiCallBase & { error: Error };

function isSdkApiCallSuccess(x: any): x is SdkApiCallSuccess {
  return x && typeof x === 'object' && x.commandName && x.output;
}

function isSdkApiCallError(x: any): x is SdkApiCallError {
  return x && typeof x === 'object' && x.commandName && x.error;
}
