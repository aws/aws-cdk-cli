export function addToColl<A, B>(map: Map<A, B[]>, key: A, value: B) {
  let coll = map.get(key);
  if (!coll) {
    coll = [];
    map.set(key, coll);
  }
  coll.push(value);
}

