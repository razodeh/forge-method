/**
 * `loadDisclosures`/`appendDisclosure`/`resolveDisclosure`/`listDisclosureLedger` — `specs/22` M15 P10:
 * the project's own disclosure ledger, the user-project analogue of this very repo's own
 * `SPEC-QUESTIONS.md`.
 *
 * Only `trade-off`/`known-gap` are ever REALLY written as a `Disclosure` document in
 * `kb/disclosures.md` (`disclosure.ts`'s own doc comment has the full reasoning). The Mandate's other
 * two named kinds — "an exemption (P6) appears automatically" and "a stopped critic loop (P9) appears
 * automatically" — are read-time SYNTHESIS from their own, already-real, already-durable sources,
 * never a second write this piece makes on P6's or P9's own behalf (neither is in this piece's own
 * Surface, and both signals are already structured and durable enough to read directly):
 *
 * - An exemption: `reports/exemptions.md` (`loadExemptions`, M15 P6) already names every real
 *   exemption with its own `reason`/`owner`/`expiry`. "Open" means "not yet expired," the identical
 *   `<=` fail-closed direction `applyExemptions` already uses for "an exemption expiring ON today is
 *   already expired, not still valid for one more day."
 * - A stopped critic loop: `RUN-113` (M15 P9) is a real, committed `StepFailed` event in a run's own
 *   event log, and `ForgeError`'s own `details` (here: `stepId`/`file`/`rounds`/`count`) survive
 *   `JSON.stringify` even nested inside a `StepFailureInfo`'s own `cause` field — confirmed directly,
 *   empirically, before writing this — so this reads real, structured data off the event log the same
 *   already-established way `forge cost`'s own `allLedgerEntries` walks every run directory
 *   (`run-ids.ts`'s own shared `listRunIds`, also used by `cost.ts`/`report.ts` -- `specs/22` M15 P12
 *   extracted this from what were three separate, byte-identical private copies), not a second,
 *   parallel mechanism. A stopped critic loop's own
 *   "resolved" state is NOT tracked here: correlating a later run's own success back to an earlier
 *   run's own failed step (same story, different run id, no shared key this project already
 *   maintains) is a real, open problem this piece's own narrow Surface does not take on — disclosed,
 *   not solved; every genuinely-exhausted `RUN-113` this scan ever finds stays visible as open
 *   indefinitely. The honest, scoped-right answer per the Mandate's own "surfaced... so it cannot rot
 *   unseen": ever-growing visibility, not a false claim of automatic resolution tracking.
 *
 *   A SHARPER, concrete gap a round-1 gauntlet critic named explicitly, worth stating plainly rather
 *   than leaving implied by the general "disclosed, not solved" framing above: a stopped-critic-loop
 *   row's ENTIRE evidentiary backing is a `StepFailed` event under `.forge/state/runs/<runId>/...` —
 *   and `.forge/state/` is a real project's own `forge init`-written `.gitignore` entry
 *   (`init/write-tree.ts`), never version-controlled, with zero deletion protection of any kind. This
 *   codebase's OWN `GATE-515` remedy text already treats `.forge/state/` as something an operator
 *   routinely reaches into and deletes from ("remove .forge/state/exemptions.lock if its own owning
 *   process is confirmed gone") — so a plain `rm -rf .forge/state` (an entirely ordinary "reset
 *   forge"/clear-CI-cache action, not a hostile or even unusual one) silently erases every
 *   stopped-critic-loop disclosure this scan would otherwise have found, with zero trace and zero
 *   record that it ever existed. This is in real, direct tension with the Mandate's own literal "a
 *   disclosure is never deleted, only resolved with a reason" — for exactly this one of its four named
 *   kinds — and there is no escape hatch today to convert a fragile, about-to-be-swept synthesized
 *   sighting into a durable, real `Disclosure` document before it is gone. Not fixed here: a durable-
 *   promotion command (`forge kb disclose --from-run <id> --step <stepId>`, say) is a real, reasonable
 *   answer, but it is a genuine scope expansion beyond this piece's own narrow Surface (`packages/kb`,
 *   `packages/templates`, `packages/cli/src/commands/kb.ts`, a `forge doctor` rule) — named here for
 *   whichever future piece decides synthesized-disclosure durability is worth solving, not half-built.
 *
 * Concurrency: `appendDisclosure`/`resolveDisclosure` both run under `withCollectionLock`
 * (`collection-lock.ts`), the identical hardened mechanism `appendExemption` (M15 P6) already uses,
 * extracted rather than duplicated — see that module's own doc comment for the full history of what
 * it took three gauntlet rounds to get right, and the honestly-claimed 20-way concurrency ceiling this
 * piece inherits unchanged.
 *
 * @see specs/22 M15 P10
 * @see PLAN-M15.md P10
 */
import type { Clock } from '@forge/core';
import { ForgeError } from '@forge/core/errors';
import { pathExists, readTextFile, writeFileAtomic, type ProjectPaths } from '@forge/core/fs';
import {
  definitionForType,
  disclosureSchema,
  disclosuresFileSchema,
  type ArtifactSource,
  type Disclosure,
  type DisclosureKind,
} from '@forge/schemas';
import { readEvents } from '@forge/telemetry/events';
import * as YAML from 'yaml';

import { withCollectionLock } from './collection-lock.ts';
import { loadExemptions } from './loop/test/exemptions.ts';
import { listRunIds } from './run-ids.ts';

const DISCLOSURES_RELATIVE_PATH = 'disclosures.md';

function disclosuresPath(kbRoot: string): string {
  return `${kbRoot}/${DISCLOSURES_RELATIVE_PATH}`;
}

async function readFrontMatter(
  paths: ProjectPaths,
  relativePath: string,
): Promise<Record<string, unknown> | undefined> {
  const target = paths.resolveWithin(relativePath);
  if (!(await pathExists(target))) return undefined;
  const text = await readTextFile(target);
  const match = /^---\n([\s\S]*?)\n---\n/.exec(text);
  if (match?.[1] === undefined) return undefined;
  const parsed: unknown = YAML.parse(match[1]);
  return typeof parsed === 'object' && parsed !== null
    ? (parsed as Record<string, unknown>)
    : undefined;
}

/** `loadDisclosures`'s own result: every row this read COULD parse, PLUS an honest count of how many
 * rows it could not -- `specs/22` M15 P10's round-1 gauntlet critic found an earlier version did a
 * single WHOLE-DOCUMENT `disclosuresFileSchema.safeParse`, so one schema-invalid row (a hand-edit, a
 * future schema migration with no matching data migration) made the ENTIRE read silently return `[]`,
 * which `forge doctor`'s own disclosures check then reported as "none open" even while a real,
 * unresolved disclosure sat right next to the corrupt row in the same file. `corruptCount > 0` is the
 * signal a caller (the `forge doctor` check, `forge kb disclosures`) surfaces visibly rather than
 * silently conflating with "genuinely zero." */
export interface LoadDisclosuresResult {
  readonly disclosures: readonly Disclosure[];
  readonly corruptCount: number;
}

/** Every real, explicitly-authored `Disclosure` this read could parse, resolved or not -- "a disclosure
 * is never deleted," so a caller wanting only the OPEN ones filters `!d.resolved` itself
 * (`listDisclosureLedger` below does exactly that for the merged view). Read PER ROW, not as one
 * whole-document parse, specifically so one corrupt row cannot hide every other, genuinely valid one
 * from a reader (`LoadDisclosuresResult`'s own doc comment has the full reasoning) -- an absent or
 * genuinely empty `kb/disclosures.md` reads as `{disclosures: [], corruptCount: 0}`, the identical "this
 * file is optional" stance `loadExemptions` already takes for its own sibling collection file. This
 * function itself never WRITES anything, so a corrupt row found here is reported, never silently
 * dropped -- only `appendDisclosure`/`resolveDisclosure`'s own, STRICTER `readDisclosuresCandidate`
 * below (which DOES write) refuses outright on the identical condition, rather than merely reporting it. */
export async function loadDisclosures(
  paths: ProjectPaths,
  kbRoot: string,
): Promise<LoadDisclosuresResult> {
  const frontMatter = await readFrontMatter(paths, disclosuresPath(kbRoot));
  const rawDisclosures: readonly unknown[] = Array.isArray(frontMatter?.['disclosures'])
    ? frontMatter['disclosures']
    : [];
  const disclosures: Disclosure[] = [];
  let corruptCount = 0;
  for (const row of rawDisclosures) {
    const parsed = disclosureSchema.safeParse(row);
    if (parsed.success) {
      disclosures.push(parsed.data);
    } else {
      corruptCount += 1;
    }
  }
  return { disclosures, corruptCount };
}

function nextDisclosureId(disclosures: readonly Disclosure[]): string {
  const definition = definitionForType('Disclosure');
  const pattern = new RegExp(
    `^${definition.idPrefix}-(\\d{${String(definition.idWidth)}})(-\\d+)?$`,
  );
  let max = 0;
  for (const disclosure of disclosures) {
    const match = pattern.exec(disclosure.id);
    if (match?.[1] === undefined) continue;
    max = Math.max(max, Number(match[1]));
  }
  const next = max + 1;
  const ceiling = 10 ** definition.idWidth - 1;
  if (next > ceiling) {
    throw new ForgeError('KB-018', { id: '', reason: 'id-exhausted', max: ceiling });
  }
  return `${definition.idPrefix}-${String(next).padStart(definition.idWidth, '0')}`;
}

/** `maxLockAttempts` -- round-3 addition: threads `withCollectionLock`'s own injectable attempt-budget
 * override through to `appendDisclosure`/`resolveDisclosure` (this function's only two callers). Left
 * `undefined` (the default, every real production call), `withCollectionLock` applies its own restored
 * original default (`200`/5s) -- the identical "optional, appended last, undefined means take the
 * callee's own default" shape used one layer down. Only `kb-disclosures.test.ts`'s own combined-suite,
 * 28-OS-process stress test passes an explicit wider value, for the real scheduling-contention reason
 * `collection-lock.ts`'s own `DEFAULT_MAX_LOCK_ATTEMPTS` doc comment explains. */
async function withDisclosuresLock<T>(
  paths: ProjectPaths,
  clock: Clock,
  operation: (verifyFence: () => Promise<void>) => Promise<T>,
  maxLockAttempts?: number,
): Promise<T> {
  return withCollectionLock(
    paths,
    clock,
    'disclosures.lock',
    (maxAttempts) =>
      new ForgeError('KB-018', { id: '', reason: 'lock-exhausted', max: maxAttempts }),
    operation,
    maxLockAttempts,
  );
}

/** The STRICT read `appendDisclosure`/`resolveDisclosure` both use to build their own write candidate --
 * unlike `loadDisclosures` above (a read-only view that reports a corrupt row and moves on), this
 * function REFUSES outright (`KB-018` `'corrupt'`, naming the bad row's own `id` when one is readable,
 * else its index) the instant any existing row fails `disclosureSchema`, rather than silently filtering
 * it out of the document a write is about to produce. `specs/22` M15 P10's round-1 gauntlet critic
 * reproduced live, twice, that an earlier version's own `.filter(row => schema.safeParse(row).success)`
 * PERMANENTLY, SILENTLY erased any already-corrupt row the next time anyone ran `forge kb disclose`/
 * `disclose resolve` -- exit 0, no warning -- directly disproving this module's own "a disclosure is
 * never deleted" guarantee via a code path the append-only mutation-evidence test never exercised. A
 * write that cannot prove the WHOLE existing document is still valid must not proceed at all: the fix
 * for a genuinely corrupt `kb/disclosures.md` is a human fixing the bad row by hand, never this command
 * silently deciding the row never existed. */
async function readDisclosuresCandidate(
  paths: ProjectPaths,
  kbRoot: string,
): Promise<{
  readonly disclosures: readonly Disclosure[];
  readonly changelog: readonly unknown[];
  readonly revision: number;
  readonly created: string | undefined;
}> {
  const existing = await readFrontMatter(paths, disclosuresPath(kbRoot));
  const priorDisclosures: readonly unknown[] = Array.isArray(existing?.['disclosures'])
    ? existing['disclosures']
    : [];
  const priorChangelog: readonly unknown[] = Array.isArray(existing?.['changelog'])
    ? existing['changelog']
    : [];
  const priorRevision = typeof existing?.['revision'] === 'number' ? existing['revision'] : 0;
  const disclosures: Disclosure[] = [];
  for (const [index, row] of priorDisclosures.entries()) {
    const parsed = disclosureSchema.safeParse(row);
    if (!parsed.success) {
      const rowId =
        typeof row === 'object' && row !== null && typeof (row as { id?: unknown }).id === 'string'
          ? (row as { id: string }).id
          : `index ${String(index)}`;
      throw new ForgeError('KB-018', { id: rowId, reason: 'corrupt' });
    }
    disclosures.push(parsed.data);
  }
  return {
    disclosures,
    changelog: priorChangelog,
    revision: priorRevision,
    created: typeof existing?.['created'] === 'string' ? existing['created'] : undefined,
  };
}

async function writeDisclosuresCandidate(
  paths: ProjectPaths,
  kbRoot: string,
  candidate: {
    readonly disclosures: readonly Disclosure[];
    readonly changelog: readonly unknown[];
    readonly revision: number;
    readonly created: string | undefined;
    readonly today: string;
    readonly by: string;
    readonly summary: string;
  },
  // Write-time fencing (see `collection-lock.ts`'s own top doc comment): called immediately before
  // the real `writeFileAtomic` commit below, as close to it as this call shape allows -- both of
  // this function's own callers (`appendDisclosure`, `resolveDisclosure`) route through here rather
  // than each remembering its own call, so there is exactly one place in this file that can forget
  // it, not two.
  verifyFence: () => Promise<void>,
): Promise<void> {
  const document = {
    type: 'Disclosure' as const,
    schemaVersion: 1,
    title: 'Disclosure register',
    status: 'active',
    created: candidate.created ?? candidate.today,
    updated: candidate.today,
    revision: candidate.revision + 1,
    author: candidate.by,
    changelog: [
      ...candidate.changelog,
      {
        revision: candidate.revision + 1,
        date: candidate.today,
        by: candidate.by,
        summary: candidate.summary,
      },
    ],
    disclosures: candidate.disclosures,
  };
  const parsed = disclosuresFileSchema.safeParse(document);
  if (!parsed.success) {
    throw new RangeError(
      `disclosuresFileSchema rejected a disclosures.md write: ${parsed.error.message}`,
    );
  }
  await verifyFence();
  await writeFileAtomic(
    paths.resolveWithin(disclosuresPath(kbRoot)),
    `---\n${YAML.stringify(parsed.data)}---\n`,
  );
}

export interface AppendDisclosureInput {
  readonly kind: DisclosureKind;
  readonly summary: string;
  readonly owner: string;
  readonly sources: readonly ArtifactSource[];
}

/** Appends one new, unresolved `DISC-###` entry to `kb/disclosures.md`, creating it if absent, under a
 * real cross-process lock. Returns the newly allocated id. Never removes or rewrites an existing
 * entry -- the append-only half of "a disclosure is never deleted, only resolved with a reason."
 *
 * `maxLockAttempts` (round 3): an optional, test-only override of the lock's own attempt budget --
 * `undefined` (every real `forge kb disclose` call) takes `withCollectionLock`'s own restored
 * production default (`200`/5s); see `withDisclosuresLock`'s own doc comment just above. */
export async function appendDisclosure(
  paths: ProjectPaths,
  kbRoot: string,
  clock: Clock,
  input: AppendDisclosureInput,
  maxLockAttempts?: number,
): Promise<string> {
  return withDisclosuresLock(
    paths,
    clock,
    async (verifyFence) => {
      const existing = await readDisclosuresCandidate(paths, kbRoot);
      const id = nextDisclosureId(existing.disclosures);
      const today = clock.now().slice(0, 10);
      await writeDisclosuresCandidate(
        paths,
        kbRoot,
        {
          ...existing,
          disclosures: [
            ...existing.disclosures,
            { id, ...input, sources: [...input.sources], resolved: false },
          ],
          today,
          by: input.owner,
          summary: `Disclosed ${input.kind} ${id}: ${input.summary}`,
        },
        verifyFence,
      );
      return id;
    },
    maxLockAttempts,
  );
}

export interface ResolveDisclosureInput {
  readonly id: string;
  readonly reason: string;
  readonly by: string;
}

/** Marks an existing `Disclosure` resolved IN PLACE -- `disclosures` is re-mapped, never filtered, so
 * the array's own length (and every other entry's own content) can only ever grow or stay the same,
 * never shrink: the structural half of "a disclosure is never deleted," independent of whatever a
 * future caller might otherwise be tempted to splice out. `@throws {ForgeError}` `KB-018`
 * `'not-found'` (no entry has this id) or `'already-resolved'` (a resolution is a one-way door, never
 * re-applied).
 *
 * `maxLockAttempts` (round 3): the identical optional, test-only lock-budget override
 * `appendDisclosure`'s own doc comment explains -- `undefined` for every real `forge kb disclose
 * resolve` call. */
export async function resolveDisclosure(
  paths: ProjectPaths,
  kbRoot: string,
  clock: Clock,
  input: ResolveDisclosureInput,
  maxLockAttempts?: number,
): Promise<void> {
  return withDisclosuresLock(
    paths,
    clock,
    async (verifyFence) => {
      const existing = await readDisclosuresCandidate(paths, kbRoot);
      const target = existing.disclosures.find((disclosure) => disclosure.id === input.id);
      if (target === undefined) {
        throw new ForgeError('KB-018', { id: input.id, reason: 'not-found' });
      }
      if (target.resolved) {
        throw new ForgeError('KB-018', { id: input.id, reason: 'already-resolved' });
      }
      const today = clock.now().slice(0, 10);
      const resolved: readonly Disclosure[] = existing.disclosures.map((disclosure) =>
        disclosure.id === input.id
          ? {
              ...disclosure,
              resolved: true,
              resolution: { reason: input.reason, by: input.by, at: today },
            }
          : disclosure,
      );
      await writeDisclosuresCandidate(
        paths,
        kbRoot,
        {
          ...existing,
          disclosures: resolved,
          today,
          by: input.by,
          summary: `Resolved ${input.id}: ${input.reason}`,
        },
        verifyFence,
      );
    },
    maxLockAttempts,
  );
}

/** One row of the MERGED ledger view `forge kb disclosures`/`forge doctor` both read -- a real,
 * explicitly-authored `Disclosure`, or a row synthesized fresh, at read time, from exemptions.md or
 * the event log. `synthesized: true` rows have no independent resolution lifecycle of their own
 * (`resolveDisclosure` only ever operates on a real `Disclosure` id) -- they are a live VIEW onto
 * another system's own already-real state, not a second, independently-driftable copy of it. */
export interface DisclosureLedgerEntry {
  readonly id: string;
  readonly kind: DisclosureKind | 'exemption' | 'stopped-critic-loop';
  readonly summary: string;
  readonly owner: string;
  readonly open: boolean;
  readonly synthesized: boolean;
}

interface SynthesizedExemptionEntries {
  readonly entries: readonly DisclosureLedgerEntry[];
  /** `specs/22` M15 P10's round-2 gauntlet critic found this function silently inherited
   * `loadExemptions`'s own pre-fix "one corrupt row zeroes the whole collection" bug -- a real,
   * in-force exemption could vanish from this ledger with literally zero signal anywhere, since
   * `reports/exemptions.md` lives outside `kb/` and gets no `forge kb lint` safety net the way
   * `kb/disclosures.md` already does. `loadExemptions` itself is now fixed (per-row-tolerant,
   * `LoadExemptionsResult.corruptCount`); this field threads that same honest count up into
   * `DisclosureLedger`'s own combined total, exactly as `loadDisclosures`'s own `corruptCount` already
   * does for disclosures. */
  readonly corruptCount: number;
}

async function synthesizeExemptionEntries(
  paths: ProjectPaths,
  reportsRoot: string,
  todayIso: string,
): Promise<SynthesizedExemptionEntries> {
  const { exemptions, corruptCount } = await loadExemptions(paths, reportsRoot);
  return {
    entries: exemptions.map((exemption) => ({
      id: exemption.id,
      kind: 'exemption' as const,
      summary: `${exemption.testId}: ${exemption.reason}`,
      owner: exemption.owner,
      // The identical `<=` fail-closed direction `applyExemptions` already uses: expiring ON today is
      // already expired, not still valid for one more day.
      open: exemption.expiry > todayIso,
      synthesized: true,
    })),
    corruptCount,
  };
}

async function synthesizeCriticLoopEntries(
  paths: ProjectPaths,
  projectRoot: string,
): Promise<readonly DisclosureLedgerEntry[]> {
  const runIds = await listRunIds(paths);
  const entries: DisclosureLedgerEntry[] = [];
  for (const runId of runIds) {
    for await (const event of readEvents(projectRoot, runId)) {
      if (event.type !== 'StepFailed') continue;
      const payload = event.payload;
      if (typeof payload !== 'object' || payload === null) continue;
      const code = (payload as { readonly code?: unknown }).code;
      if (code !== 'RUN-113') continue;
      const cause = (payload as { readonly cause?: unknown }).cause;
      const details =
        typeof cause === 'object' && cause !== null
          ? (cause as { readonly details?: unknown }).details
          : undefined;
      const rounds =
        typeof details === 'object' && details !== null
          ? (details as { readonly rounds?: unknown }).rounds
          : undefined;
      const count =
        typeof details === 'object' && details !== null
          ? (details as { readonly count?: unknown }).count
          : undefined;
      entries.push({
        id: `RUN-113:${runId}:${event.stepId ?? 'unknown-step'}`,
        kind: 'stopped-critic-loop',
        summary: `${event.stepId ?? 'a review step'} stopped after ${typeof rounds === 'number' ? String(rounds) : '?'} round(s): ${typeof count === 'number' ? String(count) : '?'} blocking finding(s) survived.`,
        owner: 'unassigned',
        // Disclosed, not solved (this module's own top doc comment): no automatic resolution tracking
        // for this synthesized kind -- every genuinely-exhausted RUN-113 this scan finds stays open.
        open: true,
        synthesized: true,
      });
    }
  }
  return entries;
}

export interface DisclosureLedgerContext {
  readonly paths: ProjectPaths;
  readonly projectRoot: string;
  readonly kbRoot: string;
  readonly reportsRoot: string;
  readonly now: Date;
}

/** `listDisclosureLedger`'s own result: the merged entries, PLUS two SEPARATE, named corrupt counts --
 * `disclosureCorruptCount` (`kb/disclosures.md`, `loadDisclosures`'s own doc comment has the full
 * original reasoning: a round-1 gauntlet critic found an earlier version of this function discarded
 * that signal entirely) and `exemptionCorruptCount` (`reports/exemptions.md`, `loadExemptions`'s own
 * doc comment has the parallel story: a round-2 gauntlet critic found this SECOND collection file had
 * the identical pre-fix bug, silently dropping every real, in-force exemption alongside one corrupt
 * row, with literally zero signal anywhere since that file lives outside `kb/` and gets no `forge kb
 * lint` safety net). Named separately, not summed into one total: the two failures point a reader at
 * two DIFFERENT files to fix (`kb/disclosures.md` vs `reports/exemptions.md`), and a single combined
 * number would force a caller to re-derive which file is actually broken before they could act on it.
 * A caller that ignores either field gets the identical, honest "every row this read COULD parse"
 * behavior as before; one that surfaces them (`forge doctor`, `forge kb disclosures`) can tell a
 * reader "the count below may be incomplete, and exactly which file to look at." */
export interface DisclosureLedger {
  readonly entries: readonly DisclosureLedgerEntry[];
  readonly disclosureCorruptCount: number;
  readonly exemptionCorruptCount: number;
}

/** The full, merged ledger: every real `Disclosure` (resolved or not) plus every synthesized
 * exemption/stopped-critic-loop row, in one list a caller filters for itself (`forge kb disclosures`
 * shows all of it; `forge doctor`'s own count is `.filter(e => !e.resolved-equivalent).length`, i.e.
 * every real, unresolved `Disclosure` plus every synthesized row whose own `open` is `true`). */
export async function listDisclosureLedger(
  ctx: DisclosureLedgerContext,
): Promise<DisclosureLedger> {
  const todayIso = ctx.now.toISOString().slice(0, 10);
  const { disclosures: real, corruptCount: disclosureCorruptCount } = await loadDisclosures(
    ctx.paths,
    ctx.kbRoot,
  );
  const realEntries: DisclosureLedgerEntry[] = real.map((disclosure) => ({
    id: disclosure.id,
    kind: disclosure.kind,
    summary: disclosure.summary,
    owner: disclosure.owner,
    open: !disclosure.resolved,
    synthesized: false,
  }));
  const [exemptionResult, criticLoopEntries] = await Promise.all([
    synthesizeExemptionEntries(ctx.paths, ctx.reportsRoot, todayIso),
    synthesizeCriticLoopEntries(ctx.paths, ctx.projectRoot),
  ]);
  return {
    entries: [...realEntries, ...exemptionResult.entries, ...criticLoopEntries],
    disclosureCorruptCount,
    exemptionCorruptCount: exemptionResult.corruptCount,
  };
}
