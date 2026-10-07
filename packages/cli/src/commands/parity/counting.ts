/**
 * The verdict precedence and the counting algebra (`13` F-TEST-9, Verdicts and Counting;
 * `process/SPEC-QUESTIONS.md` Q294 Decision 4). A pure function over a list of per-declaration
 * results — `P6`/`P7` supply those results from a real check or capture; a test may hand them in
 * directly — so the algebra is written and verified exactly once rather than re-derived by every
 * caller.
 *
 * Q294 Decision 4 records two real holes an earlier draft had, both closed by definitions the
 * invariant now follows FROM rather than an asserted rule bolted on top, and this module is written
 * to keep both closed:
 *
 * 1. **A case must satisfy exactly one verdict, chosen by precedence, never "whichever check ran
 *    first".** The first draft let a case that was both `unclean` and `match` read as `match` because
 *    `match` happened to be checked first; this module does not decide that question itself (its
 *    input is already one {@link CaseVerdict} per case, decided by `compare.ts`'s own total-precedence
 *    `decideCaseVerdict`), but its own declaration-level reduction applies the identical precedence
 *    rule to a declaration's cases, so the same class of bug cannot reappear one level up.
 * 2. **A count of what ran is not the same as a count of what happened.** The first repair asserted
 *    "`failing` is 0 only when `passing` is at least 1" as a bolted-on rule, and a declaration with no
 *    surface that is not exempt, or a check with no declaration at all, falsified it by printing 0 and
 *    0. This module makes `nothing-compared` and `no-declarations` their OWN inputs
 *    ({@link DeclarationResult}'s `'nothing-compared'` case and {@link countParityResults} being
 *    called with an empty list) rather than a state the counting loop can silently fail to visit, and
 *    the 0-and-0 case is checked explicitly and refused rather than hoped unreachable.
 *
 * @see specs/13-frameworks-testing-and-debugging.md F-TEST-9
 * @see process/SPEC-QUESTIONS.md Q294 Decision 4
 */

/** The five verdicts decided about a case that actually ran (`13` F-TEST-9). Precedence is total and
 * in this exact order: the first that applies to a case is the one reported, and the same order
 * reduces a list of case verdicts (or declaration verdicts) to the single worst one. */
export type CaseVerdict = 'error' | 'unclean' | 'unstable' | 'mismatch' | 'match';

/** {@link CaseVerdict}'s members, worst first — the order both a case's own precedence and a
 * declaration's reduction from its cases use. */
export const CASE_VERDICT_PRECEDENCE: readonly CaseVerdict[] = [
  'error',
  'unclean',
  'unstable',
  'mismatch',
  'match',
];

/** The four verdicts decided about a declaration BEFORE any of its cases run, each stopping every
 * case from running (`13` F-TEST-9). */
export type DeclarationStopVerdict = 'invalid' | 'expired' | 'missing' | 'ambiguous';

/** {@link DeclarationStopVerdict}'s members, worst first, continuing directly into
 * {@link CASE_VERDICT_PRECEDENCE} — together these nine names are `13` F-TEST-9's total order. */
export const DECLARATION_STOP_PRECEDENCE: readonly DeclarationStopVerdict[] = [
  'invalid',
  'expired',
  'missing',
  'ambiguous',
];

/** One declaration's own outcome, as the counting algebra needs it: either it was stopped before any
 * case ran (carrying the stopping verdict — `nothing-compared` is folded into `'invalid'` here,
 * matching `13` F-TEST-9's own "`invalid` ... a declaration that compares nothing ('nothing-compared':
 * it has no surface that is not exempt)"), or it ran, carrying every case's own verdict (`'exempt'`
 * for a case on an `unobservable` surface, which has no verdict and is never counted as compared). */
export type DeclarationResult =
  | { readonly kind: 'stopped'; readonly verdict: DeclarationStopVerdict }
  | { readonly kind: 'ran'; readonly cases: readonly ('exempt' | CaseVerdict)[] };

/** One declaration's reduced outcome: its own verdict (by precedence over its cases, or the stopping
 * verdict), how many cases counted `passing`/`failing`, and how many were `exempt`. */
export interface DeclarationCount {
  readonly verdict: DeclarationStopVerdict | CaseVerdict;
  readonly passing: number;
  readonly failing: number;
  readonly exempt: number;
}

/**
 * The whole check's reduced outcome. `no-declarations` is a REAL, counted, printable outcome — `13`
 * F-TEST-9 in so many words: "A check with no declaration at all counts one failing and no passing,
 * and its overall verdict is `invalid` with the reason `no-declarations`" — one sentence, distinct
 * from the refusal enumeration that precedes it; `PLAN-M16.md` P7's own Mandate restates it as its own
 * sentence too: "Zero declarations is one failing with the reason `no-declarations`, not a pass."
 * Neither source calls it a refusal, so it is the `ok: true` shape, carrying real numbers
 * (`passing: 0, failing: 1, exempt: 0, declarations: []`) a caller can print, with `reason` set so a
 * caller can still tell it apart from an ordinary all-`match` run. `nothing-printable` is the
 * genuinely different, contentless case — a result that would print 0 passing AND 0 failing from one
 * or more declarations that DID run — and stays `ok: false`, since there is nothing to print at all,
 * not merely a `reason` to add to real numbers.
 */
export type ParityCountResult =
  | {
      readonly ok: true;
      readonly verdict: DeclarationStopVerdict | CaseVerdict;
      readonly reason?: 'no-declarations';
      readonly passing: number;
      readonly failing: number;
      readonly exempt: number;
      readonly declarations: readonly DeclarationCount[];
    }
  | { readonly ok: false; readonly reason: 'nothing-printable' };

/** Reduces a list of same-kind verdicts to the single worst one by `precedence` (worst first). A
 * `declarations` list is never empty by this function's own contract (a `ran` declaration's `cases`
 * can be — the caller decides what that means — but every caller in this module passes at least one
 * verdict), so the result is never `undefined` in practice; `undefined` is returned, rather than
 * thrown, so a genuinely empty list (one no real caller here produces) degrades to "no opinion" for
 * whichever caller asks, instead of crashing a check over one bad declaration. */
function worstBy<V extends string>(
  verdicts: readonly V[],
  precedence: readonly V[],
): V | undefined {
  for (const candidate of precedence) {
    if (verdicts.includes(candidate)) return candidate;
  }
  return verdicts[0];
}

/** Reduces one declaration's raw result to its {@link DeclarationCount}. */
function countDeclaration(result: DeclarationResult): DeclarationCount {
  if (result.kind === 'stopped') {
    return { verdict: result.verdict, passing: 0, failing: 1, exempt: 0 };
  }
  let passing = 0;
  let failing = 0;
  let exempt = 0;
  const caseVerdicts: CaseVerdict[] = [];
  for (const entry of result.cases) {
    if (entry === 'exempt') {
      exempt += 1;
      continue;
    }
    caseVerdicts.push(entry);
    if (entry === 'match') passing += 1;
    else failing += 1;
  }
  // A declaration that ran has, by `13` F-TEST-9's own invariant, at least one surface that is not
  // exempt, and every surface lists at least one case (a surface with none is `invalid` at load, so
  // it never reaches `countParityResults` as `kind: 'ran'`) -- so `caseVerdicts` is never empty for a
  // well-formed input. A test that hands in an all-exempt `ran` declaration directly (bypassing that
  // invariant) falls through to `worstBy`'s own `undefined` fallback below, which this function turns
  // into `'match'` only in the sense that zero counted cases means nothing failed either -- see
  // `nothingComparedDeclaration` for the declaration-level shape that invariant is meant to be
  // expressed as instead.
  const verdict = worstBy(caseVerdicts, CASE_VERDICT_PRECEDENCE) ?? 'match';
  return { verdict, passing, failing, exempt };
}

/**
 * The declaration-level shape for "no surface that is not exempt" (`13` F-TEST-9: `invalid` as
 * `nothing-compared`) — a convenience for a caller building a {@link DeclarationResult} from a real
 * declaration where every surface turned out to be excused, since that caller already has the
 * `exempt` count in hand and should not have to re-derive the `stopped`/`invalid` shape by hand.
 */
export function nothingComparedDeclaration(exempt: number): DeclarationCount {
  return { verdict: 'invalid', passing: 0, failing: 1, exempt };
}

/**
 * The counting algebra (`13` F-TEST-9, Verdicts and Counting). `passing` counts the cases that are
 * `match` in declarations that were not stopped; `failing` counts every other case plus one for each
 * stopped declaration, however many cases it would have declared; an exempt case counts in its own
 * bucket, never as passing or failing. A check given no declarations at all carries the real,
 * pinned numbers `13` F-TEST-9 and `PLAN-M16.md` P7 both state in so many words — `{ok: true,
 * verdict: 'invalid', reason: 'no-declarations', passing: 0, failing: 1, exempt: 0, declarations:
 * []}` — never the contentless refusal shape, which is reserved for the genuinely different
 * `nothing-printable` case below (see {@link ParityCountResult}'s own doc comment for why these two
 * are not the same shape, a DECISION this module's own report corrects after a round of review found
 * the original `{ok:false}` shape gave `P7` nowhere to put the numbers both sources require). A
 * result that would print 0 passing and 0 failing from one or more declarations that DID run is
 * `{ok:false, reason: 'nothing-printable'}` — unreachable from a well-formed input by the same
 * invariant `countDeclaration`'s own comment states, checked explicitly anyway so a later change to
 * this algebra cannot reopen the hole silently (Q294 Decision 4's own stated reason for writing the
 * check at all).
 */
export function countParityResults(declarations: readonly DeclarationResult[]): ParityCountResult {
  if (declarations.length === 0) {
    return {
      ok: true,
      verdict: 'invalid',
      reason: 'no-declarations',
      passing: 0,
      failing: 1,
      exempt: 0,
      declarations: [],
    };
  }
  const counted = declarations.map(countDeclaration);
  const passing = counted.reduce((sum, entry) => sum + entry.passing, 0);
  const failing = counted.reduce((sum, entry) => sum + entry.failing, 0);
  const exempt = counted.reduce((sum, entry) => sum + entry.exempt, 0);
  if (passing === 0 && failing === 0) return { ok: false, reason: 'nothing-printable' };
  const verdict =
    worstBy(
      counted.map((entry) => entry.verdict),
      [...DECLARATION_STOP_PRECEDENCE, ...CASE_VERDICT_PRECEDENCE],
    ) ?? 'match';
  return { ok: true, verdict, passing, failing, exempt, declarations: counted };
}
