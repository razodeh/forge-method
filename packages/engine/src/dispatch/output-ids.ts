/**
 * `output-ids.ts` — a supervisor-reserved, collision-free id for a numbered artifact type, shared by
 * every caller that needs one before it can write a file: the `mode: swarm-review` `ReviewReport`
 * queue (`PLAN-M13.md` P17, `SPEC-QUESTIONS.md` Q217) and, from this piece on, a declared KB output
 * (`ADR`, `Runbook`, `Risk`, `Assumption`, `OpenQuestion`, `Environment` — every `18` §18.7 registry
 * type whose `pathTemplate` starts `kb/`, `SPEC-QUESTIONS.md` Q232 decision 2).
 *
 * This is a GENERALISATION of `swarm-review-step.ts`'s own `REVIEW-NNN` queue (`PLAN-M13.md` P17),
 * parameterised by `(idPrefix, idWidth, scan target, count)` instead of hard-coded to `REVIEW`/3/the
 * reviews directory/1 — not a rebuild: the numbering RULE is unchanged (the smallest number above
 * everything visible in the trees a later merge would collide with, and above every reservation this
 * run's own other steps already hold), so `swarm-review-step.ts`'s 45 pinned test cases pass through
 * this module with byte-identical behaviour.
 *
 * **Two scan shapes.** A per-file KB type (`ADR`, `Runbook`, and `ReviewReport`) claims one number per
 * file, `<PREFIX>-<digits>(-<slug>)?.md`, directly under a fixed directory (`directoryIdScan`). A
 * `collection: true` register type (`Risk`, `Assumption`, `OpenQuestion`, `Environment`) claims one
 * number per ENTRY inside a single shared file's front matter (`registerIdScan`) — there is no
 * per-entry file to list, so the numbers come from parsing the file `@forge/schemas`'s own KB register
 * schemas already validate (`08` §8.2's "registers"). Neither scanner needs `dispatch/outputs.ts`'s own
 * private `registerEntries`/`entryId`/`sectionRoot` (this piece's own Surface does not touch that
 * file, `P10`'s territory): the tiny amount of shape they would have supplied is duplicated here in
 * miniature, the same "duplicate the shape, not the private symbol" precedent `steps.ts`'s own
 * `CLAIM_FAILURE_CONTROL_CHARS` already sets for the identical reason.
 *
 * **Pending vs. lane-bound.** `REVIEW-NNN` is always reserved with a lane already in hand (inside the
 * lane the report will be written into, `writeReport`): from the moment it exists, `existsSync` on that
 * lane's own worktree path is a sound liveness check (P17's `pruneReservations`). A declared KB
 * output's id, by contrast, must be visible to the AGENT'S OWN PROMPT — decided before assembly, before
 * any lane exists at all (`PLAN-M14.md` P8's own mandate: "reserves BEFORE `tryAssemble`"). Naively
 * reusing `existsSync` liveness for a reservation with no lane yet would immediately read as dead (no
 * path exists to check) and let a concurrent step take the same number before either ever got a lane —
 * the exact "P17's `existsSync` liveness would drop a pre-lane reservation" bug this module's own
 * `IdReservation.bind`/`.release` are built to avoid: a reservation with no `lane` yet is `pending` and
 * is NEVER pruned by liveness, only by an explicit `.release()` (the step ended without ever getting a
 * lane) or by `.bind(lanePath)` moving it into the ordinary, liveness-pruned state once
 * `createLaneForStep` actually produces one.
 *
 * @see specs/18 §18.8
 * @see specs/06 §6.4, §6.7
 * @see specs/05 §5.5
 * @see PLAN-M14.md P8
 * @see PLAN-M13.md P17
 * @see SPEC-QUESTIONS.md Q217, Q232 decision 2
 */
import { existsSync } from 'node:fs';
import path from 'node:path';

import { ArtifactDocument } from '@forge/core/artifacts';
import { ForgeError, isForgeError } from '@forge/core/errors';
import {
  ProjectPaths,
  listDirSorted,
  pathExists,
  readTextFile,
  type AbsolutePath,
} from '@forge/core/fs';
import { artifactTypeById, type ArtifactTypeDefinition } from '@forge/schemas';

import type { StepNode } from '../plan/index.ts';
import { docRootsOf } from './outputs.ts';
import type { DocRoots, ExecuteStepContext } from './types.ts';

/** One already-claimed number, per `numbersIn` call — never negative, never `NaN` (both scanners only
 * ever push the result of a bounded `\d+` regex capture through `Number.parseInt`). */
export interface ScanTarget {
  /** Every number this id space already claims at `root` — `[]` when `root` holds nothing to scan (an
   * absent directory or register file claims nothing; not an error). */
  numbersIn(root: string): Promise<readonly number[]>;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Skips a root a scan cannot reach at all (no such directory/file, or a symlink that would carry the
 * scan out of `root`'s own tree, `CFG-003`): such a root holds nothing a later merge of THIS tree could
 * ever collide with, the identical reasoning `swarm-review-step.ts`'s own `reportFilesIn` already
 * gives. Any other failure is a real one and still propagates. */
function resolveWithinOrSkip(root: string, relative: string): AbsolutePath | undefined {
  try {
    return new ProjectPaths(root).resolveWithin(relative);
  } catch (cause) {
    if (isForgeError(cause) && cause.code === 'CFG-003') return undefined;
    throw cause;
  }
}

/**
 * One id per FILE, directly under `dir`: `REVIEW-NNN.md`, `ADR-0007-title.md`, `RUN-001-title.md` (a
 * per-file KB type's `pathTemplate` ends `{id}-{slug}.md` or `{id}.md`; either way the FILE's own name
 * starts `<PREFIX>-<digits>`, which is all this scanner needs — it does not resolve the rest of the
 * template).
 */
export function directoryIdScan(dir: string, idPrefix: string, idWidth: number): ScanTarget {
  const pattern = new RegExp(`^${escapeRegExp(idPrefix)}-(\\d{${String(idWidth)}})(?:-.*)?\\.md$`);
  return {
    async numbersIn(root: string): Promise<readonly number[]> {
      const target = resolveWithinOrSkip(root, dir);
      if (target === undefined || !(await pathExists(target))) return [];
      const numbers: number[] = [];
      for (const name of await listDirSorted(target)) {
        const match = pattern.exec(name);
        if (match?.[1] !== undefined) numbers.push(Number.parseInt(match[1], 10));
      }
      return numbers;
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Every entry id a register file's already-parsed front matter holds: every array field except
 * `changelog` (metadata, not entries), whichever key it lives under — a collection type's own array key
 * (`risks`, `assumptions`, ...) is `@forge/schemas`' own private naming, not this module's to know;
 * scanning every array field finds it regardless, the identical "no key" fallback
 * `dispatch/outputs.ts`'s own `registerEntries` already uses for the types that have none at all. */
function entryIdsIn(frontMatter: Record<string, unknown>): readonly string[] {
  const ids: string[] = [];
  for (const [key, value] of Object.entries(frontMatter)) {
    if (key === 'changelog' || !Array.isArray(value)) continue;
    for (const entry of value) {
      if (isRecord(entry) && typeof entry['id'] === 'string') ids.push(entry['id']);
    }
  }
  return ids;
}

/**
 * One id per ENTRY inside the single shared file at `file` (a `collection: true` register type: `Risk`,
 * `Assumption`, `OpenQuestion`, `Environment`) — there is one file per project tree, not one per id, so
 * `directoryIdScan`'s directory listing does not apply; every entry's own `id` field is read instead.
 * A file that does not exist, is not a git-tracked document, or does not parse claims no numbers (the
 * identical "best-effort, never fatal" stance `@forge/core/ids`'s own `countIdsFromFiles` takes for the
 * same reason: a scan that aborted on the first malformed file would never finish).
 */
export function registerIdScan(file: string, idPrefix: string, idWidth: number): ScanTarget {
  const pattern = new RegExp(`^${escapeRegExp(idPrefix)}-(\\d{${String(idWidth)}})$`);
  return {
    async numbersIn(root: string): Promise<readonly number[]> {
      const target = resolveWithinOrSkip(root, file);
      if (target === undefined || !(await pathExists(target))) return [];
      let frontMatter: Record<string, unknown>;
      try {
        const text = await readTextFile(target);
        frontMatter = ArtifactDocument.parse(text, file).frontMatter as Record<string, unknown>;
      } catch {
        return [];
      }
      const numbers: number[] = [];
      for (const id of entryIdsIn(frontMatter)) {
        const match = pattern.exec(id);
        if (match?.[1] !== undefined) numbers.push(Number.parseInt(match[1], 10));
      }
      return numbers;
    },
  };
}

function formatId(idPrefix: string, idWidth: number, numeric: number): string {
  return `${idPrefix}-${String(numeric).padStart(idWidth, '0')}`;
}

interface ReservationRecord {
  base: number;
  readonly count: number;
  /** `undefined` = pending: not yet bound to a real lane, so liveness (`existsSync`) must never prune
   * it — see this module's own doc comment. */
  lane: string | undefined;
}

/** Keyed by `(project, run, idPrefix)`: one FIFO queue and one reservation table per numbered id space,
 * so REVIEW/ADR/RUN(Runbook)/RISK/ASM/OQ/ENV each serialise and collide independently — a fan-out
 * declaring both an ADR and a Runbook reserves both without either queueing behind the other. */
const queues = new Map<string, Promise<unknown>>();
const handedOut = new Map<string, Map<string, ReservationRecord>>();

function reservationKey(projectRoot: string, runId: string, idPrefix: string): string {
  return JSON.stringify([path.resolve(projectRoot), runId, idPrefix]);
}

/** Runs `operation` after every earlier one under `key` has settled, in call order — the identical
 * per-key FIFO `swarm-review-step.ts`'s own `enqueue` already used, moved here unchanged (P17's own
 * doc comment: dropped once nothing is waiting behind it, so a long-lived process does not accumulate
 * one queue per run forever). */
function enqueue<T>(key: string, operation: () => Promise<T>): Promise<T> {
  const previous = queues.get(key) ?? Promise.resolve();
  const result = previous.then(operation, operation);
  const tail = result.then(
    () => undefined,
    () => undefined,
  );
  queues.set(key, tail);
  void tail.then(() => {
    if (queues.get(key) === tail) queues.delete(key);
  });
  return result;
}

/** Drops every LANE-BOUND reservation (`lane !== undefined`) whose lane worktree no longer exists, and
 * every id space left with no reservation at all. A `pending` reservation (no lane yet) is untouched —
 * see this module's own doc comment for why pruning it here would be the exact bug this piece exists to
 * avoid. */
function pruneReservations(key: string): void {
  const reserved = handedOut.get(key);
  if (reserved === undefined) return;
  for (const [stepId, entry] of reserved) {
    if (entry.lane !== undefined && !existsSync(entry.lane)) reserved.delete(stepId);
  }
  if (reserved.size === 0) handedOut.delete(key);
}

/** One reservation, live in `handedOut` from the moment `reserveIds` returns until it is bound to a
 * lane (from then on, liveness governs it exactly as `REVIEW-NNN` always has) or released outright. */
export interface IdReservation {
  /** `count` ids, contiguous and in order, already formatted (`<PREFIX>-<digits>`). */
  readonly ids: readonly string[];
  /** Moves this reservation from `pending` to lane-bound: from now on it is dropped, like every other
   * lane-bound reservation, the moment `lanePath` no longer exists on disk. Idempotent, and safe to call
   * even if a later reservation for the same step has since superseded this one (a no-op then). */
  bind(lanePath: string): void;
  /** Forgets this reservation outright, freeing its numbers for the next reservation in this id space —
   * call when the step ends without ever getting a lane. Idempotent for the same reason `bind` is. */
  release(): void;
}

export interface ReserveIdsParams {
  readonly projectRoot: string;
  readonly runId: string;
  /** The reserving step's own id — a fresh reservation for the same `(projectRoot, runId, idPrefix,
   * stepId)` supersedes whichever this step held before it (an earlier, discarded attempt), so a re-run
   * gets that attempt's own base back rather than the next one up. */
  readonly stepId: string;
  readonly idPrefix: string;
  readonly idWidth: number;
  /** 1 for `cardinality: 'one'` (the default); a block for `'many'` (`SPEC-QUESTIONS.md` Q232 decision
   * 2: 25 for a declared KB output; `REVIEW-NNN` always reserves 1). */
  readonly count: number;
  /** Every tree a later merge of this id space could collide with: the integration worktree, the
   * project root, every lane still waiting to merge, and (only once one exists) the reserving step's own
   * lane. Scanned in the order given; duplicates cost nothing (an already-visited root still costs one
   * scan, never double-counted, since the result is a plain highest-number reduction). */
  readonly roots: readonly string[];
  readonly target: ScanTarget;
  /** Supplied when a lane already exists at reservation time (`REVIEW-NNN`'s own call shape, and a
   * crash-resume reroll's, `PLAN-M14.md` P8: "the step's own existing lane"): the reservation is created
   * already lane-bound, skipping the `pending` phase entirely. Omitted (the fresh KB-output path, before
   * `tryAssemble`, before any lane) makes a `pending` reservation the caller must `bind`/`release`
   * itself once the step's own outcome is known. */
  readonly lanePath?: string | undefined;
}

/**
 * Reserves `count` contiguous ids for `idPrefix`, above everything `target.numbersIn` finds across
 * `roots` and above every other reservation this run already holds for the identical id space —
 * `REVIEW-NNN`'s own numbering rule (`PLAN-M13.md` P17), unchanged, generalised to any `(idPrefix,
 * idWidth, scan target, count)`. Serialised per `(projectRoot, runId, idPrefix)`, so concurrent
 * reservations of the SAME id space (a fan-out's several steps each declaring an ADR) never compute the
 * same base from the same snapshot; independent id spaces (ADR vs. Runbook, say) never wait on each
 * other.
 *
 * @throws {ForgeError} `RUN-109` if the reservation would need a number wider than `idWidth` digits.
 */
export async function reserveIds(params: ReserveIdsParams): Promise<IdReservation> {
  const { projectRoot, runId, stepId, idPrefix, idWidth, count, roots, target, lanePath } = params;
  const key = reservationKey(projectRoot, runId, idPrefix);
  return enqueue(key, async () => {
    pruneReservations(key);
    const reserved = handedOut.get(key) ?? new Map<string, ReservationRecord>();
    handedOut.set(key, reserved);
    // Supersedes this step's own earlier reservation of the identical id space, if any (a discarded
    // attempt): its numbers are simply not counted below any more, so a re-run gets them back instead of
    // leaving a gap. Every OTHER step's reservation (pending or lane-bound) still counts.
    reserved.delete(stepId);

    let highest = 0;
    for (const root of roots) {
      for (const numeric of await target.numbersIn(root)) highest = Math.max(highest, numeric);
    }
    for (const entry of reserved.values()) {
      highest = Math.max(highest, entry.base + entry.count - 1);
    }

    const base = highest + 1;
    const max = 10 ** idWidth - 1;
    if (base + count - 1 > max) {
      throw new ForgeError('RUN-109', { stepId, idPrefix, idWidth });
    }

    const record: ReservationRecord = { base, count, lane: lanePath };
    reserved.set(stepId, record);
    const ids = Array.from({ length: count }, (_, index) =>
      formatId(idPrefix, idWidth, base + index),
    );
    return {
      ids,
      bind: (lane: string) => {
        if (reserved.get(stepId) === record) record.lane = lane;
      },
      release: () => {
        if (reserved.get(stepId) === record) reserved.delete(stepId);
      },
    };
  });
}

// --- declared KB outputs (PLAN-M14.md P8, SPEC-QUESTIONS.md Q232 decision 2) -------------------------

const KB_ROOT_PREFIX = 'kb/';
/** `SPEC-QUESTIONS.md` Q232 decision 2: one id for `cardinality: 'one'` (the default), a block of 25
 * for `'many'` — the block leaves gaps between runs (disclosed: `18` §18.8 forbids reuse, not gaps). */
const MANY_BLOCK_SIZE = 25;

/**
 * The path template tail this module scans for a KB-located type, with the leading `kb/` (every P8
 * type's own registry root, by the mandate's own words: "For every declared output whose registry
 * `pathTemplate` starts `kb/`") removed. A miniature of `dispatch/outputs.ts`'s own general
 * `outputGlob`/`outputPathFor` (not imported: this piece's own Surface does not touch that file, P10's
 * territory, and the general case there also has to handle `specs/`/`sessions/`/`reports/` roots and
 * `{slug}`/other placeholders this module never needs to).
 */
function kbTemplateTail(definition: ArtifactTypeDefinition): string {
  return definition.pathTemplate.slice(KB_ROOT_PREFIX.length);
}

/**
 * Where this module scans for `definition`'s own already-claimed numbers, under the project's
 * configured `kb` root: the single shared register file itself for a `collection: true` type (`Risk`,
 * `Assumption`, `OpenQuestion`, `Environment` — the id lives inside the file, not in its name), or the
 * directory holding one file per id for every other P8 type (`ADR`, `Runbook`).
 */
function kbScanTarget(definition: ArtifactTypeDefinition, roots: DocRoots): ScanTarget {
  const tail = kbTemplateTail(definition);
  return definition.collection === true
    ? registerIdScan(path.posix.join(roots.kb, tail), definition.idPrefix, definition.idWidth)
    : directoryIdScan(
        path.posix.join(roots.kb, path.posix.dirname(tail)),
        definition.idPrefix,
        definition.idWidth,
      );
}

/** `reserveDeclaredKbOutputIds`'s result: every KB output type `node.outputs` declared, reserved. */
export interface KbOutputReservation {
  /** Reserved ids keyed by the step's own declared output `type` (`"ADR"`, not the type's `idPrefix`). */
  readonly idsByType: ReadonlyMap<string, readonly string[]>;
  /** Binds every reservation this call made to `lanePath` in one call — see `IdReservation.bind`. */
  bind(lanePath: string): void;
  /** Releases every reservation this call made in one call — see `IdReservation.release`. */
  release(): void;
}

/**
 * Reserves an id (`cardinality: 'one'`, the default) or a block of `MANY_BLOCK_SIZE` (`'many'`) for
 * every KB-located type `node.outputs` declares — `undefined` when it declares none (a step with no KB
 * output pays nothing: no scan, no queue wait). A type declared more than once (unusual, not forbidden)
 * reserves once, `many` if ANY of its entries says so, never two colliding reservations of one id space
 * for one step.
 *
 * Scans, in order: the integration worktree, the project root, every lane `ctx.laneRegistry` still
 * holds (every OTHER step's ready-but-unmerged lane), and — once one exists — `existingLanePath` (the
 * mandate's own "the step's own existing lane", the crash-resume reroll case: `resumeAgentStep`'s own
 * `runAgentAttempt`, `@forge/engine/resume`, already has a real lane that a brand-new process's own
 * empty in-memory table cannot otherwise see). Supplying `existingLanePath` also makes every reservation
 * this call returns already lane-bound (`reserveIds`'s own `lanePath`); omitted (the fresh path, before
 * any lane, before `tryAssemble`), every reservation starts `pending` and the caller governs its
 * lifecycle through the returned `bind`/`release`.
 *
 * @throws {ForgeError} `RUN-109` on exhaustion — every reservation this call already made for an
 * earlier type in the same step (when a LATER type's reservation is the one that exhausts) is released
 * first, so a step this call refuses ends up holding nothing.
 */
export async function reserveDeclaredKbOutputIds(
  node: Pick<StepNode, 'id' | 'outputs'>,
  ctx: Pick<
    ExecuteStepContext,
    'projectRoot' | 'runId' | 'integrationPath' | 'laneRegistry' | 'docRoots'
  >,
  existingLanePath?: string,
): Promise<KbOutputReservation | undefined> {
  const roots = docRootsOf(ctx);
  const byType = new Map<
    string,
    { readonly definition: ArtifactTypeDefinition; readonly many: boolean }
  >();
  for (const output of node.outputs) {
    const definition = artifactTypeById(output.type);
    if (!definition?.pathTemplate.startsWith(KB_ROOT_PREFIX)) continue;
    const existing = byType.get(output.type);
    byType.set(output.type, {
      definition,
      many: (existing?.many ?? false) || output.cardinality === 'many',
    });
  }
  if (byType.size === 0) return undefined;

  const scanRoots = [
    ctx.integrationPath,
    ctx.projectRoot,
    ...[...ctx.laneRegistry.values()].map((lane) => lane.path),
    ...(existingLanePath === undefined ? [] : [existingLanePath]),
  ];

  const made: IdReservation[] = [];
  const idsByType = new Map<string, readonly string[]>();
  try {
    for (const [type, { definition, many }] of byType) {
      const reservation = await reserveIds({
        projectRoot: ctx.projectRoot,
        runId: ctx.runId,
        stepId: node.id,
        idPrefix: definition.idPrefix,
        idWidth: definition.idWidth,
        count: many ? MANY_BLOCK_SIZE : 1,
        roots: scanRoots,
        target: kbScanTarget(definition, roots),
        lanePath: existingLanePath,
      });
      made.push(reservation);
      idsByType.set(type, reservation.ids);
    }
  } catch (cause) {
    for (const reservation of made) reservation.release();
    throw cause;
  }

  return {
    idsByType,
    bind: (lanePath: string) => {
      for (const reservation of made) reservation.bind(lanePath);
    },
    release: () => {
      for (const reservation of made) reservation.release();
    },
  };
}
