import type { IIoHost, IoMessage, IoMessageLevel, IoRequest } from '../../lib';
import { RequireApproval } from '../../lib';
import { isMessageRelevantForLevel } from '../../lib/api/shared-private';

/**
 * A test implementation of IIoHost that does nothing but can by spied on.
 * Optionally set a level to filter out all irrelevant messages.
 * Optionally set a approval level.
 */
export class TestIoHost implements IIoHost {
  public readonly notifySpy: jest.Mock<any, any, any>;
  public readonly requestSpy: jest.Mock<any, any, any>;

  public requireDeployApproval = RequireApproval.NEVER;

  constructor(public level: IoMessageLevel = 'info') {
    this.notifySpy = jest.fn();
    this.requestSpy = jest.fn();
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
