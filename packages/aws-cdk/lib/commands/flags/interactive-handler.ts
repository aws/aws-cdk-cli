import type { FeatureFlag } from '@aws-cdk/toolkit-lib';
// @ts-ignore
import { Select } from 'enquirer';
import type { FlagOperations } from './operations';
import { FlagsMenuOptions, type FlagOperationsParams } from './types';

export class InteractiveHandler {
  constructor(
    private readonly flags: FeatureFlag[],
    private readonly flagOperations: FlagOperations,
  ) {
  }

  /** Displays flags that have differences between user and recommended values */
  private async displayFlagsWithDifferences(): Promise<void> {
    const flagsWithDifferences = this.flags.filter(flag =>
      flag.userValue === undefined || !this.isUserValueEqualToRecommended(flag));

    if (flagsWithDifferences.length > 0) {
      await this.flagOperations.displayFlagTable(flagsWithDifferences);
    }
  }

  /** Checks if user value matches recommended value */
  private isUserValueEqualToRecommended(flag: FeatureFlag): boolean {
    return String(flag.userValue) === String(flag.recommendedValue);
  }

  /** Main interactive mode handler that shows menu and processes user selection */
  async handleInteractiveMode(): Promise<FlagOperationsParams | null> {
    await this.displayFlagsWithDifferences();

    const prompt = new Select({
      name: 'option',
      message: 'Menu',
      choices: Object.values(FlagsMenuOptions),
    });

    const answer = await prompt.run();

    switch (answer) {
      case FlagsMenuOptions.ALL_TO_RECOMMENDED:
        return { recommended: true, all: true, set: true };
      case FlagsMenuOptions.UNCONFIGURED_TO_RECOMMENDED:
        return { recommended: true, unconfigured: true, set: true };
      case FlagsMenuOptions.UNCONFIGURED_TO_DEFAULT:
        return { default: true, unconfigured: true, set: true };
      case FlagsMenuOptions.MODIFY_SPECIFIC_FLAG:
        return this.handleSpecificFlagSelection();
      case FlagsMenuOptions.EXIT:
        return null;
      default:
        return null;
    }
  }

  /** Handles the specific flag selection flow with flag and value prompts */
  private async handleSpecificFlagSelection(): Promise<FlagOperationsParams> {
    const booleanFlags = this.flags.filter(flag => this.flagOperations.isBooleanFlag(flag));

    const flagPrompt = new Select({
      name: 'flag',
      message: 'Select which flag you would like to modify:',
      limit: 100,
      choices: booleanFlags.map(flag => flag.name),
    });

    const selectedFlagName = await flagPrompt.run();

    const valuePrompt = new Select({
      name: 'value',
      message: 'Select a value:',
      choices: ['true', 'false'],
    });

    const value = await valuePrompt.run();

    return {
      FLAGNAME: [selectedFlagName],
      value,
      set: true,
    };
  }
}
