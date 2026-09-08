/**
 * `markExternalContent` — `05` §5.4 point 6's own labelled-untrusted-content wrapping, applied to a
 * real context pack, plus the step-level `taint: external` marker point 6 also names.
 *
 * @see specs/05 §5.4 point 6
 * @see specs/15 §15.5.4
 * @see specs/20 §20.5
 * @see PLAN-M6.md A4
 */
import { wrapUntrustedContent } from '@forge/adapter-kit/control-tokens';
import type { ContextPack } from '@forge/kb/pack';

export type ExternalContentSource = 'mcp' | 'fetch';

export interface MarkedExternalContent<TPack extends ContextPack> {
  readonly pack: TPack;
  readonly taint: 'external';
}

/**
 * `wrapUntrustedContent` (`@forge/adapter-kit/control-tokens`, M4 P3) already fuses `20` §20.5 points
 * 1-2 ("delimit and label" + "strip control tokens") into one atomic operation -- this piece's own real
 * job is applying that already-built primitive to every textual field a real `ContextPack` carries, not
 * re-inventing wrapping. `pinnedCore` is deliberately left untouched: every one of its own fields is
 * always KB/config-derived (`@forge/kb/pack`'s own `computePinnedCore`, M3), never sourced from an MCP
 * call or a fetch, so there is no real external content there to wrap.
 *
 * A caller marks external content by building the *whole* pack this function is given from real
 * MCP/fetch results in the first place (an `AgentContextPack`/`ContextPack` this piece never mixes
 * KB-sourced and externally-sourced entries within) -- this is why the signature takes one uniform
 * `source` label for the entire pack, not a per-entry one: `05` §5.4's own Checks text asks for "a pack
 * built entirely from MCP-sourced content is provably wrapped ... one built entirely from KB/artifact
 * content is not," a binary per-pack distinction, not a mixed-provenance one this piece has no signal
 * to make correctly anyway (nothing in `ContextPack`'s own shape records where an individual entry
 * came from).
 */
export function markExternalContent<TPack extends ContextPack>(
  pack: TPack,
  source: ExternalContentSource,
): MarkedExternalContent<TPack> {
  const wrap = (content: string): string => wrapUntrustedContent(content, source).wrapped;

  return {
    // Only `ContextPack`'s own two content-bearing fields are replaced; every other field on `TPack`
    // (including `AgentContextPack`'s own `skills`) is carried through unchanged from the spread.
    pack: {
      ...pack,
      declaredInputs: pack.declaredInputs.map((entry) => ({
        ...entry,
        content: wrap(entry.content),
      })),
      retrieved: pack.retrieved.map((entry) => ({ ...entry, content: wrap(entry.content) })),
    },
    taint: 'external',
  };
}
