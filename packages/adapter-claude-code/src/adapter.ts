/**
 * `ClaudeCodeAdapter` — the real `PlatformAdapter` implementation tying P1 (config/version/auth),
 * P2 (CLI transport), P3 (SDK transport), P6 (`provisionSkills`), and P7 (`provisionMcp`) together:
 * transport selection with a documented preference order, `startSession`/`resumeSession` over
 * whichever transport a given session actually used, `capabilities`/`preflight`/`listModels`, native
 * skill materialisation, and MCP grant provisioning with real load verification.
 *
 * @see specs/07 §7.2
 * @see specs/07 §7.3
 * @see specs/15 §15.6
 * @see SPEC-QUESTIONS.md Q116
 * @see SPEC-QUESTIONS.md Q119
 * @see PLAN-M7.md P4, P6, P7
 */
import type {
  AdapterCapabilities,
  AdapterEvent,
  GrantedMcpServer,
  McpProvisioning,
  ModelInfo,
  PlatformAdapter,
  PreflightContext,
  PreflightResult,
  ResolvedSkill,
  ResumeRequest,
  SessionContext,
  SessionHandle,
  SessionRequest,
  SessionResult,
  SkillProvisioning,
} from '@forge/adapter-kit';
import type { Options as SdkOptions } from '@anthropic-ai/claude-agent-sdk';

import { buildCliArgs } from './cli/build-args.ts';
import { spawnClaudeCli } from './cli/spawn.ts';
import { confirmedCapabilities, staticCapabilities } from './capabilities.ts';
import type { ClaudeCodeAdapterConfig } from './config.ts';
import { listClaudeCodeModels } from './list-models.ts';
import {
  findMissingGrantedServers,
  mapGrantedMcpServersToAllowedTools,
  mapGrantedMcpServersToConfig,
  mergeSdkForgeMcpServer,
  readMcpServerNames,
} from './mcp.ts';
import type { McpSessionExtras } from './mcp.ts';
import type { ForgeMcpBackend } from './forge-mcp/index.ts';
import { createForgeMcpServer } from './forge-mcp/index.ts';
import { runPreflight } from './preflight.ts';
import { makeSessionHandle } from './session-handle.ts';
import { accumulateSessionResult } from './session-result.ts';
import type { RunSdkQueryOptions, RunningSdkQuery } from './sdk/run-query.ts';
import { provisionSkills as provisionSkillsImpl } from './skills.ts';
import { mapPermissionModeForCli, mapPermissionModeForSdk } from './tool-grant.ts';

const FORGE_PERMISSION_MODES: readonly SessionRequest['permissionMode'][] = [
  'manual',
  'accept-edits',
  'deny-unlisted',
  'auto',
];

/** The two SDK-transport entry points this adapter actually calls, bundled behind one loader seam
 * (below) rather than imported at this file's own top level -- see `LoadSdkTransport`'s own doc
 * comment for why. */
export interface SdkTransportModule {
  readonly buildSdkOptions: (
    req: SessionRequest,
    config: ClaudeCodeAdapterConfig,
    resumeSessionId?: string,
    mcp?: McpSessionExtras,
  ) => SdkOptions;
  readonly runSdkQuery: (
    prompt: string,
    options: SdkOptions,
    runOptions?: RunSdkQueryOptions,
  ) => RunningSdkQuery;
}

export type LoadSdkTransport = () => Promise<SdkTransportModule | undefined>;

/**
 * The real default: a genuine dynamic `import()`, deliberately never a static top-level one.
 * `./sdk/run-query.ts` and `./sdk/build-options.ts` both statically import the real
 * `@anthropic-ai/claude-agent-sdk` package -- if *this* file also imported either of them statically,
 * a genuine SDK resolution failure in some other environment (package missing, an incompatible native
 * binding, ...) would crash this whole module at load time, before `ClaudeCodeAdapter` even had a
 * chance to fall back to the CLI transport. `07` §7.3's own "when the SDK isn't installed" fallback
 * condition is only real when this file's own SDK dependency is deferred to first actual use like
 * this. Injectable (`ClaudeCodeAdapterOptions.loadSdkTransport`) so a fixture can simulate a genuine
 * load failure deterministically without needing to actually break this environment's real, working
 * install -- this package's own established "inject the real dependency, default to the real
 * implementation" convention (`ClaudeCliRunner`, P1; `queryFn`, P3; `now`, P4's own `session-result.ts`),
 * applied here a fourth time, and a fifth alongside `spawnCli` (`ClaudeCodeAdapterOptions`, below).
 */
const defaultLoadSdkTransport: LoadSdkTransport = async () => {
  try {
    const sdkModule = await import('./sdk/index.ts');
    return { buildSdkOptions: sdkModule.buildSdkOptions, runSdkQuery: sdkModule.runSdkQuery };
  } catch {
    return undefined;
  }
};

interface TrackedSession {
  readonly transport: 'cli' | 'sdk';
  /** The most recent request this session actually ran with -- `ResumeRequest` (`@forge/adapter-kit`)
   * deliberately carries only `prompt`/`limits`/`abortSignal`, so a resume needs this to recover
   * `cwd`/`model`/`tools`/`systemPrompt`/`env`/`outputSchema`. `startOnTransport` (below) does replace
   * this entry's own object on every resume, but only ever with `{...request, prompt, limits,
   * abortSignal}` (`resumeSession`'s own `resumedRequest`) -- every field a *second* resume would need
   * to recover (`cwd`/`model`/`tools`/`systemPrompt`/`env`/`outputSchema`) is carried forward
   * unchanged by that spread, so a chain of resumes never actually loses or drifts the original
   * session's own context, even though the object reference itself is not literally the one
   * `startSession` first stored. */
  readonly request: SessionRequest;
  /** The real Claude-Code-assigned session id, learned only once this session's own real
   * `session.started` event has actually arrived (`drainAndTrack`, below) -- absent until then, and
   * absent forever for a session that errored/aborted before that event ever arrived. */
  readonly claudeSessionId?: string;
}

/** `startSdkQuery`'s own real outcome -- either the real, running query, or a real, typed failure
 * naming *why* the sdk transport could not be used for this session (see `startSdkQuery`'s own doc
 * comment for the two genuine ways `ok: false` is reached). */
type SdkQueryOutcome =
  | { readonly ok: true; readonly running: RunningSdkQuery }
  | { readonly ok: false; readonly errorInfo: { readonly code: string; readonly message: string } };

export interface ClaudeCodeAdapterOptions {
  readonly config: ClaudeCodeAdapterConfig;
  /** A real ambient-environment snapshot (e.g. `PATH`/`HOME`) the *caller* has decided is safe to
   * expose -- never read from `process.env` inside this class itself (R10; `@forge/schemas/config`'s
   * own "env is passed explicitly" discipline, `preflight.ts`). Merged with each session's own grant-
   * scoped `SessionRequest.env`, that side always winning on an overlapping key, before either
   * transport spawns a real process. Both transports need this merge for the identical reason:
   * `spawnClaudeCli`'s own `extendEnv: false` (P2) means the CLI transport's child sees *only* what is
   * explicitly passed, and the SDK's own real `Options.env` field is documented just as strictly
   * ("REPLACES the subprocess environment entirely... When omitted, the subprocess inherits
   * `process.env`" -- confirmed against `sdk.d.ts`) -- omitting it entirely would silently leak this
   * whole process's own ambient environment into every SDK-transport session, a real C13 (no secret
   * leak) risk `buildSdkOptions` (P3) has no way to close on its own, since it is a pure function of
   * `SessionRequest` alone and was never given this ambient snapshot. See `SPEC-QUESTIONS.md` Q116.
   */
  readonly env: Readonly<Record<string, string>>;
  /** Injected, never read ambiently (R10) -- this package's own established, `@forge/core`-free clock
   * seam (`session-result.ts`, P4). No default is supplied here for the identical reason
   * `AccumulateSessionResultOptions.now` has none: referencing `Date.now` at all, even unapplied,
   * trips this repo's own `no-restricted-syntax` R10 rule (confirmed directly against
   * `eslint.config.js`), so a real wall-clock implementation can only come from a caller in a package
   * that is allowed to hold one (`@forge/core`'s own `Clock`, outside this package's boundary edge). */
  readonly now: () => number;
  /** Injectable, defaulting to the real `spawnClaudeCli` (P2) -- this package's own established
   * "inject the real dependency, default to the real implementation" convention, mirroring
   * `loadSdkTransport` below. Its own primary reason to exist: proving transport-selection dispatch
   * (`PLAN-M7.md` P4's own Checks -- "checked via a spy/marker, not merely 'no error was thrown'")
   * without a real, billed `claude` process spawn for every such test. */
  readonly spawnCli?: typeof spawnClaudeCli;
  readonly loadSdkTransport?: LoadSdkTransport;
  /**
   * `07` §7.3's own "Optional: FORGE MCP server" -- when given, every `sdk`-transport session gets a
   * fresh `createForgeMcpServer(forgeMcpBackend)` instance (`./forge-mcp/index.ts`, P8) folded into its
   * own MCP config via `mergeSdkForgeMcpServer` (`mcp.ts`), all 9 `forge_*` tools unconditionally
   * allowed. `undefined` (the default: no real backend exists yet anywhere this adapter has a
   * boundary edge to) means zero behavioural change from before this option existed -- the same
   * "absent input, absent effect" contract `provisionMcp`'s own `mcpGrantsByCwd` already established.
   *
   * `cli`-transport sessions never see this at all, by design, not by an oversight this option could
   * fix: a real, live `McpServer` instance cannot cross the real OS process boundary a spawned `claude`
   * subprocess is on the other side of. See `mergeSdkForgeMcpServer`'s own doc comment and
   * `SPEC-QUESTIONS.md` Q120 for the full record of this real, honest transport asymmetry.
   */
  readonly forgeMcpBackend?: ForgeMcpBackend;
}

/**
 * `ClaudeCodeAdapter.id`/`displayName` are fixed literal strings, not injected -- `'claude-code'` is
 * already the real, established key this whole package's own config lives under
 * (`platform.adapterConfig['claude-code']`, `config.ts`, P1).
 */
export class ClaudeCodeAdapter implements PlatformAdapter {
  readonly id = 'claude-code';
  readonly displayName = 'Claude Code';

  private readonly config: ClaudeCodeAdapterConfig;
  private readonly env: Readonly<Record<string, string>>;
  private readonly now: () => number;
  private readonly spawnCli: typeof spawnClaudeCli;
  private readonly loadSdk: LoadSdkTransport;
  private readonly forgeMcpBackend: ForgeMcpBackend | undefined;

  /**
   * Never evicted -- a real, deliberate trade-off, not an oversight (`SPEC-QUESTIONS.md` Q116), and
   * the same one `@forge/testkit`'s own `FakePlatformAdapter` already accepted for its own two
   * sibling maps (M4 P5, still unchanged today). `session.ended` cannot be the eviction trigger: a
   * caller resumes a session precisely *after* one of its turns has ended, so evicting on that event
   * would break the one feature this map exists to support. No other real trigger is named anywhere
   * in `07` §7.2's own `resumeSession` contract either. The real cost this leaves open: each entry's
   * own `request.env` retains that session's granted secrets in memory for as long as this adapter
   * instance lives, not just for as long as the session itself runs -- for a long-lived instance
   * serving unboundedly many sessions (this milestone's own plan does not name the intended adapter
   * lifecycle either way), this is real, unbounded retention, not merely unbounded map growth. Left
   * here as an explicit, flagged gap rather than an invented, speculative eviction policy nothing in
   * this piece's own scope actually calls for.
   */
  private readonly sessions = new Map<string, TrackedSession>();
  /** A plain per-instance counter, not `crypto.randomUUID()`: R10 forbids an uninjected random source
   * in production code (confirmed against `eslint.config.js`'s own `no-restricted-imports`/
   * `no-restricted-syntax`, which name `randomUUID` explicitly), and nothing about this id needs to be
   * unpredictable -- it only needs to not collide with another session this same adapter instance
   * started, which a monotonic counter already guarantees. The identical, already-gauntlet-tested
   * pattern `@forge/testkit`'s own `FakePlatformAdapter.startSession` (M4 P5) already uses for the
   * identical reason, and `@forge/core/fs`'s own `tempPathFor` (M1 P4) uses for a sibling one. This is
   * FORGE's own session identity, deliberately distinct from Claude Code's own real, internal session
   * id (a UUID `system/init` reports) -- `resumeSession` looks the latter up from the former via
   * `sessions`, below, rather than exposing it directly as `SessionHandle.sessionId`.
   */
  private sessionCounter = 0;
  /**
   * Keyed by `cwd`, not `runId`/`stepId` -- `15` §15.6's own "scoped to `ctx.cwd`" framing for the
   * MCP-grant path, and the natural key given `provisionMcp` and the later `startSession` call for
   * the same step both carry the identical lane worktree path (`SessionContext.cwd`/
   * `SessionRequest.cwd`). Never evicted, for the identical reason `sessions` (above) is not --
   * `SPEC-QUESTIONS.md` Q119 has the record for this map specifically.
   */
  private readonly mcpGrantsByCwd = new Map<string, readonly GrantedMcpServer[]>();
  /** Flips `true` the moment any session this instance has started actually observes a real
   * `session.started` event (`drainAndTrack`, below) -- `capabilities()`'s own pre/post-session
   * distinction (`PLAN-M7.md` P4's own Checks). Process-lifetime, not per-session: once this
   * environment's real install has been observed once, every later `capabilities()` call reflects
   * that, not just calls made on the one session that triggered it. */
  private sawSessionStarted = false;

  constructor(options: ClaudeCodeAdapterOptions) {
    this.config = options.config;
    this.env = options.env;
    this.now = options.now;
    this.spawnCli = options.spawnCli ?? spawnClaudeCli;
    this.loadSdk = options.loadSdkTransport ?? defaultLoadSdkTransport;
    this.forgeMcpBackend = options.forgeMcpBackend;
  }

  /**
   * `07` §7.3: "MUST implement both and select automatically with a documented preference order."
   * `config.transport === 'cli' | 'sdk'` pins that transport *unconditionally* (`config.ts`'s own doc
   * comment) -- including staying on `'sdk'` even if it later, genuinely fails to load; only the
   * auto-select path (`config.transport === undefined`) falls back to `cli` on a real load failure,
   * since only that path was ever asked to pick for itself.
   *
   * Deliberately *not* memoized across calls, unlike almost every other cached-probe in this package
   * (`preflight`'s own version/auth probes are the one other exception, for the identical reason): a
   * transient SDK-load failure at one moment should not permanently lock this adapter onto `cli` for
   * the rest of its process lifetime when a later attempt might genuinely succeed (Node's own module
   * loader already caches a real successful `import()` internally, so re-attempting the real case
   * costs nothing extra) -- and, as a direct consequence, `startSession` and a later `capabilities()`/
   * `resumeSession` call are each free to observe a *different* answer if this adapter's own real,
   * injected SDK availability genuinely changed in between, which `resumeSession`'s own Checks
   * (`PLAN-M7.md` P4) rely on being possible to prove in a fixture.
   *
   * Returns the loaded module alongside the decision, not just the `'cli'|'sdk'` string -- a fresh
   * critic round found the original version discarded it, forcing `startSdkQuery` (below) to call
   * `this.loadSdk()` a *second*, entirely independent time whenever auto-select had just picked
   * `'sdk'`. Threading the same reference through means the auto-select path now genuinely probes
   * once, not twice, and cannot disagree with itself between the two calls.
   */
  private async resolveTransport(): Promise<{
    readonly transport: 'cli' | 'sdk';
    readonly sdk?: SdkTransportModule;
  }> {
    if (this.config.transport === 'cli') return { transport: 'cli' };
    if (this.config.transport === 'sdk') return { transport: 'sdk' };
    const sdk = await this.loadSdk();
    return sdk === undefined ? { transport: 'cli' } : { transport: 'sdk', sdk };
  }

  async capabilities(): Promise<AdapterCapabilities> {
    const { transport } = await this.resolveTransport();
    const permissionModes = FORGE_PERMISSION_MODES.map((mode) =>
      transport === 'cli' ? mapPermissionModeForCli(mode) : mapPermissionModeForSdk(mode),
    );
    return this.sawSessionStarted
      ? confirmedCapabilities(permissionModes)
      : staticCapabilities(permissionModes);
  }

  preflight(ctx: PreflightContext): Promise<PreflightResult> {
    return runPreflight(ctx, this.config);
  }

  listModels(): Promise<readonly ModelInfo[]> {
    return Promise.resolve(listClaudeCodeModels());
  }

  /** `15` §15.6's own native-skills path (`capabilities().skills === 'native'`) — thin delegation to
   * `skills.ts`'s own `provisionSkills`, kept as a standalone, independently-testable function rather
   * than inlined here, matching every other piece of this class's own construction. */
  provisionSkills(
    skills: readonly ResolvedSkill[],
    ctx: SessionContext,
  ): Promise<SkillProvisioning> {
    return provisionSkillsImpl(skills, ctx);
  }

  /**
   * `15` §15.6's own MCP-grant path. Only *remembers* the real grant here, keyed by `ctx.cwd` --
   * `provisionMcp` runs before any session exists, so there is no real transport, no real
   * `SessionRequest`, and (per `07` §7.3's own design, recorded in `SPEC-QUESTIONS.md` Q119) no real
   * `system/init` event to read a loaded-server list from yet. The actual server config and
   * `--allowedTools`/`Options.allowedTools` additions are built later, inside `startOnTransport`,
   * once this session's own real request and transport are both known; the actual load-verification
   * enforcement ("granted-but-failed-to-load fails the step") lives in `drainAndTrack`'s own post-
   * `session.started` check, below -- this method's own `loadedServerIds: []` is deliberately
   * provisional, exactly as `PLAN-M7.md` P7 specifies, for a caller that inspects it before any
   * session has actually run.
   */
  provisionMcp(
    servers: readonly GrantedMcpServer[],
    ctx: SessionContext,
  ): Promise<McpProvisioning> {
    this.mcpGrantsByCwd.set(ctx.cwd, servers);
    return Promise.resolve({ loadedServerIds: [] });
  }

  async startSession(req: SessionRequest): Promise<SessionHandle> {
    this.sessionCounter += 1;
    const sessionId = `claude-code-${String(this.sessionCounter)}`;
    const { transport, sdk } = await this.resolveTransport();
    return this.startOnTransport(sessionId, transport, req, undefined, sdk);
  }

  /**
   * A plain method, not `async` -- `resumeSession` has no real asynchronous work of its own
   * (`this.startOnTransport(...)` returns a `SessionHandle` synchronously; only the transports it
   * kicks off are async), so an `async` declaration with no real `await` inside would itself be
   * flagged by this project's own `@typescript-eslint/require-await` rule.
   *
   * The `try`/`catch` below exists for a real, critic-found reason, not defensively: a *plain*
   * method returning `Promise.resolve(this.startOnTransport(...))` still evaluates
   * `startOnTransport(...)` as a normal function-call argument *before* `Promise.resolve` ever runs
   * -- a synchronous throw inside it (a real, reachable one: `buildCliArgs`'s own
   * `JSON.stringify(req.outputSchema)` throws on a circular `outputSchema` object) would have
   * escaped `resumeSession()` directly instead of rejecting, breaking the `Promise<SessionHandle>`
   * contract every caller is entitled to rely on -- the identical hazard, and the identical fix,
   * `@forge/testkit`'s own `FakePlatformAdapter.startSession`/`resumeSession` (M4 P5) already
   * document for caller-supplied code throwing inside their own non-`async` bodies.
   */
  resumeSession(sessionId: string, req: ResumeRequest): Promise<SessionHandle> {
    try {
      const tracked = this.sessions.get(sessionId);
      if (tracked?.claudeSessionId === undefined) {
        // Fail closed rather than start a session `--resume`/`options.resume` would receive a
        // made-up id for: this package's own established discipline (P1's preflight, P5's tool-grant
        // hardening) applied here to an unresumable session instead of a malformed grant.
        throw new Error(
          `@forge/adapter-claude-code: cannot resume session "${sessionId}" -- no real Claude Code ` +
            'session id was ever observed for it (either this adapter instance never started it, ' +
            'or it ended before a session.started event ever arrived).',
        );
      }
      // `ResumeRequest` has no `cwd`/`model`/`tools`/`systemPrompt`/`env`/`outputSchema` of its own
      // (`@forge/adapter-kit`, M4, `SPEC-QUESTIONS.md` Q58 point 4) -- recovered from the original
      // request `startOnTransport` remembered, below; only `prompt`/`limits`/`abortSignal` genuinely
      // refresh on a resume.
      //
      // Caller responsibility, deliberately not enforced here (`SPEC-QUESTIONS.md` Q116): calling
      // `resumeSession` again for the same `sessionId` before a still-active prior handle for it has
      // finished draining puts two real transports against the identical real Claude Code session id
      // at once, with no way for this adapter to reconcile the result -- the same class of hazard
      // `makeSessionHandle`'s own concurrent-drain guard exists for on a single handle, just not
      // mirrored across handles here.
      const resumedRequest: SessionRequest = {
        ...tracked.request,
        prompt: req.prompt,
        limits: req.limits,
        abortSignal: req.abortSignal,
      };
      // The *same* transport the original session used, even when that differs from this adapter's
      // own current default preference (`PLAN-M7.md` P4's own Checks) -- `tracked.transport`, not a
      // fresh `resolveTransport()` call. No preloaded sdk module either: unlike `startSession`, a
      // resume never ran `resolveTransport()`'s own probe, so `startSdkQuery` (below) loads fresh if
      // the original session happened to run on `sdk`.
      return Promise.resolve(
        this.startOnTransport(
          sessionId,
          tracked.transport,
          resumedRequest,
          tracked.claudeSessionId,
          undefined,
        ),
      );
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * `preloadedSdk` is only ever set by `startSession` (from `resolveTransport`'s own probe, when
   * auto-select just picked `'sdk'`) -- `resumeSession` always passes `undefined`, since it never ran
   * that probe (see `resumeSession`'s own comment).
   */
  private startOnTransport(
    sessionId: string,
    transport: 'cli' | 'sdk',
    req: SessionRequest,
    resumeClaudeSessionId: string | undefined,
    preloadedSdk: SdkTransportModule | undefined,
  ): SessionHandle {
    const existing = this.sessions.get(sessionId);
    const claudeSessionId = existing?.claudeSessionId ?? resumeClaudeSessionId;
    this.sessions.set(sessionId, {
      transport,
      request: req,
      ...(claudeSessionId === undefined ? {} : { claudeSessionId }),
    });

    // A caller-owned `req.abortSignal` cannot itself be `.abort()`-ed by this adapter (it does not own
    // that controller) -- this inner controller is what `SessionHandle.stop()` actually triggers, and
    // it is also wired to fire whenever the caller's own signal does, so either cancellation route
    // reaches the same place. Created here, synchronously, before either transport branch below --
    // `SessionHandle.stop()` must take effect even if called before the caller has ever begun
    // consuming `.events`/`.result()`.
    const abortController = new AbortController();
    if (req.abortSignal.aborted) {
      abortController.abort();
    } else {
      req.abortSignal.addEventListener('abort', () => {
        abortController.abort();
      });
    }

    // `07` §7.2: "Never pass secrets in prompt. Secrets reach the session only via env and only when
    // the step's grant includes them." Computed once, reused by whichever transport actually runs --
    // see `ClaudeCodeAdapterOptions.env`'s own doc comment for why *both* transports need this same
    // merge, not just the CLI one.
    const sessionEnv: Readonly<Record<string, string>> = { ...this.env, ...req.env };

    // `15` §15.6's own MCP-grant path (P7): `undefined` when no `provisionMcp` call ever ran for this
    // exact `cwd` -- both builders treat that identically to "no MCP grant at all," so a session that
    // never provisioned MCP behaves exactly as it did before this piece existed.
    const grantedServers = this.mcpGrantsByCwd.get(req.cwd);
    const mcpExtras: McpSessionExtras | undefined =
      grantedServers === undefined
        ? undefined
        : {
            allowedTools: mapGrantedMcpServersToAllowedTools(grantedServers),
            serverConfig: mapGrantedMcpServersToConfig(grantedServers),
            strict: !this.config.mcp.adoptHostServers,
          };

    // Both branches below do their transport's own real "session actually starts" work right here,
    // synchronously (or, for `sdk`, at least *kicked off* synchronously), before this method ever
    // returns -- never deferred into the generator `createGenerator` produces, which only starts
    // running once the caller actually begins pumping it. A fresh critic round found the original
    // draft eager for `cli` (the real `execa` spawn already happened by the time `startSession`
    // resolved) but lazy for `sdk` (the real `query()` call was deferred until first consumption) --
    // an asymmetry invisible to the caller (transport selection is this adapter's own internal
    // detail) that `PlatformAdapter.startSession`'s own "Start a session" wording does not license,
    // and a real resource-orphan risk specifically for `cli` if a caller obtains a handle and defers
    // consuming it (the real subprocess keeps running regardless). Both are eager now: `cli` spawns
    // immediately; `sdk` calls `this.startSdkQuery(...)` immediately, which itself calls
    // `this.loadSdk()`/`sdk.runSdkQuery(...)` synchronously up to its own first `await` -- the actual
    // dynamic import and (once loaded) the real `query()` call both genuinely begin here, not later.
    // Hoisted above both branches: `drainAndTrack`'s own load-verification path (P7, below) needs a
    // real `startedAt` to compute an honest `durationMs` if it ends the session early, and the `cli`
    // branch had no such reference of its own before this piece (unlike `sdk`, which already needed
    // one for its *other* early-failure path in `runSdkSessionFromOutcome`) -- one clock read, shared
    // by whichever branch actually runs, exactly mirroring `sessionEnv`'s own "computed once, reused"
    // rationale just above.
    const startedAt = this.now();
    let createGenerator: () => AsyncGenerator<AdapterEvent, SessionResult>;
    if (transport === 'cli') {
      const args = buildCliArgs(req, this.config, resumeClaudeSessionId, mcpExtras);
      const spawned = this.spawnCli(args, {
        cwd: req.cwd,
        env: sessionEnv,
        abortSignal: abortController.signal,
      });
      // `spawnClaudeCli`'s own `options.abortSignal` already forwards into `execa`'s real
      // `cancelSignal` (P2) -- aborting `abortController` above is genuinely sufficient to terminate
      // the real subprocess; nothing here needs to reach into `SpawnedClaudeCli.stop` separately.
      createGenerator = () =>
        this.drainAndTrack(
          sessionId,
          accumulateSessionResult(spawned.events, { sessionId, cwd: req.cwd, now: this.now }),
          grantedServers,
          abortController,
          startedAt,
        );
    } else {
      // `07` §7.3's own "Optional: FORGE MCP server" (P8) -- `sdk` transport only, a fresh
      // `McpServer` instance per session (never reused across sessions: a live `McpServer.connect()`
      // "assumes ownership of the Transport, replacing any callbacks... expects that it is the only
      // user of the Transport instance going forward," confirmed against the real, installed
      // `@modelcontextprotocol/sdk`'s own `mcp.d.ts`, so two concurrent sessions sharing one instance
      // would race for that ownership). The caller-granted `mcpExtras` (if any) is preserved and
      // merged with, never replaced by, this adapter-internal server -- see `mergeSdkForgeMcpServer`'s
      // own doc comment (`mcp.ts`) for why this only ever runs for `sdk`, never `cli`.
      const sdkMcpExtras: McpSessionExtras | undefined =
        this.forgeMcpBackend === undefined
          ? mcpExtras
          : mergeSdkForgeMcpServer(
              mcpExtras,
              createForgeMcpServer(this.forgeMcpBackend),
              !this.config.mcp.adoptHostServers,
            );
      const outcomePromise = this.startSdkQuery(
        req,
        resumeClaudeSessionId,
        abortController.signal,
        sessionEnv,
        preloadedSdk,
        sdkMcpExtras,
      );
      createGenerator = () =>
        this.runSdkSessionFromOutcome(
          sessionId,
          req.cwd,
          startedAt,
          outcomePromise,
          grantedServers,
          abortController,
        );
    }

    return makeSessionHandle(sessionId, createGenerator, () => {
      abortController.abort();
      return Promise.resolve();
    });
  }

  /**
   * The eager half of the `sdk` transport's own startup: loads the SDK module (reusing
   * `preloadedSdk` when `resolveTransport` already did, rather than probing a redundant second
   * time), builds `Options`, and calls the real `runSdkQuery` -- everything a real session-start
   * needs to have genuinely begun, called synchronously from `startOnTransport` (mirroring
   * `spawnCli`'s own eager call right next to it), not from inside the lazily-pumped generator that
   * later consumes its result (`runSdkSessionFromOutcome`, below). `runSdkQuery`'s own
   * `runOptions.abortSignal` already forwards into the real SDK's own `abortController` (P3), the
   * identical reasoning `startOnTransport`'s own `cli` branch already documents for `spawnCli`.
   */
  private async startSdkQuery(
    req: SessionRequest,
    resumeClaudeSessionId: string | undefined,
    abortSignal: AbortSignal,
    sessionEnv: Readonly<Record<string, string>>,
    preloadedSdk: SdkTransportModule | undefined,
    mcpExtras: McpSessionExtras | undefined,
  ): Promise<SdkQueryOutcome> {
    const sdk = preloadedSdk ?? (await this.loadSdk());
    if (sdk === undefined) {
      // Reachable two real ways, not one: (a) `config.transport === 'sdk'` was pinned explicitly and
      // the real load genuinely failed; or (b) `resumeSession` is continuing a session that
      // originally ran on `sdk`, but this adapter's real sdk availability has since regressed
      // (`resumeSession` never has a `preloadedSdk` to reuse, so it always probes fresh). Never
      // reachable from a plain auto-select `startSession`: `resolveTransport` only ever resolves to
      // `'sdk'` by already holding a real, loaded module, which is passed through as `preloadedSdk`
      // and used directly above, without a second, independently-fallible probe.
      return {
        ok: false,
        errorInfo: {
          code: 'ADP-CLAUDE-CODE-SDK-UNAVAILABLE',
          message:
            'the sdk transport was selected for this session, but @anthropic-ai/claude-agent-sdk ' +
            'failed to load when this session actually tried to use it.',
        },
      };
    }
    const options = sdk.buildSdkOptions(req, this.config, resumeClaudeSessionId, mcpExtras);
    // `buildSdkOptions` (P3) is a pure function of `SessionRequest` alone and has no ambient snapshot
    // to merge with `req.env` itself -- set here, by the one caller that actually holds both halves
    // of the merge, exactly mirroring how `startOnTransport`'s own `cli` branch supplies `env` to
    // `spawnClaudeCli` itself rather than through `buildCliArgs`.
    options.env = { ...sessionEnv };
    return { ok: true, running: sdk.runSdkQuery(req.prompt, options, { abortSignal }) };
  }

  /**
   * The lazy half: awaits the already-in-flight `startSdkQuery` outcome (kicked off eagerly by
   * `startOnTransport`, above) and either reports a real, typed failure or re-yields the real query's
   * own event stream through `drainAndTrack`/`accumulateSessionResult`, exactly like the `cli`
   * transport's own generator does for `spawned.events`.
   */
  private async *runSdkSessionFromOutcome(
    sessionId: string,
    cwd: string,
    startedAt: number,
    outcomePromise: Promise<SdkQueryOutcome>,
    grantedServers: readonly GrantedMcpServer[] | undefined,
    abortController: AbortController,
  ): AsyncGenerator<AdapterEvent, SessionResult> {
    const outcome = await outcomePromise;
    if (!outcome.ok) {
      yield { type: 'error', ...outcome.errorInfo, retryable: false };
      yield { type: 'session.ended', reason: 'error' };
      return {
        sessionId,
        ok: false,
        finalText: '',
        usage: { inputTokens: 0, outputTokens: 0, turns: 0 },
        durationMs: this.now() - startedAt,
        changedFiles: [],
        controlTokens: [],
        error: outcome.errorInfo,
      };
    }
    return yield* this.drainAndTrack(
      sessionId,
      accumulateSessionResult(outcome.running.events, { sessionId, cwd, now: this.now }),
      grantedServers,
      abortController,
      startedAt,
    );
  }

  /**
   * The one place both transports' own raw event streams are actually consumed: re-yields every event
   * unchanged (so callers see the identical stream either transport produces, `accumulateSessionResult`'s
   * own contract), while watching for the real `session.started` event to (a) learn this session's own
   * real Claude Code session id, for a later `resumeSession` to use, (b) flip `sawSessionStarted` for
   * `capabilities()`'s own pre/post-session distinction, and (c) run `07` §7.3's own MCP
   * load-verification Check (P7): a session that granted specific MCP servers (`provisionMcp`, above)
   * but whose real `system/init` event does not report every one of them back by name failed to load
   * what it was promised, and must not silently proceed as if it had everything it was granted.
   *
   * `grantedServers` is `undefined` when no `provisionMcp` call ever ran for this session's own `cwd`
   * -- the check below is skipped entirely in that case, identical to this method's own pre-P7
   * behaviour. The check itself only ever runs once, against the *first* `session.started` event seen
   * -- a fresh critic round noted the real SDK's own doc comment describes `SDKSystemMessage` as
   * metadata "the CLI emits at the start of each turn," and this codebase's own `session-result.ts`
   * (P4) already treats a single non-resumed session as potentially spanning several internal turns
   * (its own `turns: toolCallCount + 1` heuristic). Re-running this Check against every recurrence
   * (the original P7 draft's behaviour) risked a false positive strictly outside `07` §7.3's own
   * mandate -- its own wording ("confirm... actually loaded") is a one-time, at-startup fact, not an
   * ongoing liveness probe -- if a later turn's own metadata snapshot ever omitted a server that
   * genuinely loaded fine at real session start (never live-confirmed either way: no live call this
   * milestone has made has ever granted a real MCP server, `SPEC-QUESTIONS.md` Q119). Checking once
   * removes that entire risk at zero real cost: the fact this Check cares about (did the granted
   * server load) is settled the moment the session actually starts.
   *
   * On a genuine mismatch, `abortController` is aborted and `inner` is deliberately abandoned without
   * further draining, rather than synthesizing a throwaway `SessionResult` just to satisfy
   * `AsyncGenerator.return`'s own required argument. This is *not* quite the same shape as
   * `SessionHandle.stop()`'s own identical-looking abandonment (a fresh critic round's own correction
   * to this comment's original framing): `stop()`'s abandonment only ever happens because the
   * *external caller* chose to stop pumping after calling it, whereas this abandons `inner`
   * unconditionally, from inside this adapter's own code, even while a caller is actively draining via
   * `.result()`. In practice this is very likely safe for both transports -- `spawn.ts`'s own real
   * `execa` `cancelSignal` kills the real CLI subprocess independent of whether anything keeps
   * consuming its events, and the real SDK's own `Options.abortController` doc comment states aborting
   * it makes "the query... stop and clean up resources" itself, matching the identical signal-driven
   * (not consumption-driven) cleanup model -- but that conclusion rests on reading each side's own
   * documentation, not on an executable proof this codebase can produce without a live MCP grant
   * (recorded honestly in `SPEC-QUESTIONS.md` Q119 rather than asserted as fully proven).
   */
  private async *drainAndTrack(
    sessionId: string,
    inner: AsyncGenerator<AdapterEvent, SessionResult>,
    grantedServers: readonly GrantedMcpServer[] | undefined,
    abortController: AbortController,
    startedAt: number,
  ): AsyncGenerator<AdapterEvent, SessionResult> {
    let mcpLoadChecked = false;
    let step = await inner.next();
    while (!step.done) {
      if (step.value.type === 'session.started') {
        this.sawSessionStarted = true;
        const tracked = this.sessions.get(sessionId);
        if (tracked !== undefined) {
          this.sessions.set(sessionId, { ...tracked, claudeSessionId: step.value.sessionId });
        }

        if (grantedServers !== undefined && !mcpLoadChecked) {
          mcpLoadChecked = true;
          const missing = findMissingGrantedServers(
            grantedServers,
            readMcpServerNames(step.value.meta),
          );
          if (missing.length > 0) {
            abortController.abort();
            // The real `session.started` event is still yielded first -- a genuine session did start
            // (this adapter's own real session id, model, and tool list are all real), it just failed
            // this Check's own load contract; swallowing it here would hide real information a caller
            // or telemetry pipeline would otherwise see for every other early-failure path.
            yield step.value;
            const message = `granted MCP server(s) failed to load in Claude Code: ${missing.join(', ')}.`;
            yield {
              type: 'error',
              code: 'ADP-CLAUDE-CODE-MCP-LOAD-FAILED',
              message,
              retryable: false,
            };
            yield { type: 'session.ended', reason: 'error' };
            return {
              sessionId,
              ok: false,
              finalText: '',
              usage: { inputTokens: 0, outputTokens: 0, turns: 0 },
              durationMs: this.now() - startedAt,
              changedFiles: [],
              controlTokens: [],
              error: { code: 'ADP-CLAUDE-CODE-MCP-LOAD-FAILED', message },
            };
          }
        }
      }
      yield step.value;
      step = await inner.next();
    }
    return step.value;
  }
}
