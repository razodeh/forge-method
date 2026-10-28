/**
 * The seven declarative normalisation rules and the erase-everything guard (specs/22 M16 P4).
 *
 * Every expected byte string in this file is computed BY HAND from `13` F-TEST-9's own rule text
 * (quoted at each table row), independent of `normalize.ts`'s own implementation — not read back from
 * running the code.
 *
 * @see specs/13-frameworks-testing-and-debugging.md F-TEST-9
 */
import { describe, expect, it } from 'vitest';

import type { NormalizeRule } from '../../../src/commands/parity/declaration-types.ts';
import {
  applyIgnoreJsonPointers,
  applyJsonCanonical,
  applyLineEndings,
  applyNormalizeRulesToLibraryValue,
  applyNormalizeRulesToText,
  applyRedactJsonPointers,
  applyReplace,
  applySortLines,
  applyStripAnsi,
  applyTrimTrailingWhitespace,
  fieldRedactor,
  redactJsonPointerSubstring,
  removeJsonPointer,
  reorderPointersForSafeRemoval,
  rewriteRootPaths,
} from '../../../src/commands/parity/normalize.ts';

const ESC = '\x1b';

describe('line-endings: CRLF and a lone CR both become LF (specs/22 M16 P4)', () => {
  it.each([
    // `13` F-TEST-9: "`line-endings` rewrites CRLF and a lone CR as LF". A lone CR is one NOT
    // immediately followed by LF (the piece brief's own definition); computed by hand, not by the
    // naive `/\r/g` -> `\n` replace the brief warns gets CRLF wrong (that replace would turn one
    // CRLF into TWO line feeds: `\r` -> `\n` leaves the original `\n` right after it).
    ['a\r\nb', 'a\nb', 'one CRLF pair'],
    ['a\rb', 'a\nb', 'one lone CR'],
    ['a\r\n\rb', 'a\n\nb', 'a CRLF immediately followed by a lone CR'],
    ['a\r\rb', 'a\n\nb', 'two consecutive lone CRs'],
    ['no newlines here', 'no newlines here', 'text with no CR or LF at all'],
    ['', '', 'empty input'],
  ])('%s -> %s (%s)', (input, expected) => {
    expect(applyLineEndings(input)).toBe(expected);
  });

  it('does not double a line feed for a real CRLF input (the naive-replace bug)', () => {
    // A naive `text.replace(/\r/g, '\n')` on "a\r\nb" produces "a\n\nb" (3 chars become 4): the `\r`
    // becomes `\n`, and the original `\n` survives right after it. The correct two-pass result keeps
    // the CRLF pair as exactly one LF.
    const naiveWrong = 'a\r\nb'.replace(/\r/g, '\n');
    expect(naiveWrong).toBe('a\n\nb');
    expect(applyLineEndings('a\r\nb')).toBe('a\nb');
    expect(applyLineEndings('a\r\nb')).not.toBe(naiveWrong);
  });
});

describe('strip-ansi: CSI escape sequences only, the real ECMA-48 grammar (specs/22 M16 P4)', () => {
  it.each([
    // ECMA-48: CSI = ESC `[`, zero-or-more parameter bytes (0x30-0x3F), zero-or-more intermediate
    // bytes (0x20-0x2F), one final byte (0x40-0x7E). `1;31` is four parameter bytes (digits and `;`,
    // all in 0x30-0x3F); `m` (0x6D) is the final byte.
    [`${ESC}[1;31mred${ESC}[0m`, 'red', 'a parameterised sequence, not just a bare final byte'],
    [`${ESC}[mplain`, 'plain', 'a bare CSI with zero parameter bytes'],
    ['no escapes here', 'no escapes here', 'text with no escape sequences'],
    [`a${ESC}[2Kb`, 'ab', 'a single numeric parameter (erase-line)'],
  ])('%j -> %j (%s)', (input, expected) => {
    expect(applyStripAnsi(input)).toBe(expected);
  });

  it('removes every occurrence, not just the first', () => {
    expect(applyStripAnsi(`${ESC}[1m${ESC}[31mx${ESC}[0m`)).toBe('x');
  });

  it('leaves a bare ESC with no following "[" untouched (not a CSI sequence)', () => {
    expect(applyStripAnsi(`a${ESC}b`)).toBe(`a${ESC}b`);
  });

  it(
    'the round-4 finding: the old unbounded [@-~] final-byte range erased a real distinguishing ' +
      'byte on its own, with no other rule needed -- independently re-verified before the fix, ' +
      'and the narrowed allowlist now preserves the distinction',
    () => {
      // Both critics' exact repro: 'A' is a real, allowed cursor-movement code (kept in the new
      // allowlist) and strips; 'Z' is outside the new allowlist and is no longer recognised as CSI
      // at all, so it -- and the raw ESC byte before it -- survive as literal text. The two inputs,
      // which differ ONLY in this one byte, must now produce DIFFERENT output.
      const withA = applyStripAnsi(`status:${ESC}[Aok`);
      const withZ = applyStripAnsi(`status:${ESC}[Zok`);
      expect(withA).toBe('status:ok');
      expect(withZ).toBe(`status:${ESC}[Zok`); // unrecognised: left untouched, ESC and all
      expect(withA).not.toBe(withZ);
    },
  );

  it('the round-4 finding, the scaling variant: an unbounded parameter-byte run no longer collapses to the tail alone', () => {
    const longRunX = applyStripAnsi(`${ESC}[${'1'.repeat(500)}Xtail`);
    const shortRunX = applyStripAnsi(`${ESC}[${'9'.repeat(3)}Xtail`);
    // Neither 'X' nor any digit is in the new final-byte allowlist, so no valid final byte exists
    // anywhere in either run: both stay entirely literal, not collapsed to "tail".
    expect(longRunX).toBe(`${ESC}[${'1'.repeat(500)}Xtail`);
    expect(shortRunX).toBe(`${ESC}[${'9'.repeat(3)}Xtail`);
  });

  it('still strips the real, common SGR and cursor-control sequences the rule exists for (positive control)', () => {
    expect(applyStripAnsi(`${ESC}[31mred`)).toBe('red');
    expect(applyStripAnsi(`${ESC}[1;32mgreen`)).toBe('green');
    expect(applyStripAnsi(`a${ESC}[2Kb`)).toBe('ab'); // erase in line (spinners/progress bars)
    expect(applyStripAnsi(`a${ESC}[0Jb`)).toBe('ab'); // erase in display
  });
});

describe('trim-trailing-whitespace: spaces/tabs at line END only (specs/22 M16 P4)', () => {
  it.each([
    ['a  \n', 'a\n', 'trailing spaces before LF'],
    ['a\t\t\n', 'a\n', 'trailing tabs before LF'],
    ['  a\n', '  a\n', 'LEADING spaces are untouched'],
    ['a  b\n', 'a  b\n', 'INTERIOR spaces are untouched'],
    ['a  \r\n', 'a\r\n', 'trailing spaces before CRLF (terminator untouched)'],
    ['a  \rb', 'a\rb', 'trailing spaces before a lone CR'],
    ['a   ', 'a', 'trailing spaces at end of string with no terminator at all'],
    ['   ', '', 'a line that is ENTIRELY trailing whitespace is erased down to nothing'],
  ])('%j -> %j (%s)', (input, expected) => {
    expect(applyTrimTrailingWhitespace(input)).toBe(expected);
  });
});

describe('sort-lines: UTF-16 code unit order, never locale-aware collation (specs/22 M16 P4)', () => {
  it('sorts a real non-ASCII pair by code unit, not locale collation', () => {
    // "é" is U+00E9 (233); "z" is U+007A (122). Locale-aware (e.g. Swedish/French) collation
    // frequently orders "é" before "z" by linguistic weight regardless of code point; strict UTF-16
    // code UNIT order puts "z" (122) before "é" (233) — exactly `Array.prototype.sort`'s own default
    // comparator, with no `Intl.Collator` involved anywhere in the implementation.
    expect(applySortLines('é\nz')).toBe('z\né');
    // The independent, by-hand proof of the expected order, computed from code points rather than
    // from a second literal comparison a type checker could flatten to a compile-time constant:
    // U+007A ('z') is 122, U+00E9 ('é') is 233, so 'z' sorts first under plain numeric/code-unit
    // order.
    expect('z'.codePointAt(0)).toBeLessThan('é'.codePointAt(0) ?? Number.NaN);
  });

  it.each([
    ['b\na', 'a\nb', 'two lines, reverse order, no trailing newline'],
    [
      'b\na\n',
      'a\nb\n',
      'two lines, trailing newline preserved as a terminator, not a 3rd empty line',
    ],
    ['a', 'a', 'one line, nothing to sort'],
    ['', '', 'empty input'],
    ['b\na\n\n', '\na\nb\n', 'a genuine blank final line sorts as the empty string, first'],
  ])('%j -> %j (%s)', (input, expected) => {
    expect(applySortLines(input)).toBe(expected);
  });
});

describe('json-canonical: parse, sort keys recursively, re-serialise (specs/22 M16 P4)', () => {
  it('sorts object keys at every depth and keeps array order', () => {
    const outcome = applyJsonCanonical('{"b":1,"a":{"d":2,"c":3}}');
    expect(outcome).toEqual({ ok: true, text: '{"a":{"c":3,"d":2},"b":1}' });
  });

  it('fails, never silently passing the text through unparsed, when the observation is not JSON', () => {
    const outcome = applyJsonCanonical('not json at all');
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error('unreachable');
    // Content-free: the failure detail never echoes the bad text itself (the information-boundary
    // reason given in `normalize.ts`'s own doc comment).
    expect(outcome.detail).not.toContain('not json at all');
  });
});

describe('ignore-json-pointers: RFC 6901 + RFC 6902 "remove", this piece’s own DECISION (specs/22 M16 P4)', () => {
  it('removes an object member at a top-level pointer', () => {
    expect(removeJsonPointer({ a: 1, b: 2 }, '/a')).toEqual({ b: 2 });
  });

  it('removes a nested object member without disturbing a sibling', () => {
    expect(removeJsonPointer({ a: { x: 1, y: 2 }, b: 3 }, '/a/x')).toEqual({ a: { y: 2 }, b: 3 });
  });

  it('splices an array element, per RFC 6902, rather than leaving a hole', () => {
    expect(removeJsonPointer({ items: ['x', 'y', 'z'] }, '/items/1')).toEqual({
      items: ['x', 'z'],
    });
  });

  it('is a silent no-op when the pointer does not resolve (this piece’s own DECISION)', () => {
    expect(removeJsonPointer({ a: 1 }, '/missing')).toEqual({ a: 1 });
    expect(removeJsonPointer({ a: 1 }, '/a/too/deep')).toEqual({ a: 1 });
    expect(removeJsonPointer([1, 2], '/9')).toEqual([1, 2]);
  });

  it('is a silent no-op for malformed syntax (does not start with "/") rather than throwing', () => {
    expect(removeJsonPointer({ a: 1 }, 'a')).toEqual({ a: 1 });
  });

  it('recurses through an array element to remove a nested member, leaving siblings untouched', () => {
    expect(removeJsonPointer({ items: [{ foo: 1, bar: 2 }, 'y'] }, '/items/0/foo')).toEqual({
      items: [{ bar: 2 }, 'y'],
    });
  });

  it('end to end: removes the pointer from parsed JSON text and re-serialises canonically', () => {
    const outcome = applyIgnoreJsonPointers('{"keep":1,"drop":2}', ['/drop']);
    expect(outcome).toEqual({ ok: true, text: '{"keep":1}' });
  });

  it('fails on non-JSON text, content-free, the same as json-canonical', () => {
    const outcome = applyIgnoreJsonPointers('not json', ['/x']);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error('unreachable');
    expect(outcome.detail).not.toContain('not json');
  });

  it(
    'the round-6 finding: ascending array-index pointers into the SAME parent array, written in ' +
      'the natural order a declaration author would write them, previously mistargeted everything ' +
      'after the first removal',
    () => {
      // Independently re-verified before this fix existed: `removeAtPointer`'s own splice shifts
      // every later index down by one, so resolving `/list/1` AFTER `/list/0` has already removed
      // targets the wrong element. Confirmed: the three pointers below, applied in written
      // (ascending) order against the raw primitive with no reordering, left `['B','D']` -- wrong.
      // `removeJsonPointer` is this test's own unit; `reorderPointersForSafeRemoval` (tested on its
      // own further below) is what `applyIgnoreJsonPointers` now runs first to prevent this.
      const ascending = ['/list/0', '/list/1', '/list/2'];
      let value: unknown = { list: ['A', 'B', 'C', 'D', 'E'] };
      for (const pointer of reorderPointersForSafeRemoval(ascending)) {
        value = removeJsonPointer(value, pointer);
      }
      expect(value).toEqual({ list: ['D', 'E'] });
    },
  );

  it('the round-6 finding, the 3-pointer variant that previously dropped the element meant to survive', () => {
    const pointers = ['/arr/0', '/arr/1', '/arr/3'];
    let value: unknown = { arr: ['A', 'B', 'C', 'D'] };
    for (const pointer of reorderPointersForSafeRemoval(pointers)) {
      value = removeJsonPointer(value, pointer);
    }
    expect(value).toEqual({ arr: ['C'] }); // only index 2 ('C') was never named for removal
  });

  it('end to end through applyIgnoreJsonPointers itself: ascending array-index pointers now resolve correctly', () => {
    const outcome = applyIgnoreJsonPointers('{"list":["A","B","C","D","E"]}', [
      '/list/0',
      '/list/1',
      '/list/2',
    ]);
    expect(outcome).toEqual({ ok: true, text: '{"list":["D","E"]}' });
  });
});

describe(
  'redact-json-pointers (specs/22 M17 P14) (Q317 Decision 8 follow-up): a structural, pointer-' +
    'targeted SUBSTRING redaction, never a field deletion',
  () => {
    function redact(pattern: string, replacement: string): (text: string) => string {
      return fieldRedactor(pattern, replacement, () => {
        throw new Error('unexpected whole-field match');
      });
    }

    it('redacts a matched substring inside a string value at a top-level pointer, leaving siblings alone', () => {
      const value = redactJsonPointerSubstring(
        { message: 'failed at /real/root/path/file.js', kept: 1 },
        '/message',
        redact('/real/root/path', '<PATH>'),
      );
      expect(value).toEqual({ message: 'failed at <PATH>/file.js', kept: 1 });
    });

    it('redacts inside a NESTED pointer, through both an object and an array', () => {
      const value = redactJsonPointerSubstring(
        { error: { stack: ['at /a/b/c/one.js:1:1', 'at /a/b/c/two.js:2:2'] } },
        '/error/stack/1',
        redact('/a/b/c', '<ROOT>'),
      );
      expect(value).toEqual({
        error: { stack: ['at /a/b/c/one.js:1:1', 'at <ROOT>/two.js:2:2'] },
      });
    });

    it('never removes the member, unlike ignore-json-pointers: a pattern that matches nothing leaves the string untouched', () => {
      const value = redactJsonPointerSubstring(
        { message: 'all clear' },
        '/message',
        redact('nope', 'X'),
      );
      expect(value).toEqual({ message: 'all clear' });
    });

    it('is a silent no-op when the pointer does not resolve (the identical convention removeJsonPointer already uses)', () => {
      expect(redactJsonPointerSubstring({ a: 1 }, '/missing', redact('x', 'y'))).toEqual({ a: 1 });
      expect(redactJsonPointerSubstring({ a: 1 }, '/a/too/deep', redact('x', 'y'))).toEqual({
        a: 1,
      });
      expect(redactJsonPointerSubstring([1, 2], '/9', redact('x', 'y'))).toEqual([1, 2]);
    });

    it('is a silent no-op when the pointer resolves to a non-string (a number, here)', () => {
      expect(redactJsonPointerSubstring({ a: 42 }, '/a', redact('4', 'X'))).toEqual({ a: 42 });
    });

    it('is a silent no-op for malformed syntax (does not start with "/") rather than throwing', () => {
      expect(redactJsonPointerSubstring({ a: 'x' }, 'a', redact('x', 'y'))).toEqual({ a: 'x' });
    });

    it('the root pointer ("") redacts the whole value only when the whole value IS itself a string', () => {
      // A plain uppercasing transform here, deliberately not `redact()` (built on `fieldRedactor`):
      // this test is about `redactJsonPointerSubstring`'s own root-pointer handling, independent of
      // `fieldRedactor`'s separate whole-field-match guard -- which this exact input would otherwise
      // trip, since the pattern below matches the ENTIRE root string by construction.
      const upper = (text: string): string => text.toUpperCase();
      expect(redactJsonPointerSubstring('/real/root/path', '', upper)).toBe('/REAL/ROOT/PATH');
      // An object root is a no-op, never coerced or unwrapped -- there is no string there to redact.
      expect(redactJsonPointerSubstring({ a: 1 }, '', upper)).toEqual({ a: 1 });
    });

    it('fieldRedactor: a $-prefixed replacement is taken literally, the identical applyReplace semantics', () => {
      expect(redact('a', '$1-$$')('bab')).toBe('b$1-$$b');
    });

    it(
      'fieldRedactor: a pattern matching the ENTIRE non-empty field is refused via its own callback, ' +
        'regardless of what the (possibly non-empty) replacement would actually produce',
      () => {
        let wholeFieldMatch: string | undefined;
        const onWholeFieldMatch = fieldRedactor('.*', 'REDACTED', (target) => {
          wholeFieldMatch = target;
        });
        const result = onWholeFieldMatch('secret-value');
        expect(wholeFieldMatch).toBe('secret-value');
        // The field is left untouched when the whole-match callback fires -- the caller (`applyRedact
        // JsonPointers`/`compare.ts`'s own `normalizeLibraryOrThrow`) is the one that turns this into
        // a refusal; `fieldRedactor` itself never silently substitutes anyway.
        expect(result).toBe('secret-value');
      },
    );

    it('fieldRedactor: a partial match on an otherwise non-empty field is never treated as whole-field', () => {
      let wholeFieldMatch = false;
      const onWholeFieldMatch = fieldRedactor('tok-[A-Z0-9]+', 'REDACTED', () => {
        wholeFieldMatch = true;
      });
      expect(onWholeFieldMatch('prefix tok-ABC123 suffix')).toBe('prefix REDACTED suffix');
      expect(wholeFieldMatch).toBe(false);
    });

    it('end to end: redacts the pointer from parsed JSON text and re-serialises canonically', () => {
      const outcome = applyRedactJsonPointers(
        '{"keep":1,"message":"at /real/root/path/x.js"}',
        ['/message'],
        '/real/root/path',
        '<PATH>',
      );
      expect(outcome).toEqual({ ok: true, text: '{"keep":1,"message":"at <PATH>/x.js"}' });
    });

    it('fails on non-JSON text, content-free, the same as ignore-json-pointers/json-canonical', () => {
      const outcome = applyRedactJsonPointers('not json', ['/x'], 'a', 'b');
      expect(outcome.ok).toBe(false);
      if (outcome.ok) throw new Error('unreachable');
      expect(outcome.detail).not.toContain('not json');
    });

    it('end to end: a whole-field match is refused with a content-free detail, not silently applied', () => {
      const outcome = applyRedactJsonPointers('{"message":"secret"}', ['/message'], '.*', 'X');
      expect(outcome).toEqual({
        ok: false,
        detail:
          'the pattern matches the entire content of a non-empty targeted field, which is refused',
      });
    });

    it('applies every named pointer, independent of declaration order (no reordering needed, unlike ignore-json-pointers)', () => {
      const outcome = applyRedactJsonPointers(
        '{"list":["/root/one","/root/two","/root/three"]}',
        ['/list/2', '/list/0', '/list/1'],
        '/root',
        '<R>',
      );
      expect(outcome).toEqual({ ok: true, text: '{"list":["<R>/one","<R>/two","<R>/three"]}' });
    });
  },
);

describe(
  'applyNormalizeRulesToLibraryValue: redact-json-pointers ALWAYS resolves first, against the ' +
    'pristine original value; ignore-json-pointers second (two rounds of critic findings, in ' +
    'BOTH directions, against this piece’s own earlier versions, Q317 Decision 8 follow-up)',
  () => {
    it(
      'round-1 critic repro (the ORIGINAL direction): redact names the secret at its own, ' +
        'natural, pre-removal index; ignore removes an earlier sibling -- correctly redacted, ' +
        'identically whichever order the two rules are declared in',
      () => {
        // `{list: ['decoy', '/real/root/path/to/secret.js']}`: the secret sits at its own natural
        // index 1. The redact pointer below names THAT index, exactly as written against the real
        // JSON, with no need to account for the sibling removal at index 0 at all -- the one
        // natural authoring convention this function's own doc comment now guarantees works,
        // regardless of which rule a declaration happens to list first.
        const value = { list: ['decoy', '/real/root/path/to/secret.js'] };
        const ignoreFirst: readonly NormalizeRule[] = [
          { rule: 'ignore-json-pointers', pointers: ['/list/0'] },
          {
            rule: 'redact-json-pointers',
            pointers: ['/list/1'],
            pattern: '/real/root',
            replacement: '<R>',
          },
        ];
        const redactFirst: readonly NormalizeRule[] = [
          {
            rule: 'redact-json-pointers',
            pointers: ['/list/1'],
            pattern: '/real/root',
            replacement: '<R>',
          },
          { rule: 'ignore-json-pointers', pointers: ['/list/0'] },
        ];
        const expected = { ok: true, value: { list: ['<R>/path/to/secret.js'] } };
        expect(applyNormalizeRulesToLibraryValue(value, ignoreFirst)).toEqual(expected);
        expect(applyNormalizeRulesToLibraryValue(value, redactFirst)).toEqual(expected);
      },
    );

    it(
      'round-2 critic repro (the MIRROR-IMAGE direction): the secret sits AFTER the element ' +
        'ignore-json-pointers removes -- also correctly redacted, identically whichever order ' +
        'the two rules are declared in',
      () => {
        // `{list: ['keep-this', 'other', 'ROOT/secretpath']}`: the secret sits at its own natural
        // index 2, AFTER index 0 (removed by ignore-json-pointers). This is the exact shape that
        // broke this function's own SECOND version (which ran `ignore-json-pointers` first,
        // unconditionally): with ignore running first, removing index 0 shifts the secret down to
        // index 1 BEFORE the redact rule's own `/list/2` -- written, naturally, against the
        // ORIGINAL shape -- ever resolved; post-shift, index 2 no longer existed at all, so the
        // pointer silently no-opped and the secret survived completely unredacted. Fixed: redact
        // ALWAYS resolves first, against the untouched original, so `/list/2` finds the real
        // secret regardless of what ignore is about to do to index 0.
        const value = { list: ['keep-this', 'other', 'ROOT/secretpath'] };
        const redactFirst: readonly NormalizeRule[] = [
          {
            rule: 'redact-json-pointers',
            pointers: ['/list/2'],
            pattern: 'secretpath',
            replacement: 'REDACTED',
          },
          { rule: 'ignore-json-pointers', pointers: ['/list/0'] },
        ];
        const ignoreFirst: readonly NormalizeRule[] = [
          { rule: 'ignore-json-pointers', pointers: ['/list/0'] },
          {
            rule: 'redact-json-pointers',
            pointers: ['/list/2'],
            pattern: 'secretpath',
            replacement: 'REDACTED',
          },
        ];
        const expected = { ok: true, value: { list: ['other', 'ROOT/REDACTED'] } };
        expect(applyNormalizeRulesToLibraryValue(value, redactFirst)).toEqual(expected);
        expect(applyNormalizeRulesToLibraryValue(value, ignoreFirst)).toEqual(expected);
      },
    );

    it('a lone ignore-json-pointers rule (no redact-json-pointers at all) behaves exactly as before', () => {
      expect(
        applyNormalizeRulesToLibraryValue({ kept: 1, drop: 2 }, [
          { rule: 'ignore-json-pointers', pointers: ['/drop'] },
        ]),
      ).toEqual({ ok: true, value: { kept: 1 } });
    });

    it('a lone redact-json-pointers rule (no ignore-json-pointers at all) behaves exactly as before', () => {
      expect(
        applyNormalizeRulesToLibraryValue({ message: '/real/root/a.js' }, [
          {
            rule: 'redact-json-pointers',
            pointers: ['/message'],
            pattern: '/real/root',
            replacement: '<R>',
          },
        ]),
      ).toEqual({ ok: true, value: { message: '<R>/a.js' } });
    });

    it(
      'removing the root via ignore-json-pointers is "erased" even after a redact-json-pointers ' +
        'rule in the SAME list already resolved successfully in pass 1 -- pass 2 erases ' +
        'everything pass 1 did, which is the correct outcome for a declaration that excuses its ' +
        'entire result',
      () => {
        const rules: readonly NormalizeRule[] = [
          { rule: 'redact-json-pointers', pointers: ['/other'], pattern: 'x', replacement: 'q' },
          { rule: 'ignore-json-pointers', pointers: [''] },
        ];
        expect(
          applyNormalizeRulesToLibraryValue({ message: 'secret', other: 'xyz' }, rules),
        ).toEqual({
          ok: false,
          kind: 'erased',
        });
      },
    );

    it('a redact-json-pointers pattern matching the ENTIRE non-empty field is reported as a typed "whole-field-match", never silently applied', () => {
      const rules: readonly NormalizeRule[] = [
        { rule: 'redact-json-pointers', pointers: ['/message'], pattern: '.*', replacement: 'X' },
      ];
      expect(applyNormalizeRulesToLibraryValue({ message: 'secret' }, rules)).toEqual({
        ok: false,
        kind: 'whole-field-match',
        rule: 'redact-json-pointers',
        pointer: '/message',
      });
    });

    it('every other rule kind remains a no-op, exactly as the un-refactored function already proved', () => {
      const rules: readonly NormalizeRule[] = [
        { rule: 'line-endings' },
        { rule: 'strip-ansi' },
        { rule: 'trim-trailing-whitespace' },
        { rule: 'sort-lines' },
        { rule: 'json-canonical' },
        { rule: 'replace', pattern: 'a', replacement: 'b' },
      ];
      expect(applyNormalizeRulesToLibraryValue({ kept: 1 }, rules)).toEqual({
        ok: true,
        value: { kept: 1 },
      });
    });
  },
);

describe('replace: every match, literal replacement, $1 not expanded (specs/22 M16 P4)', () => {
  it('replaces every match, not just the first', () => {
    expect(applyReplace('a-a-a', 'a', 'X')).toBe('X-X-X');
  });

  it('does NOT expand a "$1"-style backreference: the replacement is taken literally', () => {
    // Plain `String.prototype.replace` would expand "$1" to the captured "foo" here; the literal
    // reading keeps the two characters "$1" verbatim.
    expect('foo'.replace(/(foo)/, '$1')).toBe('foo'); // the built-in's OWN (expanding) behaviour
    expect(applyReplace('foo', '(foo)', '$1')).toBe('$1'); // this rule's literal behaviour
  });

  it('does not expand "$&", "$`", "$\'" either', () => {
    expect(applyReplace('xyz', 'y', "$&-$`-$'")).toBe("x$&-$`-$'z");
  });
});

describe('the order-matters test: rules run in the declaration’s own order (specs/22 M16 P4)', () => {
  it('sort-lines before line-endings differs from line-endings before sort-lines, on a lone-CR input', () => {
    // Input: "banana\rapple" -- one lone CR between the two words, no trailing terminator.
    //
    // Order A (sort-lines, THEN line-endings): at the moment sort-lines runs, the lone CR is not yet
    // a line terminator (line-endings has not run), so `applySortLines` sees ONE line
    // ("banana\rapple", with an embedded CR character that is not a split point) and leaves it
    // unchanged. line-endings then converts the lone CR to LF: "banana\napple" -- UNSORTED, "banana"
    // still before "apple".
    //
    // Order B (line-endings, THEN sort-lines): line-endings converts the lone CR to LF first:
    // "banana\napple". sort-lines now sees two real lines and sorts them: "apple\nbanana" -- SORTED.
    //
    // Both expected strings are computed by hand from the rule definitions above, not from running
    // `applyNormalizeRulesToText` first.
    const input = 'banana\rapple';

    const orderA = applySortLines(input); // sort-lines first
    const afterOrderA = applyLineEndings(orderA); // then line-endings
    expect(afterOrderA).toBe('banana\napple');

    const orderB = applyLineEndings(input); // line-endings first
    const afterOrderB = applySortLines(orderB); // then sort-lines
    expect(afterOrderB).toBe('apple\nbanana');

    expect(afterOrderA).not.toBe(afterOrderB);
  });

  it('applyNormalizeRulesToText honours the declared order for the identical input, both ways', () => {
    const input = 'banana\rapple';
    const sortThenEndings = applyNormalizeRulesToText(
      input,
      [{ rule: 'sort-lines' }, { rule: 'line-endings' }],
      {},
    );
    const endingsThenSort = applyNormalizeRulesToText(
      input,
      [{ rule: 'line-endings' }, { rule: 'sort-lines' }],
      {},
    );
    expect(sortThenEndings).toEqual({ ok: true, text: 'banana\napple' });
    expect(endingsThenSort).toEqual({ ok: true, text: 'apple\nbanana' });
  });
});

describe('the erase-everything guard (specs/22 M16 P4)', () => {
  it('refuses a rule-level erasure: strip-ansi on content that is entirely ANSI escapes', () => {
    const allAnsi = `${ESC}[31m${ESC}[0m`; // non-empty input, entirely CSI sequences
    expect(applyStripAnsi(allAnsi)).toBe(''); // the rule itself genuinely erases it
    const outcome = applyNormalizeRulesToText(allAnsi, [{ rule: 'strip-ansi' }], {});
    expect(outcome).toEqual({ ok: false, kind: 'erased', rule: 'strip-ansi' });
  });

  it('refuses the whole-stream-replace form: a pattern matching the entire non-empty stream', () => {
    const outcome = applyNormalizeRulesToText(
      'hello',
      [{ rule: 'replace', pattern: '.*', replacement: '' }],
      {},
    );
    expect(outcome).toEqual({ ok: false, kind: 'erased', rule: 'replace' });
  });

  it('accepts a rule that erases everything BUT one byte', () => {
    const outcome = applyNormalizeRulesToText(
      'hello',
      [{ rule: 'replace', pattern: 'hell', replacement: '' }],
      {},
    );
    expect(outcome).toEqual({ ok: true, text: 'o' });
  });

  it('refuses a rule that erases the literal last byte too', () => {
    const outcome = applyNormalizeRulesToText(
      'hello',
      [{ rule: 'replace', pattern: 'hello', replacement: '' }],
      {},
    );
    expect(outcome).toEqual({ ok: false, kind: 'erased', rule: 'replace' });
  });

  it('does not refuse a rule applied to an already-empty target (nothing to erase)', () => {
    const outcome = applyNormalizeRulesToText('', [{ rule: 'strip-ansi' }], {});
    expect(outcome).toEqual({ ok: true, text: '' });
  });

  it('is checked after every rule, not only the final one in the list', () => {
    const outcome = applyNormalizeRulesToText(
      'hello',
      [
        { rule: 'replace', pattern: 'hello', replacement: '' }, // erases everything
        { rule: 'sort-lines' }, // would be a no-op on "" anyway; must not un-refuse the erasure
      ],
      {},
    );
    expect(outcome.ok).toBe(false);
  });

  it(
    'refuses a replace whose match spans the whole non-empty stream even with a NON-EMPTY ' +
      'replacement -- the critic-found hole, not merely the empty-replacement case above',
    () => {
      // `13` F-TEST-9 and Q294 Decision 7 both name this independently of whether the result is
      // empty: "a replace rule that leaves some text behind while hiding everything that matters
      // would make every candidate match." A pattern that matches the WHOLE input, replaced with a
      // fixed non-empty string, makes two genuinely different inputs compare equal -- proven here
      // directly: two different raw texts both fully matched by `^[\s\S]+$` both collapse to the
      // identical "SAME" text under the (would-be) buggy behaviour, which is exactly the erasure
      // this guard exists to catch regardless of what replaces the match.
      const rules = [{ rule: 'replace' as const, pattern: '^[\\s\\S]+$', replacement: 'SAME' }];
      const first = applyNormalizeRulesToText('completely different input one', rules, {});
      const second = applyNormalizeRulesToText('a wholly unrelated second string', rules, {});
      expect(first).toEqual({ ok: false, kind: 'erased', rule: 'replace' });
      expect(second).toEqual({ ok: false, kind: 'erased', rule: 'replace' });
    },
  );

  it('accepts a replace with a non-empty replacement when the match does NOT span the whole content', () => {
    // The positive control for the test above: matching only PART of a non-empty input, even with a
    // non-empty replacement, is never an erasure and must not be refused.
    const outcome = applyNormalizeRulesToText(
      'prefix-MATCH-suffix',
      [{ rule: 'replace', pattern: 'MATCH', replacement: 'REPLACED' }],
      {},
    );
    expect(outcome).toEqual({ ok: true, text: 'prefix-REPLACED-suffix' });
  });

  it(
    'compares against the IMMEDIATELY PRECEDING rule’s output, never the original input -- the ' +
      'off-by-one a critic found no test would catch',
    () => {
      // Start from an EMPTY string (so a buggy guard that compares against the ORIGINAL input would
      // see "originally empty" at every step and never refuse anything). Rule 1 (`^$` -> 'X') turns
      // "" into "X": not an erasure (the input to THIS rule, "", was already empty). Rule 2
      // ('X' -> '') turns "X" back into "": rule 2's own INPUT ("X", the immediately preceding
      // rule's OUTPUT) was non-empty, so this IS a real erasure and must be refused. A guard that
      // compared against the original "" instead of the preceding "X" would wrongly accept it.
      const outcome = applyNormalizeRulesToText(
        '',
        [
          { rule: 'replace', pattern: '^$', replacement: 'X' },
          { rule: 'replace', pattern: 'X', replacement: '' },
        ],
        {},
      );
      expect(outcome).toEqual({ ok: false, kind: 'erased', rule: 'replace' });
    },
  );
});

describe('reorderPointersForSafeRemoval: the round-6 same-parent-array-index fix (specs/22 M16 P4)', () => {
  it('reorders ascending same-parent array-index pointers to descending', () => {
    expect(reorderPointersForSafeRemoval(['/list/0', '/list/1', '/list/2'])).toEqual([
      '/list/2',
      '/list/1',
      '/list/0',
    ]);
  });

  it('leaves already-descending same-parent pointers unchanged', () => {
    expect(reorderPointersForSafeRemoval(['/list/2', '/list/1', '/list/0'])).toEqual([
      '/list/2',
      '/list/1',
      '/list/0',
    ]);
  });

  it('leaves object-key pointers in their own original relative position (name-addressed, never shifted)', () => {
    expect(reorderPointersForSafeRemoval(['/a', '/b', '/c'])).toEqual(['/a', '/b', '/c']);
  });

  it('leaves pointers into DIFFERENT parent arrays in their own original relative order', () => {
    expect(reorderPointersForSafeRemoval(['/x/0', '/y/0', '/x/1'])).toEqual([
      // the "/x" group (indices 1 then 0, descending) is emitted at its first occurrence (position
      // 0); "/y/0" is an unrelated single-member group, unaffected, kept at its own position.
      '/x/1',
      '/x/0',
      '/y/0',
    ]);
  });

  it(
    'correctly reorders a same-parent group that is split by an unrelated pointer in the middle ' +
      '-- the exact shape a naive stable-sort comparator would handle inconsistently',
    () => {
      // A(parent1,idx2), B(parent2,idx0), C(parent1,idx5): A and C share a parent and must end up
      // ordered C-then-A (descending) relative to EACH OTHER, emitted together at the position of
      // the group's first original occurrence (index 0); B is unrelated and keeps its own position
      // after the whole group, never landing BETWEEN its two now-adjacent members.
      const reordered = reorderPointersForSafeRemoval(['/p1/2', '/p2/0', '/p1/5']);
      expect(reordered).toEqual(['/p1/5', '/p1/2', '/p2/0']);
    },
  );

  it('is a no-op for an empty list', () => {
    expect(reorderPointersForSafeRemoval([])).toEqual([]);
  });

  it('two pointers that resolve to the SAME index are kept adjacent, not separated', () => {
    expect(reorderPointersForSafeRemoval(['/list/1', '/list/1'])).toEqual(['/list/1', '/list/1']);
  });
});

describe('rewriteRootPaths: the always-on root-path-to-token rewrite (specs/22 M16 P4)', () => {
  it('replaces every occurrence of the given root path with the fixed token', () => {
    expect(
      rewriteRootPaths('cannot open /tmp/work/a.json', { asGiven: '/tmp/work', real: '/tmp/work' }),
    ).toBe('cannot open <PARITY-ROOT>/a.json');
  });

  it('replaces both the as-given and the real path when they differ (a symlinked root)', () => {
    // `13` F-TEST-9: "rewrites each observed tree's root path, BOTH as given and as its real path".
    // P3's own builder found only the candidate side can show a real difference here (macOS's
    // `/tmp` -> `/private/tmp` symlink, for one real example).
    const text = 'ref: /tmp/project/out.txt; real: /private/tmp/project/out.txt';
    const rewritten = rewriteRootPaths(text, {
      asGiven: '/tmp/project',
      real: '/private/tmp/project',
    });
    expect(rewritten).toBe('ref: <PARITY-ROOT>/out.txt; real: <PARITY-ROOT>/out.txt');
  });

  it('replaces the LONGER candidate first, so a short path is not consumed inside a longer one', () => {
    const rewritten = rewriteRootPaths('/a/b and /a', { asGiven: '/a', real: '/a/b' });
    // Had "/a" been replaced first, "/a/b" would have become "<PARITY-ROOT>/b", never matching the
    // full "/a/b" candidate afterward -- replacing the longer one first avoids that.
    expect(rewritten).toBe('<PARITY-ROOT> and <PARITY-ROOT>');
  });

  it('is a no-op when neither candidate string appears in the text', () => {
    expect(
      rewriteRootPaths('nothing to see here', { asGiven: '/tmp/x', real: '/private/tmp/x' }),
    ).toBe('nothing to see here');
  });

  it('is a no-op (never an infinite split) for an empty asGiven/real pair', () => {
    expect(rewriteRootPaths('text', { asGiven: '', real: '' })).toBe('text');
  });

  it('runs before any declared rule, through the orchestrator, when threaded a root via normalizeTextOrThrow-style scope', () => {
    // This module's own `applyNormalizeRulesToText` does not itself take a root (the rewrite is
    // `compare.ts`'s own call-site responsibility, since only it knows which side's root applies) --
    // this test instead proves the primitive composes correctly with the declared-rule pipeline by
    // rewriting first and feeding the result in, the same order `compare.ts`'s `normalizeTextOrThrow`
    // performs it.
    const raw = 'path was /tmp/proj/out';
    const rewritten = rewriteRootPaths(raw, { asGiven: '/tmp/proj', real: '/tmp/proj' });
    const outcome = applyNormalizeRulesToText(rewritten, [{ rule: 'sort-lines' }], {});
    expect(outcome).toEqual({ ok: true, text: 'path was <PARITY-ROOT>/out' });
  });
});

describe('applyNormalizeRulesToText: every rule kind reachable through the orchestrator (specs/22 M16 P4)', () => {
  it('runs trim-trailing-whitespace through the orchestrator', () => {
    expect(applyNormalizeRulesToText('a  \n', [{ rule: 'trim-trailing-whitespace' }], {})).toEqual({
      ok: true,
      text: 'a\n',
    });
  });

  it('runs sort-lines through the orchestrator', () => {
    expect(applyNormalizeRulesToText('b\na', [{ rule: 'sort-lines' }], {})).toEqual({
      ok: true,
      text: 'a\nb',
    });
  });

  it('runs a succeeding json-canonical rule through the orchestrator', () => {
    expect(applyNormalizeRulesToText('{"b":1,"a":2}', [{ rule: 'json-canonical' }], {})).toEqual({
      ok: true,
      text: '{"a":2,"b":1}',
    });
  });

  it('runs a succeeding ignore-json-pointers rule through the orchestrator', () => {
    expect(
      applyNormalizeRulesToText(
        '{"keep":1,"drop":2}',
        [{ rule: 'ignore-json-pointers', pointers: ['/drop'] }],
        {},
      ),
    ).toEqual({ ok: true, text: '{"keep":1}' });
  });

  it('propagates a failing ignore-json-pointers rule through the orchestrator as rule-failed', () => {
    const outcome = applyNormalizeRulesToText(
      'not json',
      [{ rule: 'ignore-json-pointers', pointers: ['/x'] }],
      {},
    );
    expect(outcome).toEqual({
      ok: false,
      kind: 'rule-failed',
      failure: { rule: 'ignore-json-pointers', detail: 'does not parse as JSON' },
    });
  });

  it(
    'runs a succeeding redact-json-pointers rule through the orchestrator (specs/22 M17 P14 ' +
      'follow-up, Q317 Decision 8)',
    () => {
      expect(
        applyNormalizeRulesToText(
          '{"message":"at /real/root/x.js"}',
          [
            {
              rule: 'redact-json-pointers',
              pointers: ['/message'],
              pattern: '/real/root',
              replacement: '<R>',
            },
          ],
          {},
        ),
      ).toEqual({ ok: true, text: '{"message":"at <R>/x.js"}' });
    },
  );

  it('propagates a failing redact-json-pointers rule through the orchestrator as rule-failed', () => {
    const outcome = applyNormalizeRulesToText(
      'not json',
      [{ rule: 'redact-json-pointers', pointers: ['/x'], pattern: 'a', replacement: 'b' }],
      {},
    );
    expect(outcome).toEqual({
      ok: false,
      kind: 'rule-failed',
      failure: { rule: 'redact-json-pointers', detail: 'does not parse as JSON' },
    });
  });

  it('propagates a whole-field-match redact-json-pointers refusal through the orchestrator as rule-failed', () => {
    const outcome = applyNormalizeRulesToText(
      '{"message":"secret"}',
      [{ rule: 'redact-json-pointers', pointers: ['/message'], pattern: '.*', replacement: 'X' }],
      {},
    );
    expect(outcome).toEqual({
      ok: false,
      kind: 'rule-failed',
      failure: {
        rule: 'redact-json-pointers',
        detail:
          'the pattern matches the entire content of a non-empty targeted field, which is refused',
      },
    });
  });

  it(
    'the round-6 exhaustiveness fix: an unrecognised rule kind throws rather than silently becoming ' +
      'a no-op -- reachable only by defeating the type system, exactly the way `tsc` itself now ' +
      'refuses to compile a REAL unhandled variant (confirmed separately, see this piece’s own ' +
      'mutation evidence: adding an 8th `NormalizeRule` member and running the real `tsc` command ' +
      'this project’s own `pnpm typecheck` runs now produces a real compile error)',
    () => {
      // The one place in this test file a cast through `unknown` is the only way to reach a branch
      // the type system otherwise makes unreachable -- the identical, already-established pattern
      // `compare.ts`'s own `observationsEqual` catch-all test uses for its own type-escape-hatch
      // branch.
      const notARealRule = { rule: 'not-a-real-rule-kind' } as unknown as NormalizeRule;
      expect(() => applyNormalizeRulesToText('x', [notARealRule], {})).toThrow(TypeError);
      expect(() => applyNormalizeRulesToText('x', [notARealRule], {})).toThrow(
        /Unhandled NormalizeRule kind/,
      );
    },
  );
});

describe('replace scoping to a stream or a declared output file (specs/22 M16 P4)', () => {
  it('a stream-scoped replace applies only to the matching stream', () => {
    // "token=secret-token" rather than bare "secret-token": the pattern must match only PART of the
    // content here, not the whole non-empty string, or the erase-everything guard's own whole-match
    // check (added for the entire-content case) would refuse this fixture for an unrelated reason.
    const stdout = applyNormalizeRulesToText(
      'token=secret-token',
      [{ rule: 'replace', pattern: 'secret-token', replacement: 'REDACTED', stream: 'stdout' }],
      { stream: 'stdout' },
    );
    const stderr = applyNormalizeRulesToText(
      'token=secret-token',
      [{ rule: 'replace', pattern: 'secret-token', replacement: 'REDACTED', stream: 'stdout' }],
      { stream: 'stderr' },
    );
    expect(stdout).toEqual({ ok: true, text: 'token=REDACTED' });
    expect(stderr).toEqual({ ok: true, text: 'token=secret-token' }); // unchanged: wrong stream
  });

  it('a file-scoped replace applies only to the matching declared output path', () => {
    const matching = applyNormalizeRulesToText(
      'v1.2.3',
      [{ rule: 'replace', pattern: '\\d+\\.\\d+\\.\\d+', replacement: 'X.Y.Z', file: 'VERSION' }],
      { file: 'VERSION' },
    );
    const other = applyNormalizeRulesToText(
      'v1.2.3',
      [{ rule: 'replace', pattern: '\\d+\\.\\d+\\.\\d+', replacement: 'X.Y.Z', file: 'VERSION' }],
      { file: 'other.txt' },
    );
    expect(matching).toEqual({ ok: true, text: 'vX.Y.Z' });
    expect(other).toEqual({ ok: true, text: 'v1.2.3' });
  });

  it('an unscoped replace (no stream, no file) applies everywhere', () => {
    // "xz" rather than bare "x": the pattern must match only part of the content, for the same
    // whole-match-guard reason given above.
    const outcome = applyNormalizeRulesToText(
      'xz',
      [{ rule: 'replace', pattern: 'x', replacement: 'y' }],
      { stream: 'stderr' },
    );
    expect(outcome).toEqual({ ok: true, text: 'yz' });
  });
});
