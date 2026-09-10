/**
 * `buildContextPack` — `05` §5.4's context pack over `08` §8.5's retrieval steps 1–3 and 5 (step 4,
 * embeddings, is explicitly out of scope this milestone).
 *
 * @see specs/05 §5.4
 * @see specs/08 §8.5
 * @see SPEC-QUESTIONS.md Q54
 * @see PLAN-M3.md P9
 */
import { ForgeError } from '@forge/core';

import type { KbIndexBackend } from '../db/types.ts';
import type { KbParsedEntry, KbTree } from '../schema/tree.ts';
import { estimateTokens } from './estimate-tokens.ts';
import { computePinnedCore } from './pinned-core.ts';
import type { ContextPack, PackRequest, PinnedCore, RetrievedEntry } from './types.ts';

const INDEXABLE_KINDS = new Set(['kb-entry', 'adr', 'diagram', 'runbook']);

type IndexableEntry = Extract<KbParsedEntry, { kind: 'kb-entry' | 'adr' | 'diagram' | 'runbook' }>;

function isIndexable(entry: KbParsedEntry): entry is IndexableEntry {
  return INDEXABLE_KINDS.has(entry.kind);
}

function idOf(entry: IndexableEntry): string {
  return entry.value.id;
}

function findById(tree: KbTree, id: string): IndexableEntry | undefined {
  return tree.entries.filter(isIndexable).find((entry) => idOf(entry) === id);
}

/**
 * `05` §5.4 point 2's own "full text" — each document kind's own substantive content, not just its
 * front matter. `adr`/`runbook` route through `entry.body` (`08` §8.4`/an M1 gauntlet round found
 * `adrSchema`/`runbookSchema` themselves carry no body field at all — `SPEC-QUESTIONS.md` Q54's own
 * P9 round added it to `KbParsedEntry`). `diagram` has no body at all (`.mmd.yaml` sidecars are pure
 * YAML, no `---`-delimited body to speak of) — `caption`/`alt_text` stand in instead, per `08`
 * §8.11.5's own "`alt_text` is what gets packed into an agent's context when the diagram source
 * itself is too large to include."
 */
function contentOf(entry: IndexableEntry): string {
  switch (entry.kind) {
    case 'kb-entry':
      return entry.value.body;
    case 'adr':
    case 'runbook':
      return entry.body;
    case 'diagram':
      return `${entry.value.caption}\n\n${entry.value.alt_text}`;
  }
}

function updatedOf(entry: IndexableEntry): string {
  return entry.value.updated;
}

function pinnedCoreTokens(pinnedCore: PinnedCore): number {
  return (
    estimateTokens(pinnedCore.projectIdentity ?? '') +
    estimateTokens(pinnedCore.level ?? '') +
    estimateTokens(pinnedCore.glossary) +
    estimateTokens(pinnedCore.constraints) +
    estimateTokens(pinnedCore.adrIndex) +
    estimateTokens(pinnedCore.stageGoal ?? '') +
    estimateTokens(pinnedCore.codingStandards)
  );
}

interface ScoredCandidate {
  readonly id: string;
  readonly content: string;
  readonly score: number;
  readonly updated: string;
}

/**
 * `08` §8.5's own step order: lexical (2) before graph expansion (3). A graph-expansion-only
 * candidate (not already a lexical hit) gets `score: 0` — below every real lexical hit, since
 * `scoreByTermOverlap`/BM25 both only ever report a positive score for an actual match
 * (`SPEC-QUESTIONS.md` Q54, point 4). Sorted by score descending, ties broken by more-recent
 * `updated` first (`08` §8.5's own "filtered by... recency" for graph expansion), then by `id` (byte
 * order, never `localeCompare` — R10) for full determinism.
 */
function rankedCandidates(
  tree: KbTree,
  backend: KbIndexBackend,
  briefText: string,
  declaredInputIds: readonly string[],
): readonly ScoredCandidate[] {
  const declaredSet = new Set(declaredInputIds);
  const scoreById = new Map<string, number>();

  for (const hit of backend.search(briefText)) {
    // A non-finite score is not something any built-in `KbIndexBackend` produces today
    // (`scoreByTermOverlap` only ever returns a positive integer count; real BM25 is always a finite
    // real number) — but the interface itself does not forbid it, and `NaN` defeats every numeric
    // comparison in the sort below (`NaN !== NaN`, `NaN < x` is always `false`), which would make the
    // final order depend on JS engine sort internals rather than this function's own comparator. A
    // future/alternative backend returning one degrades to "no better than a graph-only hit" instead.
    const score = Number.isFinite(hit.score) ? hit.score : 0;
    scoreById.set(hit.id, score);
  }
  // "pull entries linked to the structurally-required ones" — expand() is called only on the
  // declared inputs themselves, not on every already-retrieved lexical hit too.
  for (const id of backend.expand(declaredInputIds, 1)) {
    if (!scoreById.has(id)) scoreById.set(id, 0);
  }

  const candidates: ScoredCandidate[] = [];
  for (const [id, score] of scoreById) {
    if (declaredSet.has(id)) continue; // already fully included via declaredInputs
    // A search/expand hit naming an id this exact tree doesn't have (a stale, not-yet-rebuilt index)
    // is skipped, not fatal — the same "boundary data may lag reality" stance P8's own backends take.
    const entry = findById(tree, id);
    if (entry === undefined) continue;
    candidates.push({ id, content: contentOf(entry), score, updated: updatedOf(entry) });
  }

  return candidates.sort((a, b) => {
    if (a.score !== b.score) return b.score - a.score;
    if (a.updated !== b.updated) return a.updated < b.updated ? 1 : -1;
    return a.id < b.id ? -1 : 1;
  });
}

export function buildContextPack(
  request: PackRequest,
  backend: KbIndexBackend,
  tree: KbTree,
): ContextPack {
  if (Number.isNaN(request.budgetTokens)) {
    throw new ForgeError('KB-014', { budgetTokens: request.budgetTokens });
  }

  const pinnedCore = computePinnedCore(tree, request.pinnedCoreOverrides);

  // A caller-supplied id list is not guaranteed unique (e.g. two upstream steps each declaring the
  // same input) — deduplicated here, keeping the first occurrence's order, so `declaredInputs` and
  // `manifest` cannot disagree about how many distinct ids were actually included, and the same
  // document's content is never charged against the token budget twice.
  const declaredInputIds = [...new Set(request.declaredInputIds)];

  const declaredInputs = declaredInputIds.map((id) => {
    const entry = findById(tree, id);
    if (entry === undefined) {
      throw new ForgeError('KB-013', { entryId: id });
    }
    return { id, content: contentOf(entry) };
  });

  const candidates = rankedCandidates(tree, backend, request.briefText, declaredInputIds);

  let usedTokens = pinnedCoreTokens(pinnedCore);
  const tokenCounts: Record<string, number> = {};
  for (const declared of declaredInputs) {
    const tokens = estimateTokens(declared.content);
    tokenCounts[declared.id] = tokens;
    usedTokens += tokens;
  }

  // Pinned core and declared inputs are never dropped, even over budget — a budget smaller than
  // pinned core alone still leaves `usedTokens` already past `budgetTokens`, so the very first
  // candidate below fails to fit and `retrieved` is correctly empty rather than truncating anything.
  //
  // `break`, not `continue`, on the first candidate that doesn't fit — already the deliberate reading
  // recorded in `SPEC-QUESTIONS.md` Q54 point 4: "drop the lowest-ranked entries first" means the
  // *kept* set is always a rank-ordered prefix of `candidates`. The moment one entry doesn't fit,
  // every entry ranked below it is dropped too, even a smaller one that would fit on its own — the
  // alternative (skip an oversized entry and keep trying smaller, lower-ranked ones) can end up
  // keeping a lower-ranked entry while dropping a higher-ranked one, which is the opposite of
  // "lowest-ranked first." A gauntlet critic flagged this as wasteful-looking in the adversarial case
  // (a large top-ranked candidate blocking a small low-ranked one that would otherwise fit); the
  // policy itself is unchanged, and `build-context-pack.test.ts` now has a regression test locking it
  // in explicitly (Q54's critic-round addendum).
  const retrieved: RetrievedEntry[] = [];
  for (const candidate of candidates) {
    const tokens = estimateTokens(candidate.content);
    if (usedTokens + tokens > request.budgetTokens) break;
    retrieved.push({ id: candidate.id, content: candidate.content, score: candidate.score });
    tokenCounts[candidate.id] = tokens;
    usedTokens += tokens;
  }

  return {
    pinnedCore,
    declaredInputs,
    retrieved,
    manifest: {
      ids: [...declaredInputs.map((entry) => entry.id), ...retrieved.map((entry) => entry.id)],
      tokenCounts,
    },
  };
}
