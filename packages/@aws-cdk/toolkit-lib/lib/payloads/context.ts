export interface MissingContext {
  missingKeys: string[];
}

export interface UpdatedContext {
  context: { [key: string]: any };
}
