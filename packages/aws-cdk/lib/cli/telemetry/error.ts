import { ErrorName } from "./schema";

export function cdkCliErrorName(name: string): ErrorName {
  if (!isErrorName(name)) {
    return ErrorName.UNKNOWN_ERROR;
  }
  return name;
}

function isErrorName(name: string): name is ErrorName {
  return Object.values(ErrorName).includes(name as ErrorName);
}
