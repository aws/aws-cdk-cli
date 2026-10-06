import type { WebSourceLocation } from './api';

export type NavigateHandler = (opts: {
  sourceLocation?: WebSourceLocation;
  templateFile?: string;
  logicalId?: string;
  propertyPaths?: readonly string[];
  highestSeverity?: string;
  constructPath?: string;
}) => void;
