/**
 * `buildSdkOptions` — `07` §7.3's own mapping table, SDK column, confirmed against the real, published
 * `@anthropic-ai/claude-agent-sdk@0.3.266`'s own `.d.ts` field names (not assumed from the spec's prose
 * alone, the same discipline `build-args.ts` (P2) already applied to the CLI column).
 *
 * @see specs/07 §7.3
 * @see SPEC-QUESTIONS.md Q115
 * @see PLAN-M7.md P3
 */
import type { Options } from '@anthropic-ai/claude-agent-sdk';
import type { SessionRequest } from '@forge/adapter-kit';

import type { ClaudeCodeAdapterConfig } from '../config.ts';
import { mapPermissionModeForSdk, mapToolGrantToAllowedTools } from '../tool-grant.ts';

export function buildSdkOptions(
  req: SessionRequest,
  config: ClaudeCodeAdapterConfig,
  resumeSessionId?: string,
): Options {
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
    // as-is.
    allowedTools: [...mapToolGrantToAllowedTools(req.tools)],
    permissionMode: mapPermissionModeForSdk(req.permissionMode),
    includePartialMessages: true,
    // `07` §7.3's own mapping table names `--bare` for the CLI transport; the SDK has no literal
    // `bare` field at all (confirmed: no such field exists in the real `Options` type). Its own real,
    // documented isolation control is `settingSources: []` -- "Pass `[]` to disable filesystem
    // settings (SDK isolation mode)," confirmed directly against the real `.d.ts` doc comment, and
    // "When omitted, all sources are loaded (matches CLI defaults)" for the non-bare case. This is the
    // real SDK-side equivalent of the CLI's own `--bare`/non-bare split, not a guess.
    ...(config.bare ? { settingSources: [] } : {}),
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
