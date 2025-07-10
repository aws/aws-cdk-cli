/**
 * Are two sets equal to each other
 */
export function equalSets<A>(a: Set<A>, b: Set<A>) {
  if (a.size !== b.size) {
    return false;
  }
  for (const x of a) {
    if (!b.has(x)) {
      return false;
    }
  }
  return true;
}
