/**
 * `collectExternalKbIds` — `PLAN-M14.md` P30: the ids of every KB entry, ADR or Runbook whose own
 * `sources` carries a `kind: 'external'` provenance entry (`08` §8.3, `@forge/schemas`'s own
 * `artifactSourceSchema`) -- an entry whose content came from an MCP server or a fetched page
 * (`20` §20.5 point 3, `15` §15.5.4), named by `ref` (an `mcp:<server>[/<tool>]` or `fetch:<https-url>`
 * reference, not an ADR id or a source file path the way the other three kinds are).
 *
 * `@forge/engine/plan`'s `compilePlan` cannot compute this itself (it never opens the KB, `Q62`'s own
 * "a capability this package cannot reach yet" split); the CLI, which already knows the project's real
 * KB root, reads the tree once and hands the resulting set to every compile site as
 * `CompilePlanTaintOptions.externalKbIds` -- `run.ts`'s `runWorkflow` (both the `--dry-run` branch and
 * the real run, via `RunEngineContext.externalKbIds`), `resume.ts`'s `resumeWorkflow` (from a manifest
 * snapshot instead of a fresh read, see its own doc comment for why), and `expression-context.ts`'s
 * `assertPlannable`/`planStageForRun`.
 *
 * Read from `paths`/`kbRoot` directly (never the integration worktree): every one of this function's own
 * callers runs *before* a lane or an integration worktree necessarily exists (a `--dry-run`, or the
 * input-resolution pass that happens before `runWorkflow` creates one at all) -- the project's own
 * working tree is the one KB state every compile site can read identically, which is what "dry run and
 * real run agree" (`PLAN-M14.md` P30's own Tests-first text) actually needs: the SAME computed set
 * reaching every site, not each site independently reading a KB tree that may have moved between reads.
 *
 * @see specs/08 §8.3
 * @see specs/20 §20.5 point 3
 * @see specs/15 §15.5.4
 * @see PLAN-M14.md P30
 */
import type { ProjectPaths } from '@forge/core/fs';
import { parseKbTree, type KbParsedEntry } from '@forge/kb';

/** The three `KbParsedEntry` kinds that carry an (optional-or-required) `sources` array with a
 * `kind`/`ref` shape at all -- `risks-file`/`assumptions-file`/`open-questions-file`/`environments-file`/
 * `components-file` are collection wrappers around per-item records this piece does not reach into: none
 * of their items is (today) resolvable as a declared `kb:<id>` input at all (`dispatch/assemble.ts`'s own
 * `kbEntryIds` matches only these same three kinds plus `diagram`, which carries no `sources` field),
 * so a source on one of those items could never taint a step through `externalKbIds` regardless. */
function hasSources(
  entry: KbParsedEntry,
): entry is Extract<KbParsedEntry, { kind: 'kb-entry' | 'adr' | 'runbook' }> {
  return entry.kind === 'kb-entry' || entry.kind === 'adr' || entry.kind === 'runbook';
}

/** Every KB entry/ADR/Runbook id whose own `sources` includes at least one `kind: 'external'` entry,
 * from the real KB tree at `<paths root>/<kbRoot>`. Never throws for a malformed KB file (`parseKbTree`'s
 * own contract): a file `KbTree.errors` names is simply absent from the result, the same "one bad file
 * never hides everything else" stance the KB package already holds throughout. */
export async function collectExternalKbIds(
  paths: ProjectPaths,
  kbRoot: string,
): Promise<ReadonlySet<string>> {
  const tree = await parseKbTree(paths, kbRoot);
  const ids = new Set<string>();
  for (const entry of tree.entries) {
    if (!hasSources(entry)) continue;
    const sources = entry.value.sources ?? [];
    if (sources.some((source) => source.kind === 'external')) ids.add(entry.value.id);
  }
  return ids;
}
