import type { FeatureFlag } from '@aws-cdk/toolkit-lib';
import { SelectPrompt, isCancel } from '@clack/core';
import type { FlagOperations } from './operations';
import { FlagsMenuOptions, type FlagOperationsParams } from './types';

async function promptSelect<T extends string>(message: string, choices: { value: T; label: string }[]): Promise<T | symbol> {
  const p = new SelectPrompt({
    options: choices,
    render() {
      const lines = choices.map((c, i) =>
        i === this.cursor ? `> ${c.label}` : `  ${c.label}`,
      );
      return `${message}\n${lines.join('\n')}`;
    },
  });
  return p.prompt() as Promise<T | symbol>;
}

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

    const choices = Object.values(FlagsMenuOptions).map(o => ({ value: o, label: o }));
    const answer = await promptSelect('Menu', choices);

    if (isCancel(answer)) return null;

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

    const selectedFlagName = await promptSelect(
      'Select which flag you would like to modify:',
      booleanFlags.map(flag => ({ value: flag.name, label: flag.name })),
    );

    if (isCancel(selectedFlagName)) {
      return { set: false };
    }

    const value = await promptSelect(
      'Select a value:',
      [{ value: 'true', label: 'true' }, { value: 'false', label: 'false' }],
    );

    if (isCancel(value)) {
      return { set: false };
    }

    return {
      FLAGNAME: [selectedFlagName],
      value,
      set: true,
    };
  }
}
