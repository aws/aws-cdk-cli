import { when } from 'jest-when';
import type { IIoHost, IoMessage, IoMessageCode, IoMessageLevel, IoRequest } from '../../lib/api/io';
import type { IoHelper } from '../../lib/api/io/private';
import { asIoHelper, isMessageRelevantForLevel } from '../../lib/api/io/private';

type MessageMock = jest.Mock<void, [IoMessage<any>]>;
type RequestMock<U extends any> = jest.Mock<U, [IoRequest<any, U>]>;

/**
 * An implementation of `IIoHost` that records messages,
 * lets you assert on what was logged and can be spied on.
 *
 * Includes a level to filter out irrelevant messages, defaults to `info`.
 *
 * It comes with a predefined implementation for `notify`
 * that appends all messages to an in-memory array, and comes with a helper function
 * `expectMessage()` to test for the existence of a function in that array.
 *
 * # How to use
 *
 * Either create a new instance of this class for every test, or call `clear()`
 * on it between runs.
 *
 * Configure and reset the `notifySpy` and `requestSpy` members as you would any
 * mock function.
 */
export class TestIoHost implements IIoHost {
  public messages: Array<IoMessage<unknown>> = [];
  public readonly notifySpy: MessageMock;
  public readonly requestSpy: RequestMock<any>;

  constructor(public level: IoMessageLevel = 'info') {
    this.notifySpy = jest.fn();
    this.requestSpy = jest.fn();
    this.clear();
  }

  public clear() {
    this.messages.splice(0, this.messages.length);
    this.notifySpy.mockClear();
    this.requestSpy.mockClear();
  }

  public asHelper(action = 'synth'): IoHelper {
    return asIoHelper(this, action as any);
  }

  public async notify(msg: IoMessage<unknown>): Promise<void> {
    if (isMessageRelevantForLevel(msg, this.level)) {
      this.messages.push(msg);
      this.notifySpy(msg);
    }
  }

  public async requestResponse<T, U>(msg: IoRequest<T, U>): Promise<U> {
    let spyResponse;
    if (isMessageRelevantForLevel(msg, this.level)) {
      spyResponse = await this.requestSpy(msg);
    }
    return spyResponse ?? msg.defaultResponse;
  }

  public expectMessage(m: { containing: string; level?: IoMessageLevel }) {
    expect(this.messages).toContainEqual(expect.objectContaining({
      ...m.level ? { level: m.level } : undefined,
      // Can be a partial string as well
      message: expect.stringContaining(m.containing),
    }));
  }

  /**
   * Mocks the response for a given message code.
   *
   * Use `requestSpy.mockReset()` to remove mock.
   */
  public mockResponse(code: IoMessageCode, response: any) {
    when(this.requestSpy)
      .calledWith(expect.objectContaining({ code }))
      .mockResolvedValue(response);
  }

  /**
   * Mocks the response for a given message code, only once.
   *
   * Use `requestSpy.mockReset()` to remove mock.
   */
  public mockResponseOnce(code: IoMessageCode, response: any) {
    when(this.requestSpy)
      .calledWith(expect.objectContaining({ code }))
      .mockResolvedValueOnce(response);
  }
}
