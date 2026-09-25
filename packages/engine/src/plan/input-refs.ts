/**
 * `10` §10.1's own `inputs`/`outputs` reference mini-DSL, the one slice of it more than one module in
 * this codebase needs to parse identically: the exact KB id a `kb:<id>` or `artifact:<Type>(<id>)`
 * reference names (never a glob or a whole-type wildcard), and whether a reference is one of the two
 * *external* schemes `20` §20.5 point 3 / `15` §15.5.4 describe -- `mcp:<server>[/<tool>]` or
 * `fetch:<https-url>` (`PLAN-M14.md` P30).
 *
 * `exactKbIdOf` used to be a private duplicate of itself: `plan/compile.ts`'s own taint check (this
 * piece, matching a resolved `inputs:` entry against a caller-supplied `externalKbIds` set) and
 * `dispatch/assemble.ts`'s own declared-input resolution (`PLAN-M13.md` P5, matching the identical entry
 * against the real KB tree) each need "the one KB id this reference names," and a step compiling
 * tainted for an id that assembly then fails to recognise as the same id (or the reverse) would be a
 * real, silent correctness gap -- not the deliberate, documented kind of duplication
 * `plan/dependencies.ts`'s own narrower `ARTIFACT_REFERENCE` (type name only, not id) already discloses.
 * Shared here instead: `@forge/engine/dispatch` already has a real import edge onto `@forge/engine/plan`
 * (`StepNode` itself), so this is not a new package boundary, only a new file within one already-allowed
 * edge.
 *
 * @see specs/10 §10.1
 * @see specs/20 §20.5 point 3
 * @see specs/15 §15.5.4
 * @see PLAN-M14.md P30
 */
const GLOB_CHARS = /[*?[\]{}]/;
const KB_REFERENCE = /^kb:(.+)$/;
const ARTIFACT_ID_REFERENCE = /^artifact:[^(]+\((.+)\)$/;

/** The one KB id `reference` names exactly, or `undefined` when it is a glob, a whole-type wildcard, or
 * not a KB-resolvable reference kind at all (`mcp:`/`fetch:`/`diff:lane` included). */
export function exactKbIdOf(reference: string): string | undefined {
  const kb = KB_REFERENCE.exec(reference);
  if (kb?.[1] !== undefined && !GLOB_CHARS.test(kb[1])) return kb[1];
  const artifact = ARTIFACT_ID_REFERENCE.exec(reference);
  if (artifact?.[1] !== undefined && !GLOB_CHARS.test(artifact[1])) return artifact[1];
  return undefined;
}

/** The raw text after `kb:`, whatever shape it is -- unlike `exactKbIdOf`, never refuses a glob
 * (`kb:architecture/**`, `10` §10.1's own worked example). `undefined` for anything not a `kb:`
 * reference at all. `plan/compile.ts`'s own derived-taint check uses this as its fallback when
 * `exactKbIdOf` cannot resolve one exact id, to glob-match against a KB-relative *path* instead
 * (`PLAN-M14.md` P30, a round-1 gauntlet critic finding: a glob-shaped `kb:` input previously never
 * tainted from KB provenance at all, since there was no exact id for it to look up); `dispatch/
 * assemble.ts`'s own `classifyDeclaredInput` uses the identical fallback to LABEL such a reference too
 * (a round-2 finding, closing the gap the round-1 fix's own new glob-taint path left in `20` §20.5
 * point 1's "delimit and label").
 *
 * Deliberately `kb:` only, not `artifact:Type(<pattern>)` (a round-2 gauntlet critic finding, disclosed
 * rather than fixed): `artifact:` wildcards have the identical structural blind spot -- `exactKbIdOf`
 * refuses a non-exact `artifact:` reference exactly as it refuses a `kb:` glob, and there is no fallback
 * for it here -- but no shipped workflow or spec worked example (`10` §10.1's own `artifact:` wildcards
 * -- `Epic(*)`, `Story(*)`, `InterfaceContract(*)`, `HandoffRecord` -- are never KB-tracked types) ever
 * declares an `artifact:ADR(...)`/`artifact:Runbook(...)` step input, so this stays a real but currently
 * dormant gap, not one this piece closes. */
export function kbInputPattern(reference: string): string | undefined {
  return KB_REFERENCE.exec(reference)?.[1];
}

/** `mcp:<server>[/<tool>]` -- `15` §15.5.1's own server/tool id shapes are left open (no closed pattern
 * given anywhere in the spec pack for either), so this accepts the same permissive identifier character
 * set the rest of this codebase uses for similar free-form ids: letters, digits, `_`, `-`, `.`. Case
 * *insensitive on the scheme itself* (the `i` flag; a round-1 gauntlet critic finding, `PLAN-M14.md`
 * P30): a URI scheme name is case-insensitive by RFC 3986 §3.1 ("interpreted as lowercase"), and this
 * is the one place in this mini-DSL where scheme-matching failing open is a real, security-relevant
 * consequence -- a step whose `inputs:` reads `MCP:jira/search_issues` must not silently keep its full,
 * untainted grant merely because a workflow author (or a future resolver with its own, independently
 * case-insensitive matching) wrote the scheme in a different case. `kb:`/`artifact:`/`taint:` stay
 * deliberately case-*sensitive* elsewhere in this codebase (a typo there is caught as a visible,
 * non-security-relevant "unresolved input" or schema error, never a silent grant); `mcp:`/`fetch:` are
 * not analogous, since a mismatch here silently changes what the step is *permitted to do*. */
const MCP_INPUT_REFERENCE = /^mcp:[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)?$/i;

/** `fetch:<https-url>` -- the only `fetch:` form `10` §10.1 allows; a plain `http:` (or any other)
 * fetch scheme is a compile-time refusal (`plan/compile.ts`'s `buildLeafNode`), never silently accepted
 * or silently treated as non-external. Case-insensitive on both scheme names (`fetch:`/`https:`), for
 * the identical RFC 3986 reason `MCP_INPUT_REFERENCE` above gives. */
const FETCH_HTTPS_INPUT_REFERENCE = /^fetch:https:\/\/.+$/i;
const FETCH_SCHEME_REFERENCE = /^fetch:/i;

export function isMcpInputReference(reference: string): boolean {
  return MCP_INPUT_REFERENCE.test(reference);
}

/** Any `fetch:` reference, secure or not -- used to detect (and refuse) a non-`https:` one; never used
 * alone to decide taint (see `isExternalSchemeInputReference`). */
export function isFetchInputReference(reference: string): boolean {
  return FETCH_SCHEME_REFERENCE.test(reference);
}

export function isSecureFetchInputReference(reference: string): boolean {
  return FETCH_HTTPS_INPUT_REFERENCE.test(reference);
}

/** Whether `reference` is one of `20` §20.5 point 3's two external-content schemes -- an `mcp:` input in
 * valid `mcp:<server>[/<tool>]` shape, or a `fetch:` input that is genuinely `https:` (an insecure
 * `fetch:http://...` reference is a compile-time refusal, never reaches this function compiled). */
export function isExternalSchemeInputReference(reference: string): boolean {
  return isMcpInputReference(reference) || isSecureFetchInputReference(reference);
}
