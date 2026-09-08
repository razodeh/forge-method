/**
 * `validateEntry` — `12` §12.2's own catalog hygiene rules, made real: "Entries never claim 'fastest',
 * 'best', or performance numbers. They claim *fit conditions*." and a dangling `pairs_with`/
 * `alternatives` reference is a real authoring bug this registry is well-positioned to catch.
 *
 * @see specs/12 §12.2
 * @see PLAN-M6.md C1
 */
import type { CatalogEntry, CatalogIssue } from '../schema/types.ts';
import type { CatalogRegistry } from './registry.ts';

const SUPERLATIVE_PATTERN = /\b(fastest|best)\b/i;

/** A number immediately followed by a common performance unit, or an "Nx faster/slower" claim -- `12`
 * §12.2's own "or performance numbers" (the sibling ban to "fastest"/"best"), narrowly scoped to the
 * kinds of numeric performance claim its own worked example's own strengths/weaknesses text would
 * plausibly contain, not every number (a version number or a port number is not a performance claim). */
const PERFORMANCE_NUMBER_PATTERN =
  /\b\d+(?:\.\d+)?\s*(?:x\s*(?:faster|slower)|ms|qps|tps|req\/s|ops\/sec|%)\b/i;

// `12` §12.2's own hygiene sentence names no specific field -- it is a blanket rule about the entry's
// own claims, not scoped to any subset. `notes_for_agents` is operational guidance rather than
// marketing copy and so is unlikely to carry a superlative or performance claim in practice, but
// scanning it too costs nothing and closes a real gap: nothing stops a badly-authored entry from
// smuggling a banned claim in there instead.
const LEXICAL_FIELDS = [
  'strengths',
  'weaknesses',
  'fits_when',
  'avoid_when',
  'notes_for_agents',
] as const;

export function validateEntry(
  entry: CatalogEntry,
  registry: CatalogRegistry,
): readonly CatalogIssue[] {
  const issues: CatalogIssue[] = [];

  for (const field of LEXICAL_FIELDS) {
    for (const [index, text] of entry[field].entries()) {
      if (SUPERLATIVE_PATTERN.test(text)) {
        issues.push({
          path: `${field}.${String(index)}`,
          message: `"${text}" claims a banned superlative ("fastest"/"best") -- 12 §12.2: entries claim fit conditions, not benchmarks.`,
        });
      }
      if (PERFORMANCE_NUMBER_PATTERN.test(text)) {
        issues.push({
          path: `${field}.${String(index)}`,
          message: `"${text}" claims a performance number -- 12 §12.2: entries claim fit conditions, not benchmarks.`,
        });
      }
    }
  }

  for (const [index, id] of (entry.pairs_with ?? []).entries()) {
    if (!registry.hasId(id)) {
      issues.push({
        path: `pairs_with.${String(index)}`,
        message: `"${id}" is not a real entry id in this registry.`,
      });
    }
  }

  for (const [index, id] of (entry.alternatives ?? []).entries()) {
    if (!registry.hasId(id)) {
      issues.push({
        path: `alternatives.${String(index)}`,
        message: `"${id}" is not a real entry id in this registry.`,
      });
    }
  }

  return issues;
}
