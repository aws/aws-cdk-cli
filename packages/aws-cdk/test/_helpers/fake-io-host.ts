import { IIoHost, IoMessage, IoMessageLevel, IoRequest } from "../../../@aws-cdk/tmp-toolkit-helpers/src/api/io";

/**
 * An implementation of `IIoHost` that records messages and lets you assert on what was logged
 *
 * It's like `TestIoHost`, but comes with a predefined implementation for `notify`
 * that appends all messages to an in-memory array, and comes with a helper function
 * `expectMessage()` to test for the existence of a function in that array.
 *
 * Has a public mock for `requestResponse` that you configure like any
 * other mock function.
 *
 * # How to use
 *
 * Either create a new instance of this class for every test, or call `clear()`
 * on it between runs.
 */
export class FakeIoHost implements IIoHost {
  public messages: Array<IoMessage<unknown>> = [];
  public requestResponse!: <T, U>(msg: IoRequest<T, U>) => Promise<U>;

  constructor() {
    this.clear();
  }

  public clear() {
    this.messages.splice(0, this.messages.length);
    this.requestResponse = jest.fn().mockRejectedValue(new Error('requestResponse not mocked'));
  }

  public async notify(msg: IoMessage<unknown>): Promise<void> {
    this.messages.push(msg);
  }

  public expectMessage(m: { containing: string; level?: IoMessageLevel }) {
    expect(this.messages).toContainEqual(expect.objectContaining({
      ...m.level ? { level: m.level } : undefined,
      // Can be a partial string as well
      message: expect.stringContaining(m.containing),
    }));
  }
}
