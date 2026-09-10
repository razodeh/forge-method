/**
 * `buildCliArgs` — `07` §7.3's own mapping table, CLI column, confirmed against the real, installed
 * CLI's own `--help` text field-for-field (not assumed from the spec's prose alone).
 *
 * @see specs/07 §7.3
 * @see SPEC-QUESTIONS.md Q114
 * @see PLAN-M7.md P2
 */
import type { SessionRequest } from '@forge/adapter-kit';

import type { ClaudeCodeAdapterConfig } from '../config.ts';
import type { McpSessionExtras } from '../mcp.ts';
import { mapPermissionModeForCli, mapToolGrantToAllowedTools } from '../tool-grant.ts';

/**
 * No exact limit is enforced here — a real stdin-piped fallback for an oversized prompt (`07` §7.3:
 * "large inputs MUST be written to files inside the worktree and referenced by path, never piped") was
 * considered and deliberately not built: the real, installed CLI has no `--prompt-file` flag at all
 * (confirmed against `--help` — only `--system-prompt[-file]`/`--append-system-prompt[-file]` accept a
 * file), and this milestone has no live-verified evidence that piping the main prompt via stdin under
 * `-p` even behaves as expected (untested, and a live test to find out costs real money for an edge
 * case KB-pack budgeting elsewhere in this system already keeps rare in practice). Recorded as a real,
 * open gap in `SPEC-QUESTIONS.md` Q114 rather than shipping an unverified stdin mechanism that might
 * silently hang instead of working.
 */
export function buildCliArgs(
  req: SessionRequest,
  config: ClaudeCodeAdapterConfig,
  resumeSessionId?: string,
  mcp?: McpSessionExtras,
): readonly string[] {
  const args: string[] = ['-p', '--verbose', '--name', req.stepId];
  // `07` §7.3's own mapping table: `session resume -> --resume <sessionId>` (confirmed against the
  // real CLI's own `--help`: `-r, --resume [value]`). P4's own job, added here rather than in P2 --
  // P2's own `SessionRequest`-only signature had no session id to resume in the first place.
  if (resumeSessionId !== undefined) args.push('--resume', resumeSessionId);

  if (req.outputSchema !== undefined) {
    // `07` §7.3's own mapping table names this combination; the real CLI's own `--output-format`
    // documents `"json"` as "single result" -- genuinely incompatible with streaming, confirmed
    // against `--help` (no combined "streamed, schema-validated" mode is documented). A real,
    // deliberate trade-off for this one session: no incremental `text`/`tool.call` events, only the
    // final structured result, when the caller asked for schema-validated output.
    //
    // A fresh critic round (P4) found this trade-off is currently *worse* than intended: neither
    // `parse-event.ts`'s own `mapResultSuccess` (this file's own sibling) nor `map-message.ts`'s SDK
    // equivalent reads the real `result`/`structured_output` fields off the final `result` message at
    // all -- only `usage`/`total_cost_usd`. In this exact mode there is no other event that could
    // carry the final text either (no streaming `assistant`/`stream_event` lines are ever emitted
    // here), so a session run this way currently returns `SessionResult.finalText: ''` and
    // `structured: undefined` even on real success -- not merely a missing-structured-payload gap,
    // but the *entire* model output silently discarded. `AdapterCapabilities.structuredOutput` is
    // `false` to match (`capabilities.ts`'s own doc comment). Fixing this for real needs
    // `parseCliEventLine`/`mapSdkMessage` to support more than one `AdapterEvent` per `result`
    // message (the SDK side's own `mapSdkMessage` already returns an array in principle, but every
    // inner mapper -- including `mapResultSuccess` -- still only ever produces one candidate; the CLI
    // side's `parseCliEventLine` returns a single `AdapterEvent | undefined` outright) -- real,
    // contained, but bigger than this piece's own scope; recorded in `SPEC-QUESTIONS.md` Q116 for a
    // dedicated future piece rather than rushed through here.
    args.push('--output-format', 'json', '--json-schema', JSON.stringify(req.outputSchema));
  } else {
    args.push('--output-format', 'stream-json', '--include-partial-messages');
  }

  args.push('--model', req.model);
  args.push('--permission-mode', mapPermissionModeForCli(req.permissionMode));

  // P5's own dedicated hardening pass: the real, installed CLI's own `--help` text confirms
  // `--allowedTools <tools...>` takes a "comma or space-separated list." `<tools...>` is commander's
  // own variadic syntax (confirmed against the same `--help` text): each value can arrive as its
  // *own* separate argv element rather than one joined string (`allowedTools.join(' ')`, this piece's
  // own original approach), which is passed here directly, never re-joined.
  //
  // This is defense in depth for the *list* boundary specifically, not the primary defense against
  // rule injection within one value -- a fresh critic round found that the real risk (a single
  // crafted rule string closing early and exposing a second, attacker-controlled rule) lives inside
  // `mapToolGrantToAllowedTools`/`safeBashRule` (`tool-grant.ts`) itself, and is not actually affected
  // by how many argv tokens the overall list arrives as: Claude Code's own parser derives rule
  // boundaries by scanning each value's *content*, the same mechanism whether that content was joined
  // by this file or arrived pre-split. `tool-grant.ts`'s own doc comment has the full record of that
  // finding and the fix. Keeping this argv-element split anyway: it removes this file's own
  // dependence on Claude Code's list-splitting being correct at all, for the one, narrower case where
  // several already-safe rules sit adjacent in one value -- strictly no worse than joining, and one
  // less thing this file needs to trust.
  //
  // The empty-grant case still needs an explicit, single empty-string value (not zero arguments) so
  // `--allowedTools` is never left as a bare, valueless flag -- the identical "always pass it
  // explicitly, even for a fully-denied grant" contract this function's own top-of-file doc comment
  // already establishes.
  //
  // `mcp?.allowedTools` (P7) is merged in *here*, as part of building this one, single
  // `--allowedTools` occurrence -- not appended separately later, since everything in this argv list
  // must come before the trailing `--`/prompt guard at the very end, which only this function
  // controls the position of.
  const allowedTools = [...mapToolGrantToAllowedTools(req.tools), ...(mcp?.allowedTools ?? [])];
  if (allowedTools.length === 0) {
    args.push('--allowedTools', '');
  } else {
    args.push('--allowedTools', ...allowedTools);
  }

  // `07` §7.3's own MCP-grant path (P7): `--mcp-config <configs...>` real, confirmed against the
  // installed CLI's own `--help` text to accept "JSON files or strings" -- a JSON *string* is used
  // directly here, never a temp file, since the real flag already supports it and this avoids the
  // filesystem-write/cleanup/boundary-safety concerns a file-based approach would otherwise need
  // (`skills.ts`, P6, already needed real symlink-escape hardening for an analogous file write inside
  // the lane; a string value sidesteps that whole class of risk here). `--strict-mcp-config` (real,
  // confirmed) is the actual mechanism behind "never adopt the user's own ambient `.mcp.json` unless
  // `config.mcp.adoptHostServers`" (`15` §15.5.2) -- `--bare`'s own help text is not fully explicit
  // about whether it alone already excludes ambient MCP config, so this is passed unconditionally
  // (whenever not adopting) rather than relying on an inferred, unconfirmed side effect of `--bare`.
  //
  // `mcp.serverConfig` itself (`mapGrantedMcpServersToConfig`, `mcp.ts`) is a bare `{serverId: config}`
  // map -- the real, correct, confirmed shape for the SDK transport's own `Options.mcpServers` field
  // (`build-options.ts`), but a real `FORGE_LIVE=1` run (M7's own live-run checkpoint) found the real,
  // installed CLI's own `--mcp-config` flag rejects that identical bare map outright: `Error: Invalid
  // MCP configuration:\nmcpServers: Invalid input`, exit code 1, the real session never even starting
  // (no `session.started` event, `session.ended{reason:'error'}` within ~130ms) -- confirmed directly
  // by spawning the real CLI with these exact args and reading raw stderr, bypassing this adapter's own
  // NDJSON parsing entirely. The CLI's own real `--mcp-config` schema wants the map wrapped one level
  // deeper, under a top-level `mcpServers` key -- confirmed by the identical direct-spawn repro
  // succeeding once wrapped. `mapGrantedMcpServersToConfig` itself stays unchanged (still correct for
  // the SDK transport); this transport-specific envelope is applied only here, at this transport's own
  // one real serialization point.
  if (mcp !== undefined) {
    args.push('--mcp-config', JSON.stringify({ mcpServers: mcp.serverConfig }));
    if (mcp.strict) args.push('--strict-mcp-config');
  }

  if (req.systemPrompt.mode === 'append') {
    args.push('--append-system-prompt', req.systemPrompt.text);
  } else {
    args.push('--system-prompt', req.systemPrompt.text);
  }

  if (config.bare) args.push('--bare');

  // `limits.maxTurns`: `07` §7.3's own mapping table names `--max-turns`, but the real, installed CLI
  // (confirmed directly against `--help`) has no such flag at all -- a real spec-vs-real-CLI drift on
  // this specific version, not a gap this piece invented. Not enforced by the CLI transport at all
  // (see `spawn.ts`'s own doc comment for why a client-side turn-counting approximation was considered
  // and rejected as unreliable, and `SPEC-QUESTIONS.md` Q114 for the full record) -- the SDK transport
  // (P3) enforces this natively via its own real `Options.maxTurns` field, a genuine, accepted
  // capability asymmetry between the two transports on this exact CLI version.

  // A fresh critic round found the trailing positional prompt had no guard against a real, if
  // unlikely, adversarial-or-just-unlucky input: a `req.prompt` beginning with `-`/`--` risks the
  // CLI's own commander-based argv parser reading it as an unrecognized flag rather than literal
  // prompt text (every *other* field above is safe, since each is consumed as a named flag's own
  // mandatory next-token value, never argv-position-sniffed). `--` is the standard "everything after
  // this is a positional argument, never a flag" convention every commander.js-family CLI honours;
  // not live-verified against this specific real CLI (a live call to confirm costs real money for an
  // edge case low-severity enough not to warrant one), but strictly no worse than the unguarded
  // version for the common case of a prompt that does not start with a dash.
  args.push('--', req.prompt);
  return args;
}
