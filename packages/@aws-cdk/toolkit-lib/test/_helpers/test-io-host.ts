import type { IIoHost, IoMessage, IoMessageLevel, IoRequest } from '../../lib/api/io';
import type { IoHelper } from '../../lib/api/io/private';
import { asIoHelper, isMessageRelevantForLevel } from '../../lib/api/io/private';
import { RequireApproval } from '../../lib/api/require-approval';

/**
 * A test implementation of IIoHost that does nothing but can be spied on.
 *
 * Includes a level to filter out irrelevant messages, defaults to `info`.
 *
 * Optionally set an approval level for code `CDK_TOOLKIT_I5060`.
 *
 * # How to use
 *
 * Configure and reset the `notifySpy` and `requestSpy` members as you would any
 * mock function.
 */
export class TestIoHost implements IIoHost {
  public readonly notifySpy: jest.Mock<any, any, any>;
  public readonly requestSpy: jest.Mock<any, any, any>;

  public requireDeployApproval = RequireApproval.NEVER;

  constructor(public level: IoMessageLevel = 'info') {
    this.notifySpy = jest.fn();
    this.requestSpy = jest.fn();
  }

  public asHelper(action = 'synth'): IoHelper {
    return asIoHelper(this, action as any);
  }

  public async notify(msg: IoMessage<unknown>): Promise<void> {
    if (isMessageRelevantForLevel(msg, this.level)) {
      this.notifySpy(msg);
    }
  }

  public async requestResponse<T, U>(msg: IoRequest<T, U>): Promise<U> {
    if (isMessageRelevantForLevel(msg, this.level) && this.needsApproval(msg)) {
      this.requestSpy(msg);
    }
    return msg.defaultResponse;
  }

  private needsApproval(msg: IoRequest<any, any>): boolean {
    // Return true if the code is unrelated to approval
    if (!['CDK_TOOLKIT_I5060'].includes(msg.code)) {
      return true;
    }

    switch (this.requireDeployApproval) {
      case RequireApproval.NEVER:
        return false;
      case RequireApproval.ANY_CHANGE:
        return true;
      case RequireApproval.BROADENING:
        return msg.data?.permissionChangeType === 'broadening';
      default:
        return true;
    }
  }
}
