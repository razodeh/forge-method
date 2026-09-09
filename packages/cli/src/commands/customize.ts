/**
 * `forge customize` — `03` §3.2.8's own interactive customization wizard. The same real gap `forge
 * session`/`forge ask` already establish in C5: no real TUI/interactive-terminal-handoff mechanism
 * exists anywhere in this codebase, and this command's own real value (walking a person through
 * available presets/overlays interactively) has no honest non-interactive equivalent to fall back to
 * the way `forge init --yes` does for the wizard it stands in for. `forge preset apply <id>`/`forge
 * config set <key> <value>` already cover the real, scriptable half of "customize a project."
 *
 * @see specs/03 §3.2.8
 */
import { ForgeError } from '@forge/core';

export function customize(): never {
  throw new ForgeError('USR-003', { feature: 'customize' });
}
