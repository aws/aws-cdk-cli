import type { StackSelector } from '../stack-selector';
import { StackSelectionStrategy } from '../stack-selector';

export const ALL_STACKS: StackSelector = {
  strategy: StackSelectionStrategy.ALL_STACKS,
};
