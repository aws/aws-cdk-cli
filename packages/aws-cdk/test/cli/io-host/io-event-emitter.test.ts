import { IoEventEmitter, MessageFilter } from '../../../lib/cli/io-host/io-event-emitter';
import type { IoMessage } from '@aws-cdk/toolkit-lib';

describe('IoEventEmitter', () => {
  let emitter: IoEventEmitter;
  let mockMessage: IoMessage<unknown>;

  beforeEach(() => {
    emitter = new IoEventEmitter();
    mockMessage = {
      time: new Date(),
      level: 'info',
      action: 'deploy',
      code: 'CDK_TOOLKIT_I0001',
      message: 'Test message',
      data: {}
    };
  });

  test('on listener receives matching messages', () => {
    const fn = jest.fn();
    const filter: MessageFilter = { level: 'info' };
    
    emitter.on(filter, fn);
    (emitter as any).emit(mockMessage);
    
    expect(fn).toHaveBeenCalledWith(mockMessage);
  });

  test('once listener receives message only once', () => {
    const fn = jest.fn();
    const filter: MessageFilter = { level: 'info' };
    
    emitter.once(filter, fn);
    (emitter as any).emit(mockMessage);
    (emitter as any).emit(mockMessage);
    
    expect(fn).toHaveBeenCalledTimes(1);
  });

  test('listener can be removed with off()', () => {
    const fn = jest.fn();
    const filter: MessageFilter = { level: 'info' };
    
    const listener = emitter.on(filter, fn);
    listener.off();
    (emitter as any).emit(mockMessage);
    
    expect(fn).not.toHaveBeenCalled();
  });

  test('filter matches correctly', () => {
    const fn = jest.fn();
    const filter: MessageFilter = { level: 'error', action: 'deploy' };
    
    emitter.on(filter, fn);
    (emitter as any).emit(mockMessage); // level: 'info', action: 'deploy'
    
    expect(fn).not.toHaveBeenCalled();
    
    const errorMessage = { ...mockMessage, level: 'error' as const };
    (emitter as any).emit(errorMessage);
    
    expect(fn).toHaveBeenCalledWith(errorMessage);
  });

  test('empty filter matches all messages', () => {
    const fn = jest.fn();
    const filter: MessageFilter = {};
    
    emitter.on(filter, fn);
    (emitter as any).emit(mockMessage);
    
    expect(fn).toHaveBeenCalledWith(mockMessage);
  });
});