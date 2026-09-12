/**
 * `FakeSessionScript` — a caller-supplied, per-`SessionRequest`-matching description of what a session
 * "does." Fields are semantic (`text`, `writeFiles`, `execAttempts`, ...), not a raw `AdapterEvent[]`,
 * so `FakePlatformAdapter` can *generically* enforce `ToolGrant`/`limits`/`abortSignal` against every
 * script the same way, rather than trusting each script author to hand-write a correctly-gated
 * `tool.result.ok` themselves.
 *
 * @see specs/07 §7.2
 * @see specs/20 §20.5
 * @see SPEC-QUESTIONS.md Q61 point 2
 * @see PLAN-M4.md P5
 */

export interface ScriptedFileWrite {
  /** Relative to the session's own `cwd`. */
  readonly relativePath: string;
  readonly content: string;
}

export interface FakeSessionScriptErrorInfo {
  readonly code: string;
  readonly message: string;
}

export interface FakeSessionScript {
  /** One `text` event per entry — also the turn count `SessionRequest.limits.maxTurns` caps: if the
   * script has more entries than the granted `maxTurns`, the adapter truncates at the limit and ends
   * `reason:'limit'` instead of running the rest of the script. */
  readonly text?: readonly string[];
  readonly thinking?: readonly string[];
  /** Only actually written (and only reported in `SessionResult.changedFiles`) when
   * `SessionRequest.tools.write` is granted — never trust-on-the-script's-own-word the way a raw
   * `AdapterEvent[]` script would let a caller accidentally do. */
  readonly writeFiles?: readonly ScriptedFileWrite[];
  /** Each entry is checked via `isExecAllowed` (`@forge/adapter-kit/grants`) against the session's own
   * `tools.exec` grant before being claimed as a successful `tool.result` — an unauthorised entry is
   * reported as a failed `tool.result`, matching `07` §7.2's own "adapters MUST fail closed." */
  readonly execAttempts?: readonly string[];
  /** Simulates untrusted content (an MCP tool result, a fetched page, ...) entering this session — run
   * through `stripControlTokens` (`@forge/adapter-kit/control-tokens`, P3) before being folded into the
   * session's own text output, so a live `FORGE_*` token embedded in it is neutralised rather than
   * executed as if the agent itself had emitted it (`20` §20.5 points 1–2; `PLAN-M4.md` M4's own #2
   * acceptance criterion). */
  readonly untrustedContent?: string;
  /** For `SessionResult.structured`, when `SessionRequest.outputSchema` was set. */
  readonly structured?: unknown;
  /** `SessionResult.usage.costUsd` — this fake's own doc comment used to disclose this as "never
   * populated... add the mechanism when one does, rather than speculatively now" (`SPEC-QUESTIONS.md`
   * Q61). `PLAN-M11.md` P11 (`20` §20.10 S9) is that consumer: a real, script-supplied dollar figure
   * lets a caller test budget/ledger enforcement (`@forge/engine/budget`'s own `canAdmit`, and the real
   * `UsageRecorded` emission `runAgentWork` now performs) against a deterministic, known cost, the same
   * way `text`/`writeFiles` already let a caller assert on deterministic, known content. Omitted (not
   * defaulted to `0`) when the script does not set it — `SessionUsage.costUsd` is itself optional
   * (`adapter-kit`'s own real platforms may not report cost at all), and a fake that silently invented a
   * `0` here would make "no cost reported" indistinguishable from "reported, free." */
  readonly costUsd?: number;
  /** The one thing nothing in `SessionRequest` itself says: that this session needs a granted MCP
   * server to do its job. Refused with a precise message naming the server when the adapter has no way
   * to provision one (`capabilities().mcp === false && capabilities().toolProxy === false`). */
  readonly requiresMcpServer?: string;
  /** Emitted as an additional text event only if `provisionSkills` was called for this request's own
   * `(runId, stepId)` *before* this session started — the generic mechanism `15` §15.6 scoping (C15)
   * needs, without making the script itself a function of runtime provisioning state. Scoped by both,
   * not `stepId` alone: a step id like `"implement"` is naturally reused across different runs, and a
   * skill provisioned for one run's step must never be visible to a different run's same-named step. */
  readonly skillVisibleText?: string;
  /** Each entry is checked against whatever was granted via the most recent `provisionMcp` call for
   * this request's own `(runId, stepId)` — a granted tool name is claimed as a successful `tool.result`,
   * an ungranted one as a failed one, the same generic gating `execAttempts` already gives `tools.exec`.
   * Scoped by both, not `stepId` alone, for the identical cross-run isolation reason `skillVisibleText`
   * is. */
  readonly mcpToolAttempts?: readonly string[];
  /** `'complete'`/`'error'` only — a script cannot claim a limit or an abort happened; those two are
   * always adapter-derived from `limits`/`abortSignal`, never script-specified (a badly-written script
   * could otherwise silently defeat that generic enforcement). Defaults to `'complete'`. */
  readonly endReason?: 'complete' | 'error';
  /** Required when `endReason` is `'error'`; ignored otherwise. */
  readonly errorInfo?: FakeSessionScriptErrorInfo;
}
