import type { StackCollection } from './stack-collection';

export interface IStackAssembly {
  /**
   * The directory this CloudAssembly was read from
   */
  directory: string;

  /**
   * Select a single stack by its ID
   */
  stackById(stackId: string): StackCollection;
}
