import { format } from 'util';
import * as uuid from 'uuid';
import { CODES } from './codes';
import { formatTime } from '../../../util';
import { ActionAwareIoHost } from '../../io/private';

type MarkerType = 'synth' | 'deploy' | 'rollback' | 'destroy' | 'bootstrap' | 'build-asset';

/**
 * Helper class to mark task blocks
 */
export class Marker {
  public readonly ioHost: ActionAwareIoHost;
  public readonly type: MarkerType;

  private constructor(ioHost: ActionAwareIoHost, type: MarkerType ) {
    this.type = type;
    this.ioHost = ioHost;
  }

  /**
   * Start the Marker.
   *
   * @param message optional message to be displayed
   * @return the marker instance
   */
  public async start(message?: string): Promise<MarkerInstance> {
    const mark = new MarkerInstance(this);
    await mark.start(message);
    return mark;
  }
}

/**
 * Helper class to mark task blocks
 */
class MarkerInstance {
  private readonly id: string;
  private readonly marker: Marker;
  private startTime: number;

  constructor(marker: Marker) {
    this.id = uuid.v4();
    this.marker = marker;
    this.startTime = new Date().getTime();
  }

  /**
   * Starts the marker and notifies the IoHost.
   * @returns the cr time
   */
  public async start(message?: string) {
    this.startTime = new Date().getTime();
    const msg = message ?? '%s';
    await this.marker.ioHost.notify(this.startMessage(msg));
  }

  private startMessage(msg: string) {
    const payload = {
      markerId: this.id,
    };

    switch (this.marker.type) {
      case 'synth': return CODES.CDK_TOOLKIT_I1000.msg(format(msg, 'Synthesis'), payload);
      case 'deploy': return CODES.CDK_TOOLKIT_I5000.msg(format(msg, 'Deployment'), payload);
      case 'rollback': return CODES.CDK_TOOLKIT_I6000.msg(format(msg, 'Rollback'), payload);
      case 'destroy': return CODES.CDK_TOOLKIT_I7000.msg(format(msg, 'Destroy'), payload);
      case 'bootstrap': return CODES.CDK_TOOLKIT_I9000.msg(format(msg, 'Bootstrap'), payload);
    }
  }

  /**
   * Ends the current timer as a specified timing and notifies the IoHost.
   * @returns the elapsed time
   */
  public async end(message?: string) {
    const duration = this.time();
    const msg = message ?? `\n✨  %s time: ${duration.asSec}s\n`;
    await this.marker.ioHost.notify(this.endMessage(msg, duration.asMs));
    return duration;
  }

  private endMessage(msg: string, duration: number) {
    const payload = {
      markerId: this.id,
      duration,
    };

    switch (this.marker.type) {
      case 'synth': return CODES.CDK_TOOLKIT_I1000.msg(format(msg, 'Synthesis'), payload);
      case 'deploy': return CODES.CDK_TOOLKIT_I5000.msg(format(msg, 'Deployment'), payload);
      case 'rollback': return CODES.CDK_TOOLKIT_I6000.msg(format(msg, 'Rollback'), payload);
      case 'destroy': return CODES.CDK_TOOLKIT_I7000.msg(format(msg, 'Destroy'), payload);
      case 'bootstrap': return CODES.CDK_TOOLKIT_I9000.msg(format(msg, 'Bootstrap'), payload);
    }
  }

  /**
   * Get the current timer for the marker
   * @returns the elapsed time
   */
  private time() {
    const elapsedTime = new Date().getTime() - this.startTime;
    return {
      asMs: elapsedTime,
      asSec: formatTime(elapsedTime),
    };
  }
}
