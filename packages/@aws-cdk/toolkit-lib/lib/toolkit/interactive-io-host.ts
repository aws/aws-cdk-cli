import * as util from 'node:util';
import { IIoHost, IoMessage, IoMessageLevel, IoRequest } from '../api';
import { PermissionChangeType } from '../payloads';
import { isCI, isTTY } from '../util/shell-env';
import * as promptly from 'promptly';
import * as chalk from 'chalk';
import { RequireApproval } from '@aws-cdk/cloud-assembly-schema';

type IoRequestMessage = IoRequest<
  | {
      permissionChangeType: PermissionChangeType;
      motivation?: string;
      concurrency?: number;
      responseDescription?: string;
    }
  | undefined,
  unknown
>;

export interface InteractiveIoHostProps {
  /**
   * Determines the verbosity of the output.
   *
   * The IoHost will still receive all messages and requests,
   * but only the messages included in this level will be printed.
   *
   * @default 'info'
   */
  readonly logLevel?: IoMessageLevel;

  /**
   * Overrides the automatic TTY detection.
   *
   * When TTY is disabled, the CLI will have no interactions or color.
   *
   * @default - Determined from the current process
   */
  readonly isTTY?: boolean;

  /**
   * Whether the IoHost is running in CI mode.
   *
   * In CI mode, all non-error output goes to stdout instead of stderr.
   * Set to false in the IoHost constructor it will be overwritten if the CLI CI argument is passed
   *
   * @default - Determined from the environment, specifically based on `process.env.CI`
   */
  readonly isCI?: boolean;

  /**
   * In what scenarios should the Toolkit Lib ask for approval
   * @default RequireApproval.BROADENING
   */
  readonly requireApproval?: RequireApproval;
}

export class InteractiveIoHost implements IIoHost {
  /**
   * Whether the IoHost is running in CI mode.
   *
   * In CI mode, all non-error output goes to stdout instead of stderr.
   */
  public readonly isCI: boolean;

  /**
   * Whether the host can use interactions and message styling.
   */
  public readonly isTTY: boolean;

  /**
   * The current threshold.
   *
   * Messages with a lower priority level will be ignored.
   */
  public readonly logLevel: IoMessageLevel;

  private readonly requireDeployApproval: RequireApproval;

  constructor(props: InteractiveIoHostProps = {}) {
    this.logLevel = props.logLevel ?? 'info';
    this.isTTY = props.isTTY ?? isTTY();
    this.isCI = props.isCI ?? isCI();
    this.requireDeployApproval = props?.requireApproval ?? RequireApproval.BROADENING;
  }

  /**
   * Notifies the host of a message.
   * The caller waits until the notification completes.
   */
  public async notify(msg: IoMessage<unknown>): Promise<void> {}

  /**
   * Notifies the host of a message that requires a response.
   *
   * If the host does not return a response the suggested
   * default response from the input message will be used.
   */
  public async requestResponse<DataType, ResponseType>(msg: IoRequest<DataType, ResponseType>): Promise<ResponseType> {
    const message = msg as IoRequestMessage;

    if (this.skipApprovalStep(message)) return true as ResponseType;

    // If defaultResponse is not a boolean, the prompt information is extracted and displayed, waiting for user input. The user's response is then converted and returned.
    if (typeof msg.defaultResponse !== 'boolean') {
      const prompt = this.extractPromptInfo(message);
      const desc = message.data?.responseDescription ?? prompt.default;
      const answer = await promptly.prompt(`${chalk.cyan(msg.message)}${desc ? ` (${desc})` : ''}`, {
        default: prompt.default,
        trim: true,
      });
      const finalAnswer = answer.trim() || prompt.default;
      return prompt.convertAnswer(finalAnswer) as ResponseType;
    }

    // If defaultResponse is a boolean, displays a message asking for authorisation and waits for user input.
    const confirmed = await promptly.confirm(`${chalk.cyan(msg.message)} (y/n)`);
    if (!confirmed) throw new Error('Aborted by user');
    return confirmed as ResponseType;
  }

  /**
   * Detect special messages encode information about whether or not
   * they require approval
   */
  private skipApprovalStep(msg: IoRequestMessage): boolean {
    const approvalToolkitCodes = ['CDK_TOOLKIT_I5060'];
    if (!approvalToolkitCodes.includes(msg.code)) return false;

    switch (this.requireDeployApproval) {
      // Never require approval
      case RequireApproval.NEVER:
        return true;
      // Always require approval
      case RequireApproval.ANYCHANGE:
        return false;
      // Require approval if changes include broadening permissions
      case RequireApproval.BROADENING:
        return ['none', 'non-broadening'].includes(msg.data?.permissionChangeType ?? '');
    }
  }

  /**
   * Helper to extract information for promptly from the request
   * @returns An object containing prompt information
   */
  private extractPromptInfo(request: IoRequest<unknown, unknown>): {
    default: string;
    defaultDesc: string;
    convertAnswer: (input: string) => string | number;
  } {
    const defaultResponse = util.format(request.defaultResponse);
    return {
      default: defaultResponse,
      defaultDesc:
        'defaultDescription' in request && request.defaultDescription
          ? util.format(request.defaultDescription)
          : defaultResponse,
      convertAnswer: typeof request.defaultResponse === 'number' ? (v) => Number(v) : (v) => String(v),
    };
  }
}
