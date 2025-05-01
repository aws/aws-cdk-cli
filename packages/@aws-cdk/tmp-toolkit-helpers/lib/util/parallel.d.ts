/**
 * Run a number of promise generators with max parallelism
 *
 * Order is not maintained between the input and output.
 */
export declare function parallelPromises<A>(n: number, promises: Array<() => Promise<A>>): Promise<Array<A>>;
