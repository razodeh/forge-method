/**
 * `commands/dispatch/shared.ts` — the generic, cross-cutting helpers `bin.ts`'s monolithic dispatcher
 * used to define once and every command branch shared ambiently: ambient-fact readers (R10's one real
 * read per fact), the one real `parseCommandFlags` argument parser, real `PlatformAdapter`
 * construction, and a handful of rendering/sanitization helpers several otherwise-unrelated command
 * areas each call. Factored out here (rather than duplicated per area file, or left attached to
 * whichever area happened to define them first) once real usage was counted directly against the
 * original `bin.ts`: `realEnvSnapshot` alone has 29 real call sites there; `parseCommandFlags` has
 * 73 (both counts verified directly against `git show 067352a:packages/cli/src/bin.ts`, the real,
 * pre-extraction 6,041-line file, not estimated). Not one of the ~17 per-command-area dispatch files
 * this piece's own Mandate counts (`PLAN-M17.md` P2) — a DECISION, disclosed in this piece's own
 * gauntlet log, since the alternative (importing one area file from another for a function with no
 * real conceptual home in either) would read as arbitrary coupling a future reader could not explain.
 *
 * @see specs/22 M17 P2
 */
import path from 'node:path';

import { KNOWN_ADAPTER_MODULES, loadAdapterFactory } from '@forge/adapter-kit/registry';
import type { PlatformAdapter } from '@forge/adapter-kit/types';
import { FORGE_AGENT_ID, FORGE_RUN_ID, FORGE_STEP_ID, SYSTEM_CLOCK } from '@forge/core';
import { EXIT_CODES, ForgeError, isForgeError } from '@forge/core/errors';
import type { ProjectPaths } from '@forge/core/fs';
import type { RunState } from '@forge/engine/resume';
import type { ForgeConfig } from '@forge/schemas/config';

import { readConfig } from '../config.ts';
import type { DebugDeps } from '../loop/debug.ts';
import type { PanelDeps } from '../loop/panel.ts';
import type { ReviewDeps } from '../loop/review.ts';
import type { SessionCommandDeps } from '../loop/session.ts';
import {
  createAskPort,
  readAnswersFile,
  unmatchedAnswerWarnings,
  type CliAskPort,
} from '../run/ask.ts';
import type { GateCommandContext, RunDeps } from '../run/index.ts';
import { currentLauncher } from '../run/launcher-shim.ts';
import { runFailureError, runFailureNote } from '../run/run-failure.ts';
import type { DryRunResult, RealRunResult } from '../run/run.ts';
import type { ConflictResolutionMode } from '../../generated-header.ts';
import { resolveOwnPackageRoot } from '../../init/package-root.ts';

import type { GlobalFlags } from '../../entry/types.ts';

/**
 * The one shape every `commands/dispatch/*.ts` area file's own exported `dispatchX` function takes —
 * `main()`'s own former local `[command, sub, ...rest]`/`afterCommand` destructuring, bundled once per
 * invocation rather than re-parsed per area. Each area file re-derives `sub`/`rest`/`afterCommand`
 * from `positionals` locally, exactly as `main()`'s own original body did inline for each of its
 * branches — this keeps every area file's own dispatch logic a byte-for-byte move of the original
 * `if` block's body, rather than a rewrite against a differently-shaped context object that could
 * silently disagree with the original slicing for some edge case never exercised by today's tests.
 */
export interface DispatchContext {
  /** `flags.positionals` from `parseGlobalFlags` — the full positional-argument list, unsliced. */
  readonly positionals: readonly string[];
  /** Every global flag (`--json`, `--yes`, `--dry-run`, `--budget`, `--project`, ...). */
  readonly flags: GlobalFlags;
  /** Already resolved against `flags.project ?? process.cwd()` by `commands/dispatch/index.ts`. */
  readonly paths: ProjectPaths;
  /** The same resolved root `paths` was constructed from. */
  readonly projectRoot: string;
}

/** One area file's own real dispatcher: `undefined` means "this command/sub pair is not mine," so
 * `commands/dispatch/index.ts`'s own chain tries the next one; a real `number` is the final exit
 * code. Every area's own real command tokens are mutually exclusive with every other area's (the
 * identical property the original monolithic `if`/`else if` chain already relied on), so trying each
 * dispatcher in sequence and stopping at the first defined result reproduces the original dispatch
 * exactly, regardless of chain order. */
export type Dispatcher = (ctx: DispatchContext) => Promise<number | undefined>;

/** `.forge/agents` — shared by every command area that loads an agent roster. */
export const AGENTS_ROOT = '.forge/agents';
/** `.forge/workflows` — shared by every command area that compiles or dispatches a workflow. */
export const WORKFLOWS_ROOT = '.forge/workflows';
/** `.forge/checks` — shared by every command area that loads a gate check definition. */
export const CHECKS_ROOT = '.forge/checks';
/** `docs/forge/specs` — shared by every command area that reads or writes a spec artifact. */
export const SPECS_ROOT = 'docs/forge/specs';
/** `docs/forge/kb` — shared by every command area that reads or writes a KB entry. */
export const KB_ROOT = 'docs/forge/kb';

/**
 * `init`/`run`/`resume`/`gate`/`merge` — real dispatcher wiring for `03` §3.2.4/§3.3's own execution
 * and greenfield-wizard surface (`PLAN-M12.md` P1). Every one of these commands needs a real,
 * concrete `PlatformAdapter` — `@forge/cli/init`'s own `RunInitDeps.candidateAdapters` and
 * `@forge/cli/commands/run`'s own `RunDeps.adapter` were both left as an injected seam because no
 * concrete adapter existed anywhere in this codebase at the time (`SPEC-QUESTIONS.md` Q103).
 *
 * This file never imports an adapter package or names a platform by identifier — `specs/07` §7.1's
 * own boundary rule ("nothing above `@forge/adapter-kit` may reference Claude Code... by name") and
 * its mechanical enforcement, `forge-boundaries/no-platform-concept`, both forbid that here exactly as
 * much as inside `@forge/adapter-kit` itself. Every platform id this file ever touches is a runtime
 * string flowing out of `@forge/adapter-kit/registry`'s own `KNOWN_ADAPTER_MODULES`/
 * `loadAdapterFactory`, or a project's own `.forge/config.yaml`, never typed as a literal here.
 */
export function realEnvSnapshot(): Readonly<Record<string, string>> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value;
  }
  return env;
}

/** The real `modules/` roster directory (`RunInitDeps.modulesDir`'s own doc comment) resolved from
 * this package's own real install location — this only ever finds the *workspace* `modules/`
 * directory (two levels above `forge-method`'s own package root), since no publishing/distribution
 * mechanism for `modules/` exists yet (the identical, already-disclosed gap `RunInitDeps.modulesDir`'s
 * own doc comment names, `SPEC-QUESTIONS.md` Q103) — real for every real use of this dispatcher today
 * (a workspace checkout), not yet real for a published, installed `forge-method` package. */
export function resolveModulesDir(): string {
  return path.join(resolveOwnPackageRoot(import.meta.url), '..', '..', 'modules');
}

/** Real wall-clock time via `@forge/core`'s own injected-clock seam (R10) — never `Date.now()`
 * directly, matching `commands/run/context.ts`'s own identical `Date.parse(clock.now())` pattern. */
export function realNow(): number {
  return Date.parse(SYSTEM_CLOCK.now());
}

/** The real, running Node version — `forge doctor`/`forge upgrade`'s own `processVersion` input
 * (`DoctorOptions`/`UpgradeDeps`), read once, here, and threaded through as a real, injected parameter
 * from there on (never read ambiently inside `runDoctor`/`runUpgrade` themselves) — the identical
 * `realEnvSnapshot`/`realNow` precedent immediately above, named the same way for the same reason: one
 * real boundary read per ambient fact, never re-read inline at each call site. */
export function realProcessVersion(): string {
  return process.version;
}

/** Every real candidate `forge init` offers `selectPlatform` — every module `@forge/adapter-kit/
 * registry`'s own `KNOWN_ADAPTER_MODULES` names, each loaded and constructed dynamically (see this
 * section's own top doc comment for why this can never be a literal, direct import instead). Real,
 * disclosed gap: `@forge/adapter-generic` is not in that registry (no shipped `adapter.yaml` exists
 * anywhere in this workspace to construct one from) — see `SPEC-QUESTIONS.md`. */
export async function buildCandidateAdapters(
  env: Readonly<Record<string, string>>,
): Promise<readonly PlatformAdapter[]> {
  const adapters: PlatformAdapter[] = [];
  for (const spec of KNOWN_ADAPTER_MODULES) {
    const factory = await loadAdapterFactory(spec.packageName);
    adapters.push(factory({ env, now: realNow }));
  }
  return adapters;
}

/** Reconstructs the identical real adapter a project's own `.forge/config.yaml` already recorded at
 * `forge init` time (`platform.primary`) — `forge run`/`resume` never re-run platform *selection*
 * (`03` §3.3 step 5's own "detect installed platforms... pick primary" is `init`'s job alone); this
 * only ever re-builds the one real adapter this dispatcher knows how to construct for the id already
 * on record, reading that platform's own real `platform.adapterConfig` blob back in.
 * @throws {ForgeError} `ENV-004` for any recorded `platform.primary` this registry has no real module
 * for — the identical, disclosed "not every real platform id has a real construction path here" gap
 * this section's own top doc comment names, now surfaced for a *recorded* id this dispatcher genuinely
 * cannot honour rather than silently defaulting to the wrong adapter. An empty `platform.primary`
 * (`03` §3.3's own "unset" default) falls back to this registry's own first real entry. */
export async function buildAdapterForConfig(
  config: ForgeConfig,
  env: Readonly<Record<string, string>>,
): Promise<PlatformAdapter> {
  const platformId = config.platform.primary;
  const spec =
    platformId === ''
      ? KNOWN_ADAPTER_MODULES[0]
      : KNOWN_ADAPTER_MODULES.find((candidate) => candidate.id === platformId);
  if (spec === undefined) {
    throw new ForgeError('ENV-004', {
      tool: platformId === '' ? 'a platform adapter' : platformId,
    });
  }
  const factory = await loadAdapterFactory(spec.packageName);
  return factory({ env, now: realNow, config: config.platform.adapterConfig[spec.id] });
}

/** `forge doctor`/`forge upgrade`'s own real, degraded adapter-construction path — unlike `run`/
 * `resume`/`merge` (which genuinely cannot proceed without a real adapter, so `buildAdapterForConfig`'s
 * own `ENV-004` throw is the right, loud failure there), `doctor`'s entire job is diagnosing exactly
 * this one narrow environment problem: `checkPlatformAdapter(undefined, ...)` already has a real,
 * honest degraded outcome for "no adapter" — a `warning`, not a `hard` failure — precisely so a
 * project whose `platform.primary` names an id this registry cannot construct (a stale/foreign value,
 * a test fixture built against `@forge/testkit`'s own `FakePlatformAdapter`, never a real registry
 * entry) still gets a real, runnable `forge doctor` instead of an opaque `ENV-004` crash on the one
 * command whose whole purpose is surfacing environment problems like this.
 *
 * **Scoped narrowly to exactly that one, named `ENV-004` case — never a blanket catch.** A genuine
 * construction *crash* for a different reason still propagates as a real, loud failure here,
 * identically to how `buildAdapterForConfig` already behaves, unguarded, for `run`/`resume`/`merge`. */
export async function buildAdapterForDiagnostics(
  config: ForgeConfig,
  env: Readonly<Record<string, string>>,
): Promise<PlatformAdapter | undefined> {
  try {
    return await buildAdapterForConfig(config, env);
  } catch (error) {
    if (isForgeError(error) && error.code === 'ENV-004') return undefined;
    throw error;
  }
}

/** The real `RunDeps` every `run`/`resume`/`plan`/`implement`/`refactor`/`deploy` dispatch builds —
 * one real adapter, the real, current project config, and the running CLI's own launcher (so a
 * `command` step's `forge ...` resolves to it wherever it was launched from). */
export async function buildRunDepsForProject(
  paths: ProjectPaths,
  projectRoot: string,
): Promise<RunDeps> {
  const config = await readConfig(paths);
  const env = realEnvSnapshot();
  return {
    paths,
    projectRoot,
    config,
    adapter: await buildAdapterForConfig(config, env),
    workflowsRoot: WORKFLOWS_ROOT,
    checksRoot: CHECKS_ROOT,
    agentsRoot: AGENTS_ROOT,
    launcher: currentLauncher(env),
    warn: (message) => {
      console.error(message);
    },
  };
}

/** The identical real `paths`/`projectRoot`/`config`/`adapter`/`checksRoot` shape `RunDeps` already
 * builds, plus `agentsRoot` — the one extra field `forge debug`/`forge review`/`forge panel` each need
 * (`readProjectAgent`) that `RunDeps` itself has no reason to carry (`runWorkflow` never loads an agent
 * directly). Structurally assignable to `SessionCommandDeps` too (a strict subset of this shape), so
 * `forge session` reuses the identical builder rather than a fifth, near-duplicate one. */
export async function buildLoopDepsForProject(
  paths: ProjectPaths,
  projectRoot: string,
): Promise<DebugDeps & ReviewDeps & PanelDeps & SessionCommandDeps> {
  const config = await readConfig(paths);
  const env = realEnvSnapshot();
  return {
    paths,
    projectRoot,
    config,
    adapter: await buildAdapterForConfig(config, env),
    checksRoot: CHECKS_ROOT,
    agentsRoot: AGENTS_ROOT,
    env,
  };
}

/**
 * `--on-conflict <mode>` is parsed by each command's own flag parser (it is never a global flag).
 * When it was not given at all *and* this invocation is non-interactive by the global `--yes`/`--json`
 * flags (`03` §3.1's own "every interactive flow MUST have a --yes-able non-interactive equivalent"
 * rule, applied here to the real conflict prompt `writeRegenerableContent` would otherwise open on a
 * real, detected drift), a real default is picked rather than left `undefined` (which would block on
 * `process.stdin` in a script or CI job that piped nothing to it): `keep-mine`, the one mode that
 * never destroys a human's local edit or the newly generated content — disclosed here and in
 * `SPEC-QUESTIONS.md` as this piece's own named `--yes` default. Shared by `forge init` and `forge
 * upgrade`, the two real callers.
 */
export function defaultNonInteractiveConflictMode(
  explicit: ConflictResolutionMode | undefined,
  yes: boolean,
  json: boolean,
): ConflictResolutionMode | undefined {
  if (explicit !== undefined) return explicit;
  return yes || json ? 'keep-mine' : undefined;
}

/**
 * A minimal, generic flag parser local to one command's own `rest`/`afterCommand` slice — any
 * `--`-shaped token not named in `spec` is a real, reported `USR-002`, never silently dropped, the
 * identical "an unrecognised flag is a reportable error" discipline `parseGlobalFlags`/
 * `parseInitFlags` already apply everywhere else in this package.
 *
 * A declared value-flag's very next token is always consumed as its value, whatever it looks like —
 * `spec[flag] === true` means "this flag takes a value," full stop, so `--reason "--skip until next
 * sprint"` works correctly rather than rejecting a legitimate value that merely starts with two
 * dashes. Missing a required value (the flag is the last token, or immediately followed by another
 * recognised flag) is still a real `USR-002`.
 */
export function parseCommandFlags(
  args: readonly string[],
  spec: Readonly<Record<string, boolean>>,
): {
  readonly values: ReadonlyMap<string, string>;
  readonly flags: ReadonlySet<string>;
  readonly positionals: readonly string[];
} {
  const values = new Map<string, string>();
  const flags = new Set<string>();
  const positionals: string[] = [];
  const remaining = [...args];

  for (let token = remaining.shift(); token !== undefined; token = remaining.shift()) {
    if (!token.startsWith('--')) {
      positionals.push(token);
      continue;
    }
    const takesValue = spec[token];
    if (takesValue === undefined) {
      throw new ForgeError('USR-002', { flag: token, value: '' });
    }
    flags.add(token);
    if (takesValue) {
      const value = remaining.shift();
      if (value === undefined) {
        throw new ForgeError('USR-002', { flag: token, value: '' });
      }
      values.set(token, value);
    }
  }

  return { values, flags, positionals };
}

/** `forge pause` (and every other zero-positional command) takes no positional at all. */
export function assertNoArgs(args: readonly string[]): void {
  const { positionals } = parseCommandFlags(args, {});
  if (positionals.length > 0) {
    throw new ForgeError('USR-002', { flag: '[extra positional]', value: positionals[0] ?? '' });
  }
}

/** `forge pause`/`forge resume [runId]`/`forge abort [runId]`/`forge lanes [runId]` (`03` §3.2.4) all
 * take no real flags at all, only an optional bare `[runId]` positional — parsed through the identical
 * `parseCommandFlags` validation every other command uses, so a stray or misspelled flag is a real,
 * reported `USR-002` here too, never silently dropped. */
export function parseOptionalRunIdPositional(args: readonly string[]): string | undefined {
  const { positionals } = parseCommandFlags(args, {});
  if (positionals.length > 1) {
    throw new ForgeError('USR-002', { flag: '[extra positional]', value: positionals[1] ?? '' });
  }
  return positionals[0];
}

/** `--rule <name>` is not a global flag (`parseGlobalFlags`' own `KNOWN_FLAGS` has no entry for it),
 * so it survives into `rest` verbatim — found and validated locally by each caller (`spec validate`,
 * `test coverage`, `test flaky`) rather than adding it to the shared global-flags parser.
 *
 * Returns `''` (never a real rule id), not `undefined`, when `--rule` is present but is the very last
 * token: `rest[index + 1]` is `undefined` for that case too, indistinguishable from "no `--rule` at
 * all," so a bare trailing `--rule` must not silently run the default rule instead of erroring. `''`
 * fails every real rule-id check exactly like a misspelled one does, with no new branching needed at
 * any call site. */
export function findRuleFlag(rest: readonly string[]): string | undefined {
  const index = rest.indexOf('--rule');
  if (index === -1) return undefined;
  return rest[index + 1] ?? '';
}

/** Renders a real `RunState['runStatus']` for a human — `undefined` (no `RunStarted` event was ever
 * recorded at all, an empty log) is a real, reachable state `String(...)` would otherwise stringify
 * as the literal text `"undefined"`, the exact user-facing anti-pattern this codebase's own render
 * helpers elsewhere are written to avoid. */
export function renderRunStatus(runStatus: string | undefined): string {
  return runStatus ?? 'unknown';
}

/** Real run/resume failure exit codes: `EXIT_CODES.failure` (a genuine runtime failure — a step
 * failed or the run was aborted mid-flight), never `EXIT_CODES.usage` (this is not a caller mistake)
 * and never `EXIT_CODES.gateFailed` (a gate-shaped failure is reported by `forge gate`, not by the
 * run's own bare status here). */
export function runOutcomeExitCode(runStatus: string | undefined): number {
  return runStatus === 'failed' || runStatus === 'aborted'
    ? EXIT_CODES.failure
    : EXIT_CODES.success;
}

/** A failed run says why, on stderr, with the remedy — the way every other refusal does — and exits with the
 * reason's own code (a budget refusal is `4`, anything else `1`). With `--json` stdout still carries the one
 * JSON line, whose `runState.runFailure` holds the same reason for a machine reader. A failed run whose log
 * carries no reason (recorded before it did) keeps the plain failure exit code. */
export function reportRunFailure(runState: RunState): number {
  const failure = runFailureError(runState);
  if (failure === undefined) return runOutcomeExitCode(runState.runStatus);
  console.error(failure.message);
  console.error(failure.remedy);
  const note = runFailureNote(runState);
  if (note !== undefined) console.error(note);
  return failure.exitCode;
}

/** The identical `DryRunResult | RealRunResult` rendering `forge run` establishes, shared by every
 * other command that dispatches through the same `runWorkflow` (`forge plan <phase>`, `forge
 * implement`/`forge refactor`/`forge deploy`) so the JSON contract and human-readable shape stay
 * identical across every real caller of that one mechanism, rather than drifting across independently
 * hand-rolled copies. */
export function printWorkflowDispatchResult(
  label: string,
  result: DryRunResult | RealRunResult,
  json: boolean,
): number {
  if (result.kind === 'dry-run') {
    if (json) {
      console.log(JSON.stringify({ v: 1, plan: result.plan }));
    } else if (result.plan.success) {
      console.log(`forge ${label} --dry-run: compiled ${String(result.plan.nodes.length)} steps.`);
    } else {
      for (const issue of result.plan.issues) console.error(issue.message);
    }
    return result.plan.success ? EXIT_CODES.success : EXIT_CODES.usage;
  }
  if (json) {
    console.log(JSON.stringify({ v: 1, runId: result.runId, runState: result.runState }));
  } else {
    console.log(
      `forge ${label}: runId=${result.runId} status=${renderRunStatus(result.runState.runStatus)}.`,
    );
  }
  return reportRunFailure(result.runState);
}

/** The port an `elicit` step asks through (`PLAN-M13.md` P20): the answers in `--answers <file>`
 * (relative to the current working directory), plus a warning for any answer key that never matched
 * a real question the workflow actually asked. */
export async function buildElicitAskPort(
  answersFile: string | undefined,
  workflowSource: string | undefined,
): Promise<CliAskPort> {
  const answers =
    answersFile === undefined
      ? undefined
      : await readAnswersFile(path.resolve(process.cwd(), answersFile));
  if (answers !== undefined && workflowSource !== undefined) {
    for (const warning of unmatchedAnswerWarnings(workflowSource, answers)) {
      console.error(`forge: warning: ${warning}`);
    }
  }
  return createAskPort({
    answers,
    interactive: process.stdin.isTTY && process.stderr.isTTY,
    warn: (message) => {
      console.error(message);
    },
  });
}

/** The real FORGE session marker (`@forge/core/session-marker`, `PLAN-M14.md` P4/P15) for
 * `GateCommandContext.marker` -- read here, once, from `realEnvSnapshot()` (this file's own one
 * ambient environment read, R10), never re-read inline downstream. Absent `FORGE_RUN_ID`: `undefined`,
 * a real human's own shell never carries this marker. Reused as-is by `forge adr`/`forge config
 * set --commit`/`forge parity`/`forge evidence prune` — the identical `{runId, stepId?, agentId?}`
 * shape every one of those contexts' own `marker` field carries. */
export function gateCommandMarker(
  env: Readonly<Record<string, string>>,
): GateCommandContext['marker'] {
  const runId = env[FORGE_RUN_ID];
  if (runId === undefined) return undefined;
  const stepId = env[FORGE_STEP_ID];
  const agentId = env[FORGE_AGENT_ID];
  return {
    runId,
    ...(stepId === undefined ? {} : { stepId }),
    ...(agentId === undefined ? {} : { agentId }),
  };
}

/** The real, exhaustive flag set each `gate` subcommand accepts — a plain `switch` (not a `Record`
 * lookup) so a missing/misspelled subcommand narrows to `undefined` without an unsafe index or a
 * non-null assertion at the call site. */
export function gateSubFlags(sub: string): Readonly<Record<string, boolean>> | undefined {
  switch (sub) {
    // `list` alone takes no real `--run` at all -- it never needs a runId (see `runGateSubcommand`'s
    // own `sub === 'list'` branch), so accepting one here would only silently do nothing with it, the
    // identical "recognised but ineffective flag" failure mode `parseCommandFlags` itself exists to
    // close everywhere else.
    case 'list':
      return {};
    case 'check':
      return { '--run': true };
    case 'approve':
    case 'reject':
      return { '--run': true, '--reason': true };
    case 'waive':
      return { '--run': true, '--reason': true, '--owner': true, '--expires': true };
    default:
      return undefined;
  }
}

/** Strips C0 control characters, `DEL`, and the whole C1 range (`\x00`-`\x1f`, `\x7f`-`\x9f` —
 * contiguous once `DEL` and C1 are combined) from untrusted text before it reaches either a real
 * terminal or a `--json` consumer. Real, hostile-author-controlled free text (a module/overlay's own
 * `module.yaml`, a KB/spec/ADR/diagram's own project-authored body, a live agent's own generated
 * output) reaches this on every real install/kb/spec/adr/diagram/loop command path.
 *
 * **Applied to both output modes, not only the human-readable one.** `JSON.stringify` escapes only
 * `U+0000`-`U+001F` (plus `"`/`\`) per ECMA-262; `DEL` (`\x7f`) and the entire C1 block pass through a
 * JSON string completely unescaped as raw bytes, leaving `--json` output exactly as exposed as an
 * unfixed plain-text path would be. */
export function stripControlChars(text: string): string {
  // eslint-disable-next-line no-control-regex -- deliberately matching control chars to strip them.
  return text.replace(/[\x00-\x1f\x7f-\x9f]/g, '');
}

/** The general-purpose form of `stripControlChars` — recursively strips control characters out of
 * every string value found anywhere inside `value` (arrays and plain objects walked, everything else
 * returned unchanged), applied once to a real data structure before either `--json` or human-readable
 * rendering reaches a real terminal. Shared by `module`/`overlay`/`kb`/`spec`/`adr`/`diagram` and the
 * agent-facing loop family (`debug`/`review`/`panel`/`session`) — every one of them prints real,
 * project- or model-authored free text a hostile or careless author (or a prompt-injected agent)
 * fully controls.
 *
 * Walks only a real plain object (`Object.getPrototypeOf(value)` is `Object.prototype` or `null`),
 * left untouched otherwise — `Object.entries`/`Object.fromEntries` on a `Date`/`Map`/`Set`/class
 * instance would otherwise silently drop its own real internal state. */
export function sanitizeDeep<T>(value: T): T {
  if (typeof value === 'string') return stripControlChars(value) as unknown as T;
  if (Array.isArray(value)) {
    const items = value as readonly unknown[];
    return items.map((item) => sanitizeDeep(item)) as unknown as T;
  }
  const isPlainObject =
    value !== null &&
    typeof value === 'object' &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
  if (isPlainObject) {
    const entries: readonly (readonly [string, unknown])[] = Object.entries(
      value as Readonly<Record<string, unknown>>,
    ).map(([key, entryValue]) => [key, sanitizeDeep(entryValue)] as const);
    return Object.fromEntries(entries) as unknown as T;
  }
  return value;
}

/** The two REAL, well-documented "renders as a blank glyph in virtually every font" code points a
 * plain `\p{Cc}\p{Cf}\s` class does not cover (U+2800 BRAILLE PATTERN BLANK, U+3164 HANGUL FILLER),
 * plus three siblings from the identical Hangul-filler family (U+115F, U+1160, U+FFA0) — a known, hard
 * problem even major platforms only ever address with a curated, explicit list, never a clean regex
 * class. Closes the specific, known vectors verified so far; disclosed, not solved, as not an
 * exhaustive defense against every conceivable blank-rendering code point that might exist. */
const BLANK_RENDERING_CODE_POINTS = /[⠀ㅤᅟᅠﾠ]/gu;

/** The Unicode-aware "blank" check `forge test exempt --reason` and every one of `forge kb
 * disclose`/`kb disclose resolve`'s own free-text fields (`--summary`/`--owner`/`--reason`/`--by`)
 * share: `\p{Cc}`/`\p{Cf}` (invisible control/format characters, including a zero-width space) plus
 * ordinary whitespace, plus the curated blank-glyph list above — never a plain `.trim()`, which a
 * round-1 gauntlet critic found accepted an all-zero-width-space value as "non-blank," durably
 * recording an invisible, meaningless governance entry. */
export function isBlank(value: string): boolean {
  return (
    value.replace(/[\p{Cc}\p{Cf}\s]/gu, '').replace(BLANK_RENDERING_CODE_POINTS, '').length === 0
  );
}
