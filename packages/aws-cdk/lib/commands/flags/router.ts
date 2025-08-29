import type { InteractiveHandler } from './interactive-handler';
import type { FlagOperations } from './operations.ts';
import type { FlagOperationsParams } from './types';
import type { FlagValidator } from './validator';

export class FlagOperationRouter {
  constructor(
    private readonly validator: FlagValidator,
    private readonly interactiveHandler: InteractiveHandler,
    private readonly flagOperations: FlagOperations,
  ) {
  }

  /** Routes flag operations to appropriate handlers based on parameters */
  async route(params: FlagOperationsParams): Promise<void> {
    if (params.interactive) {
      await this.handleInteractiveMode();
      return;
    }

    if (params.safe) {
      await this.flagOperations.setSafeFlags(params);
      return;
    }

    const isValid = await this.validator.validateParams(params);
    if (!isValid) return;

    if (params.set) {
      await this.handleSetOperations(params);
    } else {
      await this.flagOperations.displayFlags(params);
      await this.showHelpMessage(params);
    }
  }

  /** Handles flag setting operations, routing to single or multiple flag methods */
  private async handleSetOperations(params: FlagOperationsParams): Promise<void> {
    if (params.FLAGNAME && params.value) {
      await this.flagOperations.setFlag(params);
    } else if (params.all || params.unconfigured) {
      await this.flagOperations.setMultipleFlags(params);
    }
  }

  /** Manages interactive mode */
  private async handleInteractiveMode(): Promise<void> {
    while (true) {
      const interactiveParams = await this.interactiveHandler.handleInteractiveMode();
      if (!interactiveParams) return;

      await this.flagOperations.execute(interactiveParams);

      if (!interactiveParams.FLAGNAME) {
        return;
      }
    }
  }

  /** Shows help message when no specific options are provided */
  private async showHelpMessage(params: FlagOperationsParams): Promise<void> {
    if (!params.all && !params.FLAGNAME) {
      await this.flagOperations.displayHelpMessage();
    }
  }
}
