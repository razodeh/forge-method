/**
 * `compareVersions` — a real, minimal semver-shaped comparison, the identical `major.minor.patch`
 * parse/compare pattern `forge doctor`'s own `checkGitVersion` (`environment.ts`) already establishes
 * for a different real version string.
 *
 * @see specs/03 §3.4
 */
function parseVersion(version: string): readonly [number, number, number] | undefined {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version);
  if (match === null) return undefined;
  const [, major, minor, patch] = match;
  return [Number(major), Number(minor), Number(patch)];
}

/** `-1` if `a` is older than `b`, `1` if newer, `0` if equal or either side is not a real,
 * parseable `major.minor.patch` string (an unparseable version can be neither confirmed older nor
 * newer than anything, so it never triggers `CFG-018`'s own downgrade refusal on its own). */
export function compareVersions(a: string, b: string): -1 | 0 | 1 {
  const parsedA = parseVersion(a);
  const parsedB = parseVersion(b);
  if (parsedA === undefined || parsedB === undefined) return 0;
  const [majorA, minorA, patchA] = parsedA;
  const [majorB, minorB, patchB] = parsedB;
  if (majorA !== majorB) return majorA > majorB ? 1 : -1;
  if (minorA !== minorB) return minorA > minorB ? 1 : -1;
  if (patchA !== patchB) return patchA > patchB ? 1 : -1;
  return 0;
}
