/**
 * `FakePlatformAdapter` — a fully spec-compliant, in-memory `PlatformAdapter`: the one adapter every
 * other future FORGE package tests against instead of a real, costly, non-deterministic coding
 * platform. Implements every optional method of `PlatformAdapter` itself (a fake with everything else
 * "on" is what proves the interface is implementable end to end), and is expected to pass all 16 of
 * `@forge/adapter-kit/conformance`'s own tests when constructed with its default (full) capabilities.
 *
 * The one capability this fake genuinely does not implement, even in the non-degraded default case, is
 * `interject`: `SessionHandle.interject` is a live mid-session interrupt into a real model's turn, which
 * has no meaningful analogue against pre-scripted, static data (`FakeSessionScript` is deliberately
 * never a function of runtime input — Q61 point 2), and no consumer of this package needs it yet.
 * `DEFAULT_CAPABILITIES.interject` is honestly `false` to match — `capabilities()` never claims a
 * capability `SessionHandle` cannot back up — matching the same `interject: false` convention
 * `@forge/adapter-kit/conformance`'s own minimal test fixtures already use.
 *
 * Known, deliberate limitations (accepted trade-offs, not oversights — a fresh critic round raised
 * both; recorded rather than silently left undocumented): `permissionMode` and
 * `attachments` are accepted but have no observable effect, since no script field models a platform
 * reacting to them yet. `SessionRequest.prompt`/`systemPrompt` used to be in this list; they still steer
 * no script, but are no longer ignored: strict mode (default on, `FakeAdapterOptions.strict`, `PLAN-M13.md`
 * P6) refuses a session whose prompt is empty, a bare path, or not the nine compiled blocks. `SessionLimits.wallClockMs`/`maxCostUsd` are accepted but not
 * enforced (this package has no injectable clock — see determinism, `specs/22`). None of these
 * currently have a consumer that needs them; add the mechanism when one does, rather than speculatively
 * now. `SessionResult.usage.costUsd` *was* one such deferred item (this doc comment used to say it "is
 * never populated... add the mechanism when one does") until `PLAN-M11.md` P11 became that real
 * consumer: `FakeSessionScript.costUsd` now threads a script-supplied figure straight onto
 * `usage.costUsd`, omitted (not defaulted to `0`) when unset, matching a real adapter's own "cost
 * reporting is optional" shape. `cacheReadTokens`/`cacheCreationTokens` (M17 P11) are the identical
 * mechanism, added for the identical reason once `@forge/engine`'s own `UsageRecorded` ledger wiring
 * (`dispatch/steps.ts`, `dispatch/conflict-resolver.ts`, `interaction/swarm-review-step.ts`) became a
 * real consumer that needed to exercise a non-zero, non-hardcoded value through this fake.
 *
 * @see specs/07 §7.2
 * @see specs/07 §7.3
 * @see specs/15 §15.6
 * @see specs/20 §20.5
 * @see SPEC-QUESTIONS.md Q61
 * @see PLAN-M4.md P5
 * @see PLAN-M17.md P11
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { parseControlTokens, stripControlTokens } from '@forge/adapter-kit/control-tokens';
import { isExecAllowed, isHostAllowed } from '@forge/adapter-kit/grants';
import type {
  AdapterCapabilities,
  AdapterEvent,
  GrantedMcpServer,
  McpProvisioning,
  ModelInfo,
  ParsedControlToken,
  PlatformAdapter,
  PreflightResult,
  ResolvedSkill,
  ResumeRequest,
  SessionContext,
  SessionHandle,
  SessionLimits,
  SessionRequest,
  SessionResult,
  SkillProvisioning,
  ToolGrant,
} from '@forge/adapter-kit/types';

import { makeHandle } from './handle.ts';
import type { SessionRequestMatcher } from './matcher.ts';
import type { FakeSessionScript } from './script.ts';
import {
  assertValidStrictOptions,
  checkSessionRequestPrompt,
  checkUserPrompt,
  promptOf,
  StrictPromptViolationError,
  stepIdOf,
  type StrictPromptOptions,
} from './strict.ts';

export type FakeFailureKind = 'error' | 'timeout' | 'abort';

/** Options for `FakePlatformAdapter` beyond its capability overrides. */
export interface FakeAdapterOptions {
  /** Strict-prompt mode (`PLAN-M13.md` P6, Q207). **On by default**: `startSession` rejects a request
   * whose prompt is empty, a bare file path, or not `05` §5.3's nine blocks opening with the operating
   * contract, and `resumeSession` rejects an empty or bare-path prompt — each rejection is also
   * recorded in `strictViolations`. Pass `false` only for a test that deliberately drives the adapter
   * with a hand-built request (adapter mechanics, conformance, a disclosed non-assembled session
   * type), with a comment saying why; pass an options object to also require the operating contract's
   * full text. */
  readonly strict?: boolean | StrictPromptOptions;
  /** Further model ids `listModels()` reports and `startSession` accepts, besides `FAKE_MODEL_ID`. A test
   * of tier-to-model resolution (`05` §5.8) needs more than one distinct model, or "the model that was
   * resolved" and "any valid model" cannot be told apart. */
  readonly models?: readonly string[];
}

/** `strict: false`, named: for a test that deliberately drives the adapter with a hand-built
 * `SessionRequest` (adapter mechanics, conformance suites) rather than one the engine assembled. Pass it
 * as the second constructor argument: `new FakePlatformAdapter({}, HAND_BUILT_REQUESTS)`. Anything that
 * dispatches through the engine should stay strict. */
export const HAND_BUILT_REQUESTS: FakeAdapterOptions = { strict: false };

/** Refusals not yet acknowledged by their test (`FakePlatformAdapter.acknowledgeStrictViolations`),
 * across every adapter in this process. `test/setup.ts` fails any test that ends with entries here: a
 * refusal is an error in the code under test, and a code path that swallows adapter failures (a step
 * recorded `failed`, a retry) must not be able to hide one. Held on `globalThis` under a registered
 * symbol, not in module scope: a test that resets the module registry gets a second copy of this module,
 * and its refusals must still reach the one hook. */
const UNACKNOWLEDGED_KEY = Symbol.for('@forge/testkit/strict-unacknowledged');
function unacknowledgedViolations(): Set<StrictViolationRecord> {
  const store = globalThis as { [UNACKNOWLEDGED_KEY]?: Set<StrictViolationRecord> | undefined };
  const existing = store[UNACKNOWLEDGED_KEY];
  if (existing !== undefined) return existing;
  const created = new Set<StrictViolationRecord>();
  store[UNACKNOWLEDGED_KEY] = created;
  return created;
}

/** Returns and clears every refusal no test acknowledged. For the global test hook, not for tests. */
export function takeUnacknowledgedStrictViolations(): readonly StrictViolationRecord[] {
  const set = unacknowledgedViolations();
  const taken = [...set];
  set.clear();
  return taken;
}

/** One request a strict adapter refused. */
export interface StrictViolationRecord {
  readonly stepId: string;
  readonly kind: 'start' | 'resume';
  readonly violations: readonly string[];
}

const DEFAULT_CAPABILITIES: AdapterCapabilities = {
  streaming: true,
  partialText: true,
  sessionResume: true,
  // Genuinely false, not a degraded default: SessionHandle.interject is never implemented (see this
  // module's own doc comment) — capabilities() must never claim a capability nothing backs up.
  interject: false,
  structuredOutput: true,
  toolAllowlist: true,
  permissionModes: ['manual', 'accept-edits', 'deny-unlisted', 'auto'],
  subagents: true,
  mcp: true,
  costReporting: 'per-turn',
  tokenReporting: true,
  maxConcurrentSessions: 0,
  cwdIsolation: true,
  systemPromptControl: 'replace',
  fileEditing: true,
  bash: true,
  network: 'full',
  bareMode: true,
  skills: 'native',
  toolProxy: true,
  // Genuinely backed up, not a degraded default: `runScriptPhases`'s own `maxTurns` handling below
  // really does truncate at the granted limit and really does report `reason: 'limit'` when it does.
  turnLimitEnforcement: true,
  // Genuinely backed up, not a degraded default (`specs/22` M17 P7, critic round 5):
  // `runScriptPhases`'s own `execAttempts` handling really does consult `ctx.vetExecCommand` (this
  // file's own `ScriptPhaseContext.vetExecCommand` doc comment) when a caller sets one. A test that
  // needs to exercise the "no real gate" refusal path overrides this via the existing
  // `capabilityOverrides` constructor argument, the identical mechanism every other flag here uses.
  execCommandGating: true,
  // Genuinely backed up, not a degraded default (`SPEC-QUESTIONS.md` Q347, fix-round critics): the
  // identical reasoning as `execCommandGating` immediately above, now for `script.writeFiles` --
  // `runScriptPhases`'s own write-file handling really does consult `ctx.vetFileAccess` (this file's
  // own `ScriptPhaseContext.vetFileAccess` doc comment) when a caller sets one, before performing the
  // write. Overridden the identical way via `capabilityOverrides` when a test needs the refusal path.
  fileAccessGating: true,
  // Genuinely backed up, not a degraded default (`SPEC-QUESTIONS.md` Q350, found while fixing Q347):
  // the identical reasoning as `fileAccessGating` immediately above, now for `script.webFetchAttempts`/
  // `script.webSearchAttempts` -- `runScriptPhases`'s own handling of both really does consult
  // `ctx.vetNetworkAccess` (this file's own `ScriptPhaseContext.vetNetworkAccess` doc comment) when a
  // caller sets one, before claiming either kind of attempt as a successful `tool.result`. Overridden
  // the identical way via `capabilityOverrides` when a test needs the refusal path.
  networkAccessGating: true,
};

const DEFAULT_SCRIPT: FakeSessionScript = {
  text: ['(no script matched this request; default response)'],
};

/** The one model id `listModels()` reports — also what `startSession` checks `request.model` against,
 * regardless of which script would otherwise match (an invalid model fails a session no matter what
 * prompt was requested; checked before script dispatch, not folded into a script's own behaviour). */
export const FAKE_MODEL_ID = 'forge-fake-model';

interface StepProvisioning {
  readonly skillIds: readonly string[];
  // `true` when any provisioned server for this step granted '*' (every tool) — a plain Set can only
  // ever enumerate explicit names, so without this a wildcard grant would silently provision *nothing*
  // (the exact opposite of what '*' means) once mcpToolAttempts checks membership in it.
  readonly grantedMcpTools: ReadonlySet<string> | true;
}

function isMcpToolGranted(provisioning: StepProvisioning | undefined, toolName: string): boolean {
  if (provisioning === undefined) return false;
  if (provisioning.grantedMcpTools === true) return true;
  return provisioning.grantedMcpTools.has(toolName);
}

/** What a resumed session needs but `ResumeRequest` (deliberately minimal — `SPEC-QUESTIONS.md` Q58
 * point 4) does not carry: the original session's own `runId`/`stepId`/`cwd`/`tools`, remembered from
 * its `startSession` call so a resume can matcher-probe and gate exactly as the original session did —
 * a resume continues the same lane/session, not a new one with none of that context. */
interface RememberedSessionContext {
  readonly runId: string;
  readonly stepId: string;
  readonly cwd: string;
  readonly tools: ToolGrant;
}

/** What `runScriptPhases` needs to enforce grants/limits/abort/provisioning-scope against, gathered
 * from either a fresh `SessionRequest` or a resumed session's own `RememberedSessionContext`. */
interface ScriptPhaseContext {
  readonly runId: string;
  readonly stepId: string;
  readonly cwd: string;
  readonly tools: ToolGrant;
  readonly abortSignal: AbortSignal;
  readonly limits: SessionLimits;
  /** `SessionRequest.vetExecCommand` (`specs/22` M17 P7, critic round 4), threaded through so a
   * scripted `execAttempts` entry is checked against it too, not only `isExecAllowed(ctx.tools, ...)`
   * — without this, no fake-adapter-backed test could ever exercise a real caller's own gate at all
   * (the real property this type exists to prove lives in Claude Code's own SDK, `canUseTool`, which
   * this fake does not run). `undefined` when the request carries none. */
  readonly vetExecCommand: SessionRequest['vetExecCommand'];
  /** `SessionRequest.vetFileAccess` (`SPEC-QUESTIONS.md` Q347), threaded through for the identical
   * reason as `vetExecCommand` immediately above, now for a scripted `writeFiles` entry — consulted
   * (with tool name `'Write'`) before this fake performs the write at all, not only
   * `resolveInsideCwd`'s own lexical containment check, which a scripted `relativePath` can never
   * fail by construction (`resolveInsideCwd`'s own doc comment). Without this, no fake-adapter-backed
   * test could ever exercise a real caller's own file-access gate (the real mechanism lives in Claude
   * Code's own SDK, `Options.hooks.PreToolUse`, which this fake does not run). `undefined` when the
   * request carries none. */
  readonly vetFileAccess: SessionRequest['vetFileAccess'];
  /** `SessionRequest.vetNetworkAccess` (`SPEC-QUESTIONS.md` Q350), threaded through for the identical
   * reason as `vetFileAccess` immediately above, now for a scripted `webFetchAttempts`/
   * `webSearchAttempts` entry — consulted (with the real tool name and, for `WebFetch` only, the real
   * URL) before either kind of attempt is claimed as a successful `tool.result`, not only
   * `isHostAllowed(ctx.tools, ...)`/`ctx.tools.network === 'full'` below. Without this, no
   * fake-adapter-backed test could ever exercise a real caller's own network-access gate (the real
   * mechanism lives in Claude Code's own SDK, `Options.hooks.PreToolUse`, which this fake does not
   * run). `undefined` when the request carries none. */
  readonly vetNetworkAccess: SessionRequest['vetNetworkAccess'];
}

interface ScriptPhaseOutcome {
  readonly finalText: string;
  readonly controlTokens: readonly ParsedControlToken[];
  readonly changedFiles: readonly string[];
  readonly turnsRun: number;
  readonly endedEarly: 'aborted' | 'limit' | undefined;
}

function emptyUsage(): SessionResult['usage'] {
  return { inputTokens: 0, outputTokens: 0, turns: 0 };
}

/** Resolves `relativePath` against `cwd`, or `undefined` if it would land outside `cwd` — by `..`
 * traversal, by itself naming an absolute path (rejected outright, even one that happens to resolve
 * inside `cwd`: `ScriptedFileWrite.relativePath`'s own contract is "relative to cwd", and accepting an
 * absolute one anyway would mask a scripting bug and leak a non-relative string into
 * `SessionResult.changedFiles`), or by resolving to `cwd` itself (not a valid file target). `cwd` itself
 * must be a genuine absolute path, not merely non-empty: `path.resolve`/`path.relative` silently treat
 * `''` (and any other non-absolute value) as `process.cwd()`, which would make *every* relativePath
 * "resolve inside cwd" — turning this function into a no-op exactly when it matters most (a caller that
 * passes a bad `cwd`, such as `resumeSession`'s own unrecognised-sessionId fallback). `specs/20` §20.2's
 * "every write... must land inside the project root or the lane's worktree" boundary for real adapters,
 * enforced here too: a scripted `relativePath` (and the `cwd` it is resolved against) is caller-supplied
 * data this fake must not blindly trust, the same reason `execAttempts` is checked against `tools.exec`
 * rather than assumed. Deliberately a plain lexical resolve, not a symlink-following `realpath` walk:
 * the "attacker" this defends against is a script authored within the same test process, not a hostile
 * filesystem — real adapters' own symlink-escape defence is `@forge/core`'s job, a dependency this
 * package deliberately does not have (`tools/eslint-plugin-forge-boundaries/src/graph.mjs`,
 * `SPEC-QUESTIONS.md` Q16). */
function resolveInsideCwd(cwd: string, relativePath: string): string | undefined {
  if (!path.isAbsolute(cwd) || path.isAbsolute(relativePath)) return undefined;
  const resolved = path.resolve(cwd, relativePath);
  const relative = path.relative(cwd, resolved);
  // The first path SEGMENT must be checked, not a raw string prefix: `path.relative` can return a
  // literal `'..cache'` (a direct child of `cwd` named with a leading `..`), and
  // `'..cache'.startsWith('..')` is `true` purely because the first two characters coincidentally
  // match, even though `..cache` names a real, single-segment sibling file, never a `..`
  // parent-directory escape — the same fix already applied to this bug's other instances elsewhere in
  // this codebase.
  if (
    relative === '' ||
    relative === '..' ||
    relative.startsWith('..' + path.sep) ||
    path.isAbsolute(relative)
  ) {
    return undefined;
  }
  return resolved;
}

/** `FakePlatformAdapter` — see this module's own doc comment. Construct directly (all capabilities on)
 * or via `withCapabilities` (a capability subset, for degradation testing). */
export class FakePlatformAdapter implements PlatformAdapter {
  readonly id = 'forge-fake-adapter';
  readonly displayName = 'FORGE Fake Adapter';

  private readonly caps: AdapterCapabilities;
  private readonly scripts: {
    readonly matcher: SessionRequestMatcher;
    readonly script: FakeSessionScript;
  }[] = [];
  private readonly failureInjections: {
    readonly matcher: SessionRequestMatcher;
    readonly failure: FakeFailureKind;
  }[] = [];
  private readonly rememberedFinalTextBySessionId = new Map<string, string>();
  private readonly rememberedContextBySessionId = new Map<string, RememberedSessionContext>();
  // Scoped runId -> stepId -> provisioning, not a single stepId-keyed map: a step id like "implement"
  // or "review" is naturally reused across different runs, and a skill/MCP tool provisioned for one
  // run's step must never be visible to a different run's same-named step (`15` §15.6's own worktree
  // isolation boundary; `specs/07` §7.6 C15 — "not leaked into other lanes").
  private readonly provisioningByRunAndStep = new Map<string, Map<string, StepProvisioning>>();
  private sessionCounter = 0;
  private readonly strict: StrictPromptOptions | undefined;
  private readonly strictViolationLog: StrictViolationRecord[] = [];
  private readonly extraModels: readonly string[];

  // Present only when this instance can provision MCP at all (SPEC-QUESTIONS.md Q61 point 6) — a
  // genuinely absent instance property, not a present-but-throwing method, so a degraded
  // withCapabilities({ mcp: false, toolProxy: false }) instance correctly *skips* C16 through
  // @forge/adapter-kit/conformance's own existing `adapter.provisionMcp === undefined` gate.
  readonly provisionMcp?: (
    servers: readonly GrantedMcpServer[],
    ctx: SessionContext,
  ) => Promise<McpProvisioning>;

  constructor(
    capabilityOverrides: Partial<AdapterCapabilities> = {},
    options: FakeAdapterOptions = {},
  ) {
    this.caps = { ...DEFAULT_CAPABILITIES, ...capabilityOverrides };
    const strict = options.strict ?? true;
    this.strict = strict === false ? undefined : strict === true ? {} : strict;
    if (this.strict !== undefined) assertValidStrictOptions(this.strict);
    this.extraModels = options.models ?? [];
    if (this.caps.mcp || this.caps.toolProxy) {
      this.provisionMcp = (servers, ctx) => this.doProvisionMcp(servers, ctx);
    }
  }

  /** Registers a script for every future `startSession` request `matcher` matches — first-registered,
   * first-matched, like an ordinary ordered list of routes. Call multiple times to register more than
   * one; a request matching none of them gets the minimal default script. */
  script(matcher: SessionRequestMatcher, script: FakeSessionScript): void {
    this.scripts.push({ matcher, script });
  }

  /** The *next* `startSession` call `matcher` matches fails the given way instead of running its
   * script — one-shot, consumed on that first match; unmatched requests, and every request after the
   * one that matched, are unaffected. */
  injectFailure(matcher: SessionRequestMatcher, failure: FakeFailureKind): void {
    this.failureInjections.push({ matcher, failure });
  }

  /** Every request this strict adapter refused so far (always empty when constructed with
   * `strict: false`). A test whose subject swallows adapter failures (a retry loop, a step that
   * records `failed` and moves on) can assert this is empty so a refusal cannot hide behind them. */
  get strictViolations(): readonly StrictViolationRecord[] {
    return this.strictViolationLog;
  }

  /** Declares this adapter's not-yet-acknowledged refusals as expected by the running test (one that
   * *asserts* on a refusal). Any refusal not acknowledged fails the test that caused it, from the global
   * `afterEach` in `test/setup.ts`, however the code under test handled the rejection. Pass the number of
   * refusals the test means to accept: acknowledging fewer or more than that throws, so one expected
   * refusal cannot also hide an unrelated one. The log itself is unchanged. */
  acknowledgeStrictViolations(expectedCount?: number): void {
    const pending = this.strictViolationLog.filter((record) =>
      unacknowledgedViolations().has(record),
    );
    if (expectedCount !== undefined && pending.length !== expectedCount) {
      throw new Error(
        `@forge/testkit strict mode: the test expected ${String(expectedCount)} refusal(s) but this ` +
          `adapter has ${String(pending.length)} unacknowledged: ` +
          pending.map((record) => `${record.kind} ${record.stepId}`).join(', '),
      );
    }
    for (const record of pending) unacknowledgedViolations().delete(record);
  }

  capabilities(): Promise<AdapterCapabilities> {
    return Promise.resolve(this.caps);
  }

  preflight(): Promise<PreflightResult> {
    return Promise.resolve({ ok: true, issues: [] });
  }

  listModels(): Promise<readonly ModelInfo[]> {
    return Promise.resolve([
      { id: FAKE_MODEL_ID, displayName: 'FORGE Fake Model' },
      ...this.extraModels.map((id) => ({ id, displayName: `FORGE Fake Model (${id})` })),
    ]);
  }

  installAssets(): Promise<readonly []> {
    return Promise.resolve([]);
  }

  provisionSkills(
    skills: readonly ResolvedSkill[],
    ctx: SessionContext,
  ): Promise<SkillProvisioning> {
    const existing = this.getProvisioning(ctx.runId, ctx.stepId);
    this.setProvisioning(ctx.runId, ctx.stepId, {
      skillIds: skills.map((skill) => skill.id),
      grantedMcpTools: existing?.grantedMcpTools ?? new Set(),
    });
    // 15 §15.6's own mapping — the identical one @forge/adapter-kit/conformance's own C15 check
    // (SPEC-QUESTIONS.md Q60 point 5) cross-checks this against.
    const strategy =
      this.caps.skills === 'native'
        ? 'native'
        : this.caps.skills === 'inline'
          ? 'inline'
          : 'bodies-injected';
    return Promise.resolve({ strategy, provisionedSkillIds: skills.map((skill) => skill.id) });
  }

  private doProvisionMcp(
    servers: readonly GrantedMcpServer[],
    ctx: SessionContext,
  ): Promise<McpProvisioning> {
    const existing = this.getProvisioning(ctx.runId, ctx.stepId);
    let sawWildcard = false;
    const explicitTools = new Set<string>();
    for (const server of servers) {
      if (server.grantedTools === '*') {
        sawWildcard = true;
        continue;
      }
      for (const tool of server.grantedTools) explicitTools.add(tool);
    }
    const grantedMcpTools: ReadonlySet<string> | true = sawWildcard ? true : explicitTools;
    this.setProvisioning(ctx.runId, ctx.stepId, {
      skillIds: existing?.skillIds ?? [],
      grantedMcpTools,
    });
    return Promise.resolve({ loadedServerIds: servers.map((server) => server.id) });
  }

  private getProvisioning(runId: string, stepId: string): StepProvisioning | undefined {
    return this.provisioningByRunAndStep.get(runId)?.get(stepId);
  }

  private setProvisioning(runId: string, stepId: string, value: StepProvisioning): void {
    let byStep = this.provisioningByRunAndStep.get(runId);
    if (byStep === undefined) {
      byStep = new Map<string, StepProvisioning>();
      this.provisioningByRunAndStep.set(runId, byStep);
    }
    byStep.set(stepId, value);
  }

  startSession(request: SessionRequest): Promise<SessionHandle> {
    if (this.strict !== undefined) {
      const violations = checkSessionRequestPrompt(request, this.strict);
      if (violations.length > 0) {
        // Checked before anything else (before failure injection and script matching): a request that
        // could not steer a real agent must not be able to pass because a script happened to match it.
        return Promise.reject(this.refuse(stepIdOf(request), 'start', violations));
      }
    }
    this.sessionCounter += 1;
    const sessionId = `session-${String(this.sessionCounter)}`;
    this.rememberedContextBySessionId.set(sessionId, {
      runId: request.runId,
      stepId: request.stepId,
      cwd: request.cwd,
      tools: request.tools,
    });

    try {
      const injectionIndex = this.failureInjections.findIndex(({ matcher }) => matcher(request));
      if (injectionIndex !== -1) {
        // Cast, not a runtime check: splice(index, 1) at a findIndex-confirmed valid index always
        // returns an array with exactly the one removed element — noUncheckedIndexedAccess cannot
        // derive that from the general Array<T> return type splice() has, so this cast makes it visible
        // to the type checker instead of leaving an unreachable `undefined` fallback in place.
        const [{ failure }] = this.failureInjections.splice(injectionIndex, 1) as [
          { readonly matcher: SessionRequestMatcher; readonly failure: FakeFailureKind },
        ];
        return Promise.resolve(
          makeHandle(sessionId, () => this.startInjectedFailure(sessionId, request, failure)),
        );
      }

      const matched = this.scripts.find(({ matcher }) => matcher(request));
      const script = matched?.script ?? DEFAULT_SCRIPT;

      if (script.requiresMcpServer !== undefined && this.provisionMcp === undefined) {
        // Promise.reject, not throw: startSession is not `async`, so a bare `throw` here would be a
        // synchronous exception rather than a rejected promise, breaking any caller (including this
        // package's own tests) that relies on the Promise<SessionHandle> contract and awaits/`.rejects`s
        // it.
        return Promise.reject(
          new Error(
            `@forge/testkit: session requires MCP server "${script.requiresMcpServer}", but this fake ` +
              'adapter was configured without mcp or toolProxy capability ' +
              '(withCapabilities({ mcp: false, toolProxy: false })).',
          ),
        );
      }

      return Promise.resolve(
        makeHandle(sessionId, () => this.runScript(sessionId, request, script)),
      );
    } catch (error) {
      // A caller-supplied SessionRequestMatcher (registered via .script()/.injectFailure()) can itself
      // throw; startSession is not `async`, so without this guard that throw would propagate
      // synchronously to the caller instead of the Promise<SessionHandle> rejection its own type
      // signature promises — the identical hazard the two Promise.reject sites above already guard
      // against, just reached through caller-supplied code instead of this method's own body.
      return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
  }

  private refuse(
    stepId: string,
    kind: StrictViolationRecord['kind'],
    violations: readonly string[],
  ): StrictPromptViolationError {
    const record: StrictViolationRecord = { stepId, kind, violations };
    this.strictViolationLog.push(record);
    unacknowledgedViolations().add(record);
    return new StrictPromptViolationError(stepId, violations);
  }

  resumeSession(sessionId: string, request: ResumeRequest): Promise<SessionHandle> {
    if (this.strict !== undefined) {
      const violations = checkUserPrompt(promptOf(request));
      if (violations.length > 0) {
        const stepId = this.rememberedContextBySessionId.get(sessionId)?.stepId ?? sessionId;
        return Promise.reject(this.refuse(stepId, 'resume', violations));
      }
    }
    if (!this.caps.sessionResume) {
      // Promise.reject, not throw: resumeSession is not `async`, so a bare `throw` here would be a
      // synchronous exception rather than a rejected promise — see the matching note in startSession.
      return Promise.reject(
        new Error(
          '@forge/testkit: resumeSession was called but this fake adapter was configured without the ' +
            'sessionResume capability (withCapabilities({ sessionResume: false })).',
        ),
      );
    }
    const remembered = this.rememberedFinalTextBySessionId.get(sessionId);
    // A sessionId this adapter never actually started (or no longer remembers) falls back to the same
    // uninformative-but-harmless defaults ResumeRequest's own shape would otherwise force on every
    // resume — permissive, not a hard failure, matching resumeSession's own pre-existing tolerance for
    // an unrecognised sessionId.
    const rememberedContext = this.rememberedContextBySessionId.get(sessionId) ?? {
      runId: 'resumed',
      stepId: 'resumed',
      cwd: '',
      tools: { read: true, write: true, exec: false, network: 'none' },
    };
    return Promise.resolve(
      makeHandle(sessionId, () =>
        this.runResumedScript(sessionId, request, remembered, rememberedContext),
      ),
    );
  }

  private async *startInjectedFailure(
    sessionId: string,
    request: SessionRequest,
    failure: FakeFailureKind,
  ): AsyncGenerator<AdapterEvent, SessionResult> {
    yield { type: 'session.started', sessionId, model: request.model, tools: [], meta: {} };
    if (failure === 'timeout') {
      // Never resolves — a genuine hang is exactly what "timeout" means; it is the caller's own job
      // (whoever is testing their own timeout-handling logic) to bound this, the same reason
      // @forge/adapter-kit/conformance's own withTimeout helper exists for its own tests.
      await new Promise<never>(() => {
        // Deliberately never settles.
      });
    }
    if (failure === 'abort') {
      yield { type: 'session.ended', reason: 'aborted' };
      return {
        sessionId,
        ok: false,
        finalText: '',
        usage: emptyUsage(),
        durationMs: 0,
        changedFiles: [],
        controlTokens: [],
      };
    }
    const errorInfo = {
      code: 'INJECTED_FAILURE',
      message: 'a failure was injected for this request',
    };
    yield { type: 'error', code: errorInfo.code, message: errorInfo.message, retryable: false };
    yield { type: 'session.ended', reason: 'error' };
    return {
      sessionId,
      ok: false,
      finalText: '',
      usage: emptyUsage(),
      durationMs: 0,
      changedFiles: [],
      controlTokens: [],
      error: errorInfo,
    };
  }

  private *emitTextAndPromoteControlTokens(
    text: string,
    finalTextParts: string[],
    controlTokens: ParsedControlToken[],
  ): Generator<AdapterEvent> {
    yield { type: 'text', text, partial: false };
    finalTextParts.push(text);
    for (const token of parseControlTokens(text).tokens) {
      controlTokens.push(token);
      yield { type: 'control', token: token.token, payload: token };
    }
  }

  /** Runs every phase of `script` (text, thinking, untrusted-content stripping, skill-visible text,
   * writes, exec attempts, MCP tool attempts) against `ctx`, generically enforcing grants/limits/abort
   * the same way for both a fresh session (`runScript`) and a resumed one (`runResumedScript`) — the
   * single implementation both delegate to, so the two can never drift out of sync on what "enforced"
   * means. `ctx.abortSignal` is checked before *every* phase and before *every item* inside a per-item
   * phase (not just once at the top), since a real caller can call `.next()` again — after an item was
   * yielded and it did its own I/O in response — at any point, and `abortSignal.aborted` can genuinely
   * have become true in that gap. */
  private async *runScriptPhases(
    script: FakeSessionScript,
    ctx: ScriptPhaseContext,
  ): AsyncGenerator<AdapterEvent, ScriptPhaseOutcome> {
    const finalTextParts: string[] = [];
    const controlTokens: ParsedControlToken[] = [];
    const changedFiles: string[] = [];
    let turnsRun = 0;

    const outcome = (endedEarly: 'aborted' | 'limit' | undefined): ScriptPhaseOutcome => ({
      finalText: finalTextParts.join(''),
      controlTokens,
      changedFiles,
      turnsRun,
      endedEarly,
    });
    function* bailIfAborted(): Generator<AdapterEvent, boolean> {
      if (!ctx.abortSignal.aborted) return false;
      yield { type: 'session.ended', reason: 'aborted' };
      return true;
    }

    if (yield* bailIfAborted()) return outcome('aborted');

    const textEntries = script.text ?? [];
    const maxTurns = ctx.limits.maxTurns;
    for (const text of textEntries) {
      if (yield* bailIfAborted()) return outcome('aborted');
      if (maxTurns !== undefined && turnsRun >= maxTurns) {
        yield { type: 'session.ended', reason: 'limit' };
        return outcome('limit');
      }
      yield* this.emitTextAndPromoteControlTokens(text, finalTextParts, controlTokens);
      turnsRun += 1;
    }

    if (yield* bailIfAborted()) return outcome('aborted');
    for (const thinkingText of script.thinking ?? []) {
      if (yield* bailIfAborted()) return outcome('aborted');
      yield { type: 'thinking', text: thinkingText };
    }

    if (yield* bailIfAborted()) return outcome('aborted');
    if (script.untrustedContent !== undefined) {
      const stripped = stripControlTokens(script.untrustedContent);
      if (stripped.text !== '') {
        yield* this.emitTextAndPromoteControlTokens(stripped.text, finalTextParts, controlTokens);
      }
    }

    if (yield* bailIfAborted()) return outcome('aborted');
    const provisioning = this.getProvisioning(ctx.runId, ctx.stepId);
    if (script.skillVisibleText !== undefined && (provisioning?.skillIds.length ?? 0) > 0) {
      yield* this.emitTextAndPromoteControlTokens(
        script.skillVisibleText,
        finalTextParts,
        controlTokens,
      );
    }

    if (yield* bailIfAborted()) return outcome('aborted');
    for (const file of script.writeFiles ?? []) {
      if (yield* bailIfAborted()) return outcome('aborted');
      const id = `write:${file.relativePath}`;
      yield { type: 'tool.call', id, name: 'write_file', input: { path: file.relativePath } };
      if (!ctx.tools.write || !this.caps.fileEditing) {
        yield { type: 'tool.result', id, ok: false, summary: 'write is not granted' };
        continue;
      }
      const target = resolveInsideCwd(ctx.cwd, file.relativePath);
      if (target === undefined) {
        yield {
          type: 'tool.result',
          id,
          ok: false,
          summary: `refused: "${file.relativePath}" resolves outside the session's own cwd`,
        };
        continue;
      }
      // `ctx.vetFileAccess` (`SessionRequest.vetFileAccess`, `SPEC-QUESTIONS.md` Q347): consulted IN
      // ADDITION to `resolveInsideCwd`'s own lexical containment check above, mirroring the identical
      // property `ctx.vetExecCommand` already adds on top of `isExecAllowed` below -- the one way a
      // fake-adapter-backed test can exercise a caller's own gate at all (this type's own doc comment
      // on `ScriptPhaseContext.vetFileAccess` has the fuller reasoning).
      const fileAccessVetted =
        ctx.vetFileAccess === undefined ? true : (await ctx.vetFileAccess('Write', target)).allowed;
      if (!fileAccessVetted) {
        yield {
          type: 'tool.result',
          id,
          ok: false,
          summary: `refused: "${file.relativePath}" was denied by this session's own vetFileAccess gate`,
        };
        continue;
      }
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, file.content, 'utf8');
      changedFiles.push(file.relativePath);
      yield { type: 'file.changed', path: file.relativePath, change: 'created' };
      yield { type: 'tool.result', id, ok: true, summary: `wrote ${file.relativePath}` };
    }

    if (yield* bailIfAborted()) return outcome('aborted');
    for (const [index, command] of (script.execAttempts ?? []).entries()) {
      if (yield* bailIfAborted()) return outcome('aborted');
      const id = `exec:${String(index)}`;
      // `ctx.vetExecCommand` (`SessionRequest.vetExecCommand`, `specs/22` M17 P7, critic round 4):
      // consulted IN ADDITION to the grant-pattern check below, mirroring the real property a real
      // adapter's own `canUseTool` wiring is meant to add on top of its native `allowedTools`
      // matching -- the one way a fake-adapter-backed test can exercise a caller's own gate at all
      // (this type's own doc comment on `fake-adapter.ts`'s `ScriptPhaseContext` has the fuller
      // reasoning for why this is not, and cannot be, proof that the REAL SDK invokes it the same way).
      const vetted =
        ctx.vetExecCommand === undefined ? true : (await ctx.vetExecCommand(command)).allowed;
      const allowed = isExecAllowed(ctx.tools, command) && this.caps.bash && vetted;
      yield { type: 'tool.call', id, name: 'exec', input: { command } };
      yield { type: 'tool.result', id, ok: allowed, summary: command };
    }

    if (yield* bailIfAborted()) return outcome('aborted');
    for (const [index, toolName] of (script.mcpToolAttempts ?? []).entries()) {
      if (yield* bailIfAborted()) return outcome('aborted');
      const id = `mcp:${String(index)}`;
      const granted = isMcpToolGranted(provisioning, toolName);
      yield { type: 'tool.call', id, name: toolName };
      yield { type: 'tool.result', id, ok: granted, summary: toolName };
    }

    if (yield* bailIfAborted()) return outcome('aborted');
    for (const [index, url] of (script.webFetchAttempts ?? []).entries()) {
      if (yield* bailIfAborted()) return outcome('aborted');
      const id = `webfetch:${String(index)}`;
      // `ctx.vetNetworkAccess` (`SessionRequest.vetNetworkAccess`, `SPEC-QUESTIONS.md` Q350):
      // consulted IN ADDITION to the grant-native check below, mirroring the identical property
      // `ctx.vetExecCommand` already adds on top of `isExecAllowed` above -- the one way a
      // fake-adapter-backed test can exercise a caller's own network-access gate at all.
      const vetted =
        ctx.vetNetworkAccess === undefined
          ? true
          : (await ctx.vetNetworkAccess('WebFetch', url)).allowed;
      // Destructured, not a `.hostname` member access on a fresh `new URL(...)`: the real-but-
      // overbroad R10 `HOST_FACT_NAMES` lint rule (`eslint.config.js`) matches ANY `MemberExpression`
      // named `hostname` on the assumption it is `os.hostname()` (a genuine per-machine fact); this is
      // the unrelated, deterministic WHATWG `URL.hostname` -- a pure parse of `url`, not a host fact at
      // all -- and destructuring sidesteps the selector's own `MemberExpression`-only AST match rather
      // than suppressing the rule (`createLiveNetworkAccessGate`'s own identical comment).
      let hostname: string | undefined;
      try {
        ({ hostname } = new URL(url));
      } catch {
        hostname = undefined;
      }
      const grantAllowed = hostname !== undefined && isHostAllowed(ctx.tools, hostname);
      const allowed = grantAllowed && this.caps.network !== 'none' && vetted;
      yield { type: 'tool.call', id, name: 'web_fetch', input: { url } };
      yield { type: 'tool.result', id, ok: allowed, summary: url };
    }

    if (yield* bailIfAborted()) return outcome('aborted');
    for (const [index, query] of (script.webSearchAttempts ?? []).entries()) {
      if (yield* bailIfAborted()) return outcome('aborted');
      const id = `websearch:${String(index)}`;
      // `ctx.vetNetworkAccess`: the identical consultation as `webFetchAttempts` immediately above,
      // now for `WebSearch` -- always called with `undefined` for the second argument, mirroring the
      // real `WebSearchInput` shape (`createLiveNetworkAccessGate`'s own doc comment has the fuller
      // reasoning for why `WebSearch` has no per-call host to vet at all).
      const vetted =
        ctx.vetNetworkAccess === undefined
          ? true
          : (await ctx.vetNetworkAccess('WebSearch', undefined)).allowed;
      const allowed = ctx.tools.network === 'full' && this.caps.network !== 'none' && vetted;
      yield { type: 'tool.call', id, name: 'web_search', input: { query } };
      yield { type: 'tool.result', id, ok: allowed, summary: query };
    }

    if (yield* bailIfAborted()) return outcome('aborted');
    return outcome(undefined);
  }

  private async *runScript(
    sessionId: string,
    request: SessionRequest,
    script: FakeSessionScript,
  ): AsyncGenerator<AdapterEvent, SessionResult> {
    yield { type: 'session.started', sessionId, model: request.model, tools: [], meta: {} };

    // Checked before any script dispatch, unconditionally: an invalid model fails a session no matter
    // which prompt was requested, the identical "check model first, not folded into per-prompt
    // behaviour" ordering M4 P4's own gauntlet round found missing from an earlier fake-adapter-shaped
    // stub built for that piece's own tests.
    if (request.model !== FAKE_MODEL_ID && !this.extraModels.includes(request.model)) {
      const errorInfo = { code: 'UNKNOWN_MODEL', message: `unknown model id: ${request.model}` };
      yield { type: 'error', code: errorInfo.code, message: errorInfo.message, retryable: false };
      yield { type: 'session.ended', reason: 'error' };
      return {
        sessionId,
        ok: false,
        finalText: '',
        usage: emptyUsage(),
        durationMs: 0,
        changedFiles: [],
        controlTokens: [],
        error: errorInfo,
      };
    }

    const outcome = yield* this.runScriptPhases(script, {
      runId: request.runId,
      stepId: request.stepId,
      cwd: request.cwd,
      tools: request.tools,
      abortSignal: request.abortSignal,
      limits: request.limits,
      vetExecCommand: request.vetExecCommand,
      vetFileAccess: request.vetFileAccess,
      vetNetworkAccess: request.vetNetworkAccess,
    });

    if (outcome.endedEarly !== undefined) {
      const turns = outcome.turnsRun;
      return {
        sessionId,
        ok: outcome.endedEarly === 'limit',
        finalText: outcome.finalText,
        usage: { inputTokens: 10 * turns, outputTokens: 5 * turns, turns },
        durationMs: 0,
        changedFiles: outcome.changedFiles,
        controlTokens: outcome.controlTokens,
      };
    }

    const effectiveTurns = Math.max(outcome.turnsRun, 1);
    const usage: SessionResult['usage'] = {
      inputTokens: 10 * effectiveTurns,
      outputTokens: 5 * effectiveTurns,
      turns: outcome.turnsRun,
      ...(script.costUsd !== undefined ? { costUsd: script.costUsd } : {}),
      // M17 P11: mirrors `costUsd` immediately above, for the identical reason.
      ...(script.cacheReadTokens !== undefined ? { cacheReadTokens: script.cacheReadTokens } : {}),
      ...(script.cacheCreationTokens !== undefined
        ? { cacheCreationTokens: script.cacheCreationTokens }
        : {}),
    };
    yield { type: 'usage', inputTokens: usage.inputTokens, outputTokens: usage.outputTokens };

    this.rememberedFinalTextBySessionId.set(sessionId, outcome.finalText);

    if (script.endReason === 'error') {
      const errorInfo = script.errorInfo ?? {
        code: 'SCRIPTED_ERROR',
        message: 'the script specified an error ending',
      };
      yield { type: 'error', code: errorInfo.code, message: errorInfo.message, retryable: false };
      yield { type: 'session.ended', reason: 'error' };
      return {
        sessionId,
        ok: false,
        finalText: outcome.finalText,
        usage,
        durationMs: 0,
        changedFiles: outcome.changedFiles,
        controlTokens: outcome.controlTokens,
        error: errorInfo,
      };
    }

    yield { type: 'session.ended', reason: 'complete' };
    return {
      sessionId,
      ok: true,
      finalText: outcome.finalText,
      usage,
      durationMs: 0,
      changedFiles: outcome.changedFiles,
      controlTokens: outcome.controlTokens,
      // Gated on structuredOutput too, not just the script's own say-so: a degraded adapter without the
      // capability must behave like a real platform lacking JSON-mode support would — plain text only,
      // never a structured payload, regardless of what the script or the request asked for.
      ...(script.structured !== undefined && this.caps.structuredOutput
        ? { structured: script.structured }
        : {}),
    };
  }

  /** A resumed session runs every phase the same way a fresh one does (`runScriptPhases`, shared with
   * `runScript`) — same abort/limit checking, same grants, same control-token promotion — with one
   * addition at the very start: if the original session produced any final text, it is replayed as a
   * leading, plain `text` event (not re-scanned for control tokens — those were already promoted once,
   * in the turn that first produced this text; scanning it again could double-emit the same `control`
   * event). The script a resumed request matches against is probed with the *original* session's own
   * remembered `runId`/`stepId`/`cwd`/`tools` (a resume continues the same lane/session, not a new one
   * with none of that context), falling back to uninformative defaults only for a `sessionId` this
   * adapter never actually started. */
  private async *runResumedScript(
    sessionId: string,
    request: ResumeRequest,
    remembered: string | undefined,
    rememberedContext: RememberedSessionContext,
  ): AsyncGenerator<AdapterEvent, SessionResult> {
    yield { type: 'session.started', sessionId, model: FAKE_MODEL_ID, tools: [], meta: {} };

    const leadingTextParts: string[] = [];
    if (remembered !== undefined && remembered !== '') {
      yield { type: 'text', text: remembered, partial: false };
      leadingTextParts.push(remembered);
    }

    const matched = this.scripts.find(({ matcher }) =>
      matcher({
        runId: rememberedContext.runId,
        stepId: rememberedContext.stepId,
        cwd: rememberedContext.cwd,
        systemPrompt: { mode: 'append', text: '' },
        prompt: request.prompt,
        model: FAKE_MODEL_ID,
        tools: rememberedContext.tools,
        permissionMode: 'auto',
        limits: request.limits,
        env: {},
        abortSignal: request.abortSignal,
      }),
    );
    const script = matched?.script ?? { text: [] };

    const outcome = yield* this.runScriptPhases(script, {
      runId: rememberedContext.runId,
      stepId: rememberedContext.stepId,
      cwd: rememberedContext.cwd,
      tools: rememberedContext.tools,
      abortSignal: request.abortSignal,
      limits: request.limits,
      // `RememberedSessionContext` does not carry `vetExecCommand`/`vetFileAccess`/`vetNetworkAccess`
      // (this file's own doc comment on that type) -- a resumed session has no caller-supplied gate to
      // re-apply here. No real caller resumes an adopt-tests session today, so this is not a live gap
      // this round needs to close.
      vetExecCommand: undefined,
      vetFileAccess: undefined,
      vetNetworkAccess: undefined,
    });
    const finalText = leadingTextParts.join('') + outcome.finalText;

    if (outcome.endedEarly !== undefined) {
      const turns = outcome.turnsRun;
      return {
        sessionId,
        ok: outcome.endedEarly === 'limit',
        finalText,
        usage: { inputTokens: 10 * turns, outputTokens: 5 * turns, turns },
        durationMs: 0,
        changedFiles: outcome.changedFiles,
        controlTokens: outcome.controlTokens,
      };
    }

    // Computed once and yielded as its own event, matching runScript's identical structure — a resumed
    // session's usage must not silently omit the streamed event nor diverge (by staying flat/unscaled
    // on the error path alone) from what a fresh session with the same script reports.
    const effectiveTurns = Math.max(outcome.turnsRun, 1);
    const usage: SessionResult['usage'] = {
      inputTokens: 10 * effectiveTurns,
      outputTokens: 5 * effectiveTurns,
      turns: outcome.turnsRun,
      ...(script.costUsd !== undefined ? { costUsd: script.costUsd } : {}),
      // M17 P11: mirrors `costUsd` immediately above, for the identical reason.
      ...(script.cacheReadTokens !== undefined ? { cacheReadTokens: script.cacheReadTokens } : {}),
      ...(script.cacheCreationTokens !== undefined
        ? { cacheCreationTokens: script.cacheCreationTokens }
        : {}),
    };
    yield { type: 'usage', inputTokens: usage.inputTokens, outputTokens: usage.outputTokens };

    if (script.endReason === 'error') {
      const errorInfo = script.errorInfo ?? {
        code: 'SCRIPTED_ERROR',
        message: 'the script specified an error ending',
      };
      yield { type: 'error', code: errorInfo.code, message: errorInfo.message, retryable: false };
      yield { type: 'session.ended', reason: 'error' };
      return {
        sessionId,
        ok: false,
        finalText,
        usage,
        durationMs: 0,
        changedFiles: outcome.changedFiles,
        controlTokens: outcome.controlTokens,
        error: errorInfo,
      };
    }

    yield { type: 'session.ended', reason: 'complete' };
    return {
      sessionId,
      ok: true,
      finalText,
      usage,
      durationMs: 0,
      changedFiles: outcome.changedFiles,
      controlTokens: outcome.controlTokens,
      ...(script.structured !== undefined && this.caps.structuredOutput
        ? { structured: script.structured }
        : {}),
    };
  }
}

/** Returns a fresh `FakePlatformAdapter` reporting the given capability subset. A hard, typed refusal —
 * never a silent no-op or a silent success — is currently wired for `sessionResume` (`resumeSession`
 * itself refuses), `mcp`/`toolProxy` (`provisionMcp` is genuinely absent, and a script's own
 * `requiresMcpServer` refuses `startSession`), `structuredOutput` (a scripted `structured` payload is
 * silently omitted from the result, matching a real platform without JSON-mode support), and
 * `fileEditing`/`bash` (folded into the existing `tools.write`/`tools.exec` grant checks, so a degraded
 * adapter refuses a write or exec attempt the request itself granted). The remaining capability flags
 * are reported accurately by `capabilities()` but are not independently enforced — this fake has no
 * script vocabulary yet for e.g. an "interject attempt" or a "subagent spawn attempt" to refuse, and
 * inventing one before any consumer needs it would be scope this milestone's own plan does not call
 * for (`SPEC-QUESTIONS.md` Q61 point 11). */
export function withCapabilities(
  overrides: Partial<AdapterCapabilities>,
  options: FakeAdapterOptions = {},
): FakePlatformAdapter {
  return new FakePlatformAdapter(overrides, options);
}
