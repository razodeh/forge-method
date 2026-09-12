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
 * both; recorded rather than silently left undocumented): `SessionRequest.systemPrompt`,
 * `permissionMode`, and `attachments` are accepted but have no observable effect, since no script field
 * models a platform reacting to them yet. `SessionLimits.wallClockMs`/`maxCostUsd` are accepted but not
 * enforced (this package has no injectable clock — see determinism, `specs/22`). None of these
 * currently have a consumer that needs them; add the mechanism when one does, rather than speculatively
 * now. `SessionResult.usage.costUsd` *was* one such deferred item (this doc comment used to say it "is
 * never populated... add the mechanism when one does") until `PLAN-M11.md` P11 became that real
 * consumer: `FakeSessionScript.costUsd` now threads a script-supplied figure straight onto
 * `usage.costUsd`, omitted (not defaulted to `0`) when unset, matching a real adapter's own "cost
 * reporting is optional" shape.
 *
 * @see specs/07 §7.2
 * @see specs/15 §15.6
 * @see specs/20 §20.5
 * @see SPEC-QUESTIONS.md Q61
 * @see PLAN-M4.md P5
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { parseControlTokens, stripControlTokens } from '@forge/adapter-kit/control-tokens';
import { isExecAllowed } from '@forge/adapter-kit/grants';
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

export type FakeFailureKind = 'error' | 'timeout' | 'abort';

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
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) return undefined;
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

  // Present only when this instance can provision MCP at all (SPEC-QUESTIONS.md Q61 point 6) — a
  // genuinely absent instance property, not a present-but-throwing method, so a degraded
  // withCapabilities({ mcp: false, toolProxy: false }) instance correctly *skips* C16 through
  // @forge/adapter-kit/conformance's own existing `adapter.provisionMcp === undefined` gate.
  readonly provisionMcp?: (
    servers: readonly GrantedMcpServer[],
    ctx: SessionContext,
  ) => Promise<McpProvisioning>;

  constructor(capabilityOverrides: Partial<AdapterCapabilities> = {}) {
    this.caps = { ...DEFAULT_CAPABILITIES, ...capabilityOverrides };
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

  capabilities(): Promise<AdapterCapabilities> {
    return Promise.resolve(this.caps);
  }

  preflight(): Promise<PreflightResult> {
    return Promise.resolve({ ok: true, issues: [] });
  }

  listModels(): Promise<readonly ModelInfo[]> {
    return Promise.resolve([{ id: FAKE_MODEL_ID, displayName: 'FORGE Fake Model' }]);
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

  resumeSession(sessionId: string, request: ResumeRequest): Promise<SessionHandle> {
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
      const allowed = isExecAllowed(ctx.tools, command) && this.caps.bash;
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
    if (request.model !== FAKE_MODEL_ID) {
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
export function withCapabilities(overrides: Partial<AdapterCapabilities>): FakePlatformAdapter {
  return new FakePlatformAdapter(overrides);
}
