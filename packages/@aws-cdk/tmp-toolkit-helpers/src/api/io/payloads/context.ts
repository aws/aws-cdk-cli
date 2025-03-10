export interface MissingContext {
  missingKeys: string[];
}

export interface UpdatedContext {
  contextFile: string;
  context: { [key: string]: any };
}
