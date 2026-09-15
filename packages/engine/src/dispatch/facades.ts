/**
 * Real implementations of `types.ts`'s own facade seams, wrapping `@forge/vcs`, `@forge/telemetry`, and
 * `@forge/engine/gates` (P14) directly — no mock, no fake git, no fake event log; every real test in this
 * package exercises these against a real tmp-dir repository and a real on-disk event log, matching this
 * piece's own Checks text ("a real tmp-dir lane"). A caller that genuinely needs a different backend can
 * still substitute its own object satisfying the same interface — nothing here requires these specific
 * factories, only that *some* implementation of the shape in `types.ts` exists.
 *
 * @see PLAN-M5.md P15
 */
import { appendEvent, type NewForgeEvent } from '@forge/telemetry/events';
import { SECRET_PATTERNS } from '@forge/extensions/skills';
import {
  commitInLane,
  createLaneWorktree,
  diffLaneChanges,
  enforceClaim,
  processMergeCandidate,
  removeLaneWorktree,
  resolveRevision,
  type LaneHandle as VcsLaneHandle,
  type MergeCandidate,
  type MergeConflictResolver,
  type PostMergeCheck,
  type PreMergeCheck,
} from '@forge/vcs';

import { evaluateGate, buildGateReport, type GateDefinition } from '../gates/index.ts';
import { runShellCommand } from './shell.ts';
import type {
  GateEvaluator,
  LaneHandle,
  MergeCandidateLike,
  MergeQueueFacade,
  NewDispatchEvent,
  TelemetryFacade,
  VcsFacade,
} from './types.ts';

/** Every `LaneHandle` this facade ever receives back from a caller originally came from this same
 * facade's own `createLane`, which returns a real, `@forge/vcs`-branded one — `types.ts`'s own `LaneHandle`
 * is deliberately a wider, unbranded, structural re-declaration so this module's own public surface never
 * forces a consumer to resolve `@forge/vcs`'s own `LaneId` brand (`types.ts`'s own doc comment has the
 * fuller reasoning). This cast is what bridges the two at the one place that actually needs the brand back
 * — calling into `@forge/vcs` itself — not a claim that an arbitrary `LaneHandle` is safe here; a caller
 * that hand-built one without ever going through `createLane` would get whatever `@forge/vcs` itself does
 * with a `laneId` string that never actually came from its own branding constructor (in practice, every
 * real `@forge/vcs` function here only ever reads `.path`/`.branch` off it, never re-validates `.laneId`
 * itself, so this is safe even then — but the cast's own justification is "this really is one of ours,"
 * not "the shape happens to still work out"). */
function asVcsLaneHandle(handle: LaneHandle): VcsLaneHandle {
  return handle as unknown as VcsLaneHandle;
}

export function createVcsFacade(projectRoot: string, runId: string): VcsFacade {
  return {
    async createLane(stepId, integrationBase) {
      return createLaneWorktree(projectRoot, { runId, stepId, integrationBase });
    },
    async removeLane(handle, retain) {
      await removeLaneWorktree(projectRoot, asVcsLaneHandle(handle), { retain });
    },
    async commit(handle, message, sign) {
      return commitInLane(asVcsLaneHandle(handle), { message, sign });
    },
    async resolveRevision(ref) {
      return resolveRevision(projectRoot, ref);
    },
    async hasChanges(handle, baseSha) {
      const changed = await diffLaneChanges(asVcsLaneHandle(handle), baseSha);
      return changed.length > 0;
    },
    async enforceClaim(handle, baseSha, declaredGlobs, policy) {
      return enforceClaim(asVcsLaneHandle(handle), baseSha, declaredGlobs, policy);
    },
  };
}

/** Rebuilds `value`, omitting any key whose value is `undefined` — needed wherever this package's own
 * `exactOptionalPropertyTypes` setting meets an upstream type (`@forge/telemetry`'s `NewForgeEvent`,
 * `@forge/vcs`'s `ProcessMergeCandidateOptions`) that declares an optional field *without* `| undefined` in
 * its own type, so passing the key through with an explicit `undefined` value — rather than omitting it —
 * is itself a type error there, not merely a stylistic nicety. Safe even for a field the target type
 * declares mandatory-but-`unknown`-typed (`ForgeEvent.payload`): `@forge/telemetry`'s own `appendEvent`
 * immediately `JSON.stringify`s the whole event, which already drops an `undefined`-valued key identically
 * (`parseEventLine`'s own doc comment: "a caller-supplied undefined payload is serialised... as an absent
 * key entirely") — this function does at the type level exactly what serialisation already does at the
 * wire level, not something behaviourally new. */
type WithoutUndefinedValues<T> = { [K in keyof T]?: Exclude<T[K], undefined> };

function omitUndefinedValues<T extends object>(value: T): WithoutUndefinedValues<T> {
  const result: Record<string, unknown> = {};
  for (const [key, fieldValue] of Object.entries(value)) {
    if (fieldValue !== undefined) result[key] = fieldValue;
  }
  return result as WithoutUndefinedValues<T>;
}

/** `runId`/`ts` are the two fields `TelemetryFacade.emit`'s own callers never supply (`types.ts`'s own doc
 * comment) — injected here, once, from this facade's own construction (`runId`) and from `now` (`ts`,
 * ISO-8601, matching `ForgeEvent.ts`'s own documented format) on every call.
 *
 * Every event this facade ever appends is passed through `@forge/telemetry`'s own real
 * `valuePatterns` redaction using `@forge/extensions`'s own `SECRET_PATTERNS` — the exact AWS/GitHub/
 * Slack/PEM/Bearer-token shapes `20` §20.10 S3 names — not left to each of this module's own dozen call
 * sites to remember individually. `PLAN-M11.md` P10's own real fixture-run test found this facade's
 * predecessor called `appendEvent` with no options at all: a secret-shaped value landing in any event
 * payload field (a session's own free-text `message`, say) reached `.forge/state/runs/<runId>/
 * events.ndjson` completely unredacted, since `redactPayload`'s own two pre-existing checks are a
 * key-name-shape match (never fires on an innocuous key like `message`) and an exact-known-secret-value
 * match (`knownSecrets` defaults empty — resolved-secret tracking is not yet wired anywhere in this
 * dependency graph, `SPEC-QUESTIONS.md` Q62). Defaulting `valuePatterns` here, at the one real
 * production constructor every live run's own `@forge/cli` context (`run/context.ts`) already calls
 * unchanged, closes the gap for every caller at once. */
export function createTelemetryFacade(
  projectRoot: string,
  runId: string,
  now: () => number,
): TelemetryFacade {
  return {
    async emit(event: Omit<NewDispatchEvent, 'runId' | 'ts'>) {
      const fullEvent = omitUndefinedValues({
        ...event,
        runId,
        ts: new Date(now()).toISOString(),
      }) as NewForgeEvent;
      return appendEvent(projectRoot, runId, fullEvent, { valuePatterns: SECRET_PATTERNS });
    },
  };
}

/** The gate registry is closed over here, not exposed on the returned `GateEvaluator` itself — a caller
 * that wants to inspect it keeps its own reference to the `Map`/object it built before calling this. */
export function createGateEvaluator(
  gateRegistry: ReadonlyMap<string, GateDefinition>,
): GateEvaluator {
  return {
    async evaluate(gateId, cwd) {
      const definition = gateRegistry.get(gateId);
      if (definition === undefined) return Promise.reject(new GateNotFoundError(gateId));
      const result = await evaluateGate(definition, cwd, async (check) =>
        runShellCommand(check.run, cwd),
      );
      return buildGateReport(definition, result);
    },
  };
}

/** Not exported: `runGateStep` (`steps.ts`) is this error's own one caller, and it immediately converts
 * this into the real, registered `ForgeError` (`RUN-040`) every other failure path in this module produces
 * — kept as a plain, undecorated marker class purely so that conversion can distinguish "the gate id was
 * never registered" from any other rejection `evaluateGate`/`buildGateReport` could in principle raise,
 * without stringly-typed message sniffing. */
export class GateNotFoundError extends Error {
  readonly gateId: string;

  constructor(gateId: string) {
    super(`Gate ${gateId} is not registered.`);
    this.gateId = gateId;
  }
}

function toPreMergeCheck(command: string | undefined): readonly PreMergeCheck[] {
  if (command === undefined) return [];
  return [
    async (cwd) => {
      const { exitCode, stdout, stderr } = await runShellCommand(command, cwd);
      // `stderr || stdout`, not bare `stderr`: many real check commands report their failure on
      // stdout, leaving stderr empty -- the identical fallback `steps.ts`'s own inline-command failure
      // path already uses for the same reason.
      return { passed: exitCode === 0, summary: exitCode === 0 ? stdout : stderr || stdout };
    },
  ];
}

function toPostMergeCheck(command: string | undefined): readonly PostMergeCheck[] {
  return toPreMergeCheck(command);
}

/** Bundles `@forge/vcs`'s own `processMergeCandidate` with the per-run constants (`integrationPath`, a
 * caller-supplied conflict resolver) it needs on every call, so `runMergeStep` (`steps.ts`) itself only
 * ever has to build a `MergeCandidateLike` — the one thing that genuinely varies per call. `preChecks`/
 * `postChecks` are supplied *per call* (a `MergePolicy.preChecks`/`postChecks` command string, `06` §6.5
 * step 3 belongs to the specific merge step's own declared policy, not to the queue itself), so this
 * facade takes them as `process`'s own second argument rather than baking one fixed pair in at
 * construction. */
/** The identical "re-declared, not imported" bridge `asVcsLaneHandle` above provides for a bare
 * `LaneHandle`, one level up: `MergeCandidateLike` is structurally identical to `@forge/vcs`'s own
 * `MergeCandidate` except for the same unbranded `laneId`. */
function asVcsMergeCandidate(candidate: MergeCandidateLike): MergeCandidate {
  return candidate as unknown as MergeCandidate;
}

/**
 * `@forge/vcs`'s own `processMergeCandidate` doc comment states plainly: "Serial by construction:
 * one call at a time, on one candidate; the caller owns queueing order across candidates (`06` §6.5:
 * 'Serial, one merge at a time') -- this piece does not itself lock or serialise anything." Nothing
 * downstream of this facade ever enforced that. A fresh adversarial review found two real,
 * independent call sites into `MergeQueueFacade.process` (`dispatch/steps.ts`'s `runMergeStep` and
 * `interaction/session.ts`'s `mergeDecideLane`), neither aware of the other, and no dependency edge
 * (`plan/compile.ts`'s `buildLeafNode` gives a `merge`-kind step an empty `produces: []`, so the
 * scheduler's own overlap-based admission control never excludes two ready merge steps from the same
 * batch) — a completely ordinary workflow shape (two independent lanes, each ending in its own
 * `merge` step, with no `dependsOn` edge between the two merges since their own predecessors are
 * unrelated) reaches a scheduling tick where both are admitted together and run concurrently via
 * `driveToCompletion`'s own `Promise.all`. Two concurrent `processMergeCandidate` calls against the
 * identical `integrationPath` then race real `git rebase`/`git merge --no-ff`/`git commit` against
 * the same working directory — exactly the corruption class (`MERGE_HEAD`/`index.lock` collisions,
 * two aborts racing each other, an interleaved commit) `@forge/vcs`'s own doc comment already warns
 * about, but as an ordinary reachable outcome, not a rare crash-recovery edge case.
 *
 * Fixed here, the one real place both call sites' calls converge (both go through the identical
 * `MergeQueueFacade` instance `context.ts` constructs once per run): a module-level `Map<string,
 * Promise<unknown>>` keyed by `integrationPath`, the exact same "serialise real writes against
 * project-shared state" pattern `interaction/session.ts`'s own `sessionRecordQueues`/
 * `enqueueForProject` already establishes for the identical shape of problem (independent lanes
 * racing shared, on-disk state with no natural dependency edge between them). Keyed by path, not
 * held as private facade state, so two separately-constructed facades pointed at the same real
 * `integrationPath` (as `run/context.ts` and `run/merge.ts` each independently do) still serialise
 * against each other rather than each guarding only its own, useless private queue. */
const mergeQueues = new Map<string, Promise<unknown>>();

function enqueueForIntegrationPath<T>(
  integrationPath: string,
  operation: () => Promise<T>,
): Promise<T> {
  const previous = mergeQueues.get(integrationPath) ?? Promise.resolve();
  const result = previous.then(operation, operation);
  mergeQueues.set(
    integrationPath,
    result.then(
      () => undefined,
      () => undefined,
    ),
  );
  return result;
}

export function createMergeQueueFacade(
  integrationPath: string,
  conflictResolver: MergeConflictResolver | undefined,
): MergeQueueFacade {
  return {
    async process(candidate, checks) {
      return enqueueForIntegrationPath(integrationPath, () =>
        processMergeCandidate(asVcsMergeCandidate(candidate), {
          ...omitUndefinedValues({ conflictResolver }),
          integrationPath,
          preChecks: toPreMergeCheck(checks.preCheck),
          postChecks: toPostMergeCheck(checks.postCheck),
        }),
      );
    },
  };
}
