/**
 * Shared text-safety helpers for every generator in `@forge/diagrams/generate`.
 *
 * @see PLAN-M3.md P3
 * @see SPEC-QUESTIONS.md Q46
 */

/**
 * A curated set of words that fail to parse as a bare, unquoted identifier in at least one Mermaid
 * diagram kind this package generates (`end`, `class`, `style`, `subgraph` in `flowchart`;
 * `end`/`participant`/`loop`/... in `sequenceDiagram`) — verified empirically against
 * `mermaid@11.17.2`, not derived from Mermaid's own published grammar (it publishes none as a single
 * list). Checked case-insensitively and shared across every diagram kind rather than kept per-kind:
 * over-escaping an id that would have been safe in one specific kind is a cosmetic cost (an extra
 * `_1` suffix nobody but a diff notices); under-escaping is a parse failure. See `SPEC-QUESTIONS.md`
 * Q46 for why this list is deliberately not claimed exhaustive.
 */
const RESERVED_MERMAID_WORDS = new Set([
  'end',
  'subgraph',
  'class',
  'style',
  'click',
  'linkstyle',
  'classdef',
  'direction',
  'graph',
  'flowchart',
  'sequencediagram',
  'erdiagram',
  'statediagram',
  'participant',
  'actor',
  'loop',
  'alt',
  'opt',
  'par',
  'and',
  'rect',
  'activate',
  'deactivate',
  'note',
  'title',
  'else',
  'critical',
  'break',
  'box',
]);

/**
 * A domain id (`component:api`, `DM-004`, ...) is not always a valid unquoted Mermaid node
 * identifier — `:` in particular is a real, common separator in this project's own id conventions
 * and is not legal there. Every character outside `[A-Za-z0-9_]` becomes `_`.
 *
 * This alone is not injective (`component-api` and `component_api` both sanitize to
 * `component_api`) and can produce a reserved word or an empty string — `buildSanitizedIdMap` is
 * what actually guarantees a safe, collision-free identifier per id; this function is its first,
 * character-level pass, exported separately only because `sanitizeMermaidLabel`'s own tests need it
 * as a building block.
 */
export function sanitizeMermaidId(id: string): string {
  return id.replace(/[^A-Za-z0-9_]/g, '_');
}

/**
 * Assigns every id in `ids` a Mermaid-safe, collision-free, non-reserved identifier, and returns a
 * lookup for it — the one thing every generator must funnel *every* domain id through before
 * emitting it bare into Mermaid source, rather than calling `sanitizeMermaidId` ad hoc at each render
 * site (which is exactly what let a collision or a reserved word through silently —
 * `SPEC-QUESTIONS.md` Q46).
 *
 * Two ids that sanitize to the same character-level result (`component-api`/`component_api`), or one
 * that sanitizes to a reserved word or the empty string, would otherwise either merge two distinct
 * nodes into one (silently wrong) or fail to parse at all. Both are resolved the same way: the
 * *first* id to claim a candidate (in a fixed, deterministic sort order — never input order, so two
 * calls with the same id set always agree regardless of how the caller happened to list them) keeps
 * it; every later claimant gets `_2`, `_3`, ... appended until the result is free.
 *
 * Returns a lookup *function*, not the underlying `Map`, directly: every caller only ever looks up an
 * id that was itself passed into this same call, so a genuinely missing id is a bug in the caller
 * (built the map from one id list, looked up from a different one) rather than a real runtime case to
 * design around — the function throws a plain `RangeError` for it once, here, instead of every call
 * site repeating a `?? fallback`/non-null-assertion around a lookup that cannot fail when used as
 * intended.
 */
export function buildSanitizedIdMap(ids: readonly string[]): (id: string) => string {
  // Two distinct elements of a `Set` are never equal, so a two-way comparator (no `=== 0` branch to
  // leave provably unreachable) is honest here, not merely simpler.
  const uniqueIds = [...new Set(ids)].sort((a, b) => (a < b ? -1 : 1));
  const claimed = new Set<string>();
  const map = new Map<string, string>();

  for (const id of uniqueIds) {
    const sanitized = sanitizeMermaidId(id);
    const base =
      sanitized === '' || RESERVED_MERMAID_WORDS.has(sanitized.toLowerCase())
        ? `n_${sanitized}`
        : sanitized;
    let candidate = base;
    let suffix = 2;
    while (claimed.has(candidate)) {
      candidate = `${base}_${String(suffix)}`;
      suffix += 1;
    }
    claimed.add(candidate);
    map.set(id, candidate);
  }

  return (id: string): string => {
    const sanitized = map.get(id);
    if (sanitized === undefined) {
      throw new RangeError(
        `buildSanitizedIdMap: "${id}" was never passed to buildSanitizedIdMap — this is a bug in the caller, not a real input to handle.`,
      );
    }
    return sanitized;
  };
}

/**
 * A label wrapped in double quotes is Mermaid's own way to allow arbitrary text — but a literal `"`
 * inside it would close the quote early. Mermaid's own HTML-entity escape (`#quot;`) is the
 * "correct" answer for hand-authored source, but this package's own extractor (`@forge/diagrams/
 * parse`, `SPEC-QUESTIONS.md` Q45) does not decode it back out, so a generated diagram carrying one
 * would not round-trip through this package's own tooling. Replacing with a plain apostrophe is a
 * deliberate, simpler choice: it never breaks Mermaid syntax and never needs a decode step anywhere
 * downstream.
 */
export function sanitizeMermaidLabel(label: string): string {
  return label.replace(/"/g, "'");
}

/** A quoted Mermaid label — `["Real label"]`, `("Real label")`, etc., with `wrap` supplying the pair. */
export function quotedLabel(label: string, [open, close]: readonly [string, string]): string {
  return `${open}"${sanitizeMermaidLabel(label)}"${close}`;
}
