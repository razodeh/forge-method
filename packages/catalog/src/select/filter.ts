/**
 * `filterByConstraints` -- `12` §12.3 step 1: "remove anything violating a hard constraint. Print what
 * was removed and why (this transparency is required; silent elimination is a bug)."
 *
 * @see specs/12 §12.3
 * @see PLAN-M6.md C5
 */
import type { CatalogEntry } from '../schema/types.ts';
import type { FilterResult, RemovedCandidate, StackConstraints } from './types.ts';

/** `managed_options` id prefixes this piece recognises as cloud-specific, for the `constraints.cloud`
 * filter below -- a real, deliberately narrow heuristic (`12` §12.3 gives the constraint, not an
 * algorithm for applying it against catalog data shaped the way C1-C4 actually shipped it). An entry is
 * only filtered on cloud mismatch when *every one* of its own managed options names a *different* cloud
 * than the one requested; an entry with no managed options, or with at least one option matching (or not
 * cloud-specific at all, e.g. a self-hosted-only tool), is never removed by this rule alone. */
const CLOUD_PREFIXES: Readonly<Record<string, readonly string[]>> = {
  aws: ['aws-'],
  gcp: ['gcp-'],
  azure: ['azure-'],
};

function isCloudMismatch(entry: CatalogEntry, cloud: string): boolean {
  const options = entry.managed_options;
  if (options === undefined || options.length === 0) return false;

  const requestedPrefixes = CLOUD_PREFIXES[cloud.toLowerCase()];
  if (requestedPrefixes === undefined) return false;

  const matchesRequested = (option: string) =>
    requestedPrefixes.some((prefix) => option.startsWith(prefix));
  const matchesAnyOtherCloud = (option: string) =>
    Object.entries(CLOUD_PREFIXES).some(
      ([name, prefixes]) =>
        name !== cloud.toLowerCase() && prefixes.some((prefix) => option.startsWith(prefix)),
    );

  const anyMatchesRequested = options.some(matchesRequested);
  const everyOptionIsAnotherCloud = options.every(matchesAnyOtherCloud);
  return !anyMatchesRequested && everyOptionIsAnotherCloud;
}

/** Pure: removes any candidate matching `constraints.forbidden` (by id, exact match), any candidate
 * whose `licence` string contains a `constraints.licencePolicy` banned term (case-insensitive substring
 * match), and any candidate whose every managed option is cloud-specific to a different cloud than
 * `constraints.cloud`. `constraints.teamSkills` is deliberately not a filter here -- `12` §12.3 describes
 * it as a scoring input (step 3's own "team familiarity" criterion), not a hard elimination constraint,
 * and `constraints.compliance` is not mechanically enforced here either: no shipped `CatalogEntry` field
 * carries compliance-certification data to filter against, so treating it as a real elimination
 * constraint today would be a fabricated signal, not a real one -- it remains part of the type for a
 * later piece (or catalog schema extension) to make real. */
export function filterByConstraints(
  candidates: readonly CatalogEntry[],
  constraints: StackConstraints,
): FilterResult {
  const kept: CatalogEntry[] = [];
  const removed: RemovedCandidate[] = [];
  const forbidden = new Set(constraints.forbidden);

  for (const entry of candidates) {
    if (forbidden.has(entry.id)) {
      removed.push({ entry, reason: `"${entry.id}" is on constraints.forbidden.` });
      continue;
    }

    const bannedLicenceTerm = (constraints.licencePolicy ?? []).find((term) =>
      entry.licence.toLowerCase().includes(term.toLowerCase()),
    );
    if (bannedLicenceTerm !== undefined) {
      removed.push({
        entry,
        reason: `licence "${entry.licence}" contains the banned term "${bannedLicenceTerm}" from constraints.licencePolicy.`,
      });
      continue;
    }

    if (constraints.cloud !== undefined && isCloudMismatch(entry, constraints.cloud)) {
      removed.push({
        entry,
        reason: `every managed option is specific to a different cloud than constraints.cloud ("${constraints.cloud}").`,
      });
      continue;
    }

    kept.push(entry);
  }

  return { kept, removed };
}
