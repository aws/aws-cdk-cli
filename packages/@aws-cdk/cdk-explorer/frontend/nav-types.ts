import type { WebSourceLocation } from './api';

export type NavigateHandler = (opts: {
  sourceLocation?: WebSourceLocation;
  templateFile?: string;
  logicalId?: string;
  propertyPaths?: readonly string[];
  color?: string;
  constructPath?: string;
}) => void;
