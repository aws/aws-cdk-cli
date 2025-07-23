import { ErrorName } from './schema';

export function cdkCliErrorName(name: string): ErrorName {
  // We only record error names that we control. Errors coming from dependencies
  // contain text that we have no control over so it is safer to not send it.
  if (!isKnownErrorName(name)) {
    return ErrorName.UNKNOWN_ERROR;
  }
  return name;
}

function isKnownErrorName(name: string): name is ErrorName {
  return Object.values(ErrorName).includes(name as ErrorName);
}
