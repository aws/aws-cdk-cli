import { RequireApproval } from '../../../require-approval';
import type { IIoHost } from '../../io-host';
import type { IoMessage, IoMessageLevel, IoRequest } from '../../io-message';
import type { IoHelper } from '../io-helper';
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
export declare class TestIoHost implements IIoHost {
    level: IoMessageLevel;
    readonly notifySpy: jest.Mock<any, any, any>;
    readonly requestSpy: jest.Mock<any, any, any>;
    requireDeployApproval: RequireApproval;
    constructor(level?: IoMessageLevel);
    asHelper(action?: string): IoHelper;
    notify(msg: IoMessage<unknown>): Promise<void>;
    requestResponse<T, U>(msg: IoRequest<T, U>): Promise<U>;
    private needsApproval;
}
