/**
 * `applyNormalizeRulesToTextBounded` — the wall-clock budget, enforced by a killable worker thread,
 * `specs/22` M17 P14 adds around the whole ordered normalize-rule application for one text target.
 *
 * @see specs/13-frameworks-testing-and-debugging.md F-TEST-9
 * @see process/plans/PLAN-M17.md P14
 */
import { describe, expect, it } from 'vitest';

import {
  applyNormalizeRulesToTextBounded,
  DEFAULT_NORMALIZE_BUDGET_MS,
} from '../../../src/commands/parity/normalize-budget.ts';

describe('applyNormalizeRulesToTextBounded: the fast path (specs/22 M17 P14)', () => {
  it('returns the identical outcome applyNormalizeRulesToText itself would, for an ordinary rule list', () => {
    const outcome = applyNormalizeRulesToTextBounded(
      'Line1\r\nLine2  \r\n',
      [{ rule: 'line-endings' }, { rule: 'trim-trailing-whitespace' }],
      {},
      1000,
    );
    expect(outcome).toEqual({ timedOut: false, ok: true, text: 'Line1\nLine2\n' });
  });

  it('propagates an ordinary rule-application failure unchanged (RUN-130’s own "rule-failed" shape)', () => {
    const outcome = applyNormalizeRulesToTextBounded(
      'not json',
      [{ rule: 'json-canonical' }],
      {},
      1000,
    );
    expect(outcome).toEqual({
      timedOut: false,
      ok: false,
      kind: 'rule-failed',
      failure: { rule: 'json-canonical', detail: 'does not parse as JSON' },
    });
  });

  it('propagates the erase-everything guard unchanged', () => {
    const outcome = applyNormalizeRulesToTextBounded(
      'hello',
      [{ rule: 'replace', pattern: '.*', replacement: '' }],
      {},
      1000,
    );
    expect(outcome).toEqual({ timedOut: false, ok: false, kind: 'erased', rule: 'replace' });
  });

  it('the exported default really is specs/13 F-TEST-9’s own stated 5000ms, not a smaller test value', () => {
    expect(DEFAULT_NORMALIZE_BUDGET_MS).toBe(5000);
  });
});

describe(
  'applyNormalizeRulesToTextBounded (specs/22 M17 P14): a catastrophic pattern is refused by ' +
    'TIME, not hung',
  () => {
    it(
      'a flat-adjacent-unbounded-groups pattern that defeats replace-lint.ts’s own static shape ' +
        'lint (no nested quantifier at all -- that lint’s own disclosed gap) times out within the ' +
        'stated budget, never hanging the calling thread',
      () => {
        // The exact shape `replace-lint.ts`'s own file header names as independently reproduced and
        // NOT caught by `isPathologicalReplacePattern`: 20 flat, adjacent (never nested) unbounded
        // groups, then a literal that cannot match, against a run of 33 of the one character every
        // group can consume. `isPathologicalReplacePattern` confirms this pattern passes the lint
        // clean (asserted directly below, so this test does not merely assume the premise).
        const pattern = `${'(a*)'.repeat(20)}b`;
        const input = 'a'.repeat(33);
        const budgetMs = 200;

        const started = Date.now();
        const outcome = applyNormalizeRulesToTextBounded(
          input,
          [{ rule: 'replace', pattern, replacement: 'X' }],
          {},
          budgetMs,
        );
        const elapsedMs = Date.now() - started;

        expect(outcome).toEqual({ timedOut: true });
        // Bounded close to the stated budget, not merely "eventually returned" -- a generous upper
        // bound (worker start/teardown overhead included) that still proves this did not wait for
        // the real catastrophic backtrack to finish on its own (which this module's own manual,
        // interactive reproduction left running for minutes with no sign of returning).
        expect(elapsedMs).toBeLessThan(budgetMs + 3000);
      },
    );

    it(
      'confirms the premise directly: the pathological pattern above really does pass ' +
        'isPathologicalReplacePattern’s own static lint clean (this is replace-lint.ts’s own ' +
        'disclosed gap, not a pattern CFG-511 would have refused first)',
      async () => {
        const { isPathologicalReplacePattern } =
          await import('../../../src/commands/parity/replace-lint.ts');
        expect(isPathologicalReplacePattern(`${'(a*)'.repeat(20)}b`)).toBe(false);
      },
    );

    it('a second, independent catastrophic shape (nested quantifier, the kind CFG-511 DOES catch) also times out, not hangs', () => {
      // `(a+)+` IS caught by `isPathologicalReplacePattern` at declaration-load time (CFG-511) -- but
      // this module's own job is a RUNTIME backstop for whatever reaches it regardless, so it is
      // proven here too, independent of whether a static lint would have refused it first.
      const budgetMs = 200;
      const started = Date.now();
      const outcome = applyNormalizeRulesToTextBounded(
        'a'.repeat(40) + '!',
        [{ rule: 'replace', pattern: '(a+)+$', replacement: 'X' }],
        {},
        budgetMs,
      );
      const elapsedMs = Date.now() - started;
      expect(outcome).toEqual({ timedOut: true });
      expect(elapsedMs).toBeLessThan(budgetMs + 3000);
    });
  },
);
