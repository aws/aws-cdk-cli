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
