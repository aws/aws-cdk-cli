import { IIoHost, IoMessage, IoMessageLevel, IoRequest, RequireApproval } from '../../lib';
import { isMessageRelevantForLevel } from '../../lib/api/io/private/level-priority';

/**
 * A test implementation of IIoHost that does nothing but can by spied on.
 * Optionally set a level to filter out all irrelevant messages.
 * Optionally set a approval level. 
 */
export class TestIoHost implements IIoHost {
  public readonly notifySpy: jest.Mock<any, any, any>;
  public readonly requestSpy: jest.Mock<any, any, any>;

  public requireApproval: RequireApproval;
  
  constructor(public level: IoMessageLevel = 'info') {
    this.notifySpy = jest.fn();
    this.requestSpy = jest.fn();
  }

  public async notify<T>(msg: IoMessage<T>): Promise<void> {
    if (isMessageRelevantForLevel(msg, this.level)) {
      this.notifySpy(msg);
    }
  }

  public async requestResponse<T, U>(msg: IoRequest<T, U>): Promise<U> {
    if (isMessageRelevantForLevel(msg, this.level)) {
      this.requestSpy(msg);
    }
    return msg.defaultResponse;
  }
}
