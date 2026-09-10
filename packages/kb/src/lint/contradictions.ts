/**
 * `checkContradictions` — `08` §8.7's own "Contradiction detection implementation" paragraph: the
 * deterministic checks (curated antonym-pair tag conflicts, conflicting ADR statuses, two `accepted`
 * ADRs in the same scope with no supersession link), exported separately from `lintKb` so a later,
 * optional LLM-backed semantic pass can compose additional *warning*-severity findings alongside this
 * function's own output without ever touching it — "LLM findings are warnings only, never fail a
 * gate," true by construction since nothing here upgrades a caller-supplied `severity`.
 *
 * @see specs/08 §8.7
 * @see SPEC-QUESTIONS.md Q56
 * @see PLAN-M3.md P10
 */
import type { ADR } from '@forge/schemas';

import type { KbEntry } from '../schema/kb-entry.ts';
import { adrScope } from './kb-links.ts';
import { sortFindings, type KbFinding } from './types.ts';

/** `08` §8.7's own three named examples, seeded — extensible by appending another `[a, b]` pair. Each
 * pair is checked in both directions (one entry tagged `a`, the other `b`, or vice versa). */
export const ANTONYM_TAG_PAIRS: readonly (readonly [string, string])[] = [
  ['sync', 'async'],
  ['monolith', 'microservices'],
  ['strong-consistency', 'eventual-consistency'],
];

function setsOverlap(a: ReadonlySet<string>, b: readonly string[]): boolean {
  return b.some((value) => a.has(value));
}

/** Every unordered pair `[a, b]` from `items`, `a` before `b` — iterated via `.slice()` off each
 * element's own position rather than a manually-indexed double loop, so neither element is ever
 * looked up by an index `noUncheckedIndexedAccess` would otherwise force an unreachable `undefined`
 * guard around (every `a`/`b` here comes directly from iteration, never from `items[i]`). */
function unorderedPairs<T>(items: readonly T[]): readonly (readonly [T, T])[] {
  return items.flatMap((a, index) => items.slice(index + 1).map((b): readonly [T, T] => [a, b]));
}

/** `[a, b]` reordered so `a.id < b.id` always — a gauntlet critic found `unorderedPairs`' own
 * caller-array order otherwise leaked directly into which entry became `entryId` and which name came
 * first in the message, so the identical logical conflict between two entries read differently (a real
 * R10 violation, not merely a list-order one) depending only on which array position each one started
 * in — never guaranteed by `KbTree`'s own type for any caller other than `parseKbTree`'s own
 * lexically-sorted walk. */
function canonicalPair<T extends { readonly id: string }>(pair: readonly [T, T]): readonly [T, T] {
  const [a, b] = pair;
  return a.id < b.id ? pair : [b, a];
}

/** Two `active` KB entries in the same `section`, sharing at least one `applies_to` tag, where one's
 * own `tags` contains one half of a curated antonym pair and the other's contains the other half. */
function checkAntonymTagConflicts(kbEntries: readonly KbEntry[]): readonly KbFinding[] {
  const findings: KbFinding[] = [];
  const active = kbEntries.filter((entry) => entry.status === 'active');

  for (const pair of unorderedPairs(active)) {
    const [a, b] = canonicalPair(pair);
    if (a.section !== b.section) continue;
    if (!setsOverlap(new Set(a.applies_to), b.applies_to)) continue;

    for (const [x, y] of ANTONYM_TAG_PAIRS) {
      const aVsB = a.tags.includes(x) && b.tags.includes(y);
      const bVsA = a.tags.includes(y) && b.tags.includes(x);
      if (!aVsB && !bVsA) continue;
      findings.push({
        ruleId: 'kb:contradiction',
        severity: 'error',
        message: `${a.id} and ${b.id} are both active in section ${JSON.stringify(a.section)}, apply to a shared subject, and carry opposing tags (${JSON.stringify(x)}/${JSON.stringify(y)}).`,
        entryId: a.id,
      });
    }
  }

  return findings;
}

interface Supersedable {
  readonly id: string;
  readonly status: string;
  readonly supersedes: readonly string[];
  readonly superseded_by: string | null;
}

/** For every `a.supersedes` id that resolves to a real entry `b` in the same set: `b` must actually
 * agree it was superseded by `a` (`b.status === 'superseded'` and `b.superseded_by === a.id`) — the
 * cross-entity half of the status/superseded_by consistency each schema already checks internally
 * (one entry's own two fields agreeing with each other, not with what a *different* entry claims about
 * it). A dangling `supersedes` id (no such `b`) is `lintKb`'s own "referenced ids exist" rule's job,
 * not this one's — skipped here, not reported twice.
 *
 * Takes `entries` as one combined KB-entry-and-ADR set, not one kind at a time — `supersedes` is a
 * generic id list on both schemas (a KB entry can legitimately supersede an ADR, or vice versa), and a
 * gauntlet critic found calling this twice, once per kind, meant a cross-kind pair was silently never
 * checked at all (`byId` never had the other kind's ids in it). `checkSupersessionCycles` (`lint.ts`)
 * already unions both kinds into one edge map for the identical reason. */
function checkSupersessionStatusConsistency(
  entries: readonly Supersedable[],
): readonly KbFinding[] {
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const findings: KbFinding[] = [];

  for (const a of entries) {
    for (const supersededId of a.supersedes) {
      const b = byId.get(supersededId);
      if (b === undefined) continue;
      if (b.status === 'superseded' && b.superseded_by === a.id) continue;
      findings.push({
        ruleId: 'kb:contradiction',
        severity: 'error',
        message: `${a.id} claims to supersede ${b.id}, but ${b.id}'s own status (${JSON.stringify(b.status)}) and superseded_by (${JSON.stringify(b.superseded_by)}) do not agree it was superseded by ${a.id}.`,
        entryId: a.id,
      });
    }
  }

  return findings;
}

/** Two `accepted` ADRs in the same `category`, whose derived scopes (`adrScope`, `SPEC-QUESTIONS.md`
 * Q56 point 3) overlap, with no `supersedes` link between them in either direction. */
function checkAdrScopeConflicts(
  adrs: readonly ADR[],
  kbEntries: readonly KbEntry[],
): readonly KbFinding[] {
  const findings: KbFinding[] = [];
  const accepted = adrs.filter((adr) => adr.status === 'accepted');

  for (const pair of unorderedPairs(accepted)) {
    const [a, b] = canonicalPair(pair);
    if (a.category !== b.category) continue;
    if (a.supersedes.includes(b.id) || b.supersedes.includes(a.id)) continue;
    if (!setsOverlap(adrScope(a.id, kbEntries), [...adrScope(b.id, kbEntries)])) continue;

    findings.push({
      ruleId: 'kb:contradiction',
      severity: 'error',
      message: `${a.id} and ${b.id} are both accepted in category ${JSON.stringify(a.category)} with overlapping scope and no supersession link between them.`,
      entryId: a.id,
    });
  }

  return findings;
}

export function checkContradictions(
  kbEntries: readonly KbEntry[],
  adrs: readonly ADR[],
): readonly KbFinding[] {
  return sortFindings([
    ...checkAntonymTagConflicts(kbEntries),
    ...checkSupersessionStatusConsistency([...kbEntries, ...adrs]),
    ...checkAdrScopeConflicts(adrs, kbEntries),
  ]);
}
