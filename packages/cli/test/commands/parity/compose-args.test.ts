/**
 * `composeArgs` (specs/22 M16 P2) — `13` F-TEST-9: "each [argument] is appended to the surface's
 * `run` as one single-quoted word, and the composed line is what vetting judges at load and what
 * runs." A single quote, a newline or a shell operator cannot be composed at all.
 *
 * @see specs/13-frameworks-testing-and-debugging.md F-TEST-9
 */
import { describe, expect, it } from 'vitest';

import { composeArgs } from '../../../src/commands/parity/compose-args.ts';

describe('composeArgs (specs/22 M16 P2)', () => {
  it('returns the bare run unchanged when there are no arguments', () => {
    expect(composeArgs('node check.js', [])).toBe('node check.js');
  });

  it('appends one argument as a single single-quoted word', () => {
    expect(composeArgs('node check.js', ['a b'])).toBe("node check.js 'a b'");
  });

  it('appends several arguments, each its own single-quoted word, in order', () => {
    expect(composeArgs('node check.js', ['one', 'two three'])).toBe(
      "node check.js 'one' 'two three'",
    );
  });

  it.each([
    ["holds a single quote (')", "it's", "'"],
    ['holds a literal newline', 'a\nb', '\n'],
    ['holds a ";"', 'a;b', ';'],
    ['holds a "|"', 'a|b', '|'],
    ['holds a "&"', 'a&b', '&'],
    ['holds a backtick', 'a`b', '`'],
    ['holds a "$("', 'a$(b)', '$('],
    ['holds a carriage return', 'a\rb', '\r'],
  ])('refuses composition when an argument %s', (_label, arg) => {
    const result = composeArgs('node check.js', [arg]);
    expect(typeof result).not.toBe('string');
    expect(result).toHaveProperty('invalid');
  });

  it.each([
    ['a tilde', 'node check.js ~'],
    ['a glob star', '*.txt'],
    ['a tab', 'a\tb'],
    ['a plain space', 'a b'],
  ])(
    "composes into one POSIX-shell-safe word when an argument merely holds %s (POSIX only — see compose-args.ts's own disclosed Windows gap)",
    (_label, arg) => {
      const result = composeArgs('node check.js', [arg]);
      expect(typeof result).toBe('string');
      expect(result).toBe(`node check.js '${arg}'`);
    },
  );

  it('names which argument (by index) and what it contains in the refusal reason', () => {
    const result = composeArgs('node check.js', ['safe', "unsafe's"]);
    if (typeof result === 'string') throw new Error('expected a refusal');
    expect(result.invalid).toMatch(/argument 1/);
    expect(result.invalid).toMatch(/single quote/);
  });

  it('refuses independently per argument: a later safe argument does not rescue an earlier unsafe one', () => {
    const result = composeArgs('node check.js', ["bad'arg", 'good']);
    expect(typeof result).not.toBe('string');
  });

  it('two different cases of the same surface compose independently (no shared state)', () => {
    const first = composeArgs('node check.js', ['one']);
    const second = composeArgs('node check.js', ['two']);
    expect(first).toBe("node check.js 'one'");
    expect(second).toBe("node check.js 'two'");
  });
});
