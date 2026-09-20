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
import type { ModelInfo, TierModelMap } from '@forge/adapter-kit';

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

/**
 * Claude Code's own answer to `PlatformAdapter.defaultTierModels` (`05` §5.8, `PLAN-M13.md` P5b,
 * `SPEC-QUESTIONS.md` Q204): `frugal` -> the small/fast family, `balanced` -> the mid family, `max` ->
 * the large family — the three-step haiku / sonnet / opus line, in that order. That is a judgement call
 * about which of the listed models best serves each tier, not something a test can prove; a project that
 * disagrees (for example wants `max` on another listed model) says so in `models.tiers`, and `forge init`
 * never overwrites that.
 *
 * Deliberately the short *aliases*, never a pinned dated id: an alias tracks whichever release the CLI
 * currently serves for that family, so a project initialised today does not silently keep asking for a
 * retired snapshot; and the aliases are exactly what the CLI's own `--model` help documents. Every value
 * here is also reported by `listClaudeCodeModels` (a test holds that), because `forge init` refuses to
 * write an id the adapter's own `listModels()` does not list.
 */
export function defaultClaudeCodeTierModels(): TierModelMap {
  return { frugal: 'haiku', balanced: 'sonnet', max: 'opus' };
}
