import type { Logger } from '@smithy/types';
export declare function setSdkTracing(enabled: boolean): void;
/**
 * Method decorator to trace a single static or member method, any time it's called
 */
export declare function callTrace(fn: string, className?: string, logger?: Logger): void;
/**
 * Class decorator, enable tracing for all member methods on this class
 * @deprecated this doesn't work well with localized logging instances, don't use
 */
export declare function traceMemberMethods(constructor: Function): void;
