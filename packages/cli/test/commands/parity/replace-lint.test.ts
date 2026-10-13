/**
 * The catastrophic-backtracking lint on a `replace` rule's pattern (specs/22 M16 P4) — conservative
 * nested-quantifier SHAPE detection, never a timing proof.
 *
 * @see specs/13-frameworks-testing-and-debugging.md F-TEST-9
 */
import { describe, expect, it } from 'vitest';

import { ForgeError } from '@forge/core/errors';

import {
  applyNormalizeRulesToText,
  rewriteRootPaths,
} from '../../../src/commands/parity/normalize.ts';
import {
  assertNoConflictingContentDiscardingRules,
  assertNoReplaceRuleOnRootRewrittenSurface,
  assertNoRepeatedRuleKindInScope,
  assertParityDeclarationPatternsSafe,
  collectContentDiscardingConflicts,
  collectReplaceOnRootRewrittenSurfaceConflicts,
  collectRepeatedRuleKindConflicts,
  hasConflictingContentDiscardingRules,
  hasRepeatedRuleKindInScope,
  isPathologicalReplacePattern,
  lintParityDeclarationReplacePatterns,
} from '../../../src/commands/parity/replace-lint.ts';
import { minimalCase, minimalDeclaration, minimalSurface } from './fixtures.ts';

const ESC = '\x1b';

describe('isPathologicalReplacePattern: flags nested variable-quantified atoms (specs/22 M16 P4)', () => {
  it.each([
    ['(a+)+', true, 'the textbook case: a quantified group containing a quantified literal'],
    ['([a-z]+)*', true, 'a quantified group containing a quantified character class'],
    ['(\\d*)+', true, 'a quantified group containing a quantified shorthand class'],
    ['(.+)+', true, 'a quantified group containing a quantified wildcard'],
    ['((a+)+)+', true, 'the pathological shape nested two groups deep'],
    ['x(y(a+)+)z', true, 'a pathological inner group that does not itself wrap the whole pattern'],
    ['(ab)+', false, 'a quantified group with no inner quantifier at all — linear, not flagged'],
    ['^[a-z0-9][a-z0-9-]*$', false, 'a flat quantified character class with no group at all'],
    [
      '(a|b)+',
      false,
      'alternation with no nested quantifier — outside this conservative lint’s own reach',
    ],
    ['a+', false, 'a bare quantified atom with no enclosing group'],
    ['', false, 'the empty pattern'],
    ['(a{2,})+', true, 'a brace quantifier with no upper bound ("{n,}") counts as variable'],
    ['(a{2,5})+', true, 'a brace range where the upper bound exceeds the lower bound is variable'],
    [
      '(a{3})+',
      false,
      'an EXACT brace count ("{n}") is not variable — bounded, cannot nest unsafely',
    ],
    ['(a{2,2})+', false, 'a brace range whose bounds are equal is exact in effect, not variable'],
  ])('%j -> %s (%s)', (pattern, expected) => {
    expect(isPathologicalReplacePattern(pattern)).toBe(expected);
  });

  it(
    'refuses a pathologically DEEP pattern cleanly, rather than crashing the harness it exists to ' +
      'protect — a critic-found stack overflow, now capped',
    () => {
      // A pattern nested 20,000 parentheses deep recurses once per level and exhausts the call
      // stack with a bare, uncaught RangeError before `MAX_NESTING_DEPTH` was added — reproduced
      // against the pre-fix code and confirmed to throw for exactly that reason (see this piece's
      // own mutation evidence). The function whose entire job is protecting a reviewed declaration
      // from a dangerous pattern must never itself crash on one: it must return `true` (refuse)
      // cleanly instead.
      const deeplyNested = '('.repeat(20000) + 'a' + ')'.repeat(20000);
      expect(() => isPathologicalReplacePattern(deeplyNested)).not.toThrow();
      expect(isPathologicalReplacePattern(deeplyNested)).toBe(true);
    },
  );

  it('still analyses ordinary, shallowly-nested patterns correctly (the depth cap does not over-refuse normal patterns)', () => {
    // Four levels of USELESS wrapping around a bare `a+`, with no quantifier on any of the three
    // outer groups: safe and linear (nothing actually repeats the wrapped group), computed by hand
    // the same way the top-of-file table's own `(ab)+` row is -- verifies the depth cap did not turn
    // "merely deeply parenthesised" into a false positive.
    expect(isPathologicalReplacePattern('((((a+))))')).toBe(false);
    expect(isPathologicalReplacePattern('(ab(cd)ef)+')).toBe(false);
    // Three levels deep, well under the cap, and genuinely pathological: the middle group "(a+)+" is
    // already the textbook shape, now wrapped in one further quantified group.
    expect(isPathologicalReplacePattern('((a+)+)+')).toBe(true);
  });
});

describe('lintParityDeclarationReplacePatterns: walks every surface/case/rule (specs/22 M16 P4)', () => {
  it('reports no problems for a declaration with only safe patterns', () => {
    const declaration = minimalDeclaration({
      surfaces: {
        process: minimalSurface({
          cases: [
            minimalCase({ normalize: [{ rule: 'replace', pattern: 'foo', replacement: 'bar' }] }),
          ],
        }),
      },
    });
    expect(lintParityDeclarationReplacePatterns(declaration)).toEqual([]);
  });

  it('locates a pathological pattern with a dotted key naming its exact position', () => {
    const declaration = minimalDeclaration({
      surfaces: {
        process: minimalSurface({
          cases: [
            minimalCase({ normalize: [{ rule: 'line-endings' }] }),
            minimalCase({ normalize: [{ rule: 'replace', pattern: '(a+)+', replacement: '' }] }),
          ],
        }),
      },
    });
    const problems = lintParityDeclarationReplacePatterns(declaration);
    expect(problems).toHaveLength(1);
    expect(problems[0]?.key).toBe('surfaces.process.cases[1].normalize[0].pattern');
    expect(problems[0]?.pattern).toBe('(a+)+');
  });

  it('is run once per declaration: two cases sharing one pathological pattern both surface', () => {
    const declaration = minimalDeclaration({
      surfaces: {
        process: minimalSurface({
          cases: [
            minimalCase({ normalize: [{ rule: 'replace', pattern: '(a+)+', replacement: '' }] }),
            minimalCase({ normalize: [{ rule: 'replace', pattern: '(a+)+', replacement: '' }] }),
          ],
        }),
      },
    });
    expect(lintParityDeclarationReplacePatterns(declaration)).toHaveLength(2);
  });
});

describe('assertParityDeclarationPatternsSafe: throws CFG-511 naming the first problem (specs/22 M16 P4)', () => {
  it('returns normally for a declaration with no pathological pattern', () => {
    const declaration = minimalDeclaration();
    expect(() => {
      assertParityDeclarationPatternsSafe(declaration);
    }).not.toThrow();
  });

  it('throws a typed ForgeError CFG-511, never a bare exception', () => {
    const declaration = minimalDeclaration({
      surfaces: {
        process: minimalSurface({
          cases: [
            minimalCase({ normalize: [{ rule: 'replace', pattern: '(a+)+', replacement: '' }] }),
          ],
        }),
      },
    });
    let caught: unknown;
    try {
      assertParityDeclarationPatternsSafe(declaration);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ForgeError);
    expect((caught as ForgeError).code).toBe('CFG-511');
    expect((caught as ForgeError).details['key']).toBe(
      'surfaces.process.cases[0].normalize[0].pattern',
    );
  });
});

describe('hasConflictingContentDiscardingRules: the round-3 chained-rule finding (specs/22 M16 P4)', () => {
  it('flags repro A (two unscoped replace rules, each individually safe)', () => {
    const rules = [
      { rule: 'replace' as const, pattern: '^.{4}', replacement: 'PPPP' },
      { rule: 'replace' as const, pattern: '.{4}$', replacement: 'QQQQ' },
    ];
    expect(hasConflictingContentDiscardingRules(rules)).toBe(true);
  });

  it(
    'repro A, independent of the check above: the chain really does collapse three different ' +
      'inputs to one (this test does not call the check at all, so a mutation that disables the ' +
      'check cannot hide this)',
    () => {
      // The real collapse, demonstrated directly against `applyNormalizeRulesToText` (not merely
      // "the new check says true"): three different 5-character strings, chained through BOTH
      // rules with no guard in the way, all become the identical "PQQQQ". Neither rule alone trips
      // the erase-everything guard (each leaves exactly 1 byte of real input after its own step),
      // which is exactly why this needed a declaration-shape restriction rather than a per-rule one.
      const rules = [
        { rule: 'replace' as const, pattern: '^.{4}', replacement: 'PPPP' },
        { rule: 'replace' as const, pattern: '.{4}$', replacement: 'QQQQ' },
      ];
      const collapse = (input: string): unknown => applyNormalizeRulesToText(input, rules, {});
      expect(collapse('hello')).toEqual({ ok: true, text: 'PQQQQ' });
      expect(collapse('world')).toEqual({ ok: true, text: 'PQQQQ' });
      expect(collapse('zebra')).toEqual({ ok: true, text: 'PQQQQ' });
    },
  );

  it('flags repro B (sort-lines then a content-dependent-position replace)', () => {
    const rules = [
      { rule: 'sort-lines' as const },
      { rule: 'replace' as const, pattern: '\\n.*$', replacement: 'X' },
    ];
    expect(hasConflictingContentDiscardingRules(rules)).toBe(true);
  });

  it(
    'repro B, independent of the check above: two genuinely different diagnostic lines collapse ' +
      'to the same bytes (this test does not call the check at all)',
    () => {
      const rules = [
        { rule: 'sort-lines' as const },
        { rule: 'replace' as const, pattern: '\\n.*$', replacement: 'X' },
      ];
      const collapse = (input: string): unknown => applyNormalizeRulesToText(input, rules, {});
      const reference = collapse('ERROR: disk full\nAAA_STATUS_OK');
      const candidate = collapse('ERROR: timeout!!\nAAA_STATUS_OK');
      expect(reference).toEqual({ ok: true, text: 'AAA_STATUS_OKX' });
      expect(candidate).toEqual({ ok: true, text: 'AAA_STATUS_OKX' });
      expect(reference).toEqual(candidate); // genuinely different diagnostics, identical bytes
    },
  );

  it('flags repro C (json-canonical then a replace targeting the alphabetically-last key)', () => {
    const rules = [
      { rule: 'json-canonical' as const },
      { rule: 'replace' as const, pattern: ',"[^"]*":"[^"]*"\\}$', replacement: '}' },
    ];
    expect(hasConflictingContentDiscardingRules(rules)).toBe(true);
  });

  it(
    'repro C, independent of the check above: two genuinely different error messages collapse to ' +
      'the identical bytes once json-canonical makes which key is last name-dependent, not ' +
      'value-dependent (this test does not call the check at all)',
    () => {
      const rules = [
        { rule: 'json-canonical' as const },
        { rule: 'replace' as const, pattern: ',"[^"]*":"[^"]*"\\}$', replacement: '}' },
      ];
      const collapse = (input: string): unknown => applyNormalizeRulesToText(input, rules, {});
      const reference = collapse('{"errorMsg":"disk full","aaaStatusOk":"OK"}');
      const candidate = collapse('{"errorMsg":"timeout!!!","aaaStatusOk":"OK"}');
      expect(reference).toEqual({ ok: true, text: '{"aaaStatusOk":"OK"}' });
      expect(candidate).toEqual({ ok: true, text: '{"aaaStatusOk":"OK"}' });
      expect(reference).toEqual(candidate); // genuinely different error messages, identical bytes
    },
  );

  it('does NOT flag a single content-discarding rule freely combined with structural rules (no over-restriction)', () => {
    // The positive control: `replace` + `line-endings` + `strip-ansi`, one implicit scope (all
    // unscoped), must still be accepted -- the restriction triggers only on TWO OR MORE
    // content-discarding rules sharing a scope, never on ordinary single-rule use alongside any
    // number of structural rules.
    const rules = [
      { rule: 'line-endings' as const },
      { rule: 'strip-ansi' as const },
      { rule: 'replace' as const, pattern: 'secret', replacement: 'REDACTED' },
    ];
    expect(hasConflictingContentDiscardingRules(rules)).toBe(false);
    // And it genuinely still works end to end: all three rules apply correctly together.
    const outcome = applyNormalizeRulesToText('line1\r\nsecret\x1b[31m-value\x1b[0m', rules, {});
    expect(outcome).toEqual({ ok: true, text: 'line1\nREDACTED-value' });
  });

  it.each([
    ['replace', { rule: 'replace' as const, pattern: 'x', replacement: 'y' }],
    ['sort-lines', { rule: 'sort-lines' as const }],
    ['trim-trailing-whitespace', { rule: 'trim-trailing-whitespace' as const }],
    ['json-canonical', { rule: 'json-canonical' as const }],
    ['ignore-json-pointers', { rule: 'ignore-json-pointers' as const, pointers: ['/x'] }],
  ] as const)(
    'each of the five now-restricted kinds (%s) used ALONE, freely combined with the one ' +
      'permitted structural pair, is not flagged (no over-restriction from round 6’s widening)',
    (_name, contentDiscardingRule) => {
      const rules = [
        { rule: 'line-endings' as const },
        { rule: 'strip-ansi' as const },
        contentDiscardingRule,
      ];
      expect(hasConflictingContentDiscardingRules(rules)).toBe(false);
    },
  );

  it('does not flag two content-discarding rules scoped to DIFFERENT, non-overlapping targets', () => {
    const rules = [
      { rule: 'replace' as const, pattern: 'a', replacement: 'b', stream: 'stdout' as const },
      { rule: 'replace' as const, pattern: 'c', replacement: 'd', stream: 'stderr' as const },
    ];
    expect(hasConflictingContentDiscardingRules(rules)).toBe(false);
  });

  it('flags two content-discarding rules explicitly scoped to the identical stream', () => {
    const rules = [
      { rule: 'replace' as const, pattern: 'a', replacement: 'b', stream: 'stdout' as const },
      { rule: 'trim-trailing-whitespace' as const },
    ];
    // `trim-trailing-whitespace` has no scope field at all, so it is always unscoped -- it reaches
    // EVERY target, `stdout` included, so it collides with the stdout-scoped `replace` too.
    expect(hasConflictingContentDiscardingRules(rules)).toBe(true);
  });

  it('is a no-op for an empty or all-structural normalize list', () => {
    // Only `line-endings` and `strip-ansi` remain "structural" as of round 6 -- `json-canonical`
    // and `ignore-json-pointers` moved into the content-discarding set (Repro C, this file's own
    // `hasConflictingContentDiscardingRules` doc comment has the full account), so a fixture using
    // either of those two here would no longer be "all-structural".
    expect(hasConflictingContentDiscardingRules([])).toBe(false);
    expect(
      hasConflictingContentDiscardingRules([{ rule: 'line-endings' }, { rule: 'strip-ansi' }]),
    ).toBe(false);
  });
});

describe('collectContentDiscardingConflicts / assertNoConflictingContentDiscardingRules (specs/22 M16 P4)', () => {
  it('locates a conflicting case with a dotted key naming the normalize list itself', () => {
    const declaration = minimalDeclaration({
      surfaces: {
        process: minimalSurface({
          cases: [
            minimalCase({ normalize: [{ rule: 'line-endings' }] }),
            minimalCase({
              normalize: [
                { rule: 'replace', pattern: '^.{4}', replacement: 'PPPP' },
                { rule: 'replace', pattern: '.{4}$', replacement: 'QQQQ' },
              ],
            }),
          ],
        }),
      },
    });
    const conflicts = collectContentDiscardingConflicts(declaration);
    expect(conflicts).toEqual([{ key: 'surfaces.process.cases[1].normalize' }]);
  });

  it('reports no conflicts for a declaration using only single content-discarding rules', () => {
    const declaration = minimalDeclaration({
      surfaces: {
        process: minimalSurface({
          cases: [
            minimalCase({ normalize: [{ rule: 'replace', pattern: 'a', replacement: 'b' }] }),
          ],
        }),
      },
    });
    expect(collectContentDiscardingConflicts(declaration)).toEqual([]);
  });

  it(
    'specs/22 M17 P14: sort-lines + trim-trailing-whitespace no longer throws -- round 4 proved this ' +
      'exact pair harmless and M16 P4 refused it anyway as a deliberate conservative cost; M17 P14 ' +
      'acts on that proof instead of merely accepting the cost (see replace-lint.ts’s own doc comment ' +
      'for the proof)',
    () => {
      const declaration = minimalDeclaration({
        surfaces: {
          process: minimalSurface({
            cases: [
              minimalCase({
                normalize: [{ rule: 'sort-lines' }, { rule: 'trim-trailing-whitespace' }],
              }),
            ],
          }),
        },
      });
      expect(() => {
        assertNoConflictingContentDiscardingRules(declaration);
      }).not.toThrow();
      expect(collectContentDiscardingConflicts(declaration)).toEqual([]);
      // In BOTH orders -- the proof does not depend on which the declaration author wrote.
      const reversed = minimalDeclaration({
        surfaces: {
          process: minimalSurface({
            cases: [
              minimalCase({
                normalize: [{ rule: 'trim-trailing-whitespace' }, { rule: 'sort-lines' }],
              }),
            ],
          }),
        },
      });
      expect(collectContentDiscardingConflicts(reversed)).toEqual([]);
    },
  );

  it(
    'specs/22 M17 P14: json-canonical + ignore-json-pointers no longer throws -- the second proven-' +
      'safe pair (Q298 Decision 3’s second half), exempted for the identical reason',
    () => {
      const declaration = minimalDeclaration({
        surfaces: {
          process: minimalSurface({
            cases: [
              minimalCase({
                normalize: [
                  { rule: 'json-canonical' },
                  { rule: 'ignore-json-pointers', pointers: ['/x'] },
                ],
              }),
            ],
          }),
        },
      });
      expect(() => {
        assertNoConflictingContentDiscardingRules(declaration);
      }).not.toThrow();
      expect(collectContentDiscardingConflicts(declaration)).toEqual([]);
    },
  );

  it(
    'specs/22 M17 P14: a THIRD content-discarding rule alongside a proven-safe pair still throws -- ' +
      'the exemption covers exactly the two-member pair, never a superset',
    () => {
      const declaration = minimalDeclaration({
        surfaces: {
          process: minimalSurface({
            cases: [
              minimalCase({
                normalize: [
                  { rule: 'sort-lines' },
                  { rule: 'trim-trailing-whitespace' },
                  { rule: 'json-canonical' },
                ],
              }),
            ],
          }),
        },
      });
      expect(collectContentDiscardingConflicts(declaration)).toEqual([
        { key: 'surfaces.process.cases[0].normalize' },
      ]);
    },
  );

  it(
    'specs/22 M17 P14: mixing members of the TWO different safe pairs is not itself proven safe, and ' +
      'still throws -- the exemption is keyed to each exact pair, not to "any of these four kinds"',
    () => {
      const declaration = minimalDeclaration({
        surfaces: {
          process: minimalSurface({
            cases: [
              minimalCase({
                normalize: [{ rule: 'sort-lines' }, { rule: 'json-canonical' }],
              }),
            ],
          }),
        },
      });
      expect(collectContentDiscardingConflicts(declaration)).toEqual([
        { key: 'surfaces.process.cases[0].normalize' },
      ]);
    },
  );

  it(
    'specs/22 M17 P14: the proof holds directly against applyNormalizeRulesToText, not just against ' +
      'the check -- two genuinely different inputs stay genuinely different after BOTH orders of ' +
      'each proven-safe pair (this test does not call the check at all, so a mutation that disables ' +
      'the check cannot hide a regression here)',
    () => {
      const sortThenTrim = [
        { rule: 'sort-lines' as const },
        { rule: 'trim-trailing-whitespace' as const },
      ];
      const trimThenSort = [
        { rule: 'trim-trailing-whitespace' as const },
        { rule: 'sort-lines' as const },
      ];
      // Shaped exactly like the repros this file's own CONTENT_DISCARDING_RULES doc comment warns
      // about (one line genuinely differs), to confirm the safe pair does NOT reproduce them.
      const a = 'ERROR: disk full   \nAAA_STATUS_OK   ';
      const b = 'ERROR: timeout!!   \nAAA_STATUS_OK   ';
      for (const rules of [sortThenTrim, trimThenSort]) {
        const resultA = applyNormalizeRulesToText(a, rules, {});
        const resultB = applyNormalizeRulesToText(b, rules, {});
        expect(resultA).toEqual({ ok: true, text: 'AAA_STATUS_OK\nERROR: disk full' });
        expect(resultB).toEqual({ ok: true, text: 'AAA_STATUS_OK\nERROR: timeout!!' });
        expect(resultA).not.toEqual(resultB); // genuinely different inputs, still different output
      }

      const canonicalThenIgnore = [
        { rule: 'json-canonical' as const },
        { rule: 'ignore-json-pointers' as const, pointers: ['/aaaStatusOk'] },
      ];
      const ignoreThenCanonical = [
        { rule: 'ignore-json-pointers' as const, pointers: ['/aaaStatusOk'] },
        { rule: 'json-canonical' as const },
      ];
      const c = '{"errorMsg":"disk full","aaaStatusOk":"OK"}';
      const d = '{"errorMsg":"timeout!!!","aaaStatusOk":"OK"}';
      for (const rules of [canonicalThenIgnore, ignoreThenCanonical]) {
        const resultC = applyNormalizeRulesToText(c, rules, {});
        const resultD = applyNormalizeRulesToText(d, rules, {});
        expect(resultC).toEqual({ ok: true, text: '{"errorMsg":"disk full"}' });
        expect(resultD).toEqual({ ok: true, text: '{"errorMsg":"timeout!!!"}' });
        expect(resultC).not.toEqual(resultD); // genuinely different inputs, still different output
      }
    },
  );

  it('returns normally for a declaration with no conflicting case', () => {
    const declaration = minimalDeclaration();
    expect(() => {
      assertNoConflictingContentDiscardingRules(declaration);
    }).not.toThrow();
  });

  it(
    'is a no-op for a library-surface case carrying two content-discarding rules, confirmed (not ' +
      'merely assumed) harmless: those rules already have zero effect on a library value',
    () => {
      // `sort-lines` + `trim-trailing-whitespace` is now one of the two proven-safe pairs
      // (`specs/22` M17 P14, above), so it no longer demonstrates "library gets no special case" on
      // its own -- it would read `[]` on ANY surface now. `replace` + `sort-lines` is NOT a proven-
      // safe pair (only `replace`-free combinations are ever exempted), so it still exercises the
      // real claim this test makes: library applies ONLY `ignore-json-pointers` to its structured
      // result (`compare.ts`'s own `normalizeLibraryOrThrow`) -- `replace`/`sort-lines` are already
      // complete no-ops there -- and this function does NOT special-case `library` anyway: it still
      // refuses this combination (simpler, uniform, matches `collectReplacePatterns`'s own surface-
      // agnostic walk, and costs nothing real since no legitimate declaration needs two content-
      // discarding rules on a surface where neither does anything).
      const declaration = minimalDeclaration({
        surfaces: {
          library: minimalSurface({
            run: 'node probe.mjs',
            cases: [
              minimalCase({
                normalize: [
                  { rule: 'replace', pattern: 'a', replacement: 'b' },
                  { rule: 'sort-lines' },
                ],
              }),
            ],
          }),
        },
      });
      const conflicts = collectContentDiscardingConflicts(declaration);
      expect(conflicts).toEqual([{ key: 'surfaces.library.cases[0].normalize' }]);
    },
  );
});

describe('hasRepeatedRuleKindInScope: the round-5 same-kind-twice finding (specs/22 M16 P4)', () => {
  it('flags strip-ansi applied twice, unscoped (the round-5 repro rule list)', () => {
    const rules = [{ rule: 'strip-ansi' as const }, { rule: 'strip-ansi' as const }];
    expect(hasRepeatedRuleKindInScope(rules)).toBe(true);
  });

  it(
    'the round-5 repro, independent of the check above: a single strip-ansi pass genuinely ' +
      'distinguishes o1/o2, but a second pass collapses both to the same bytes (this test does ' +
      'not call the check at all, so a mutation that disables the check cannot hide this)',
    () => {
      // Independently re-verified (not merely taken on report), and reproduces identically against
      // the OLD, unbounded [@-~] final-byte range too -- this finding is unrelated to round 4's
      // allowlist narrowing. A dangling, never-completed `ESC[<params>` prefix (interrupted by a
      // second ESC before any valid final byte) sits before the only COMPLETE CSI sequence either
      // string contains (`ESC[31m`); removing that sequence on the first pass makes the dangling
      // prefix newly adjacent to literal text ('A' from "After"), which a second pass then reads as
      // that prefix's own final byte -- a "sequence" that never existed in the original bytes.
      const o1 = `${ESC}[1${ESC}[31mAfter`;
      const o2 = `${ESC}[99${ESC}[31mAfter`;
      const rules = [{ rule: 'strip-ansi' as const }, { rule: 'strip-ansi' as const }];

      const onePass = (input: string): unknown =>
        applyNormalizeRulesToText(input, [{ rule: 'strip-ansi' }], {});
      const singlePassO1 = onePass(o1);
      const singlePassO2 = onePass(o2);
      expect(singlePassO1).toEqual({ ok: true, text: `${ESC}[1After` });
      expect(singlePassO2).toEqual({ ok: true, text: `${ESC}[99After` });
      expect(singlePassO1).not.toEqual(singlePassO2); // genuinely distinguished after ONE pass

      const twoPasses = (input: string): unknown => applyNormalizeRulesToText(input, rules, {});
      const doublePassO1 = twoPasses(o1);
      const doublePassO2 = twoPasses(o2);
      expect(doublePassO1).toEqual({ ok: true, text: 'fter' });
      expect(doublePassO2).toEqual({ ok: true, text: 'fter' });
      expect(doublePassO1).toEqual(doublePassO2); // collapsed by the second pass alone
    },
  );

  it('does NOT flag any of the seven rule kinds used exactly once each, freely combined (no over-restriction)', () => {
    const rules = [
      { rule: 'line-endings' as const },
      { rule: 'strip-ansi' as const },
      { rule: 'trim-trailing-whitespace' as const },
      { rule: 'sort-lines' as const },
      { rule: 'json-canonical' as const },
      { rule: 'ignore-json-pointers' as const, pointers: ['/x'] },
      { rule: 'replace' as const, pattern: 'a', replacement: 'b' },
    ];
    expect(hasRepeatedRuleKindInScope(rules)).toBe(false);
    // And it genuinely still works end to end on real content.
    const outcome = applyNormalizeRulesToText('{"a":1,"b":2}  \r\n', rules, {});
    expect(outcome.ok).toBe(true);
  });

  it('does not flag two DIFFERENT scopes each independently using the identical kind once', () => {
    const rules = [
      { rule: 'replace' as const, pattern: 'a', replacement: 'b', stream: 'stdout' as const },
      { rule: 'replace' as const, pattern: 'c', replacement: 'd', stream: 'stderr' as const },
    ];
    expect(hasRepeatedRuleKindInScope(rules)).toBe(false);
  });

  it('flags a repeated STRUCTURAL kind too, not only a repeated content-discarding one', () => {
    // `line-endings` is not in `CONTENT_DISCARDING_RULES` at all, so `hasConflictingContentDiscarding
    // Rules` would never see this -- confirming the two checks are genuinely independent.
    const rules = [{ rule: 'line-endings' as const }, { rule: 'line-endings' as const }];
    expect(hasRepeatedRuleKindInScope(rules)).toBe(true);
    expect(hasConflictingContentDiscardingRules(rules)).toBe(false);
  });

  it('is a no-op for an empty normalize list', () => {
    expect(hasRepeatedRuleKindInScope([])).toBe(false);
  });
});

describe('collectRepeatedRuleKindConflicts / assertNoRepeatedRuleKindInScope (specs/22 M16 P4)', () => {
  it('locates a conflicting case with a dotted key naming the normalize list itself', () => {
    const declaration = minimalDeclaration({
      surfaces: {
        process: minimalSurface({
          cases: [
            minimalCase({ normalize: [{ rule: 'line-endings' }] }),
            minimalCase({ normalize: [{ rule: 'strip-ansi' }, { rule: 'strip-ansi' }] }),
          ],
        }),
      },
    });
    const conflicts = collectRepeatedRuleKindConflicts(declaration);
    expect(conflicts).toEqual([{ key: 'surfaces.process.cases[1].normalize' }]);
  });

  it('reports no conflicts for a declaration using each rule kind at most once per scope', () => {
    const declaration = minimalDeclaration({
      surfaces: {
        process: minimalSurface({
          cases: [
            minimalCase({ normalize: [{ rule: 'replace', pattern: 'a', replacement: 'b' }] }),
          ],
        }),
      },
    });
    expect(collectRepeatedRuleKindConflicts(declaration)).toEqual([]);
  });

  it('throws a typed ForgeError CFG-513, never a bare exception, naming the conflicting case', () => {
    const declaration = minimalDeclaration({
      surfaces: {
        process: minimalSurface({
          cases: [minimalCase({ normalize: [{ rule: 'strip-ansi' }, { rule: 'strip-ansi' }] })],
        }),
      },
    });
    let caught: unknown;
    try {
      assertNoRepeatedRuleKindInScope(declaration);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ForgeError);
    expect((caught as ForgeError).code).toBe('CFG-513');
    expect((caught as ForgeError).details['key']).toBe('surfaces.process.cases[0].normalize');
  });

  it('returns normally for a declaration with no repeated-kind conflict', () => {
    const declaration = minimalDeclaration();
    expect(() => {
      assertNoRepeatedRuleKindInScope(declaration);
    }).not.toThrow();
  });

  it('CFG-512 and CFG-513 are independent: a case can trip one, both, or neither', () => {
    // `sort-lines` + `trim-trailing-whitespace` no longer trips CFG-512 at all (specs/22 M17 P14,
    // the proven-safe-pair exemption, above) -- `sort-lines` + `json-canonical` is NOT one of the
    // two proven-safe pairs, so it still demonstrates "trips CFG-512, not CFG-513" here.
    const tripsOnlyCfg512 = minimalDeclaration({
      surfaces: {
        process: minimalSurface({
          cases: [minimalCase({ normalize: [{ rule: 'sort-lines' }, { rule: 'json-canonical' }] })],
        }),
      },
    });
    expect(collectContentDiscardingConflicts(tripsOnlyCfg512)).toHaveLength(1);
    expect(collectRepeatedRuleKindConflicts(tripsOnlyCfg512)).toHaveLength(0);

    const tripsOnlyCfg513 = minimalDeclaration({
      surfaces: {
        process: minimalSurface({
          cases: [minimalCase({ normalize: [{ rule: 'line-endings' }, { rule: 'line-endings' }] })],
        }),
      },
    });
    expect(collectContentDiscardingConflicts(tripsOnlyCfg513)).toHaveLength(0);
    expect(collectRepeatedRuleKindConflicts(tripsOnlyCfg513)).toHaveLength(1);

    const tripsBoth = minimalDeclaration({
      surfaces: {
        process: minimalSurface({
          cases: [minimalCase({ normalize: [{ rule: 'sort-lines' }, { rule: 'sort-lines' }] })],
        }),
      },
    });
    expect(collectContentDiscardingConflicts(tripsBoth)).toHaveLength(1);
    expect(collectRepeatedRuleKindConflicts(tripsBoth)).toHaveLength(1);
  });
});

describe(
  '(specs/22 M17 P14) collectReplaceOnRootRewrittenSurfaceConflicts / ' +
    'assertNoReplaceRuleOnRootRewrittenSurface: closing the always-on root-token masking gap',
  () => {
    it.each(['process', 'file', 'http'] as const)(
      'flags a "replace" rule on the %s surface, which the always-on root rewrite reaches',
      (kind) => {
        const surfaceOverrides =
          kind === 'http'
            ? {
                run: 'node server.mjs',
                port: 4100,
                readiness: { path: '/health', timeoutMs: 1000 },
                network: 'loopback' as const,
                cases: [
                  {
                    request: { method: 'GET', path: '/' },
                    normalize: [{ rule: 'replace' as const, pattern: '.{3}$', replacement: '' }],
                  },
                ],
              }
            : {
                cases: [
                  minimalCase({
                    normalize: [{ rule: 'replace' as const, pattern: '.{3}$', replacement: '' }],
                  }),
                ],
              };
        const declaration = minimalDeclaration({
          surfaces: { [kind]: minimalSurface(surfaceOverrides) },
        });
        expect(collectReplaceOnRootRewrittenSurfaceConflicts(declaration)).toEqual([
          { key: `surfaces.${kind}.cases[0].normalize` },
        ]);
      },
    );

    it('does NOT flag a "replace" rule on the library surface, which the rewrite never reaches', () => {
      const declaration = minimalDeclaration({
        surfaces: {
          library: minimalSurface({
            run: 'node probe.mjs',
            cases: [
              minimalCase({
                normalize: [{ rule: 'replace', pattern: '.{3}$', replacement: '' }],
              }),
            ],
          }),
        },
      });
      expect(collectReplaceOnRootRewrittenSurfaceConflicts(declaration)).toEqual([]);
    });

    it('does not flag a case with no "replace" rule at all, however many other rules it declares', () => {
      const declaration = minimalDeclaration({
        surfaces: {
          process: minimalSurface({
            cases: [
              minimalCase({
                normalize: [
                  { rule: 'line-endings' },
                  { rule: 'strip-ansi' },
                  { rule: 'sort-lines' },
                  { rule: 'trim-trailing-whitespace' },
                  { rule: 'json-canonical' },
                  { rule: 'ignore-json-pointers', pointers: ['/x'] },
                ],
              }),
            ],
          }),
        },
      });
      expect(collectReplaceOnRootRewrittenSurfaceConflicts(declaration)).toEqual([]);
    });

    it('locates every conflicting case, in a fixed surface/case order, regardless of scope', () => {
      const declaration = minimalDeclaration({
        surfaces: {
          process: minimalSurface({
            cases: [
              minimalCase({ normalize: [{ rule: 'line-endings' }] }),
              minimalCase({
                normalize: [{ rule: 'replace', pattern: 'a', replacement: 'b', stream: 'stderr' }],
              }),
            ],
          }),
          file: minimalSurface({
            cases: [
              minimalCase({
                outputs: [{ path: 'out.txt' }],
                normalize: [{ rule: 'replace', pattern: 'a', replacement: 'b', file: 'out.txt' }],
              }),
            ],
          }),
        },
      });
      expect(collectReplaceOnRootRewrittenSurfaceConflicts(declaration)).toEqual([
        { key: 'surfaces.process.cases[1].normalize' },
        { key: 'surfaces.file.cases[0].normalize' },
      ]);
    });

    it('returns normally for a declaration with no "replace" rule on a root-rewritten surface', () => {
      const declaration = minimalDeclaration();
      expect(() => {
        assertNoReplaceRuleOnRootRewrittenSurface(declaration);
      }).not.toThrow();
    });

    it('throws a typed ForgeError CFG-516, never a bare exception, naming the conflicting case', () => {
      const declaration = minimalDeclaration({
        surfaces: {
          process: minimalSurface({
            cases: [
              minimalCase({ normalize: [{ rule: 'replace', pattern: '.{3}$', replacement: '' }] }),
            ],
          }),
        },
      });
      let caught: unknown;
      try {
        assertNoReplaceRuleOnRootRewrittenSurface(declaration);
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(ForgeError);
      expect((caught as ForgeError).code).toBe('CFG-516');
      expect((caught as ForgeError).details['key']).toBe('surfaces.process.cases[0].normalize');
    });

    it(
      'the M16 P4 repro itself: an ordinary root-path difference plus an ordinary trailing-content ' +
        'replace masks a genuine PASS-vs-FAIL difference -- this is exactly what CFG-516 now refuses ' +
        'before the case ever runs (reproduced directly against rewriteRootPaths + ' +
        'applyNormalizeRulesToText, not merely asserted; see normalize.ts’s own doc comment for the ' +
        'full account)',
      () => {
        const rules = [{ rule: 'replace' as const, pattern: '.{5}$', replacement: '' }];
        const reference = applyNormalizeRulesToText(
          rewriteRootPaths('/r:XXPASS', { asGiven: '/r', real: '/r' }),
          rules,
          {},
        );
        const candidate = applyNormalizeRulesToText(
          rewriteRootPaths('/candidateroot:XXFAIL', {
            asGiven: '/candidateroot',
            real: '/candidateroot',
          }),
          rules,
          {},
        );
        // The masking still happens at the primitive level (this piece did not change
        // `rewriteRootPaths`/`applyNormalizeRulesToText` themselves) -- CFG-516 prevents it by
        // refusing the DECLARATION before `decideCaseVerdict` ever reaches this combination.
        expect(reference).toEqual(candidate);
        const declaration = minimalDeclaration({
          surfaces: { process: minimalSurface({ cases: [minimalCase({ normalize: rules })] }) },
        });
        expect(() => {
          assertNoReplaceRuleOnRootRewrittenSurface(declaration);
        }).toThrow(ForgeError);
      },
    );

    it(
      'a fresh M17 P14 adversarial round: a start-anchored replace, and a root occurring in the ' +
        'MIDDLE of the text (a logged cwd), mask a genuine difference the identical way -- confirming ' +
        'the gap is not limited to the one repro shape M16 P4 happened to find',
      () => {
        const rules = [{ rule: 'replace' as const, pattern: '^.{6}', replacement: '' }];
        const reference = applyNormalizeRulesToText(
          rewriteRootPaths('PASS!! running in /short', { asGiven: '/short', real: '/short' }),
          rules,
          {},
        );
        const candidate = applyNormalizeRulesToText(
          rewriteRootPaths('FAIL!! running in /much/longer/checkout/path', {
            asGiven: '/much/longer/checkout/path',
            real: '/much/longer/checkout/path',
          }),
          rules,
          {},
        );
        expect(reference).toEqual(candidate); // a genuine PASS vs FAIL, masked the same way
        const declaration = minimalDeclaration({
          surfaces: { process: minimalSurface({ cases: [minimalCase({ normalize: rules })] }) },
        });
        expect(() => {
          assertNoReplaceRuleOnRootRewrittenSurface(declaration);
        }).toThrow(ForgeError);
      },
    );
  },
);
