/**
 * `SessionRequest`/`SessionHandle`/`SessionResult`/`ResumeRequest` — `07` §7.2's own session
 * lifecycle shapes, verbatim where given. `ResumeRequest` is not elaborated anywhere in the spec pack
 * (`SPEC-QUESTIONS.md` Q58 point 4): a resume is a new instruction to continue with, not a full new
 * session, so it reuses `SessionRequest`'s own `SessionLimits` shape rather than inventing a second one.
 *
 * @see specs/07 §7.2
 * @see SPEC-QUESTIONS.md Q58
 * @see PLAN-M4.md P1
 */
import type { AdapterEvent } from './events.ts';
import type { ParsedControlToken } from './control-tokens.ts';
import type { JSONSchema } from './json-schema.ts';
import type { ToolGrant } from './tool-grant.ts';

export interface SessionLimits {
  readonly maxTurns?: number;
  readonly wallClockMs?: number;
  readonly maxCostUsd?: number;
}

export interface SessionAttachment {
  readonly path: string;
  readonly role: 'input' | 'reference';
}

/** `SessionRequest.vetExecCommand`'s own result (`specs/22` M17 P7, critic round 4) — `allowed: false`
 * carries a human-readable `reason` the adapter may surface back to the model (e.g. as a Claude Code
 * `PermissionResult.deny.message`) so a refused attempt is a stated refusal, not a silent hang or an
 * opaque failure. */
export type ExecCommandVerdict =
  { readonly allowed: true } | { readonly allowed: false; readonly reason: string };

export interface SessionRequest {
  readonly runId: string;
  readonly stepId: string;
  /** Lane worktree. */
  readonly cwd: string;
  readonly systemPrompt: { readonly mode: 'append' | 'replace'; readonly text: string };
  /** The step brief, already context-packed. */
  readonly prompt: string;
  /** Resolved from tier. */
  readonly model: string;
  readonly thinking?: 'none' | 'low' | 'medium' | 'high';
  /** FORGE-neutral grant; the adapter maps it. */
  readonly tools: ToolGrant;
  readonly permissionMode: 'manual' | 'accept-edits' | 'deny-unlisted' | 'auto';
  readonly limits: SessionLimits;
  /** Never includes secrets not explicitly granted. */
  readonly env: Readonly<Record<string, string>>;
  /** When structured output is required. */
  readonly outputSchema?: JSONSchema;
  readonly attachments?: readonly SessionAttachment[];
  readonly abortSignal: AbortSignal;
  /**
   * An optional, per-call gate on the session's own LIVE, in-turn exec tool use — called with the
   * real command string a live Bash-type tool call is about to run, BEFORE the adapter lets it
   * execute (`specs/22` M17 P7, critic round 4). `undefined` when the caller has no such gate (every
   * existing caller before this round): the adapter falls back to its own native tool-grant mapping
   * alone, exactly as before — this field is purely additive, never a replacement for `tools`.
   *
   * **Why this exists at all.** `tools` (`ToolGrant`) only ever reaches a real adapter's own coarse,
   * native allow-list mechanism (Claude Code: `allowedTools`, pattern-matched against the command
   * STRING alone) — confirmed directly (`tool-grant.ts`'s own pre-existing doc comment) to do nothing
   * about where a matched command's own real reach extends: `cwd` governs a subprocess's own
   * STARTING directory, never a sandbox boundary, so an allowed pattern like `make *` still lets
   * `make -f /tmp/evil.mk pwn` through to a real shell with no containment at all. This callback is
   * the one real, per-call seam (Claude Code's own SDK `canUseTool`, confirmed against the real,
   * installed `.d.ts`: "Called before each tool execution to determine if it should be allowed")
   * that receives the actual command text for every live attempt, not only the final one a session
   * might separately report in structured output — `adopt-agent.ts`'s own `vetProposedTestCommand`
   * already re-vets THAT one; this is its live-tool-use sibling.
   *
   * **Scope.** Project-neutral by design — a plain `(command) => Promise<ExecCommandVerdict>`, not a
   * `ToolGrant`/root pair, so this type never needs to know HOW a caller derived its verdict
   * (`vetProposedCommand`, or any other mechanism a future caller might use) and no adapter needs to
   * import anything beyond this one function shape.
   *
   * **Known gap, disclosed rather than assumed closed.** Only the SDK transport
   * (`@forge/adapter-claude-code`'s `buildSdkOptions`) can honour this at all — Claude Code's CLI
   * transport (`spawn.ts`) has no documented equivalent hook; a session running on that transport
   * (the SDK's own fallback, `config.ts`'s own doc comment) gets no live per-call gate regardless of
   * whether this field is set. Whether the SDK's own `canUseTool` is actually INVOKED for a command
   * that also matches an `allowedTools` rule — as opposed to that rule resolving the decision before
   * the callback is ever consulted — is NOT independently, empirically verified here (confirmed only
   * against the type's own doc comment, "called before each tool execution," not against a real,
   * live API call): a caller relying on this field for its ONLY exec defence, with no other layer
   * backing it, is relying on a claim this type's own author could not fully verify without a real,
   * costly API call.
   */
  readonly vetExecCommand?: (command: string) => Promise<ExecCommandVerdict>;
  /**
   * An optional, per-call gate on the session's own LIVE, in-turn `Read`/`Edit`/`Write` tool use —
   * called with the tool name and the real absolute `file_path` argument a live file-tool call is
   * about to touch, BEFORE the adapter lets it execute (`SPEC-QUESTIONS.md` Q347). `undefined` when
   * the caller has no such gate: the adapter falls back to its own native tool-grant mapping alone
   * (bare `Read`/`Edit`/`Write` entries), exactly as before this field existed -- purely additive,
   * never a replacement for `tools`.
   *
   * **Why this exists at all.** Claude Code's own real SDK prints
   * `CLAUDE_SDK_CAN_USE_TOOL_SHADOWED` in every real `--agent` log this product has produced: a bare
   * `Read`/`Edit`/`Write` entry in `allowedTools` (`tool-grant.ts`'s own `mapToolGrantToAllowedTools`
   * always emits exactly these three as bare strings, never a parenthesised, narrower rule the way
   * Bash patterns are) auto-approves the whole tool before `vetExecCommand`'s own sibling mechanism,
   * `canUseTool`, is ever consulted -- confirmed not merely theoretical by a real, live `--agent`
   * session transcript this milestone's own run already produced: a real `Write` tool call created
   * `/tmp/forge-probe/test_forge_probe.py`, an absolute path completely outside that session's own
   * lane worktree, on the real host filesystem, with zero confinement and zero denial. `cwd` governs
   * only a subprocess's own STARTING directory (`vetExecCommand`'s own doc comment already establishes
   * this for Bash); nothing analogous ever existed for a live file-tool call's own `file_path`
   * argument, which can be any absolute path the model writes, regardless of `cwd`.
   *
   * **The real fix, and why it is a *different* SDK mechanism than `vetExecCommand`'s.** Claude
   * Code's own SDK documents exactly two remedies for `CLAUDE_SDK_CAN_USE_TOOL_SHADOWED`: "use a
   * PreToolUse hook" or "remove the bare names from allowedTools so they fall through to
   * `canUseTool`." The second is not available here -- Claude Code's own real tool-permission
   * vocabulary (confirmed against the installed SDK's own `.d.ts`) has no narrower, path-scoped rule
   * syntax for `Read`/`Edit`/`Write` the way `Bash(pattern)`/`WebFetch(domain:host)` exist for their
   * own tools, so the bare entries cannot be replaced with an equivalently-permissive narrower rule.
   * The first remedy is a structurally earlier, separate mechanism from `canUseTool`
   * (`Options.hooks.PreToolUse`, confirmed directly against the installed `.d.ts`): a real, live,
   * API-key-backed experiment (not merely a reading of the type's own doc comment) confirmed it fires
   * regardless of whether the tool is bare-listed in `allowedTools` -- the exact thing
   * `canUseTool`'s own shadowing does NOT survive -- denying a genuinely out-of-lane `Write`/`Edit`/
   * `Read` with the model receiving a real, observable denial (a `tool_result` with `is_error: true`
   * and this callback's own `reason` text), while an in-lane call of the identical shape still
   * succeeds.
   *
   * **Scope.** Project-neutral by design, mirroring `vetExecCommand`'s own reasoning exactly: a plain
   * `(toolName, filePath) => Promise<ExecCommandVerdict>`, never a `ToolGrant`/root pair, so this type
   * never needs to know HOW a caller derived its verdict and no adapter needs to import anything
   * beyond this one function shape. `toolName` is always one of `'Read' | 'Edit' | 'Write'` -- the
   * complete real bare-shadowed set this milestone's own disclosure names (re-confirmed directly
   * against the installed SDK's own shadowing-warning source: it actually flags ANY bare
   * `allowedTools` entry, not only these three, but `mapToolGrantToAllowedTools` is the one place
   * that could ever emit a bare non-exec, non-network tool name today, and it only ever does so for
   * these three -- `WebFetch`/`WebSearch` only ever appear bare for `network: 'full'`, a separate,
   * undisclosed finding this field deliberately does not attempt to close, matching the owner's own
   * explicit "stay focused on Read/Edit/Write" scope for this piece).
   *
   * **Known gap, disclosed rather than assumed closed**, mirroring `vetExecCommand`'s own identical
   * disclosure: only the SDK transport (`@forge/adapter-claude-code`'s `buildSdkOptions`) can honour
   * this at all -- the CLI transport (`spawn.ts`) has no documented hooks equivalent either.
   */
  readonly vetFileAccess?: (
    toolName: 'Read' | 'Edit' | 'Write',
    filePath: string,
  ) => Promise<ExecCommandVerdict>;
}

export interface ResumeRequest {
  readonly prompt: string;
  readonly limits: SessionLimits;
  readonly abortSignal: AbortSignal;
}

export interface SessionUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly costUsd?: number;
  readonly turns: number;
  /** `07` §7.3's own "Honest cache-token accounting" (post-v1.0, M17 P11): summed from the adapter's
   * real per-model usage breakdown (every model call made through the query pipeline — the main loop,
   * Task subagents, sidechains and internal calls), never from the main-loop-only `inputTokens`/
   * `outputTokens` fields above alone — those exclude exactly the subagent/sidechain spend a real
   * multi-agent FORGE step routinely makes, so a ledger reading only them under-reports real cache
   * spend. Omitted, not zeroed, when the adapter reports no real per-model breakdown at all. */
  readonly cacheReadTokens?: number;
  /** Same source and the same reason as `cacheReadTokens` above. */
  readonly cacheCreationTokens?: number;
}

export interface SessionResult {
  readonly sessionId: string;
  readonly ok: boolean;
  readonly finalText: string;
  readonly structured?: unknown;
  readonly usage: SessionUsage;
  readonly durationMs: number;
  readonly changedFiles: readonly string[];
  readonly controlTokens: readonly ParsedControlToken[];
  readonly error?: { readonly code: string; readonly message: string };
}

export interface SessionHandle {
  readonly sessionId: string;
  readonly events: AsyncIterable<AdapterEvent>;
  interject?(text: string): Promise<void>;
  stop(reason: string): Promise<void>;
  /** Resolves after the stream ends. */
  result(): Promise<SessionResult>;
}
