/**
 * Renders an arbitrary value for inclusion in an error message.
 *
 * One implementation, used by the message templates, the cause renderer and the terminal formatter.
 * Three copies existed first and that is a real hazard here: an error is raised at the moment
 * something has already gone wrong, so a renderer that throws — on a cyclic object, a symbol, a
 * `null`-prototype value — replaces a diagnosable failure with an undiagnosable one.
 *
 * @see specs/02 §2.6
 */

/**
 * Renders `value` on a single line, never throwing.
 *
 * @returns a placeholder in angle brackets when a value has no useful rendering, so the output is
 * unambiguous about the difference between "absent" and the string `"undefined"`.
 */
export function renderValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === undefined) return '<missing>';
  if (value === null) return 'null';
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value);
  }
  if (typeof value === 'symbol') return value.toString();
  if (typeof value === 'function') return '<function>';

  try {
    // Sound because the declared return type is wrong at the edge: TypeScript types
    // `JSON.stringify` as returning `string`, but it returns `undefined` for a value that encodes
    // to nothing — an object whose `toJSON` yields undefined, for instance. Without the cast the
    // nullish check below is deleted as unreachable and the caller gets the string "undefined".
    const encoded = JSON.stringify(value) as string | undefined;
    return encoded ?? '<unserialisable>';
  } catch {
    return '<unserialisable>';
  }
}
