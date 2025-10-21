import type { FeatureFlag, Toolkit } from '@aws-cdk/toolkit-lib';
import { InteractiveHandler } from './interactive-handler';
import { FlagOperations } from './operations';
import { FlagOperationRouter } from './router';
import type { FlagOperationsParams } from './types';
import { FlagValidator } from './validator';
import type { IoHelper } from '../../api-private';
import { OBSOLETE_FLAGS } from '../../obsolete-flags';

export class FlagCommandHandler {
  private readonly flags: FeatureFlag[];
  private readonly router: FlagOperationRouter;
  private readonly options: FlagOperationsParams;
  private readonly ioHelper: IoHelper;

  /** Main component that sets up all flag operation components */
  constructor(flagData: FeatureFlag[], ioHelper: IoHelper, options: FlagOperationsParams, toolkit: Toolkit) {
    this.flags = flagData.filter(flag => !OBSOLETE_FLAGS.includes(flag.name));
    this.options = { ...options, concurrency: options.concurrency ?? 4 };
    this.ioHelper = ioHelper;

    const validator = new FlagValidator(ioHelper);
    const flagOperations = new FlagOperations(this.flags, toolkit, ioHelper);
    const interactiveHandler = new InteractiveHandler(this.flags, flagOperations);

    this.router = new FlagOperationRouter(validator, interactiveHandler, flagOperations);
  }

  /** Main entry point that processes the flags command */
  async processFlagsCommand(): Promise<void> {
    if (this.flags.length === 0) {
      await this.ioHelper.defaults.error('The \'cdk flags\' command is not compatible with the AWS CDK library used by your application. Please upgrade to 2.212.0 or above.');
      return;
    }

    await this.router.route(this.options);
  }
}
