/**
 * `parseModuleVersionRange`, `satisfiesForgeVersionRange` — a real, minimal semver-range parser and
 * checker for `module.yaml`'s own `forgeVersion` field (`19` §19.1's worked example: `">=1.0 <2"`).
 *
 * No `semver` dependency: this package (`@forge/extensions`) does not currently depend on one, and
 * the identical "real, minimal `major.minor.patch` parse/compare, no library" pattern is already
 * established precedent in this repo (`packages/cli/src/commands/upgrade/version.ts`'s own
 * `compareVersions`) for a different real version string. A range here is an npm-style
 * space-separated AND of comparator clauses (`>=1.0 <2`) — the one form `19` §19.1's own worked
 * example actually shows; no OR (`||`) syntax is supported, since nothing in the spec pack uses one.
 *
 * @see specs/19 §19.1
 * @see packages/cli/src/commands/upgrade/version.ts
 */

type Comparator = '>=' | '<=' | '>' | '<' | '=';

const COMPARATORS: readonly Comparator[] = ['>=', '<=', '>', '<', '='];

interface RangeClause {
  readonly comparator: Comparator;
  readonly version: readonly [number, number, number];
}

/** A `major`, `major.minor`, or `major.minor.patch` version string — missing components default to
 * `0`, matching npm's own partial-version range convention (`"2"` means `"2.0.0"`). `undefined` for
 * anything that is not purely digits and dots. */
function parsePartialVersion(raw: string): readonly [number, number, number] | undefined {
  const match = /^(\d+)(?:\.(\d+))?(?:\.(\d+))?$/.exec(raw.trim());
  if (match === null) return undefined;
  const [, major, minor, patch] = match;
  return [Number(major), Number(minor ?? '0'), Number(patch ?? '0')];
}

/**
 * Destructures both tuples rather than indexing (`a[0]`, `a[1]`, ...): a fixed-length tuple type
 * destructures to plain `number`s even with `noUncheckedIndexedAccess` on, since a tuple's own
 * length is already known at every position — indexing the same tuple would type each element
 * `number | undefined` instead, forcing a non-null assertion this codebase's own
 * `@typescript-eslint/no-non-null-assertion` rule (enabled for `src/`) forbids.
 */
function compareTriples(
  a: readonly [number, number, number],
  b: readonly [number, number, number],
): -1 | 0 | 1 {
  const [aMajor, aMinor, aPatch] = a;
  const [bMajor, bMinor, bPatch] = b;
  if (aMajor !== bMajor) return aMajor > bMajor ? 1 : -1;
  if (aMinor !== bMinor) return aMinor > bMinor ? 1 : -1;
  if (aPatch !== bPatch) return aPatch > bPatch ? 1 : -1;
  return 0;
}

/**
 * Parses `range` into its comparator clauses, or `undefined` if any clause is malformed —
 * `undefined` is a real, checkable outcome (`satisfiesForgeVersionRange` treats it as "not
 * satisfied," never a thrown exception a caller would have to guess how to handle).
 */
export function parseModuleVersionRange(range: string): readonly RangeClause[] | undefined {
  const clauses = range.trim().split(/\s+/).filter(Boolean);
  if (clauses.length === 0) return undefined;

  const parsed: RangeClause[] = [];
  for (const clause of clauses) {
    const match = /^(>=|<=|>|<|=)?(\d.*)$/.exec(clause);
    if (match === null) return undefined;
    const [, rawComparator, rawVersion] = match;
    const comparator = (rawComparator ?? '=') as Comparator;
    if (!COMPARATORS.includes(comparator)) return undefined;
    const version = parsePartialVersion(rawVersion ?? '');
    if (version === undefined) return undefined;
    parsed.push({ comparator, version });
  }
  return parsed;
}

/**
 * Whether `version` (a real `major.minor.patch` string, e.g. a running FORGE version) satisfies every
 * clause of `range`.
 *
 * Fails closed on anything unparseable — an unparseable `version` or `range` is never treated as
 * satisfied, the same "never a silent skip" rule this package's other boundary checks already follow
 * (`checkToolCeiling`'s own exhaustive violation list, `applyOverlay`'s own `CFG-011`).
 */
export function satisfiesForgeVersionRange(version: string, range: string): boolean {
  const target = parsePartialVersion(version);
  const clauses = parseModuleVersionRange(range);
  if (target === undefined || clauses === undefined) return false;

  return clauses.every((clause) => {
    const cmp = compareTriples(target, clause.version);
    switch (clause.comparator) {
      case '>=':
        return cmp >= 0;
      case '<=':
        return cmp <= 0;
      case '>':
        return cmp > 0;
      case '<':
        return cmp < 0;
      case '=':
        return cmp === 0;
    }
  });
}
