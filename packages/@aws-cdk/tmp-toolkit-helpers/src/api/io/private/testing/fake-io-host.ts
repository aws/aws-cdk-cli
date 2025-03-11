import { IIoHost } from "../../io-host";
import { IoMessage, IoMessageLevel, IoRequest } from "../../io-message";

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

  public expectMessage(m: { containing: string, level?: IoMessageLevel }) {
    expect(this.messages).toContainEqual(expect.objectContaining({
      ...m.level ? { level: m.level } : undefined,
      // Can be a partial string as well
      message: expect.stringContaining(m.containing),
    }));
  }
}
