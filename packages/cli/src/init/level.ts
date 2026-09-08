/**
 * `resolveInitLevel` — `03` §3.3 step 4: "auto-proposed L0–L4 with reasoning shown; confirm or
 * override."
 *
 * @see specs/03 §3.3
 * @see specs/01 §1.9
 */
import { proposeLevel, type LevelProposal, type LevelSignals } from '@forge/methods/level';

import type { InitOptions } from './types.ts';

/**
 * The signal set `runInit` derives when `options.level` is not given.
 *
 * `greenfield: true` is the one signal this piece can state with real confidence — `forge init` (as
 * opposed to `forge adopt`) is greenfield by definition. Every other signal in `01` §1.9's own seven-
 * signal list (user-facing capability count, deployable units, persistent state, external
 * integrations, regulatory scope, multi-runtime) needs real answers this non-interactive flag surface
 * has no source for: `03` §3.3's own worked flag example always passes `--level` explicitly rather
 * than relying on auto-proposal, and inventing a heuristic from `--modules`/`--idea-file` content
 * would be guessing, not deriving. Conservative defaults (0/false) are used instead of a fabricated
 * heuristic — a real, documented simplification, not a hidden one. See `SPEC-QUESTIONS.md` Q101.
 */
function defaultSignals(): LevelSignals {
  return {
    greenfield: true,
    userFacingCapabilities: 0,
    deployableUnits: 0,
    hasPersistentState: false,
    hasExternalIntegrations: false,
    regulatory: false,
    multiRuntime: false,
  };
}

export function resolveInitLevel(options: InitOptions): LevelProposal {
  if (options.level !== undefined) {
    return { level: options.level, reasoning: `Explicit --level ${options.level}.` };
  }
  return proposeLevel(defaultSignals());
}
