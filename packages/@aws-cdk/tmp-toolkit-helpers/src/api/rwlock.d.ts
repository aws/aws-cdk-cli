/**
 * A single-writer/multi-reader lock on a directory
 *
 * It uses marker files with PIDs in them as a locking marker; the PIDs will be
 * checked for liveness, so that if the process exits without cleaning up the
 * files the lock is implicitly released.
 *
 * This class is not 100% race safe, but in practice it should be a lot
 * better than the 0 protection we have today.
 */
export declare class RWLock {
    readonly directory: string;
    private readonly pidString;
    private readonly writerFile;
    private readCounter;
    constructor(directory: string);
    /**
     * Acquire a writer lock.
     *
     * No other readers or writers must exist for the given directory.
     */
    acquireWrite(): Promise<IWriterLock>;
    /**
     * Acquire a read lock
     *
     * Will fail if there are any writers.
     */
    acquireRead(): Promise<ILock>;
    /**
     * Obtains the name fo a (new) `readerFile` to use. This includes a counter so
     * that if multiple threads of the same PID attempt to concurrently acquire
     * the same lock, they're guaranteed to use a different reader file name (only
     * one thread will ever execute JS code at once, guaranteeing the readCounter
     * is incremented "atomically" from the point of view of this PID.).
     */
    private readerFile;
    /**
     * Do the actual acquiring of a read lock.
     */
    private doAcquireRead;
    private assertNoOtherWriters;
    /**
     * Check the current writer (if any)
     */
    private currentWriter;
    /**
     * Check the current readers (if any)
     */
    private currentReaders;
}
/**
 * An acquired lock
 */
export interface ILock {
    release(): Promise<void>;
}
/**
 * An acquired writer lock
 */
export interface IWriterLock extends ILock {
    /**
     * Convert the writer lock to a reader lock
     */
    convertToReaderLock(): Promise<ILock>;
}
