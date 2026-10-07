/**
 * The counting algebra (specs/22 M16 P4): `13` F-TEST-9's Verdicts and Counting section, and
 * `process/SPEC-QUESTIONS.md` Q294 Decision 4's two closed holes.
 *
 * @see specs/13-frameworks-testing-and-debugging.md F-TEST-9
 * @see process/SPEC-QUESTIONS.md Q294 Decision 4
 */
import { describe, expect, it } from 'vitest';

import {
  countParityResults,
  nothingComparedDeclaration,
  type CaseVerdict,
  type DeclarationResult,
} from '../../../src/commands/parity/counting.ts';

function ran(cases: readonly ('exempt' | CaseVerdict)[]): DeclarationResult {
  return { kind: 'ran', cases };
}

describe('countParityResults: every case verdict individually reaches failing (specs/22 M16 P4)', () => {
  it.each(['error', 'unclean', 'unstable', 'mismatch'] as const)(
    'a case that is %s counts as 1 failing, 0 passing, declaration verdict %s',
    (verdict) => {
      const result = countParityResults([ran([verdict])]);
      expect(result).toEqual({
        ok: true,
        verdict,
        passing: 0,
        failing: 1,
        exempt: 0,
        declarations: [{ verdict, passing: 0, failing: 1, exempt: 0 }],
      });
    },
  );

  it('a case that is match counts as 1 passing, 0 failing', () => {
    const result = countParityResults([ran(['match'])]);
    expect(result).toMatchObject({ ok: true, passing: 1, failing: 0, verdict: 'match' });
  });
});

describe('countParityResults: a stopped declaration contributes exactly ONE failing (specs/22 M16 P4)', () => {
  it.each(['invalid', 'expired', 'missing', 'ambiguous'] as const)(
    'a declaration stopped as %s counts 1 failing regardless of how many cases it would have had',
    (verdict) => {
      const result = countParityResults([{ kind: 'stopped', verdict }]);
      expect(result).toEqual({
        ok: true,
        verdict,
        passing: 0,
        failing: 1,
        exempt: 0,
        declarations: [{ verdict, passing: 0, failing: 1, exempt: 0 }],
      });
    },
  );

  it('a declaration stopped before running contributes 1 failing no matter how many surfaces it declared', () => {
    // The spec text: "plus one for each declaration that was stopped at declaration level, HOWEVER
    // MANY CASES IT DECLARES." This models that by construction: a `stopped` result carries no case
    // list at all (the verdict is decided before any case runs), so there is no "number of cases" to
    // multiply by in the first place -- the shape itself makes the hole Q294 Decision 4 found
    // structurally unreachable rather than merely asserting the count is always 1.
    const result = countParityResults([{ kind: 'stopped', verdict: 'invalid' }]);
    expect(result).toMatchObject({ failing: 1 });
  });
});

describe('countParityResults: exempt cases count in their own bucket (specs/22 M16 P4)', () => {
  it('an exempt case is never counted as passing or failing', () => {
    const result = countParityResults([ran(['match', 'exempt', 'exempt'])]);
    expect(result).toMatchObject({ ok: true, passing: 1, failing: 0, exempt: 2 });
  });

  it('all-exempt is nothing-compared: use nothingComparedDeclaration rather than an all-exempt "ran"', () => {
    // `13` F-TEST-9: "a declaration with no surface that is not exempt is `invalid` as
    // `nothing-compared`." This is the declaration-level shape for that -- an all-exempt declaration
    // never reaches `countParityResults` as `kind: 'ran'` with zero non-exempt cases; it is built as
    // this `stopped`/`invalid` shape instead, by whichever piece decided every surface was exempt.
    const declaration = nothingComparedDeclaration(3);
    expect(declaration).toEqual({ verdict: 'invalid', passing: 0, failing: 1, exempt: 3 });
    const result = countParityResults([{ kind: 'stopped', verdict: 'invalid' }]);
    expect(result).toMatchObject({ ok: true, verdict: 'invalid', passing: 0, failing: 1 });
  });
});

describe('countParityResults: the 0-passing-0-failing refusal, its own explicit test (specs/22 M16 P4)', () => {
  it('refuses outright (ok: false) rather than silently passing on nothing', () => {
    // Unreachable from a well-formed declaration result by this module's own invariant (every `ran`
    // declaration has at least one non-exempt case, so it always contributes to passing or failing;
    // every `stopped` declaration contributes exactly one failing) -- checked explicitly anyway, per
    // Q294 Decision 4's own stated reason: "so that a later change to the counting cannot bring the
    // hole back silently." Constructed here by handing in a `ran` declaration with only exempt cases,
    // bypassing that invariant on purpose to prove the refusal actually fires rather than assuming it
    // is unreachable.
    const result = countParityResults([ran(['exempt', 'exempt'])]);
    expect(result).toEqual({ ok: false, reason: 'nothing-printable' });
  });

  it('is refused even across multiple declarations that each individually print nothing', () => {
    const result = countParityResults([ran(['exempt']), ran(['exempt'])]);
    expect(result).toEqual({ ok: false, reason: 'nothing-printable' });
  });
});

describe('countParityResults: no declarations at all carries real, counted numbers (specs/22 M16 P4)', () => {
  it(
    'an empty declarations list is ok:true, verdict invalid, reason no-declarations, with the ' +
      'EXACT pinned numbers -- not a contentless refusal (a critic-found gap: the type previously ' +
      'gave this case nowhere to carry them)',
    () => {
      // `13` F-TEST-9, in so many words: "A check with no declaration at all counts one failing and
      // no passing, and its overall verdict is `invalid` with the reason `no-declarations`."
      // `PLAN-M16.md` P7's own Mandate restates it as a sentence deliberately separate from its own
      // refusal enumeration: "Zero declarations is one failing with the reason `no-declarations`,
      // not a pass." Both describe a REAL, printable result, never the `ok: false` shape
      // `nothing-printable` uses.
      expect(countParityResults([])).toEqual({
        ok: true,
        verdict: 'invalid',
        reason: 'no-declarations',
        passing: 0,
        failing: 1,
        exempt: 0,
        declarations: [],
      });
    },
  );

  it('is distinct in SHAPE from nothing-printable, which stays a contentless ok:false refusal', () => {
    const noDeclarations = countParityResults([]);
    const nothingPrintable = countParityResults([ran(['exempt'])]);
    expect(noDeclarations.ok).toBe(true);
    expect(nothingPrintable).toEqual({ ok: false, reason: 'nothing-printable' });
  });
});

describe('countParityResults: totals and overall precedence over several declarations (specs/22 M16 P4)', () => {
  it('sums passing/failing/exempt across declarations', () => {
    const result = countParityResults([ran(['match', 'match']), ran(['mismatch', 'exempt'])]);
    expect(result).toMatchObject({ ok: true, passing: 2, failing: 1, exempt: 1 });
  });

  it('the overall verdict is the worst declaration verdict, by the total nine-verdict precedence', () => {
    const result = countParityResults([
      ran(['match']),
      { kind: 'stopped', verdict: 'expired' },
      ran(['mismatch']),
    ]);
    // `expired` outranks `mismatch` in `13` F-TEST-9's total order (invalid, expired, missing,
    // ambiguous, error, unclean, unstable, mismatch, match), so it is the overall verdict even though
    // it is listed second.
    expect(result).toMatchObject({ ok: true, verdict: 'expired' });
  });

  it(
    'two DIFFERENT stopped declarations are ordered correctly against EACH OTHER, not merely ' +
      'against a case verdict (pins DECLARATION_STOP_PRECEDENCE’s own internal order, which no ' +
      'other test exercised: swapping it was a silent mutation survivor)',
    () => {
      // `invalid` outranks `ambiguous` in `13` F-TEST-9's total order (invalid, expired, missing,
      // ambiguous, ...). Listed `ambiguous` FIRST here so a correct reduction has to actually look at
      // precedence, not just report whichever declaration happened to be listed first or last.
      const invalidBeatsAmbiguous = countParityResults([
        { kind: 'stopped', verdict: 'ambiguous' },
        { kind: 'stopped', verdict: 'invalid' },
      ]);
      expect(invalidBeatsAmbiguous).toMatchObject({ ok: true, verdict: 'invalid' });

      // `missing` outranks `ambiguous` too (missing, THEN ambiguous in the declared order).
      const missingBeatsAmbiguous = countParityResults([
        { kind: 'stopped', verdict: 'ambiguous' },
        { kind: 'stopped', verdict: 'missing' },
      ]);
      expect(missingBeatsAmbiguous).toMatchObject({ ok: true, verdict: 'missing' });
    },
  );

  it('a declaration itself reduces its cases by the identical precedence (a mismatch beats a match)', () => {
    const result = countParityResults([ran(['match', 'mismatch', 'match'])]);
    expect(result).toMatchObject({
      ok: true,
      verdict: 'mismatch',
      declarations: [{ verdict: 'mismatch', passing: 2, failing: 1, exempt: 0 }],
    });
  });
});
