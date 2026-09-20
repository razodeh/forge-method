/**
 * `claimsMayOverlap` — the one conservative file-claim overlap rule.
 *
 * Two consumers ask "may these two stories write the same file?": the stage run plan
 * (`compileStageRunPlan`, `06` §6.2 rule 3, which serialises overlapping stories) and
 * `forge spec validate --rule file-claim-overlap` (`G-Ready`, `09` §9.3 rule 4, which fails a stage
 * whose ready stories overlap). They must agree, and both must err in the same direction: a missed
 * overlap lets two stories write the same files in parallel, an over-reported one only costs a
 * serialisation (plan) or a re-cut claim (gate). So the answer is one-sided: `true` unless the two
 * claims provably cannot share a file.
 *
 * **Why not `globsOverlap`.** That function asks `minimatch` whether one *pattern string* matches the
 * other, both ways. That is a test of literal-against-pattern, not of intersection, and it answers
 * `false` for `src/auth` against `src/auth/login.ts`, `src/**\/*.ts` against `src/billing/**`, brace sets,
 * `./` prefixes, and (silently) for any glob over its 512-character guard. It stays where the
 * scheduler and `agent validate` use it, unchanged; a claim gate cannot afford its misses.
 *
 * **The rule.** Compare the fixed leading path segments of each claim (everything before the first
 * segment containing a glob character): the claims may overlap unless those prefixes diverge at some
 * segment. Two claims whose fixed prefixes diverge (`src/a/**`, `src/b/**`) cannot match a common path;
 * two whose prefixes nest may. That is a superset of true glob intersection, needs no `minimatch` (so
 * no adversarial-pattern cost and no length guard), and can only over-report (`src/*.ts` against
 * `src/a/b.ts`). Comparison is case-insensitive (macOS and Windows filesystems are), `.` and empty
 * segments are ignored (`./src`, `src//a`, a trailing `/`), and a `..` anywhere in the
 * claim, or an absolute claim, empties the prefix because the claim could then resolve anywhere.
 *
 * @see specs/06 §6.2
 * @see specs/09 §9.3
 * @see PLAN-M13.md P24
 */

/** Whether a path segment is more than a literal name, so the fixed prefix must stop before it. Glob syntax
 * (`* ? [ ] { }`, an extglob opener `+( @( !(`), a backslash (a Windows separator: `src\auth` is not one name),
 * a colon (a drive-relative path `c:foo`, an NTFS stream `a:b`), and an 8.3 short name (`progra~1`, which names the
 * long directory). Ordinary directory names that merely contain `@`, `(`, `)`, `+` or `~` (`@acme`, `(shop)`, `c++`,
 * `~tmp`) are literal in `minimatch` and stay part of the prefix, so a `@scope` monorepo's packages are not all
 * "overlapping". Erring the other way only shortens the prefix, which over-reports; it never misses. */
function isGlobSegment(segment: string): boolean {
  return /[*?[\]{}\\:]/.test(segment) || /[+@!]\(/.test(segment) || /~\d/.test(segment);
}

/** The fixed leading path segments of a claim, lower-cased and NFC-normalised (a macOS filesystem treats `é` written
 * composed or decomposed as one name). No fixed prefix at all (`[]`, which may overlap anything) for: a negated
 * pattern (`!src/a` matches everything else), an absolute claim (`/x`, `C:\x`), and a `..` in any segment, including
 * one after a glob segment (`src/*\/../../lib/x`), behind a backslash (`a/..\lib`) or padded (`.. `), since the
 * claim could then resolve anywhere. */
export function claimFixedPrefix(glob: string): readonly string[] {
  const claim = glob.trim().normalize('NFC').toLowerCase();
  if (claim.startsWith('!') || /^(?:\/|[a-z]:[\\/])/.test(claim)) return [];
  if (claim.split(/[/\\]/).some((segment) => withoutTrailingBlanks(segment) === '..')) return [];
  const prefix: string[] = [];
  for (const segment of claim.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (isGlobSegment(segment)) break;
    // Windows ignores trailing dots and spaces in a name (`auth.` and `auth ` are `auth`).
    const name = withoutTrailingDotsAndBlanks(segment);
    if (name === '') continue;
    prefix.push(name);
  }
  return prefix;
}

function withoutTrailingBlanks(segment: string): string {
  let end = segment.length;
  while (end > 0 && (segment.charAt(end - 1) === ' ' || segment.charAt(end - 1) === '\t')) end -= 1;
  return segment.slice(0, end);
}

function withoutTrailingDotsAndBlanks(segment: string): string {
  let end = segment.length;
  while (end > 0 && '. \t'.includes(segment.charAt(end - 1))) end -= 1;
  return segment.slice(0, end);
}

/** Whether two already-computed fixed prefixes nest (one is a leading run of the other). */
export function prefixesNest(a: readonly string[], b: readonly string[]): boolean {
  const shorter = a.length <= b.length ? a : b;
  const longer = a.length <= b.length ? b : a;
  return shorter.every((segment, index) => segment === longer[index]);
}

/** `true` unless the two claims provably cannot match a common file. Symmetric; never throws. */
export function claimsMayOverlap(a: string, b: string): boolean {
  return prefixesNest(claimFixedPrefix(a), claimFixedPrefix(b));
}
