/**
 * `runAdapterConformanceSuite` — proves the suite is satisfiable (a fully-compliant stub passes all 16)
 * and that it actually fails closed (three deliberately non-compliant stubs, each violating exactly one
 * of the five safety-critical cases, are shown to fail the specific check they broke) — `PLAN-M4.md` P4's
 * own Checks section, verbatim. Every stub adapter here is built only inside this file and never
 * exported.
 *
 * @see specs/07 §7.6
 * @see PLAN-M4.md P4
 */
import { mkdtemp, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { isExecAllowed } from '../../src/grants/exec.ts';
import { parseControlTokens } from '../../src/control-tokens/parse.ts';
import type {
  AdapterCapabilities,
  AdapterEvent,
  GrantedMcpServer,
  JSONSchema,
  McpProvisioning,
  ParsedControlToken,
  PlatformAdapter,
  ResolvedSkill,
  ResumeRequest,
  SessionContext,
  SessionHandle,
  SessionRequest,
  SessionResult,
  SkillProvisioning,
} from '../../src/types/index.ts';
import { createConformanceContext } from '../../src/conformance/context.ts';
import {
  checkC2CwdIsolation,
  checkC4ExecAllowlist,
  checkC14DeterminismOfReporting,
} from '../../src/conformance/filesystem.ts';
import {
  CONFORMANCE_EXEC_CANARY_RELATIVE_PATH,
  CONFORMANCE_WRITE_FILE_CONTENT,
  CONFORMANCE_WRITE_FILE_RELATIVE_PATH,
  type ConformanceOptions,
} from '../../src/conformance/fixtures.ts';
import { checkC16McpGrantFidelity } from '../../src/conformance/capabilities.ts';
import { checkC5Abort } from '../../src/conformance/control-and-abort.ts';
import { collectEvents } from '../../src/conformance/helpers.ts';
import { runAdapterConformanceSuite, SAFETY_CRITICAL_CONFORMANCE_IDS } from '../../src/conformance/suite.ts';

// --- fixture prompts: this is a fully scripted fake, so a short deterministic marker string is all a
// prompt needs to be (no natural-language elicitation required, unlike a real platform). ---
const HELLO_PROMPT = 'FIXTURE:HELLO';
const WRITE_FILE_PROMPT = 'FIXTURE:WRITE_FILE';
const MANY_TURNS_PROMPT = 'FIXTURE:MANY_TURNS';
const EXEC_PROMPT = 'FIXTURE:EXEC';
const CONTROL_TOKEN_PROMPT = 'FIXTURE:CONTROL_TOKEN';
const STRUCTURED_PROMPT = 'FIXTURE:STRUCTURED';
const RESUME_INITIAL_PROMPT = 'FIXTURE:RESUME_INITIAL';
const RESUME_PROBE_PROMPT = 'FIXTURE:RESUME_PROBE';
const MCP_PROMPT = 'FIXTURE:MCP';
const SKILL_PROMPT = 'FIXTURE:SKILL';

const RESUME_REMEMBERED_FRAGMENT = 'purple-elephant-42';
const SKILL_FRAGMENT = 'skill-marker-fragment-77';
const MCP_ALLOWED_TOOL = 'allowed-tool';
const MCP_DENIED_TOOL = 'denied-tool';
const MCP_SERVER: GrantedMcpServer = {
  id: 'conformance-mcp-server',
  transport: 'stdio',
  command: 'echo',
  grantedTools: [MCP_ALLOWED_TOOL],
};
const SKILL: ResolvedSkill = {
  id: 'conformance-skill',
  summary: 'A conformance test skill',
  body: `Skill body mentioning ${SKILL_FRAGMENT}`,
  appliesTo: [],
};
const STRUCTURED_SCHEMA: JSONSchema = { type: 'object', properties: { ok: { type: 'boolean' } } };
function isValidStructured(value: unknown): boolean {
  return typeof value === 'object' && value !== null && (value as { ok?: unknown }).ok === true;
}

async function createScratchDir(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), 'forge-conformance-'));
}

function emptySessionResult(sessionId: string, overrides: Partial<SessionResult> = {}): SessionResult {
  return {
    sessionId,
    ok: true,
    finalText: '',
    usage: { inputTokens: 10, outputTokens: 5, turns: 1 },
    durationMs: 1,
    changedFiles: [],
    controlTokens: [],
    ...overrides,
  };
}

/** Turns a `(sessionId) => AsyncGenerator<AdapterEvent, SessionResult>` behaviour into a spec-compliant
 * `SessionHandle` — shared by every stub adapter in this file. `events` and `result()` may be drained in
 * either order, but not *concurrently*: exactly one `pump()` may be in flight against the underlying
 * generator at a time. A gauntlet critic found the original version had no such guard and raced silently
 * — two concurrent drainers (e.g. `Promise.all([collectEvents(handle), handle.result()])`) could both
 * observe the generator's own final `{done:true}` step, but only the *first* to receive it captures the
 * real `SessionResult`; the second (a spent generator always returns `{done:true, value:undefined}` on
 * every call after the first) would silently clobber `finalResult` back to `undefined`, and `result()`
 * would then throw a confusing "produced no SessionResult" for a session that genuinely completed.
 * `AsyncIterable` was never a safe-for-concurrent-multi-consumption contract in general, and every real
 * check in this suite already drains sequentially — so rather than build (and separately have to trust)
 * a general concurrent-fan-out scheduler, concurrent use is detected and rejected outright: a clear,
 * immediate error instead of the previous silent corruption. */
function makeHandle(
  sessionId: string,
  createGenerator: () => AsyncGenerator<AdapterEvent, SessionResult>,
): SessionHandle {
  const generator = createGenerator();
  let finalResult: SessionResult | undefined;
  let generatorDone = false;
  let pumpInFlight = false;
  let draining: Promise<void> | undefined;

  async function pump(): Promise<IteratorResult<AdapterEvent, void>> {
    // Once the underlying generator has reported done, never call .next() on it again: a spent
    // generator always returns {done:true, value:undefined} on every subsequent call, and events and
    // result() can each independently try to drain it (events via a real consumer, result() via its
    // own drainFully()) — without this guard, whichever drains second overwrites the already-captured
    // finalResult with undefined.
    if (generatorDone) {
      return { done: true, value: undefined };
    }
    if (pumpInFlight) {
      throw new Error(
        `stub adapter: session ${sessionId} — events and result() were drained concurrently; ` +
          'fully drain one before starting the other (see makeHandle\'s own doc comment).',
      );
    }
    pumpInFlight = true;
    try {
      const step = await generator.next();
      if (step.done) {
        generatorDone = true;
        finalResult = step.value;
        return { done: true, value: undefined };
      }
      return { done: false, value: step.value };
    } finally {
      pumpInFlight = false;
    }
  }

  async function drainFully(): Promise<void> {
    let step = await pump();
    while (!step.done) {
      step = await pump();
    }
  }

  return {
    sessionId,
    events: {
      [Symbol.asyncIterator]() {
        return { next: () => pump() };
      },
    },
    async stop(): Promise<void> {
      // No real process to tear down for an in-memory stub.
    },
    async result(): Promise<SessionResult> {
      draining ??= drainFully();
      try {
        await draining;
      } catch (error) {
        // A gauntlet verify pass found that if this call itself lost a concurrent-drain race (the
        // pumpInFlight guard above), `draining` stayed memoized to the rejected promise forever — every
        // later, purely-sequential call to result() on the same handle would keep rejecting with the
        // identical stale error, even after the generator went on to fully drain via the other side and
        // a correct finalResult was already sitting captured. Resetting draining here lets a later call
        // retry cleanly: pump() itself now sees generatorDone and returns the real result immediately.
        draining = undefined;
        throw error;
      }
      if (finalResult === undefined) {
        throw new Error(`stub adapter: session ${sessionId} produced no SessionResult.`);
      }
      return finalResult;
    },
  };
}

interface StubSessionMemory {
  rememberedFragment: string;
}

interface StubProvisioning {
  skillIds: readonly string[];
  mcpServerIds: readonly string[];
}

interface StubAdapterOpts {
  writeBroken?: boolean;
  abortBroken?: boolean;
  mcpBroken?: boolean;
  execBroken?: boolean;
  changedFilesBroken?: boolean;
}

/** A minimal but fully spec-compliant `PlatformAdapter`, scripted entirely by matching
 * `SessionRequest.prompt` against the fixed fixture prompts above. `writeBroken`/`abortBroken`/
 * `mcpBroken`/`execBroken`/`changedFilesBroken` each introduce exactly one deliberate violation, for the
 * fails-closed checks below. */
class StubAdapter implements PlatformAdapter {
  readonly id = 'conformance-stub';
  readonly displayName = 'Conformance Stub Adapter';

  private sessionCounter = 0;
  private readonly sessionsById = new Map<string, StubSessionMemory>();
  private readonly provisioningByStepId = new Map<string, StubProvisioning>();
  private readonly opts: StubAdapterOpts;

  constructor(opts: StubAdapterOpts = {}) {
    this.opts = opts;
  }

  capabilities(): Promise<AdapterCapabilities> {
    return Promise.resolve({
      streaming: true,
      partialText: false,
      sessionResume: true,
      interject: false,
      structuredOutput: true,
      toolAllowlist: true,
      permissionModes: ['auto'],
      subagents: false,
      mcp: true,
      costReporting: 'per-session',
      tokenReporting: true,
      maxConcurrentSessions: 0,
      cwdIsolation: true,
      systemPromptControl: 'append',
      fileEditing: true,
      bash: true,
      network: 'none',
      bareMode: true,
      skills: 'inline',
      toolProxy: false,
    });
  }

  preflight(): Promise<{ ok: boolean; issues: readonly [] }> {
    return Promise.resolve({ ok: true, issues: [] });
  }

  listModels(): Promise<readonly { id: string; displayName: string }[]> {
    return Promise.resolve([{ id: 'conformance-model', displayName: 'Conformance Model' }]);
  }

  provisionSkills(skills: readonly ResolvedSkill[], ctx: SessionContext): Promise<SkillProvisioning> {
    const existing = this.provisioningByStepId.get(ctx.stepId);
    this.provisioningByStepId.set(ctx.stepId, {
      skillIds: skills.map((skill) => skill.id),
      mcpServerIds: existing?.mcpServerIds ?? [],
    });
    // Matches this stub's own declared capabilities().skills ('inline') per 15 §15.6's own mapping —
    // C15 now cross-checks provisioning.strategy against the declared capability (a gauntlet critic
    // found the original version never asserted this half of the row at all).
    return Promise.resolve({ strategy: 'inline', provisionedSkillIds: skills.map((skill) => skill.id) });
  }

  provisionMcp(servers: readonly GrantedMcpServer[], ctx: SessionContext): Promise<McpProvisioning> {
    const existing = this.provisioningByStepId.get(ctx.stepId);
    this.provisioningByStepId.set(ctx.stepId, {
      skillIds: existing?.skillIds ?? [],
      mcpServerIds: servers.map((server) => server.id),
    });
    return Promise.resolve({ loadedServerIds: servers.map((server) => server.id) });
  }

  startSession(request: SessionRequest): Promise<SessionHandle> {
    this.sessionCounter += 1;
    const sessionId = `session-${String(this.sessionCounter)}`;
    // Computed eagerly, here, where `this` is naturally in scope — `behaviorFor` only builds the
    // generator object (nothing in its body actually runs yet), so capturing it in a plain local and
    // referencing that from `wrapped` below needs no `this`/`self` alias inside a nested function.
    const behaviorGenerator = this.behaviorFor(request, sessionId);
    async function* wrapped(): AsyncGenerator<AdapterEvent, SessionResult> {
      await Promise.resolve();
      yield { type: 'session.started', sessionId, model: request.model, tools: [], meta: {} };
      return yield* behaviorGenerator;
    }
    return Promise.resolve(makeHandle(sessionId, wrapped));
  }

  resumeSession(sessionId: string, request: ResumeRequest): Promise<SessionHandle> {
    const remembered = this.sessionsById.get(sessionId)?.rememberedFragment ?? '(nothing remembered)';
    async function* wrapped(): AsyncGenerator<AdapterEvent, SessionResult> {
      await Promise.resolve();
      const text = request.prompt === RESUME_PROBE_PROMPT ? `I remember: ${remembered}` : 'resumed';
      yield { type: 'text', text, partial: false };
      yield { type: 'session.ended', reason: 'complete' };
      return emptySessionResult(sessionId, { finalText: text });
    }
    return Promise.resolve(makeHandle(sessionId, wrapped));
  }

  private behaviorFor(request: SessionRequest, sessionId: string): AsyncGenerator<AdapterEvent, SessionResult> {
    // An invalid model fails the session regardless of what prompt was requested — checked before the
    // prompt dispatch below, not folded into its default case, so C11 is exercised no matter which
    // prompt fixture a caller happens to combine it with.
    if (request.model === 'conformance-invalid-model') {
      return this.invalidModelBehavior(sessionId);
    }
    switch (request.prompt) {
      case HELLO_PROMPT:
        return this.helloBehavior(sessionId);
      case WRITE_FILE_PROMPT:
        return this.writeFileBehavior(request, sessionId);
      case MANY_TURNS_PROMPT:
        return this.manyTurnsBehavior(request, sessionId);
      case EXEC_PROMPT:
        return this.execBehavior(request, sessionId);
      case CONTROL_TOKEN_PROMPT:
        return this.controlTokenBehavior(sessionId);
      case STRUCTURED_PROMPT:
        return this.structuredBehavior(sessionId);
      case RESUME_INITIAL_PROMPT:
        return this.resumeInitialBehavior(sessionId);
      case MCP_PROMPT:
        return this.mcpBehavior(request, sessionId);
      case SKILL_PROMPT:
        return this.skillBehavior(request, sessionId);
      default:
        return this.defaultBehavior(sessionId);
    }
  }

  private async *helloBehavior(sessionId: string): AsyncGenerator<AdapterEvent, SessionResult> {
    await Promise.resolve();
    yield { type: 'text', text: 'Hello!', partial: false };
    yield { type: 'usage', inputTokens: 10, outputTokens: 5 };
    yield { type: 'session.ended', reason: 'complete' };
    return emptySessionResult(sessionId, { finalText: 'Hello!' });
  }

  private async *writeFileBehavior(
    request: SessionRequest,
    sessionId: string,
  ): AsyncGenerator<AdapterEvent, SessionResult> {
    if (!request.tools.write) {
      yield { type: 'tool.call', id: 'call-1', name: 'write_file' };
      yield { type: 'tool.result', id: 'call-1', ok: false, summary: 'write is not granted' };
      yield { type: 'text', text: 'I cannot write files in this session.', partial: false };
      yield { type: 'session.ended', reason: 'complete' };
      return emptySessionResult(sessionId, { finalText: 'I cannot write files in this session.' });
    }
    const targetDir = this.opts.writeBroken ? await createScratchDir() : request.cwd;
    await writeFile(path.join(targetDir, CONFORMANCE_WRITE_FILE_RELATIVE_PATH), CONFORMANCE_WRITE_FILE_CONTENT, 'utf8');
    yield { type: 'tool.call', id: 'call-1', name: 'write_file' };
    yield { type: 'tool.result', id: 'call-1', ok: true, summary: 'wrote file' };
    yield { type: 'session.ended', reason: 'complete' };
    return emptySessionResult(sessionId, {
      finalText: 'Wrote the file.',
      // changedFilesBroken: writes the real file to the real cwd (unlike writeBroken, which redirects
      // the write itself) but misreports changedFiles as empty regardless — a realistic bug shape
      // (correct write, buggy bookkeeping) distinct from writeBroken's, and the one C14 itself exists to
      // catch: git status on cwd would show the real file, changedFiles would not.
      changedFiles: this.opts.writeBroken || this.opts.changedFilesBroken ? [] : [CONFORMANCE_WRITE_FILE_RELATIVE_PATH],
    });
  }

  private async *manyTurnsBehavior(
    request: SessionRequest,
    sessionId: string,
  ): AsyncGenerator<AdapterEvent, SessionResult> {
    if (this.opts.abortBroken) {
      // Deliberately ignores abortSignal entirely and never yields a terminal event — proves C5
      // catches an adapter that hangs instead of settling within the 5s budget.
      await new Promise<never>(() => {
        // never resolves
      });
    }
    // No separate pre-loop abort check: the loop below re-reads request.abortSignal.aborted on every
    // iteration, including the first, so a signal already aborted before this generator ever started
    // running is caught there just the same.
    const maxTurns = request.limits.maxTurns;
    const totalSimulatedTurns = 5;
    let text = '';
    let turnsRun = 0;
    for (let turn = 1; turn <= totalSimulatedTurns; turn += 1) {
      if (request.abortSignal.aborted) {
        yield { type: 'session.ended', reason: 'aborted' };
        return emptySessionResult(sessionId, { ok: false, finalText: text });
      }
      if (maxTurns !== undefined && turn > maxTurns) {
        yield { type: 'session.ended', reason: 'limit' };
        return emptySessionResult(sessionId, { finalText: text, usage: { inputTokens: 10, outputTokens: 5, turns: turnsRun } });
      }
      const chunk = `Turn ${String(turn)}. `;
      text += chunk;
      yield { type: 'text', text: chunk, partial: false };
      turnsRun += 1;
    }
    yield { type: 'session.ended', reason: 'complete' };
    return emptySessionResult(sessionId, { finalText: text, usage: { inputTokens: 10, outputTokens: 5, turns: turnsRun } });
  }

  private async *execBehavior(request: SessionRequest, sessionId: string): AsyncGenerator<AdapterEvent, SessionResult> {
    await Promise.resolve();
    // Both sides genuinely routed through the real isExecAllowed grant-checker, not hardcoded — a
    // gauntlet critic named the earlier hardcoded-echo-success version as a (low-materiality) way this
    // stub's own "compliant" proof could be seen as not fully exercising real allow-logic.
    const echoAllowed = isExecAllowed(request.tools, 'echo hi');
    yield { type: 'tool.call', id: 'call-echo', name: 'exec' };
    yield { type: 'tool.result', id: 'call-echo', ok: echoAllowed, summary: 'echo hi' };

    const rmAllowed = this.opts.execBroken === true || isExecAllowed(request.tools, 'rm -rf conformance-canary.txt');
    if (rmAllowed) {
      // The broken variant ignores the grant outright (isExecAllowed would correctly say no — 'rm
      // -rf...' never matches 'echo *' — this branch only reaches the real deletion when execBroken
      // forces it, or for a genuinely-granted future fixture that isn't this one).
      await unlink(path.join(request.cwd, CONFORMANCE_EXEC_CANARY_RELATIVE_PATH)).catch(() => {
        // Already absent, or some other reason it can't be removed — nothing more for the stub to do.
      });
      yield { type: 'tool.call', id: 'call-rm', name: 'exec' };
      yield { type: 'tool.result', id: 'call-rm', ok: true, summary: 'rm -rf conformance-canary.txt' };
    }
    yield { type: 'session.ended', reason: 'complete' };
    return emptySessionResult(sessionId, { finalText: 'ran commands' });
  }

  private async *controlTokenBehavior(sessionId: string): AsyncGenerator<AdapterEvent, SessionResult> {
    await Promise.resolve();
    const raw = 'FORGE_ASK: which database? | Postgres, SQLite';
    const parsed = parseControlTokens(raw);
    const askToken = parsed.tokens.find(
      (token): token is Extract<ParsedControlToken, { readonly token: 'FORGE_ASK' }> => token.token === 'FORGE_ASK',
    );
    if (askToken !== undefined) {
      yield { type: 'control', token: 'FORGE_ASK', payload: { question: askToken.question, options: askToken.options } };
    }
    yield { type: 'text', text: raw, partial: false };
    yield { type: 'session.ended', reason: 'complete' };
    return emptySessionResult(sessionId, {
      finalText: raw,
      controlTokens: askToken !== undefined ? [askToken] : [],
    });
  }

  private async *structuredBehavior(sessionId: string): AsyncGenerator<AdapterEvent, SessionResult> {
    await Promise.resolve();
    yield { type: 'text', text: 'done', partial: false };
    yield { type: 'session.ended', reason: 'complete' };
    return emptySessionResult(sessionId, { finalText: 'done', structured: { ok: true } });
  }

  private async *resumeInitialBehavior(sessionId: string): AsyncGenerator<AdapterEvent, SessionResult> {
    await Promise.resolve();
    this.sessionsById.set(sessionId, { rememberedFragment: RESUME_REMEMBERED_FRAGMENT });
    yield { type: 'text', text: 'remembering a fact', partial: false };
    yield { type: 'session.ended', reason: 'complete' };
    return emptySessionResult(sessionId, { finalText: 'remembering a fact' });
  }

  private async *mcpBehavior(request: SessionRequest, sessionId: string): AsyncGenerator<AdapterEvent, SessionResult> {
    await Promise.resolve();
    const provisioning = this.provisioningByStepId.get(request.stepId);
    const grantedIds = this.opts.mcpBroken ? [MCP_ALLOWED_TOOL, MCP_DENIED_TOOL] : (provisioning?.mcpServerIds.length ?? 0) > 0 ? [MCP_ALLOWED_TOOL] : [];
    yield { type: 'tool.call', id: 'call-allowed', name: MCP_ALLOWED_TOOL };
    yield { type: 'tool.result', id: 'call-allowed', ok: grantedIds.includes(MCP_ALLOWED_TOOL), summary: 'allowed tool' };
    if (this.opts.mcpBroken) {
      yield { type: 'tool.call', id: 'call-denied', name: MCP_DENIED_TOOL };
      yield { type: 'tool.result', id: 'call-denied', ok: true, summary: 'denied tool (should not succeed)' };
    }
    yield { type: 'session.ended', reason: 'complete' };
    return emptySessionResult(sessionId, { finalText: 'mcp done' });
  }

  private async *skillBehavior(request: SessionRequest, sessionId: string): AsyncGenerator<AdapterEvent, SessionResult> {
    await Promise.resolve();
    const provisioning = this.provisioningByStepId.get(request.stepId);
    const text = provisioning !== undefined && provisioning.skillIds.length > 0 ? `Using skill: ${SKILL_FRAGMENT}` : 'no skill visible';
    yield { type: 'text', text, partial: false };
    yield { type: 'session.ended', reason: 'complete' };
    return emptySessionResult(sessionId, { finalText: text });
  }

  private async *invalidModelBehavior(sessionId: string): AsyncGenerator<AdapterEvent, SessionResult> {
    await Promise.resolve();
    yield { type: 'error', code: 'INVALID_MODEL', message: 'unknown model id', retryable: false };
    yield { type: 'session.ended', reason: 'error' };
    return emptySessionResult(sessionId, {
      ok: false,
      error: { code: 'INVALID_MODEL', message: 'unknown model id' },
    });
  }

  private async *defaultBehavior(sessionId: string): AsyncGenerator<AdapterEvent, SessionResult> {
    // Secret-probe prompt and any other unmatched prompt: an ordinary, uneventful completion. The
    // stub never reads process.env or anything outside `request.env`, so it cannot leak a secret it
    // was never given regardless of what the prompt asks.
    await Promise.resolve();
    yield { type: 'text', text: 'ok', partial: false };
    yield { type: 'session.ended', reason: 'complete' };
    return emptySessionResult(sessionId, { finalText: 'ok' });
  }
}

function buildOptions(overrides: Partial<ConformanceOptions> = {}): ConformanceOptions {
  return {
    createScratchDir,
    validModel: 'conformance-model',
    invalidModel: 'conformance-invalid-model',
    helloPrompt: HELLO_PROMPT,
    writeFilePrompt: WRITE_FILE_PROMPT,
    manyTurnsPrompt: MANY_TURNS_PROMPT,
    execPrompt: EXEC_PROMPT,
    secretProbe: { value: 'forge-conformance-secret-do-not-print-this', prompt: 'FIXTURE:SECRET_PROBE' },
    controlTokenPrompt: CONTROL_TOKEN_PROMPT,
    structured: { schema: STRUCTURED_SCHEMA, prompt: STRUCTURED_PROMPT, isValid: isValidStructured },
    resume: {
      initialPrompt: RESUME_INITIAL_PROMPT,
      probePrompt: RESUME_PROBE_PROMPT,
      expectedFragment: RESUME_REMEMBERED_FRAGMENT,
    },
    mcp: { server: MCP_SERVER, allowedToolName: MCP_ALLOWED_TOOL, deniedToolName: MCP_DENIED_TOOL, prompt: MCP_PROMPT },
    skill: { skill: SKILL, prompt: SKILL_PROMPT, expectedFragment: SKILL_FRAGMENT },
    ...overrides,
  };
}

// --- the suite is satisfiable: a fully-compliant stub passes all 16, none of the safety-critical ---
runAdapterConformanceSuite(() => new StubAdapter(), buildOptions());

describe('runAdapterConformanceSuite meta', () => {
  it('SAFETY_CRITICAL_CONFORMANCE_IDS matches 07 §7.6\'s own closing line exactly', () => {
    expect(SAFETY_CRITICAL_CONFORMANCE_IDS).toEqual(['C2', 'C5', 'C13', 'C14', 'C16']);
  });

  // --- makeHandle: a gauntlet critic found concurrent draining of events/result() (e.g. via
  // Promise.all) silently corrupted the captured SessionResult; concurrent use is now detected and
  // rejected with a clear error instead. Every real check in this suite already drains sequentially
  // and is unaffected — this proves the *new* failure mode is loud, not that anything here needs it. ---

  it('makeHandle rejects concurrent draining of events and result() with a clear error, not silent corruption', async () => {
    const adapter = new StubAdapter();
    const cwd = await createScratchDir();
    const handle = await adapter.startSession({
      runId: 'r',
      stepId: 's',
      cwd,
      systemPrompt: { mode: 'append', text: '' },
      prompt: MANY_TURNS_PROMPT,
      model: 'conformance-model',
      tools: { read: true, write: true, exec: false, network: 'none' },
      permissionMode: 'auto',
      limits: {},
      env: {},
      abortSignal: new AbortController().signal,
    });
    const [eventsOutcome, resultOutcome] = await Promise.allSettled([collectEvents(handle), handle.result()]);
    const outcomes = [eventsOutcome, resultOutcome];
    expect(outcomes.some((outcome) => outcome.status === 'rejected')).toBe(true);
    for (const outcome of outcomes) {
      if (outcome.status === 'rejected') {
        expect(String(outcome.reason)).toMatch(/drained concurrently/);
      }
    }

    // A gauntlet verify pass found that if this call to result() was the one that lost the race above,
    // a later, purely-sequential retry would keep rejecting with the identical stale error forever, even
    // though the generator went on to fully drain via events and a correct SessionResult was already
    // captured. A later call must now recover cleanly instead of staying permanently wedged.
    if (resultOutcome.status === 'rejected') {
      await expect(handle.result()).resolves.toBeDefined();
    }
  });

  // --- fails closed: each of these directly invokes one check (bypassing vitest's own dynamic
  // registration, which has no way to report a nested test's pass/fail back to an outer test) against
  // a stub that violates exactly the one thing that check exists to catch. ---

  it('a stub that writes outside the given cwd fails C2', async () => {
    const adapter = new StubAdapter({ writeBroken: true });
    const { context, setAdapter, setCapabilities } = createConformanceContext(buildOptions());
    setAdapter(adapter);
    setCapabilities(await adapter.capabilities());
    await expect(checkC2CwdIsolation(context)).rejects.toThrow();
  });

  it('a stub that ignores abortSignal and hangs fails C5', async () => {
    const adapter = new StubAdapter({ abortBroken: true });
    const { context, setAdapter, setCapabilities } = createConformanceContext(buildOptions());
    setAdapter(adapter);
    setCapabilities(await adapter.capabilities());
    await expect(checkC5Abort(context)).rejects.toThrow();
  }, 10000);

  it('a stub that exposes an ungranted MCP tool fails C16', async () => {
    const adapter = new StubAdapter({ mcpBroken: true });
    const { context, setAdapter, setCapabilities } = createConformanceContext(buildOptions());
    setAdapter(adapter);
    setCapabilities(await adapter.capabilities());
    await expect(checkC16McpGrantFidelity(context)).rejects.toThrow();
  });

  it('a stub that ignores the exec grant and deletes the canary anyway fails C4', async () => {
    const adapter = new StubAdapter({ execBroken: true });
    const { context, setAdapter, setCapabilities } = createConformanceContext(buildOptions());
    setAdapter(adapter);
    setCapabilities(await adapter.capabilities());
    await expect(checkC4ExecAllowlist(context)).rejects.toThrow();
  });

  it('a stub that writes correctly but misreports changedFiles fails C14', async () => {
    const adapter = new StubAdapter({ changedFilesBroken: true });
    const { context, setAdapter, setCapabilities } = createConformanceContext(buildOptions());
    setAdapter(adapter);
    setCapabilities(await adapter.capabilities());
    await expect(checkC14DeterminismOfReporting(context)).rejects.toThrow();
  });

  it('sanity: the compliant stub itself still passes the same checks the broken stubs fail', async () => {
    const adapter = new StubAdapter();
    const { context, setAdapter, setCapabilities } = createConformanceContext(buildOptions());
    setAdapter(adapter);
    setCapabilities(await adapter.capabilities());
    await expect(checkC2CwdIsolation(context)).resolves.toBeUndefined();
    await expect(checkC16McpGrantFidelity(context)).resolves.toBeUndefined();
  });

  it('the exec allowlist check itself passes against the compliant stub (not just individually mocked)', async () => {
    const adapter = new StubAdapter();
    const { context, setAdapter, setCapabilities } = createConformanceContext(buildOptions());
    setAdapter(adapter);
    setCapabilities(await adapter.capabilities());
    await expect(checkC4ExecAllowlist(context)).resolves.toBeUndefined();
  });
});
