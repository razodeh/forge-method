/**
 * `writePromptRecord` — `05` §5.3's own mandatory audit write of a compiled prompt to
 * `.forge/state/runs/<runId>/steps/<stepId>/prompt.md`.
 *
 * @see specs/05 §5.3
 * @see PLAN-M6.md A5
 */
import { writeFileAtomic } from '@forge/core';
import type { ProjectPaths } from '@forge/core';

import type { CompiledPrompt } from './types.ts';

/**
 * `ProjectPaths.resolveState` (not `resolveWithin`) is the only way to reach `.forge/state/` at all —
 * `resolveWithin`'s own deny list refuses it categorically (`@forge/core/fs`'s `DENIED_PREFIXES`),
 * since that boundary exists to keep ordinary *agent* artifact writes out of the engine's own runtime
 * state. This piece is the engine-side audit writer that path is deliberately still open to.
 */
export async function writePromptRecord(
  runId: string,
  stepId: string,
  prompt: CompiledPrompt,
  paths: ProjectPaths,
): Promise<void> {
  const target = paths.resolveState(`runs/${runId}/steps/${stepId}/prompt.md`);
  await writeFileAtomic(target, `${prompt.text}\n`);
}
