/**
 * `computePinnedCore` — `05` §5.4 point 1's own seven pinned-core items, minus the three that are not
 * KB data at all (`SPEC-QUESTIONS.md` Q54).
 *
 * `glossary`/`codingStandards` are one real `kb-entry`'s own body text; `adrIndex`/`constraints` are
 * computed one-line-per-entry summaries, not read from `08` §8.2's own `decisions/index.md` — that
 * file is generated and out of `parseKbTree`'s scope (`SPEC-QUESTIONS.md` Q51), and no piece in this
 * milestone produces it yet. Computing the summary directly from the same source data a future
 * "regenerate `index.md`" piece would use is more honest than depending on a file that may be stale
 * or entirely absent.
 *
 * @see specs/05 §5.4
 * @see SPEC-QUESTIONS.md Q54
 * @see PLAN-M3.md P9
 */
import type { KbParsedEntry, KbTree } from '../schema/tree.ts';
import type { PackRequest, PinnedCore } from './types.ts';

const GLOSSARY_PATH = 'glossary.md';
const CODING_STANDARDS_PATH = 'engineering/standards.md';

function findByPath(tree: KbTree, path: string): KbParsedEntry | undefined {
  return tree.entries.find((entry) => entry.path === path);
}

/** The body text of the `kb-entry`-kind document at `path`, or `''` if it does not exist or is some
 * other kind — a missing glossary/standards file is a real gap in the project's own KB, not this
 * function's job to raise an error about (`buildContextPack` still produces a pack either way). */
function kbEntryBodyAt(tree: KbTree, path: string): string {
  const entry = findByPath(tree, path);
  return entry?.kind === 'kb-entry' ? entry.value.body : '';
}

function computeAdrIndex(tree: KbTree): string {
  const lines = tree.entries
    .filter((entry): entry is Extract<KbParsedEntry, { kind: 'adr' }> => entry.kind === 'adr')
    .map((entry) => `${entry.value.id}: ${entry.value.title} (${entry.value.status})`)
    .sort((a, b) => (a < b ? -1 : 1));
  return lines.join('\n');
}

function computeActiveConstraints(tree: KbTree): string {
  const lines = tree.entries
    .filter(
      (entry): entry is Extract<KbParsedEntry, { kind: 'kb-entry' }> =>
        entry.kind === 'kb-entry' &&
        entry.value.section === 'constraints' &&
        entry.value.status === 'active',
    )
    .map((entry) => `${entry.value.id}: ${entry.value.title}`)
    .sort((a, b) => (a < b ? -1 : 1));
  return lines.join('\n');
}

export function computePinnedCore(
  tree: KbTree,
  overrides: PackRequest['pinnedCoreOverrides'],
): PinnedCore {
  const computed = {
    glossary: kbEntryBodyAt(tree, GLOSSARY_PATH),
    constraints: computeActiveConstraints(tree),
    adrIndex: computeAdrIndex(tree),
    codingStandards: kbEntryBodyAt(tree, CODING_STANDARDS_PATH),
  };
  // `overrides` (`Partial<PinnedCore>`) permits a caller to write `{ glossary: undefined }`
  // explicitly, even though `PinnedCore.glossary` is a required `string` — `Partial` makes a
  // property optional, and an optional property's *read* type always includes `undefined` regardless
  // of `exactOptionalPropertyTypes`. A gauntlet verify pass found a plain `{ ...computed, ...overrides
  // }` spread let that explicit `undefined` clobber the computed value, so `pinnedCore.glossary` (and
  // its three siblings below) could end up genuinely `undefined` at runtime despite their
  // required-`string` type, which then threw a raw `TypeError` deep inside `estimateTokens`. Spreading
  // `overrides` first, then re-assigning these four keys to `override ?? computed` afterward, means
  // the reassignment always writes a definite `string` — never a literal `undefined` — so it stays
  // `exactOptionalPropertyTypes`-clean. `projectIdentity`/`level`/`stageGoal` need no such guard:
  // `PinnedCore` already types those three optional, so `undefined` is a legitimate value for them,
  // override or not.
  return {
    ...overrides,
    glossary: overrides?.glossary ?? computed.glossary,
    constraints: overrides?.constraints ?? computed.constraints,
    adrIndex: overrides?.adrIndex ?? computed.adrIndex,
    codingStandards: overrides?.codingStandards ?? computed.codingStandards,
  };
}
