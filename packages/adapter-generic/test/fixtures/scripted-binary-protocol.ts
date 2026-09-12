/**
 * The scripted-binary fixture's own wire protocol: the JSON scripted-response-table shape
 * `scripted-binary.ts` reads, the per-invocation context it matches against, and the pure matching
 * function itself (extracted so it is unit-testable without ever spawning a real process). Mirrors
 * `@forge/testkit`'s own `FakeSessionScript`/`.script()` API shape deliberately, for familiarity
 * (`PLAN-M11.md` P8's own mandate) — semantic response fields (`text`, `writeFiles`, ...), not a raw
 * event array, so a table author does not have to hand-write the exact NDJSON wire format by hand.
 *
 * The underlying mechanism is nothing like `FakePlatformAdapter`, though: that fake matches an
 * in-process `SessionRequest` object directly; this fixture is a genuine, separate OS process
 * (`node --experimental-strip-types scripted-binary.ts`, the same real-child-process pattern
 * `packages/engine/test/e2e/fixtures/run-engine-child.ts` and `packages/adapter-claude-code/test/
 * conformance/fixtures/mcp-server.ts` already establish) that only ever sees what a real external CLI
 * tool would see: argv, an optional prompt file or stdin, and a cwd — so matching here is necessarily
 * against those, not against a typed `SessionRequest`.
 *
 * @see specs/07 §7.5
 * @see specs/07 §7.6
 * @see PLAN-M11.md P8
 */

/** One scripted file write, relative to the invocation's own `--cwd`. */
export interface ScriptedFileWrite {
  readonly relativePath: string;
  readonly content: string;
}

/** One scripted tool-call announcement — reported verbatim as a `tool_call` source event; this
 * fixture never itself decides whether a tool call is "allowed" (that grant-enforcement judgment
 * belongs to whatever real `PlatformAdapter` translates these events, per `07` §7.2 — a later piece's
 * job, not this fixture's). */
export interface ScriptedToolCall {
  readonly tool: string;
  readonly args?: Record<string, unknown>;
}

export interface ScriptedErrorInfo {
  readonly code: string;
  readonly message: string;
}

/** What one invocation of the scripted binary does, once its own matcher has selected it. Every
 * field is optional and independent, so a single response can combine e.g. `text` and `writeFiles`
 * and `usage` the way a real external CLI tool's own single invocation naturally would. */
export interface ScriptedBinaryResponse {
  /** One `message`-shaped NDJSON line per entry (`07` §7.5's own worked-example source vocabulary:
   * `{ type: "message", role: "assistant", content }`). */
  readonly text?: readonly string[];
  /** One `tool_call`-shaped NDJSON line per entry (`{ type: "tool_call", tool, args }`). */
  readonly toolCalls?: readonly ScriptedToolCall[];
  /** Actually written to disk under the invocation's own `--cwd`, and reported as a `tool_call`
   * announcing the write — real side effects, not merely claimed ones, matching this repo's own
   * `FakeSessionScript.writeFiles` precedent of never trusting a script's own say-so for a change
   * that must be independently observable (`07` §7.6 C2/C14). */
  readonly writeFiles?: readonly ScriptedFileWrite[];
  /** Written to disk under `--cwd` and never otherwise reported — the `07` §7.5 worked example's own
   * `result.finalTextFrom: file:{{outFile}}` channel, a plain file read rather than an event. */
  readonly outFile?: ScriptedFileWrite;
  /** Emitted as a `usage`-shaped NDJSON line (`07` §7.6 C7) — not part of `07` §7.5's own worked
   * example (whose sample `adapter.yaml` declares `costReporting: none`), a disclosed, deliberate
   * extension for the adapters that do declare per-turn/per-session cost reporting. */
  readonly usage?: { readonly inputTokens: number; readonly outputTokens: number };
  /** Emitted as a `result`-shaped NDJSON line (`{ type: "result", structured }`) — `07` §7.6 C8's own
   * fixture need; also a disclosed extension beyond the literal worked example, for the same reason
   * `usage` is. */
  readonly structured?: unknown;
  /** Present only on a scripted error ending: emits an `error`-shaped NDJSON line and skips `done`.
   * Pairs naturally with `exitCode` (typically non-zero), but the two are independent — a caller can
   * script a non-zero exit with no typed error line, or vice versa. */
  readonly errorInfo?: ScriptedErrorInfo;
  /** Defaults to 0. A non-zero exit with no `errorInfo` still skips the `done` line — an external
   * tool that merely dies is not the same as one that emits a proper error surface, and `07` §7.6
   * C11 needs to be able to tell the two apart. */
  readonly exitCode?: number;
  /** Simulates the binary genuinely hanging (`07` §7.6 C5's own fixture need): every other field is
   * still honoured first (so a hang can be scripted after some real output), then this process
   * ignores `SIGTERM`/`SIGINT` and never exits on its own — only a `SIGKILL` from the caller ends it,
   * the realistic "no orphan child processes" proof a cooperative-exit fixture could not provide. */
  readonly hang?: boolean;
  /** Emits one deliberately-invalid NDJSON line (fails `JSON.parse`) before any other output — `07`
   * §7.6's own malformed-output failure-injection need, proving a later `events.format: ndjson`
   * parser's own robustness against a single bad line. */
  readonly malformedLine?: boolean;
  /** Ends the process without ever emitting a `done` line, but exits 0 (unless `exitCode` overrides
   * it) — an external tool that stops output abruptly without a clean sign-off, distinct from both
   * the normal-completion and the scripted-error paths. */
  readonly omitDone?: boolean;
  /** Waits this many milliseconds, after every other field has been honoured, before exiting — a
   * scripted-slow-binary fixture need (distinct from `hang`, which never exits at all). */
  readonly delayMsBeforeExit?: number;
}

/** What one real invocation of the fixture is matched against — built by `scripted-binary.ts` from
 * real argv/an actual prompt-file or stdin read, never from anything the table author supplies
 * directly. */
export interface ScriptedInvocationContext {
  /** The full real `process.argv.slice(2)` this invocation was started with. */
  readonly argv: readonly string[];
  /** The real prompt text this invocation resolved, from `--prompt-file` or from stdin — `''` if
   * neither carried one. */
  readonly prompt: string;
  /** From `--model`, if present. */
  readonly model: string | undefined;
  /** From `--cwd`, if present. */
  readonly cwd: string | undefined;
}

export interface ScriptedInvocationMatcher {
  /** Matches if `prompt` contains this literal substring. */
  readonly promptContains?: string;
  /** Matches only if `model` is exactly this value. */
  readonly modelEquals?: string;
  /** Matches if some element of `argv` is exactly this literal (e.g. `'--read-only'`). */
  readonly argvContains?: string;
  /** Matches only if `cwd` is exactly this value — lets a table distinguish concurrent invocations by
   * their own cwd (`07` §7.6 C12's own "N concurrent sessions in distinct cwds" fixture need), the one
   * real-world reason to match on it: a conformance table for C12 must script each of the N concurrent
   * invocations differently, and cwd is the only field that actually differs between them. Compared as
   * a raw string, with no `path.resolve`/trailing-slash normalisation — a table author must pass the
   * identical literal a real `--cwd` invocation will carry (the whole-directory paths a conformance
   * harness constructs, e.g. via `mkdtemp`, are already canonical absolute paths with no such
   * formatting variance in practice; a disclosed, deliberate simplification, not an oversight). */
  readonly cwdEquals?: string;
}

export interface ScriptedBinaryEntry {
  readonly match: ScriptedInvocationMatcher;
  readonly response: ScriptedBinaryResponse;
}

/** The full scripted-response table `scripted-binary.ts` reads from a JSON file named by its own
 * `--forge-fixture-table` argv flag (a fixture-only control-plane flag, deliberately not shaped like
 * any real `07` §7.5 `invoke.args` entry, so it can never collide with a real adapter.yaml's own
 * templated arguments). */
export interface ScriptedBinaryTable {
  /** Checked in order; the first entry whose `match` is satisfied wins (`07` §7.5's own generic
   * "first matching rule" convention, and `FakeSessionScript`'s own "first-registered,
   * first-matched" precedent). */
  readonly entries: readonly ScriptedBinaryEntry[];
  /** Used when no entry matches. Falls back to `DEFAULT_RESPONSE` (a single, clearly-labelled
   * response) if this is absent too. */
  readonly defaultResponse?: ScriptedBinaryResponse;
  /** Reported by `--version` (formatted as `v{version}`), regardless of any other flag or table
   * entry. Defaults to `DEFAULT_VERSION`. */
  readonly version?: string;
}

export const DEFAULT_VERSION = '1.4.0';

export const DEFAULT_RESPONSE: ScriptedBinaryResponse = {
  text: ['(no scripted entry matched this invocation; default response)'],
};

function matcherMatches(matcher: ScriptedInvocationMatcher, ctx: ScriptedInvocationContext): boolean {
  if (matcher.promptContains !== undefined && !ctx.prompt.includes(matcher.promptContains)) {
    return false;
  }
  if (matcher.modelEquals !== undefined && ctx.model !== matcher.modelEquals) {
    return false;
  }
  if (matcher.argvContains !== undefined && !ctx.argv.includes(matcher.argvContains)) {
    return false;
  }
  if (matcher.cwdEquals !== undefined && ctx.cwd !== matcher.cwdEquals) {
    return false;
  }
  return true;
}

/** Pure, unit-tested independently of the real process: the first `entries` member whose `match`
 * every specified field agrees with `ctx`, else `table.defaultResponse`, else the built-in
 * `DEFAULT_RESPONSE`. An empty `match` object (`{}`) matches every invocation — the deliberate way to
 * write a catch-all entry ahead of `defaultResponse` when the table wants that ordering. */
export function matchScriptedEntry(
  table: ScriptedBinaryTable,
  ctx: ScriptedInvocationContext,
): ScriptedBinaryResponse {
  for (const entry of table.entries) {
    if (matcherMatches(entry.match, ctx)) return entry.response;
  }
  return table.defaultResponse ?? DEFAULT_RESPONSE;
}
