/**
 * `resolveContextRequest` — `05` §5.4 point 4's own `FORGE_REQUEST_CONTEXT:` expansion protocol: an
 * agent mid-step asks for more context than its own initial pack carried, naming either a specific KB
 * id or a fresh retrieval query.
 *
 * @see specs/05 §5.4
 * @see PLAN-M6.md A4
 */
import { isForgeError } from '@forge/core';
import { buildContextPack } from '@forge/kb/pack';
import type { KbIndexBackend, KbTree } from '@forge/kb';

import type { AgentContextPack } from './types.ts';

/**
 * `query` is already the *payload* of a `FORGE_REQUEST_CONTEXT:` control token -- this piece never
 * parses the token itself (`05` §5.4 point 4's own text: "reusing `@forge/adapter-kit/control-tokens`,
 * not a second token parser"); a real caller extracts `parseControlToken(raw).query` (M4, P3) and
 * passes that string straight in.
 *
 * Two shapes, tried in order: `query` names a specific, real KB entry id (`buildContextPack`'s own
 * `declaredInputIds` lookup succeeds) -> that entry's full content, guaranteed included; otherwise
 * `query` is treated as a fresh retrieval query run through the identical lexical/graph-expansion
 * backend `buildContextPack` itself already uses for the initial pack, so an expansion request gets
 * the same real ranking `05` §5.4's own retrieval steps already established, not a second, different
 * search mechanism invented here.
 *
 * Returns an *incremental* pack: `pinnedCore`/`declaredInputs` carry only what this one request
 * resolved (not the step's own original pack, which this piece never receives at all) -- a real
 * caller's own job is merging this into the step's live context, not this function's.
 */
export function resolveContextRequest(
  query: string,
  kbBackend: KbIndexBackend,
  kbTree: KbTree,
  budgetTokens: number,
): AgentContextPack {
  try {
    const byId = buildContextPack(
      { declaredInputIds: [query], briefText: '', budgetTokens },
      kbBackend,
      kbTree,
    );
    return { ...byId, skills: [] };
  } catch (cause) {
    // `KB-013`: `query` did not resolve to a real KB entry id -- fall back to treating it as a
    // free-text retrieval query instead. Any other `ForgeError` (or a non-`ForgeError` at all) is a
    // genuine, different failure and is not swallowed here.
    if (!isForgeError(cause) || cause.code !== 'KB-013') throw cause;
    const byQuery = buildContextPack(
      { declaredInputIds: [], briefText: query, budgetTokens },
      kbBackend,
      kbTree,
    );
    return { ...byQuery, skills: [] };
  }
}
