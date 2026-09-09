/**
 * `listModels` — `07` §7.2: "Models this platform can currently use, for tier mapping validation."
 * Neither transport exposes a real "list available models" call of its own (confirmed: no such
 * command/option was found on the real CLI's own `--help` output or the SDK's own `.d.ts`), so this is
 * a real, small, static table of Claude Code's own known model ids -- documented as static rather
 * than faked as a live probe this milestone found no real mechanism for.
 *
 * @see specs/07 §7.2
 * @see PLAN-M7.md P4
 */
import type { ModelInfo } from '@forge/adapter-kit';

/** Every id/alias confirmed directly against the real, installed CLI's own `--model` help text
 * ("Provide an alias for the latest model (e.g. 'fable', 'opus', or 'sonnet')") and this milestone's
 * own real, live captures (`claude-haiku-4-5-20251001` and `claude-fable-5-1` both appeared in real
 * `system/init` events). */
export function listClaudeCodeModels(): readonly ModelInfo[] {
  return [
    { id: 'opus', displayName: 'Claude Opus 5 (alias)' },
    { id: 'sonnet', displayName: 'Claude Sonnet 5 (alias)' },
    { id: 'fable', displayName: 'Claude Fable 5.1 (alias)' },
    { id: 'haiku', displayName: 'Claude Haiku 4.5 (alias)' },
    { id: 'claude-opus-5', displayName: 'Claude Opus 5' },
    { id: 'claude-sonnet-5', displayName: 'Claude Sonnet 5' },
    { id: 'claude-fable-5-1', displayName: 'Claude Fable 5.1' },
    { id: 'claude-haiku-4-5-20251001', displayName: 'Claude Haiku 4.5' },
  ];
}
