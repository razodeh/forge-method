/**
 * `toCanonicalJson` — the canonical-form JSON serialisation `13` F-TEST-9 requires everywhere a
 * parity declaration or capture is hashed or stored: compact, keys sorted at every depth, arrays in
 * their given order, UTF-8, no trailing newline.
 *
 * Two different pieces of this milestone need the identical bytes for the identical value: the
 * declaration **digest** (`digest.ts`) hashes the declaration's canonical form, and the **capture**
 * (`capture.ts`) is stored, and content-addressed, as its canonical bytes. Both need the same
 * guarantee — a differently-key-ordered or differently-whitespaced document that means the same thing
 * produces byte-identical output — so this is one shared, independently tested function rather than
 * two copies that could drift.
 *
 * No exported helper in this codebase already does this: `packages/engine/src/dispatch/outputs.ts`'s
 * own `canonical` function is private to that file (confirmed by reading its module, which exports
 * only `checkDeclaredOutputs`, `docRootsOf`, and the other names `@forge/engine/dispatch`'s barrel
 * lists — never `canonical` itself).
 *
 * Deliberately not `JSON.stringify` with a key-sorting replacer. `JSON.stringify` silently turns
 * `NaN`/`Infinity`/`-Infinity` into `null`, and a `function`/`symbol`/`bigint` into `undefined` (or
 * drops it from an object) — exactly the silent coercion a content-addressed, digest-bound format
 * cannot tolerate: a capture that silently normalised away a real difference would be a worse defect
 * than a thrown one. This refuses anything that is not plain, finite JSON instead of coercing it.
 *
 * @see specs/13-frameworks-testing-and-debugging.md F-TEST-9
 */

/**
 * A value this module accepts: the plain-JSON universe, plus `undefined` as an object member's value
 * (meaning "this key is absent"), recursively. `undefined` is allowed only there, never as an array
 * element or a value's own top-level self, matching how `JSON.stringify` already treats an object
 * property (dropped) differently from an array element (never legal to drop) — the asymmetry this
 * module's own canonicalisation preserves on purpose, see `render` below.
 */
export type CanonicalValue =
  | null
  | boolean
  | number
  | string
  | readonly CanonicalValue[]
  | { readonly [key: string]: CanonicalValue | undefined };

function describePath(path: readonly string[]): string {
  return path.length === 0 ? '(root)' : path.join('.');
}

/**
 * A type guard with its OWN declared narrowing, rather than relying on `Array.isArray`'s built-in
 * `arg is any[]` predicate directly in `render` below: that predicate's `any` erases the element
 * type inside the branch (every element would type as `any`, not `CanonicalValue`, which
 * `@typescript-eslint/no-unsafe-argument` correctly refuses to pass on to a recursive `render`
 * call), and its negative form does not subtract a `readonly` array type from a union either. This
 * function's own signature fixes both: sound because `value`'s declared type allows only ONE
 * array-shaped member in the first place.
 */
function isCanonicalArray(value: CanonicalValue | undefined): value is readonly CanonicalValue[] {
  return Array.isArray(value);
}

/** The same idea as {@link isCanonicalArray}, for the one remaining non-primitive, non-array branch
 * once null and array are both excluded. */
function isCanonicalRecord(
  value: CanonicalValue | undefined,
): value is Record<string, CanonicalValue | undefined> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function render(value: CanonicalValue | undefined, path: readonly string[]): string {
  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new TypeError(
        `toCanonicalJson: ${describePath(path)} is ${String(value)}, which has no JSON representation.`,
      );
    }
    return JSON.stringify(value);
  }
  if (isCanonicalArray(value)) {
    // No `undefined`-element guard here, unlike the object branch below: `CanonicalValue`'s array
    // arm is `readonly CanonicalValue[]`, which has no `undefined` member at all (unlike an object's
    // value type, `CanonicalValue | undefined`) — a well-typed caller cannot construct one, and a
    // caller that defeats the type system with its own `as` reaches the catch-all `throw` at the
    // bottom of this function instead, via `isCanonicalArray`/`isCanonicalRecord` both answering
    // `false` for a real runtime `undefined`.
    const rendered: string[] = value.map((entry, index) =>
      render(entry, [...path, `[${String(index)}]`]),
    );
    return `[${rendered.join(',')}]`;
  }
  if (isCanonicalRecord(value)) {
    const keys = Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort();
    const rendered = keys.map(
      (key) => `${JSON.stringify(key)}:${render(value[key], [...path, key])}`,
    );
    return `{${rendered.join(',')}}`;
  }
  // `undefined` at the root, a `function`, a `symbol`, a `bigint`: none is plain JSON, and none is
  // silently coerced — the caller passed something this format cannot represent.
  throw new TypeError(
    `toCanonicalJson: ${describePath(path)} (${typeof value}) has no JSON representation.`,
  );
}

/**
 * Serialises `value` as compact, canonical JSON: object keys sorted at every depth (recursively),
 * array order preserved, `undefined` object members omitted, UTF-8, no trailing newline.
 *
 * Throws `TypeError` — not a `ForgeError` — because every caller in this package builds `value` from
 * already-validated data (a parsed declaration, a constructed capture): a non-finite number or a
 * function reaching this function is this package's own bug, not a user-facing failure with a
 * remedy. The thrown message names the exact path (`surfaces.process.cases[0].timeoutMs`) so the bug
 * is findable without a debugger.
 *
 * @see specs/13 F-TEST-9 (the capture's own "canonical JSON (compact, with keys sorted at every depth
 * and no trailing newline)" bullet; the declaration digest's identical requirement)
 */
export function toCanonicalJson(value: CanonicalValue): string {
  return render(value, []);
}
