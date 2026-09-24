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
import { existsSync } from 'node:fs';
import path from 'node:path';

import { execa } from 'execa';
import { appendEvent, type NewForgeEvent } from '@forge/telemetry/events';
import { SECRET_PATTERNS } from '@forge/extensions/skills';
import {
  commitInLane,
  createLaneWorktree,
  diffLaneChanges,
  enforceClaim,
  mergeIntoLane,
  processMergeCandidate,
  removeLaneWorktree,
  resolveRevision,
  VcsError,
  wrapGitFailure,
  type JoinConflictPolicy,
  type LaneHandle as VcsLaneHandle,
  type MergeCandidate,
  type MergeConflictResolver,
  type PreMergeCheck,
} from '@forge/vcs';

import { evaluateGate, buildGateReport, type GateDefinition } from '../gates/index.ts';
import { runShellCommand, type ShellLimits } from './shell.ts';
import type {
  GateEvaluator,
  JoinConflictResolver,
  LaneHandle,
  MergeCandidateLike,
  MergeCheckCommand,
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

/** The largest artifact file `readAtRevision` will return (8 MiB): far beyond any real document. */
const MAX_ARTIFACT_BYTES = 8 * 1024 * 1024;

/** `JoinConflictResolver` (dispatch/types.ts) is structurally identical to `@forge/vcs`'s own
 * `MergeConflictResolver` (`JoinConflictDescription` mirrors `MergeConflictDescription` field for field) --
 * the identical "re-declared, not imported" bridge `asVcsLaneHandle` already provides for `LaneHandle`. */
function asVcsConflictResolver(resolver: JoinConflictResolver): MergeConflictResolver {
  return resolver as unknown as MergeConflictResolver;
}

/** `PLAN-M14.md` P34: `createVcsFacade`'s own conflict policy/resolver for `mergeIntoLane`, bound once at
 * construction -- an ordinary `agent`/`command` step has no conflict policy of its own to supply per call
 * the way a `merge` step's `mergePolicy` does, so this mirrors `createMergeQueueFacade`'s own
 * constructor-bound resolver (not yet a per-call override, `PLAN-M14.md` P35's own later scope).
 * `conflictPolicy` omitted defaults `'abort'`: the same safe, no-caller-supplied-resolver-needed default
 * `RunEngineContext.conflictPolicy`'s own doc comment already documents for the analogous landing-conflict
 * case, and matches `SPEC-QUESTIONS.md` Q226 open item (b) (`conflictPolicy: agent` still has no resolver
 * anywhere in this milestone's own wiring). */
export interface VcsFacadeOptions {
  readonly conflictPolicy?: JoinConflictPolicy | undefined;
  readonly conflictResolver?: JoinConflictResolver | undefined;
}

export function createVcsFacade(
  projectRoot: string,
  runId: string,
  options: VcsFacadeOptions = {},
): VcsFacade {
  const conflictPolicy = options.conflictPolicy ?? 'abort';
  const boundResolver =
    options.conflictResolver === undefined ? undefined : asVcsConflictResolver(options.conflictResolver);
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
    async mergeIntoLane(handle, sha, message, resolver) {
      return mergeIntoLane(
        asVcsLaneHandle(handle),
        sha,
        message,
        conflictPolicy,
        resolver === undefined ? boundResolver : asVcsConflictResolver(resolver),
      );
    },
    async resolveRevision(ref) {
      return resolveRevision(projectRoot, ref);
    },
    async isAncestor(ancestor, descendant) {
      // Resolved first: a flag-shaped or unknown revision must never reach `merge-base` as an argument.
      const [left, right] = [
        await resolveRevision(projectRoot, ancestor),
        await resolveRevision(projectRoot, descendant),
      ];
      const result = await execa('git', ['merge-base', '--is-ancestor', left, right], {
        cwd: projectRoot,
        reject: false,
      });
      if (result.exitCode === 0) return true;
      if (result.exitCode === 1) return false;
      throw new VcsError({
        code: 'VCS-GIT-OPERATION-FAILED',
        message: `checking whether "${ancestor}" is an ancestor of "${descendant}" in "${projectRoot}" failed: ${result.stderr}`,
        remedy: 'Inspect the repository and the two lane branches directly with git.',
      });
    },
    async hasChanges(handle, baseSha) {
      const changed = await diffLaneChanges(asVcsLaneHandle(handle), baseSha);
      return changed.length > 0;
    },
    async changedFiles(handle, baseSha) {
      const vcsHandle = asVcsLaneHandle(handle);
      const resolvedBase = await resolveRevision(handle.path, baseSha);
      // `-z`/`--no-renames` for the reasons `diffLaneChanges`' own doc comment gives: raw NUL-separated paths
      // (no `core.quotePath` mangling) and a rename reported as a delete plus an add.
      const { stdout } = await wrapGitFailure(
        () =>
          execa('git', ['diff', '--no-renames', '-z', '--name-only', resolvedBase, 'HEAD', '--'], {
            cwd: handle.path,
          }),
        `listing the commits of the lane worktree at "${handle.path}" against "${baseSha}"`,
      );
      const committed = stdout.split('\0').filter((entry) => entry !== '');
      const committedSet = new Set(committed);
      const everything = await diffLaneChanges(vcsHandle, resolvedBase);
      // The raw form carries each entry's new mode: 120000 is a symlink and 160000 a submodule, neither an
      // artifact and neither something the claim may carry in under a declared output's path. The records are
      // `:<oldmode> <newmode> <oldsha> <newsha> <status>` NUL `<path>` NUL.
      const { stdout: raw } = await wrapGitFailure(
        () =>
          execa(
            'git',
            ['diff', '--no-renames', '-z', '--raw', '--no-abbrev', resolvedBase, 'HEAD', '--'],
            { cwd: handle.path },
          ),
        `listing the entry modes of the lane worktree at "${handle.path}" against "${baseSha}"`,
      );
      const fields = raw.split('\0');
      const nonRegular: string[] = [];
      for (let index = 0; index + 1 < fields.length; index += 2) {
        const newMode = (fields[index] ?? '').split(' ')[1];
        if (newMode === '120000' || newMode === '160000') nonRegular.push(fields[index + 1] ?? '');
      }
      return {
        committed: committed.sort(),
        uncommitted: everything.filter((file) => !committedSet.has(file)),
        nonRegular: nonRegular.sort(),
      };
    },
    async readAtRevision(handle, revision, file) {
      // `git show <rev>:<path>` reads the object database; a file absent at `revision` exits non-zero. Bounded
      // so one enormous file cannot exhaust memory; an over-limit file reads as absent, which fails the check
      // rather than passing. A flag-shaped revision must never reach git (`@forge/vcs`'s own rule for refs).
      if (revision.startsWith('-')) return undefined;
      // Only a regular file (mode 100644/100755) is an artifact: a symlink's blob is its target text, which
      // could be a perfectly valid document while the tree entry a merge carries is a link.
      const entry = await execa('git', ['ls-tree', '-z', revision, '--', file], {
        cwd: handle.path,
        reject: false,
      });
      const mode = entry.exitCode === 0 ? entry.stdout.split(' ')[0] : undefined;
      if (mode !== '100644' && mode !== '100755') return undefined;
      const result = await execa('git', ['show', `${revision}:${file}`], {
        cwd: handle.path,
        reject: false,
        stripFinalNewline: false,
        maxBuffer: MAX_ARTIFACT_BYTES,
      });
      return result.exitCode === 0 && !result.failed ? result.stdout : undefined;
    },
    async listFilesAtRevision(handle, revision, dir) {
      // A flag-shaped revision must never reach git, the identical rule readAtRevision's own doc comment
      // gives; `git ls-tree` would otherwise interpret it as an option rather than a ref.
      if (revision.startsWith('-')) return [];
      const result = await execa(
        'git',
        ['ls-tree', '-r', '-z', '--name-only', revision, '--', dir],
        {
          cwd: handle.path,
          reject: false,
        },
      );
      if (result.exitCode !== 0) return [];
      return result.stdout.split('\0').filter((entry) => entry !== '');
    },
    async enforceClaim(handle, baseSha, declaredGlobs, policy, excludedGlobs) {
      return enforceClaim(asVcsLaneHandle(handle), baseSha, declaredGlobs, policy, excludedGlobs);
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

/** The environment overlay every facade that spawns a shell command applies (`ExecuteStepContext.commandEnv`). */
export interface CommandLauncherOptions {
  readonly env?: Readonly<Record<string, string>> | undefined;
}

/** The gate registry is closed over here, not exposed on the returned `GateEvaluator` itself — a caller
 * that wants to inspect it keeps its own reference to the `Map`/object it built before calling this. */
export function createGateEvaluator(
  gateRegistry: ReadonlyMap<string, GateDefinition>,
  options: CommandLauncherOptions = {},
): GateEvaluator {
  const env = options.env;
  return {
    async evaluate(gateId, cwd) {
      const definition = gateRegistry.get(gateId);
      if (definition === undefined) return Promise.reject(new GateNotFoundError(gateId));
      const result = await evaluateGate(definition, cwd, async (check) =>
        runShellCommand(check.run, cwd, env),
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

/** Caps for a merge check: the project's own test command (or a merge policy's), which the engine did not write.
 * Ten minutes and 8 MiB, the same bounds `forge test run --rule smoke|contract` puts on a layer command
 * (`13` §13.1 F-TEST-1: the slowest budgeted layer is under ten minutes). A check that outlives them is killed and
 * FAILS; it is never left to hang a run or pass by being abandoned. */
export const MERGE_CHECK_LIMITS = { timeoutMs: 600_000, maxOutputBytes: 8 * 1024 * 1024 } as const;

/** How much of a failing check's output its summary keeps: enough to act on, not a log. */
const CHECK_OUTPUT_TAIL_CHARS = 2000;

function tailOf(text: string): string {
  const trimmed = text.trimEnd();
  return trimmed.length > CHECK_OUTPUT_TAIL_CHARS
    ? `...${trimmed.slice(-CHECK_OUTPUT_TAIL_CHARS)}`
    : trimmed;
}

function toMergeChecks(
  commands: readonly MergeCheckCommand[],
  env: Readonly<Record<string, string>> | undefined,
  limits: ShellLimits,
): readonly PreMergeCheck[] {
  return commands.map(({ command, label }) => async (cwd) => {
    const result = await runShellCommand(command, cwd, env, limits);
    const { exitCode, stdout, stderr } = result;
    const timedOut = result.timedOut === true;
    const flooded = result.outputLimitExceeded === true;
    const passed = exitCode === 0 && !timedOut && !flooded;
    // `stderr || stdout`, not bare `stderr`: many real check commands report their failure on stdout, leaving
    // stderr empty -- the identical fallback `steps.ts`'s own inline-command failure path already uses.
    if (passed) return { passed, summary: stdout };
    const output = tailOf(stderr.trim() === '' ? stdout : stderr);
    if (label === undefined && !timedOut && !flooded) return { passed, summary: output };
    // The label (a config key) names what failed; the command text is not repeated here, it may hold secrets and this
    // summary reaches the event log.
    const subject = label ?? 'the merge check';
    const why = timedOut
      ? `did not finish within ${String(limits.timeoutMs)}ms and was killed`
      : flooded
        ? `wrote more than ${String(limits.maxOutputBytes)} bytes of output and was stopped`
        : `exited ${String(exitCode)}`;
    return { passed, summary: `${subject} ${why}${output === '' ? '' : `: ${output}`}` };
  });
}

function commandsOf(
  resolved: readonly MergeCheckCommand[] | undefined,
  literal: string | undefined,
): readonly MergeCheckCommand[] {
  if (resolved !== undefined) return resolved;
  return literal === undefined ? [] : [{ command: literal }];
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

/** Aborts a `git rebase` or `git merge` left in progress in `cwd` (a killed process). A no-op when none is. */
async function abortInterruptedGitOperation(cwd: string, kind: 'rebase' | 'merge'): Promise<void> {
  if (kind === 'merge') {
    const head = await execa('git', ['rev-parse', '--quiet', '--verify', 'MERGE_HEAD'], {
      cwd,
      reject: false,
    });
    if (head.exitCode === 0) await execa('git', ['merge', '--abort'], { cwd, reject: false });
    return;
  }
  for (const dir of ['rebase-merge', 'rebase-apply']) {
    const gitPath = await execa('git', ['rev-parse', '--git-path', dir], { cwd, reject: false });
    if (gitPath.exitCode !== 0) continue;
    const resolved = path.resolve(cwd, gitPath.stdout.trim());
    if (existsSync(resolved)) {
      await execa('git', ['rebase', '--abort'], { cwd, reject: false });
      return;
    }
  }
}

export interface MergeQueueOptions extends CommandLauncherOptions {
  /** Overrides `MERGE_CHECK_LIMITS`; a test uses it to prove the caps without waiting for the real ones. */
  readonly checkLimits?: ShellLimits | undefined;
}

export function createMergeQueueFacade(
  integrationPath: string,
  conflictResolver: MergeConflictResolver | undefined,
  options: MergeQueueOptions = {},
): MergeQueueFacade {
  const env = options.env;
  const limits = options.checkLimits ?? MERGE_CHECK_LIMITS;
  return {
    async process(candidate, checks) {
      return enqueueForIntegrationPath(integrationPath, async () => {
        // A process killed inside a rebase (in the lane) or a merge (in the integration worktree) leaves that
        // git operation half done; a resumed run's second attempt would fail on it forever. Abandoned first.
        await abortInterruptedGitOperation(candidate.handle.path, 'rebase');
        await abortInterruptedGitOperation(integrationPath, 'merge');
        return processMergeCandidate(asVcsMergeCandidate(candidate), {
          ...omitUndefinedValues({ conflictResolver }),
          integrationPath,
          preChecks: toMergeChecks(commandsOf(checks.preCommands, checks.preCheck), env, limits),
          postChecks: toMergeChecks(commandsOf(checks.postCommands, checks.postCheck), env, limits),
        });
      });
    },
    exclusive(operation) {
      return enqueueForIntegrationPath(integrationPath, operation);
    },
    async isIntegrated(handle) {
      // `merge-base --is-ancestor` exits 0 (an ancestor), 1 (not) and >1 for a real failure, which must not
      // read as "not integrated" (that would offer the lane to a merge that then fails the same way, but
      // with a less useful message) or as integrated (that would drop a lane's work): it throws.
      return enqueueForIntegrationPath(integrationPath, async () => {
        // A lane whose merge was reverted is an ancestor all the same but its content is not in the branch: not
        // integrated, so it goes to the queue, which refuses it (`VCS-LANE-REVERTED`).
        const revert = await execa(
          'git',
          [
            'log',
            'HEAD',
            '-1',
            '--format=%H',
            '--fixed-strings',
            '--grep',
            `Revert merge of lane ${handle.laneId} (`,
          ],
          { cwd: integrationPath, reject: false },
        );
        if (revert.exitCode === 0 && revert.stdout.trim() !== '') return false;
        const result = await execa('git', ['merge-base', '--is-ancestor', handle.branch, 'HEAD'], {
          cwd: integrationPath,
          reject: false,
        });
        if (result.exitCode === 0) return true;
        if (result.exitCode === 1) {
          // Not an ancestor, but possibly nothing left to land all the same (`PLAN-M13.md` P38): a lane stacked on
          // another one holds that lane's commits, and landing that lane REWROTE them (the queue rebases onto the
          // integration head), so the stacked lane's branch still names the old commits. `git cherry` marks a
          // commit `-` when the integration branch already has one with the same patch: a lane whose commits are
          // all `-` has nothing to merge (merging it would report another lane's merge commit as its own, and a
          // failing post-check would then revert that lane's merge).
          const cherry = await execa('git', ['cherry', 'HEAD', handle.branch], {
            cwd: integrationPath,
            reject: false,
          });
          if (cherry.exitCode !== 0) return false;
          return !cherry.stdout.split('\n').some((line) => line.startsWith('+'));
        }
        throw new VcsError({
          code: 'VCS-GIT-OPERATION-FAILED',
          message: `checking whether lane branch "${handle.branch}" is already in the integration worktree at "${integrationPath}" failed: ${result.stderr}`,
          remedy: 'Inspect the integration worktree and the lane branch directly with git.',
        });
      });
    },
  };
}
