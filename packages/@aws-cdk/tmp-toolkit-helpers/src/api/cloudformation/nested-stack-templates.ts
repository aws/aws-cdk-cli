import type { Template } from './stack-helpers';

export interface NestedStackTemplates {
  readonly physicalName: string | undefined;
  readonly deployedTemplate: Template;
  readonly generatedTemplate: Template;
  readonly nestedStackTemplates: {
    [nestedStackLogicalId: string]: NestedStackTemplates;
  };
}
