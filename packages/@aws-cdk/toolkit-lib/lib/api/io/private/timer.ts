import { format } from 'util';
import { IO } from './messages';
import { formatTime } from '../../../private/util';
import type { IoHelper } from '../../shared-private';

/**
 * Helper class to measure the time of code.
 */
export class Timer {
  /**
   * Start the timer.
   * @return the timer instance
   */
  public static start(): Timer {
    return new Timer();
  }

  private readonly startTime: number;

  private constructor() {
    this.startTime = new Date().getTime();
  }

  /**
   * End the current timer.
   * @returns the elapsed time
   */
  public end() {
    const elapsedTime = new Date().getTime() - this.startTime;
    return {
      asMs: elapsedTime,
      asSec: formatTime(elapsedTime),
    };
  }

  /**
   * Ends the current timer as a specified timing and notifies the IoHost.
   * @returns the elapsed time
   */
  public async endAs(ioHost: IoHelper, type: 'synth' | 'deploy' | 'rollback' | 'destroy' | 'bootstrap') {
    const duration = this.end();
    await ioHost.notify(timerMessage(type, duration));
    return duration;
  }
}

function timerMessage(type: 'synth' | 'deploy' | 'rollback'| 'destroy' | 'bootstrap', duration: {
  asMs: number;
  asSec: number;
}) {
  const message = `\n✨  %s time: ${duration.asSec}s\n`;
  const payload = { duration: duration.asMs };

  switch (type) {
    case 'synth': return IO.CDK_TOOLKIT_I1000.msg(format(message, 'Synthesis'), payload);
    case 'deploy': return IO.CDK_TOOLKIT_I5000.msg(format(message, 'Deployment'), payload);
    case 'rollback': return IO.CDK_TOOLKIT_I6000.msg(format(message, 'Rollback'), payload);
    case 'destroy': return IO.CDK_TOOLKIT_I7000.msg(format(message, 'Destroy'), payload);
    case 'bootstrap': return IO.CDK_TOOLKIT_I9000.msg(format(message, 'Bootstrap'), payload);
  }
}
