/**
 * `detailOfJunitElement` — the detail text inside a JUnit-XML `<failure>`/`<error>`/`<skipped>`
 * element, shared by BOTH real JUnit-XML-reading code paths this codebase has (`13` F-TEST-7 point
 * 2, F-TEST-11): `reporter.ts`'s own legacy, ecosystem-auto-detected path (`outcomesFromJunitXml`,
 * reached by the default, bare-string `testCommands.<layer>` form — still the common config, not
 * deprecated) and `parsers/junit-xml.ts`'s own structured, opt-in path (`entryFrom`, reached only by
 * a layer that declares `format: 'junit-xml'` explicitly). Extracted here (Q346, post-v1.0,
 * `specs/22` M17 P21, round 4) after a round-3 critic found the two paths had drifted into a real,
 * byte-for-byte copy-paste of this exact function under two different names
 * (`detailOfJunitError`/`detailOfJunitElement`) rather than one shared source of truth.
 *
 * Read exactly the way `fast-xml-parser`'s own `ignoreAttributes: false` shapes one with both a
 * `message` attribute and text content: `{ '@_message': string, '#text': string }` (confirmed
 * directly: pytest's own collection-failure element sets `@_message` to the fixed, uninformative
 * literal `"collection failure"` while `#text` carries the real traceback, so `#text` is preferred
 * when present). `value` can also be a bare string (an element with no attributes at all, confirmed
 * directly against real fixtures: e.g. `<failure>boom</failure>`) or `undefined` (no such child) —
 * both handled defensively.
 *
 * @see specs/09 §9.5
 * @see specs/22 M17 P3, M17 P21 (Q346)
 */
export function detailOfJunitElement(value: unknown): string | undefined {
  if (typeof value === 'string' && value !== '') return value;
  if (typeof value !== 'object' || value === null) return undefined;
  const candidate = value as Readonly<Record<string, unknown>>;
  const text = candidate['#text'];
  if (typeof text === 'string' && text !== '') return text;
  const message = candidate['@_message'];
  return typeof message === 'string' && message !== '' ? message : undefined;
}
