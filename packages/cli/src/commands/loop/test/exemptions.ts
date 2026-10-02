/**
 * `loadExemptions`/`appendExemption`/`applyExemptions` — `specs/22` M15 P6: a mutation-binding
 * exemption, declared once (`forge test exempt`), checked on every later `forge test binding`/`forge
 * story verify` run.
 *
 * `testId` is always the FULLY QUALIFIED `"<storyId>: <testName>"` form (`exemption.ts`'s own doc
 * comment has the full reasoning: a bare name can collide across two different stories' own test
 * suites). `applyExemptions` is the one place that builds and compares this qualified key, so both
 * `forge test binding`'s own single-story mode (whose own `nonBinding` output stays bare, unprefixed,
 * for M15 P4's already-shipped contract) and its discover mode (M15 P5, which prefixes afterward) and
 * `forge story verify`'s own `checkBinding` (M15 P5) all match against the identical key, never three
 * independently-drifting copies of the same comparison.
 *
 * `reports/exemptions.md` is a `collection: true` artifact (`18` §18.7) — one shared, repeatedly
 * modified file, never a write-once-per-record file the way `MutationEvidence` is (M15 P2's own
 * `writeNewFileAtomic`): `appendExemption` reads the whole file, adds one entry, and writes the whole
 * file back, the identical "read-modify-write a collection file" discipline `packages/kb/src/adopt/
 * artifacts.ts`'s own `appendRiskEntry` already establishes for `Risk`/`OpenQuestion` (a different
 * package, so not directly importable). `nextExemptionId` deliberately never calls
 * `IdAllocator.allocate('Exemption')`: `appendRiskEntry`'s own doc comment records a real, reproduced
 * bug where the shared, project-wide allocator's scan only ever reads a document's own top-level `id`
 * field, never INSIDE a `collection: true` type's own array, so two calls would silently collide on
 * the same id (confirmed there with a real repro before that fix; not re-proven here, since the fix
 * this module takes is identical by construction, not a rediscovery).
 *
 * `withExemptionsLock` (`.forge/state/exemptions.lock`) is a REAL, cross-process lock, not the
 * in-process `Promise`-queue this module shipped with first: two independent, fresh-context gauntlet
 * critics (round 1) each independently reproduced live that a plain in-process queue gives two
 * SEPARATE `forge test exempt` processes -- the only way this command is ever actually invoked --
 * nothing at all (each process owns its own, empty queue), so two real, concurrent CLI invocations
 * silently raced the same read-modify-write and one call's own write clobbered the other's, both
 * exiting 0 and believing they had succeeded. See `withExemptionsLock`'s own doc comment for the fix.
 *
 * @see specs/13-frameworks-testing-and-debugging.md F-TEST-8
 * @see specs/18-persistence-config-and-schemas.md §18.7
 * @see specs/22 M15 P6
 * @see PLAN-M15.md P6
 */
import type { Clock } from '@forge/core';
import { ForgeError } from '@forge/core/errors';
import { pathExists, readTextFile, writeFileAtomic, type ProjectPaths } from '@forge/core/fs';
import {
  definitionForType,
  exemptionSchema,
  exemptionsFileSchema,
  type Exemption,
} from '@forge/schemas';
import * as YAML from 'yaml';

import { withCollectionLock } from '../../collection-lock.ts';
import { emitExemptionDeclaredTelemetry } from './check-telemetry.ts';

const EXEMPTIONS_RELATIVE_PATH = 'exemptions.md';

function exemptionsPath(reportsRoot: string): string {
  return `${reportsRoot}/${EXEMPTIONS_RELATIVE_PATH}`;
}

/** The qualified key `applyExemptions`/`appendExemption` both compare `Exemption.testId` against --
 * `"<storyId>: <testName>"`, the identical format discover mode's own `nonBinding`/`bound` arrays
 * already use (`specs/22` M15 P5). */
export function qualifiedTestId(storyId: string, testName: string): string {
  return `${storyId}: ${testName}`;
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

/** `loadExemptions`'s own result: every row this read COULD parse, PLUS an honest count of how many
 * rows it could not -- `specs/22` M15 P10's round-2 gauntlet critic found this module's own
 * whole-document `exemptionsFileSchema.safeParse` meant one schema-invalid row (a hand-edit, a future
 * schema migration with no matching data migration) made the ENTIRE read silently return `[]`,
 * dropping every OTHER, genuinely valid, in-force exemption along with it -- the identical bug
 * `loadDisclosures` (`kb-disclosures.ts`) already had and was fixed for in M15 P10's own round-1, now
 * newly load-bearing here too since `kb-disclosures.ts`'s own `synthesizeExemptionEntries` calls this
 * function directly to produce the ledger's "an exemption appears automatically" row -- and unlike
 * `kb/disclosures.md`, `reports/exemptions.md` lives outside the `kb/` tree and gets no `forge kb lint`
 * safety net at all, so a corrupt row here failed with ZERO signal anywhere. `corruptCount > 0` is the
 * same honest signal `LoadDisclosuresResult` already surfaces, now threaded through this sibling type
 * for the identical reason. */
export interface LoadExemptionsResult {
  readonly exemptions: readonly Exemption[];
  readonly corruptCount: number;
}

/** Every declared exemption in the project this read could parse, regardless of which story it names --
 * callers filter to their own story via `qualifiedTestId`. Read PER ROW, not as one whole-document
 * parse, specifically so one corrupt row cannot hide every other, genuinely valid one from a reader
 * (`LoadExemptionsResult`'s own doc comment has the full reasoning). An absent or genuinely empty
 * `reports/exemptions.md` reads as `{exemptions: [], corruptCount: 0}`, the identical "this file is
 * optional" stance it already took before this fix: a project that has never run `forge test exempt`
 * must behave exactly as M15 P4/P5 already did before this piece existed. This function never writes
 * anything, so a corrupt row found here is reported, never silently dropped -- `appendExemption`'s own
 * write path (below) still refuses the whole write outright on the identical condition, as it already
 * did (its own `exemptionsFileSchema.safeParse` on the full candidate document, at write time). */
export async function loadExemptions(
  paths: ProjectPaths,
  reportsRoot: string,
): Promise<LoadExemptionsResult> {
  const frontMatter = await readFrontMatter(paths, exemptionsPath(reportsRoot));
  const rawExemptions: readonly unknown[] = Array.isArray(frontMatter?.['exemptions'])
    ? frontMatter['exemptions']
    : [];
  const exemptions: Exemption[] = [];
  let corruptCount = 0;
  for (const row of rawExemptions) {
    const parsed = exemptionSchema.safeParse(row);
    if (parsed.success) {
      exemptions.push(parsed.data);
    } else {
      corruptCount += 1;
    }
  }
  return { exemptions, corruptCount };
}

/** The next free id for `Exemption` inside *this collection file's own array* -- never the shared,
 * project-wide `IdAllocator` (this module's own top doc comment has the full reasoning).
 *
 * `@throws {ForgeError}` `GATE-515` (`'id-exhausted'`) once `idWidth` digits are full -- the identical
 * "refuse, never silently widen or wrap the id" stance `GATE-514` already takes for the same
 * exhaustion case on `GateReport` (`packages/core/src/errors/codes.ts`), reused here rather than
 * invented a second way for the same class of problem. Not reached by any real project today (999
 * exemptions), but a silent wrap/overflow into a colliding or malformed id is strictly worse than a
 * clean refusal, so this is checked rather than assumed unreachable. */
function nextExemptionId(exemptions: readonly Exemption[], testId: string): string {
  const definition = definitionForType('Exemption');
  const pattern = new RegExp(
    `^${definition.idPrefix}-(\\d{${String(definition.idWidth)}})(-\\d+)?$`,
  );
  let max = 0;
  for (const exemption of exemptions) {
    const match = pattern.exec(exemption.id);
    if (match?.[1] === undefined) continue;
    max = Math.max(max, Number(match[1]));
  }
  const next = max + 1;
  const ceiling = 10 ** definition.idWidth - 1;
  if (next > ceiling) {
    throw new ForgeError('GATE-515', { testId, reason: 'id-exhausted', max: ceiling });
  }
  return `${definition.idPrefix}-${String(next).padStart(definition.idWidth, '0')}`;
}

/** `specs/22` M15 P10: `withExemptionsLock` is now a thin wrapper over `withCollectionLock`
 * (`../../collection-lock.ts`) -- the full original diagnosis (every bug found and fixed across all
 * three M15 P6 gauntlet rounds: a real failure of the exclusive-create primitive's own atomicity
 * under heavy I/O contention, a `resolveState`-path TOCTOU race in shared `@forge/core/fs`
 * infrastructure, an immediate-reclaim rule unsafe against an ordinary in-flight writer, and a
 * reclaim's own `ENOENT` race against a concurrent read-back) now lives in that shared module's own
 * doc comment, extracted rather than duplicated so this piece's own sibling collection file
 * (`kb/disclosures.md`, M15 P10) does not re-fight the identical hard concurrency problem from
 * scratch. See `SPEC-QUESTIONS.md`'s own `## Q285` for the complete record. */
async function withExemptionsLock<T>(
  paths: ProjectPaths,
  clock: Clock,
  operation: () => Promise<T>,
): Promise<T> {
  return withCollectionLock(
    paths,
    clock,
    'exemptions.lock',
    (maxAttempts) =>
      new ForgeError('GATE-515', { testId: '', reason: 'lock-exhausted', max: maxAttempts }),
    operation,
  );
}

export interface AppendExemptionInput {
  readonly testId: string;
  readonly reason: string;
  readonly owner: string;
  readonly expiry: string;
}

/** Appends one new `EXEMPT-###` entry to `reports/exemptions.md`, creating it if absent, under a real
 * cross-process lock (`withExemptionsLock`). Returns the newly allocated id. Does NOT validate
 * `owner`/`expiry`-cap policy itself (`forge test exempt`'s own CLI layer calls
 * `isWaiverOwnerIdentifier`/`waiverExceedsCap` first, the identical functions `forge gate waive`
 * already uses, before ever reaching this function) or confirm the named test is genuinely non-binding
 * (the CLI layer's own job too, `GATE-515` `'exempts-a-binding-test'`) -- those two refusals are the
 * CLI layer's job. The one policy check this function DOES make itself, because it is inherent to the
 * id it allocates, not a property of the caller's own input: `nextExemptionId`'s own `GATE-515`
 * `'id-exhausted'` refusal.
 *
 * `telemetry` (`specs/22` M15 P11 metric 4a): fired once this write genuinely commits, never before
 * -- a refused or failed declaration records no event for an exemption that was never actually
 * durable. `undefined` `runId` (no real `forge run` in progress, the common case: this command has
 * exactly one real caller, `forge test exempt`, which no shipped workflow ever runs as a step) emits
 * nothing, the identical `FORGE_RUN_ID`-gated stance `check-telemetry.ts`'s own doc comment explains. */
export async function appendExemption(
  paths: ProjectPaths,
  reportsRoot: string,
  clock: Clock,
  input: AppendExemptionInput,
  telemetry: { readonly projectRoot: string; readonly runId: string | undefined },
): Promise<string> {
  const relativePath = exemptionsPath(reportsRoot);
  const id = await withExemptionsLock(paths, clock, async () => {
    const existing = await readFrontMatter(paths, relativePath);
    const priorExemptions: readonly unknown[] = Array.isArray(existing?.['exemptions'])
      ? existing['exemptions']
      : [];
    const priorChangelog: readonly unknown[] = Array.isArray(existing?.['changelog'])
      ? existing['changelog']
      : [];
    const priorRevision = typeof existing?.['revision'] === 'number' ? existing['revision'] : 0;
    const today = clock.now().slice(0, 10);
    const id = nextExemptionId(
      priorExemptions.filter((row): row is Exemption => exemptionSchema.safeParse(row).success),
      input.testId,
    );
    const candidate = {
      type: 'Exemption' as const,
      schemaVersion: 1,
      title: 'Exemption register',
      status: 'active',
      created: (existing?.['created'] as string | undefined) ?? today,
      updated: today,
      revision: priorRevision + 1,
      author: input.owner,
      changelog: [
        ...priorChangelog,
        {
          revision: priorRevision + 1,
          date: today,
          by: input.owner,
          summary: `Exempted ${input.testId} (${id}).`,
        },
      ],
      exemptions: [...priorExemptions, { id, ...input }],
    };
    const parsed = exemptionsFileSchema.safeParse(candidate);
    if (!parsed.success) {
      throw new RangeError(
        `exemptionsFileSchema rejected a new exemption: ${parsed.error.message}`,
      );
    }
    await writeFileAtomic(
      paths.resolveWithin(relativePath),
      `---\n${YAML.stringify(parsed.data)}---\n`,
    );
    return id;
  });
  await emitExemptionDeclaredTelemetry({
    projectRoot: telemetry.projectRoot,
    runId: telemetry.runId,
    clock,
    exemptionId: id,
    testId: input.testId,
    owner: input.owner,
    expiry: input.expiry,
  });
  return id;
}

export interface ExemptionApplication {
  /** `rawNonBinding`, minus every test a valid (not stale, not expired) exemption names. */
  readonly nonBinding: readonly string[];
  /** A declared exemption for this story whose own `testId` matches no test in `rawNonBinding` at
   * all -- the code was fixed, the test was renamed, or the exemption was copy-pasted wrong. Reported
   * as a `'problem'` outcome (a plain string, `GATE-515`'s own doc comment has the full reasoning for
   * why this is not a thrown code), never silently dropped. */
  readonly staleExemptions: readonly Exemption[];
  /** A declared exemption for this story whose own `expiry` has already passed, regardless of
   * whether it would otherwise have matched. Reported the same way. */
  readonly expiredExemptions: readonly Exemption[];
}

/** Applies every exemption that names `storyId` (via `qualifiedTestId`) to one story's own raw
 * binding-check result. Pure: no I/O, no clock of its own -- `todayIso` (`YYYY-MM-DD`) is the
 * caller's own already-resolved "today," the identical determinism-mandate reason (`21` §21.1) every
 * other clock-reading function in this codebase takes `now` as a plain argument. */
export function applyExemptions(
  storyId: string,
  rawNonBinding: readonly string[],
  allExemptions: readonly Exemption[],
  todayIso: string,
): ExemptionApplication {
  const prefix = `${storyId}: `;
  const relevant = allExemptions.filter((exemption) => exemption.testId.startsWith(prefix));
  // `<=`, not `<`: an exemption expiring ON `todayIso` is already expired, not still valid for one
  // more day -- the identical fail-closed direction `applyWaiver` (`@forge/engine/gates/waiver.ts`)
  // already takes for a waiver expiring at exactly `now` ("not still valid for one more instant").
  const expiredExemptions = relevant.filter((exemption) => exemption.expiry <= todayIso);
  const expiredIds = new Set(expiredExemptions.map((exemption) => exemption.id));
  const staleExemptions = relevant.filter(
    (exemption) =>
      !expiredIds.has(exemption.id) &&
      !rawNonBinding.includes(exemption.testId.slice(prefix.length)),
  );
  const invalidIds = new Set([...expiredExemptions, ...staleExemptions].map((e) => e.id));
  const appliedNames = new Set(
    relevant
      .filter((exemption) => !invalidIds.has(exemption.id))
      .map((exemption) => exemption.testId.slice(prefix.length)),
  );
  return {
    nonBinding: rawNonBinding.filter((name) => !appliedNames.has(name)),
    staleExemptions,
    expiredExemptions,
  };
}

/** One human-readable line per stale/expired exemption, for the `'problem'` outcome's own text --
 * never a thrown `ForgeError`: `codes.ts`'s own `GATE-515` doc comment explains why a later, real-
 * check-time finding is not the same kind of event as `forge test exempt`'s own declaration-time
 * refusals. */
export function describeExemptionProblems(application: ExemptionApplication): readonly string[] {
  const problems: string[] = [];
  for (const exemption of application.staleExemptions) {
    problems.push(
      `${exemption.testId}'s own exemption (${exemption.id}) is stale: no currently non-binding test matches it.`,
    );
  }
  for (const exemption of application.expiredExemptions) {
    problems.push(
      `${exemption.testId}'s own exemption (${exemption.id}, owner ${exemption.owner}) expired on ${exemption.expiry}.`,
    );
  }
  return problems;
}
