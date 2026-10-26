const keys = new WeakMap<object, number>();
let next = 0;

/**
 * A stable number per object identity. Legacy re-rendered some lists with `innerHTML`
 * whenever new data landed; keying rows by it remounts them (and their `defaultChecked`)
 * exactly then, and never on unrelated re-renders.
 */
export function renderKey(value: object): number {
  let key = keys.get(value);
  if (key === undefined) {
    key = ++next;
    keys.set(value, key);
  }
  return key;
}
