/**
 * `buildSdkOptions` — `07` §7.3's own mapping table, SDK column, confirmed against the real, published
 * `@anthropic-ai/claude-agent-sdk@0.3.266`'s own `.d.ts` field names (not assumed from the spec's prose
 * alone, the same discipline `build-args.ts` (P2) already applied to the CLI column).
 *
 * @see specs/07 §7.3
 * @see SPEC-QUESTIONS.md Q115
 * @see PLAN-M7.md P3
 */
import type {
  CanUseTool,
  HookCallback,
  HookCallbackMatcher,
  Options,
  PreToolUseHookSpecificOutput,
} from '@anthropic-ai/claude-agent-sdk';
import type { SessionRequest } from '@forge/adapter-kit';

import type { ClaudeCodeAdapterConfig } from '../config.ts';
import type { McpSessionExtras } from '../mcp.ts';
import { mapPermissionModeForSdk, mapToolGrantToAllowedTools } from '../tool-grant.ts';

/**
 * `req.vetExecCommand` (`specs/22` M17 P7, critic round 4), wired into the SDK's own real
 * `Options.canUseTool` — confirmed directly against the installed `.d.ts`: `CanUseTool = (toolName,
 * input, options) => Promise<PermissionResult | null>`, "Called before each tool execution to
 * determine if it should be allowed." `undefined` when `req` carries no gate (every caller before
 * this round): returns `undefined` so `buildSdkOptions` omits `canUseTool` entirely, leaving the
 * adapter's own prior, native `allowedTools`-only behaviour completely unchanged.
 *
 * Only `'Bash'` calls are ever routed through the gate — `req.vetExecCommand`'s own contract is a
 * plain command string, which only `BashInput.command` (confirmed against the real, installed
 * `sdk-tools.d.ts`: `tool: "Bash"`, `BashInput.command: string`) supplies; every other tool name
 * resolves `{behavior: 'allow'}` immediately, deferring entirely to whatever `allowedTools`/
 * `permissionMode` would otherwise have decided for it — this callback only ever NARROWS a Bash
 * decision, never widens one (it has no `'ask'`-shaped escape hatch of its own: a refusal is always a
 * real `{behavior: 'deny', message}`, never `null`, which the real SDK's own doc comment warns blocks
 * the tool "indefinitely" if returned by mistake).
 *
 * A `Bash` call whose own `input.command` is somehow not a string is DENIED, not allowed (`specs/22`
 * M17 P7, critic round 5) — fail closed on anything unexpected, matching `isExecAllowed`/
 * `vetProposedCommand`'s own convention everywhere else in this codebase, never a quiet pass-through
 * for a shape this function cannot actually vet. Near-unreachable in practice (the real SDK's own
 * `BashInput.command: string` already guarantees this for a genuine `Bash` call), which is exactly
 * why failing closed costs nothing real: there is no legitimate case this branch is meant to let
 * through.
 *
 * **Disclosed, not assumed closed** (this file's own doc comment on `SessionRequest.vetExecCommand`
 * has the fuller reasoning): whether the real SDK actually INVOKES this callback for a `Bash` call
 * that also matches an `allowedTools` rule — as opposed to that rule resolving the call before the
 * callback is ever consulted — rests on this type's own plain "called before each tool execution"
 * doc comment, not on a live, confirmed API call. No permission-mode or `allowedTools` change is made
 * here to force the issue either way: this is a strictly additive wiring of a documented SDK field,
 * nothing about the adapter's existing, already-shipped behaviour for every caller that leaves this
 * field unset.
 */
function buildCanUseTool(req: SessionRequest): CanUseTool | undefined {
  const vetExecCommand = req.vetExecCommand;
  if (vetExecCommand === undefined) return undefined;
  return async (toolName, input) => {
    if (toolName !== 'Bash') return { behavior: 'allow' };
    const command = input['command'];
    if (typeof command !== 'string') {
      return {
        behavior: 'deny',
        message: 'refused: this Bash call carries no real "command" string to vet at all.',
      };
    }
    const verdict = await vetExecCommand(command);
    return verdict.allowed ? { behavior: 'allow' } : { behavior: 'deny', message: verdict.reason };
  };
}

/** A `PreToolUseHookSpecificOutput` denial, plus the generic `decision`/`reason` pair every hook
 * event (not only `PreToolUse`) also understands -- both set to the identical text, matching the
 * real SDK's own documented precedent (`ExitPlanModeInput`'s own sibling `PreModelSwitch` output
 * carries the same `permissionDecision`/`permissionDecisionReason` pair) rather than relying on only
 * one of the two mechanisms the installed `.d.ts` exposes for "deny this tool call." */
function denyFileAccess(reason: string): { continue: false } & {
  decision: 'block';
  reason: string;
  hookSpecificOutput: PreToolUseHookSpecificOutput;
} {
  return {
    continue: false,
    decision: 'block',
    reason,
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reason,
    },
  };
}

/**
 * `req.vetFileAccess` (`SPEC-QUESTIONS.md` Q347), wired into the SDK's own real
 * `Options.hooks.PreToolUse` -- a DIFFERENT, structurally earlier mechanism than `buildCanUseTool`
 * above, and deliberately so: `mapToolGrantToAllowedTools` always emits bare `'Read'`/`'Edit'`/
 * `'Write'` strings (never a parenthesised, narrower rule the way Bash/WebFetch patterns are), and
 * the real, installed SDK's own documented behaviour is that a bare `allowedTools` entry
 * auto-approves the whole tool BEFORE `canUseTool` is ever consulted (`CLAUDE_SDK_CAN_USE_TOOL_SHADOWED`,
 * printed in every real `--agent` log this product has produced) -- so wiring this into
 * `canUseTool` the way `vetExecCommand` is wired above would silently never fire for exactly the
 * three tools it exists to confine. The SDK's own warning text names a `PreToolUse` hook as the
 * other real remedy, and a real, live, API-key-backed experiment (not merely a reading of the
 * installed `.d.ts`) confirmed it: an in-lane `Write`/`Edit`/`Read` still succeeds, and a
 * genuinely out-of-lane one is denied, with the model receiving a real, observable denial (a
 * `tool_result` with `is_error: true` carrying this callback's own `reason` text) -- not a silent
 * hang or crash.
 *
 * `undefined` when `req` carries no gate (every caller before this piece): returns `undefined` so
 * `buildSdkOptions` omits `hooks` entirely, leaving every existing session's own behaviour
 * unchanged -- the identical "strictly additive" discipline `buildCanUseTool` already established.
 *
 * Only `'Read'`/`'Edit'`/`'Write'` tool_use events are ever routed through the gate -- every other
 * `tool_name` (including `'Bash'`, already covered separately by `buildCanUseTool`) resolves
 * `{ continue: true }` immediately. A call whose own `tool_input.file_path` is somehow not a string
 * is DENIED, not allowed (fail closed, matching `buildCanUseTool`'s own identical convention for a
 * non-string Bash `input.command`) -- near-unreachable in practice given the real SDK's own
 * `FileReadInput`/`FileEditInput`/`FileWriteInput.file_path: string` contract (confirmed against the
 * installed `sdk-tools.d.ts`), which is exactly why failing closed costs nothing real here either.
 *
 * **Disclosed, not assumed closed.** `PreToolUseHookInput.tool_input` is typed `unknown` in the
 * installed `.d.ts` -- this function reads `file_path` off it with a plain runtime shape check, not
 * a schema-validated parse, matching `buildCanUseTool`'s own identical, already-accepted treatment
 * of `input['command']` immediately above.
 */
function buildFileAccessHook(req: SessionRequest): HookCallback | undefined {
  const vetFileAccess = req.vetFileAccess;
  if (vetFileAccess === undefined) return undefined;
  return async (input) => {
    if (input.hook_event_name !== 'PreToolUse') return { continue: true };
    const toolName = input.tool_name;
    if (toolName !== 'Read' && toolName !== 'Edit' && toolName !== 'Write') {
      return { continue: true };
    }
    const toolInput = input.tool_input;
    const filePath =
      toolInput !== null && typeof toolInput === 'object' && 'file_path' in toolInput
        ? (toolInput as Record<string, unknown>)['file_path']
        : undefined;
    if (typeof filePath !== 'string') {
      return denyFileAccess(
        `refused: this ${toolName} call carries no real "file_path" string to vet at all.`,
      );
    }
    const verdict = await vetFileAccess(toolName, filePath);
    return verdict.allowed ? { continue: true } : denyFileAccess(verdict.reason);
  };
}

export function buildSdkOptions(
  req: SessionRequest,
  config: ClaudeCodeAdapterConfig,
  resumeSessionId?: string,
  mcp?: McpSessionExtras,
): Options {
  const canUseTool = buildCanUseTool(req);
  const fileAccessHook = buildFileAccessHook(req);
  const options: Options = {
    cwd: req.cwd,
    model: req.model,
    // `07` §7.3's own mapping table: `session resume -> --resume <sessionId>` on the CLI column
    // (`build-args.ts`, P4); the SDK's own real, confirmed equivalent field is `Options.resume:
    // string` (confirmed directly against the real `.d.ts`, same discipline as every other field
    // here).
    ...(resumeSessionId === undefined ? {} : { resume: resumeSessionId }),
    // `Options.allowedTools` already wants a plain `string[]` -- no `.join(' ')` needed here, unlike
    // the CLI transport's own single `--allowedTools` flag value (`build-args.ts`, P2). The identical
    // shared function `mapToolGrantToAllowedTools` (P2) produces the right shape for both transports
    // as-is. `mcp?.allowedTools` (P7) is merged in here too, mirroring `build-args.ts`'s own identical
    // merge.
    allowedTools: [...mapToolGrantToAllowedTools(req.tools), ...(mcp?.allowedTools ?? [])],
    permissionMode: mapPermissionModeForSdk(req.permissionMode),
    includePartialMessages: true,
    // `buildCanUseTool` (above) returns `undefined` when `req.vetExecCommand` is unset, so this
    // spread adds nothing at all for every caller before critic round 4 -- strictly additive.
    ...(canUseTool === undefined ? {} : { canUseTool }),
    // `buildFileAccessHook` (above) returns `undefined` when `req.vetFileAccess` is unset, so this
    // spread adds nothing at all for every caller before this piece -- strictly additive, the
    // identical discipline as `canUseTool` directly above. One matcher, no `matcher` pattern (every
    // tool_use event is inspected; the callback itself narrows to `Read`/`Edit`/`Write`), mirroring
    // the installed `.d.ts`'s own worked example shape (`hooks: { PreToolUse: [{ hooks: [...] }] }`).
    ...(fileAccessHook === undefined
      ? {}
      : {
          hooks: {
            PreToolUse: [{ hooks: [fileAccessHook] } satisfies HookCallbackMatcher],
          },
        }),
    // `07` §7.3's own mapping table names `--bare` for the CLI transport; the SDK has no literal
    // `bare` field at all (confirmed: no such field exists in the real `Options` type). Its own real,
    // documented isolation control is `settingSources: []` -- "Pass `[]` to disable filesystem
    // settings (SDK isolation mode)," confirmed directly against the real `.d.ts` doc comment, and
    // "When omitted, all sources are loaded (matches CLI defaults)" for the non-bare case. This is the
    // real SDK-side equivalent of the CLI's own `--bare`/non-bare split, not a guess.
    ...(config.bare ? { settingSources: [] } : {}),
    // `07` §7.3's own MCP-grant path (P7): the real, confirmed `Options.mcpServers`/`strictMcpConfig`
    // fields -- `strictMcpConfig`'s own doc comment says verbatim "Maps to the CLI
    // `--strict-mcp-config` flag," confirming this is genuinely the same real mechanism
    // `build-args.ts` uses, not an independently-invented SDK-side equivalent.
    ...(mcp === undefined
      ? {}
      : { mcpServers: { ...mcp.serverConfig }, strictMcpConfig: mcp.strict }),
  };

  // `07` §7.3's own mapping table names this combination for the CLI transport
  // (`--output-format json --json-schema`); the SDK's own real, confirmed equivalent is
  // `Options.outputFormat: { type: 'json_schema', schema }` -- unlike the CLI transport, this is NOT
  // documented as incompatible with `includePartialMessages` above (no `.d.ts` comment states a
  // conflict the way the CLI's own `--output-format` documentation does), so both stay set; not
  // live-verified whether structured output and partial-message streaming genuinely coexist on this
  // transport (a live call to confirm costs real money for a combination this milestone's own plan
  // does not require exercising together).
  if (req.outputSchema !== undefined) {
    options.outputFormat = { type: 'json_schema', schema: req.outputSchema };
  }

  if (req.limits.maxTurns !== undefined) options.maxTurns = req.limits.maxTurns;

  // `systemPrompt.mode === 'append'` maps to the real, documented preset-append form; `'replace'` maps
  // to a bare custom-string prompt (confirmed: "Has no effect when `systemPrompt` is a string (custom
  // prompt)" -- a plain string *is* the full-replace form, no other field needed).
  options.systemPrompt =
    req.systemPrompt.mode === 'append'
      ? { type: 'preset', preset: 'claude_code', append: req.systemPrompt.text }
      : req.systemPrompt.text;

  return options;
}
