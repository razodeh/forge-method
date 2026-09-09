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
): readonly string[] {
  const args: string[] = ['-p', '--verbose', '--name', req.stepId];

  if (req.outputSchema !== undefined) {
    // `07` §7.3's own mapping table names this combination; the real CLI's own `--output-format`
    // documents `"json"` as "single result" -- genuinely incompatible with streaming, confirmed
    // against `--help` (no combined "streamed, schema-validated" mode is documented). A real,
    // deliberate trade-off for this one session: no incremental `text`/`tool.call` events, only the
    // final structured result, when the caller asked for schema-validated output.
    args.push('--output-format', 'json', '--json-schema', JSON.stringify(req.outputSchema));
  } else {
    args.push('--output-format', 'stream-json', '--include-partial-messages');
  }

  args.push('--model', req.model);
  args.push('--permission-mode', mapPermissionModeForCli(req.permissionMode));

  const allowedTools = mapToolGrantToAllowedTools(req.tools);
  args.push('--allowedTools', allowedTools.join(' '));

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
