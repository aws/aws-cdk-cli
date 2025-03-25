export interface NestedStackTemplates {
  readonly physicalName: string | undefined;
  readonly deployedTemplate: Template;
  readonly generatedTemplate: Template;
  readonly nestedStackTemplates: {
    [nestedStackLogicalId: string]: NestedStackTemplates;
  };
}

export interface Template {
  Parameters?: Record<string, TemplateParameter>;
  [section: string]: any;
}

export interface TemplateParameter {
  Type: string;
  Default?: any;
  Description?: string;
  [key: string]: any;
}
