/**
 * `listRunIds` — every real run directory under `.forge/state/runs/`, for the "walk every run this
 * project has ever executed" idiom several CLI commands independently need (`forge cost`, `forge kb
 * disclosures`' own stopped-critic-loop synthesis, and `specs/22` M15 P12's `forge report`).
 *
 * Extracted here rather than left as three separate, byte-identical private copies
 * (`cost.ts`/`kb-disclosures.ts` both had their own before this piece, confirmed via direct read —
 * the same "a second silent copy" risk M15 P10's own `withExemptionsLock` -> `collection-lock.ts`
 * extraction already named and fixed for the cross-process lock mechanism). `@forge/telemetry/audit`'s
 * own `queryAuditEvents` has a FOURTH, independently-necessary copy — that one is not consolidated
 * here: it lives in a different package with no `@forge/core/fs` edge to reach `ProjectPaths`/
 * `listDirEntriesSorted` with (its own doc comment says so directly), so it reimplements the walk over
 * raw `node:fs` instead. Not this piece's Surface to fix; named here as a known, disclosed, pre-existing
 * duplication a future consolidation could still close, not a new one this piece introduces.
 *
 * @see PLAN-M15.md P12
 */
import { listDirEntriesSorted, pathExists, type ProjectPaths } from '@forge/core/fs';

/** Every real run id this project has ever executed, sorted (`listDirEntriesSorted`'s own plain
 * code-unit order — never `localeCompare`, `QUALITY-BAR.md` R10), or `[]` for a project with no runs
 * directory at all yet (not an error — the identical "no event log yet is not corruption" stance
 * `@forge/telemetry/events`'s own `readEvents` already takes for one run). `.forge/state/` is a denied
 * prefix under `ProjectPaths.resolveWithin` (`@forge/core/fs`'s own containment rule) —
 * `resolveState` is the one sanctioned way to reach inside it. */
export async function listRunIds(paths: ProjectPaths): Promise<readonly string[]> {
  const runsDir = paths.resolveState('runs');
  if (!(await pathExists(runsDir))) return [];
  const entries = await listDirEntriesSorted(runsDir);
  return entries.filter((entry) => entry.isDirectory).map((entry) => entry.name);
}
