/**
 * `renderTestCommandTemplate`/`withTimeoutOverride` — `18` §18.3's own `{files}`/`{name}`/
 * `{name:regex}` placeholder substitution, and the structured-command `timeoutMs` override, for a
 * structured `testCommands.<layer>` entry (`run`/`scope`/`filter`). Direct, focused unit tests
 * against these pure, exported, side-effect-free functions: both real callers of the first
 * (`run.ts`'s `runTestLayerCommand`/`runTestLayerRetry`, `binding.ts`'s `runScopedLayer`) only ever
 * exercise it with ordinary, already-covered fixture names/files, so the pathological-input cases
 * below need a test that targets this function directly, not only the end-to-end subprocess tests
 * elsewhere in this Surface.
 *
 * Where the expected output itself is non-trivial to compute by hand (`shellQuote`'s own embedded-
 * quote escaping stacked with `escapeRegExp`'s own regex escaping), the test instead round-trips the
 * rendered string through a REAL shell (`sh -c 'printf "%s\n" ARG' -- {rendered}`) and asserts the
 * shell receives back exactly the one argument this function was asked to encode — the real property
 * that matters (a project's own configured command, run for real, sees the right value), proven
 * without trusting a hand-derived expected string.
 *
 * @see specs/18 §18.3
 * @see specs/22 M17 P4
 */
import { execFileSync } from 'node:child_process';

import { describe, expect, it } from 'vitest';

import {
  renderTestCommandTemplate,
  withTimeoutOverride,
} from '../../../../src/commands/loop/test/reporter.ts';

/** Runs `rendered` (a single, already shell-quoted token `renderTestCommandTemplate` produced for
 * one bare `{name}`/`{name:regex}` placeholder, with no other template text around it) through a
 * REAL `/bin/sh -c`, printing back exactly the one positional word it decodes to — the exact inverse
 * of `shellQuote`'s own encoding, proof the rendered text is genuinely well-formed shell syntax
 * carrying the real value, not merely "looks plausible." One level of shell interpretation only:
 * `rendered` is concatenated directly into the command-line STRING handed to `sh -c`'s own single
 * argument, never passed through a second, Node-added `shell: true` layer (which would quote it
 * again and defeat the point of this check). */
function shellDecodesToOneArgument(rendered: string): string {
  return execFileSync('/bin/sh', ['-c', `printf '%s' ${rendered}`], { encoding: 'utf8' });
}

describe('renderTestCommandTemplate -- {files} (specs/22 M17 P4) (18 §18.3)', () => {
  it('multiple files are individually shell-quoted and SPACE-joined, never comma- or otherwise-joined', () => {
    const rendered = renderTestCommandTemplate('run {files}', {
      files: ['a.test.js', 'b.test.js', 'sub/c.test.js'],
    });
    expect(rendered).toBe("run 'a.test.js' 'b.test.js' 'sub/c.test.js'");
  });

  it('a single file is shell-quoted alone, with no trailing separator', () => {
    expect(renderTestCommandTemplate('run {files}', { files: ['only.test.js'] })).toBe(
      "run 'only.test.js'",
    );
  });

  it('a file name containing a literal GetSubstitution-magic sequence ($&) round-trips without corruption', () => {
    // Before the fix (a bare STRING passed to `replaceAll`, not a replacer function), this exact
    // content would have been scanned for `$&`/`` $` ``/`$'`/`$$` tokens and silently mangled.
    const file = 'weird$&file.test.js';
    expect(renderTestCommandTemplate('{files}', { files: [file] })).toBe(`'${file}'`);
  });
});

describe('renderTestCommandTemplate -- {name} (specs/22 M17 P4) (18 §18.3)', () => {
  it('a literal match, shell-quoted verbatim', () => {
    expect(renderTestCommandTemplate('-k {name}', { name: 'adds two numbers' })).toBe(
      "-k 'adds two numbers'",
    );
  });

  it('a name containing an embedded single quote decodes, through a real shell, to exactly the original name', () => {
    const name = "don't fail";
    const rendered = renderTestCommandTemplate('{name}', { name });
    expect(shellDecodesToOneArgument(rendered)).toBe(name);
  });

  it.each([
    ['$&', 'contains the literal match token $&'],
    ['$`', 'contains the literal backtick token $`'],
    ["$'", "contains the literal tail token $'"],
    ['$$', 'contains the literal doubled-dollar token $$'],
  ])(
    'a name that %s round-trips, through a real shell, to exactly the original name (%s)',
    (token) => {
      const name = `weird ${token} in the middle`;
      const rendered = renderTestCommandTemplate('{name}', { name });
      expect(shellDecodesToOneArgument(rendered)).toBe(name);
    },
  );

  it("text following the placeholder is never duplicated, and the closing quote is never eaten, for a name ending in the magic tail $'", () => {
    const name = "ends in dollar-quote $'";
    const rendered = renderTestCommandTemplate('-k {name} --rest', { name });
    // The literal text "--rest" appears in the rendered command exactly once, not duplicated.
    expect(rendered.split('--rest')).toHaveLength(2);
    expect(shellDecodesToOneArgument(renderTestCommandTemplate('{name}', { name }))).toBe(name);
  });
});

describe('renderTestCommandTemplate -- {name:regex} (specs/22 M17 P4) (18 §18.3)', () => {
  it('anchored (^...$) and regex-escaped before quoting', () => {
    expect(renderTestCommandTemplate('-t {name:regex}', { name: 'a.b' })).toBe("-t '^a\\.b$'");
  });

  it('MUTATION EVIDENCE (critic-reproduced): correct for the empty name -- not only a non-empty one', () => {
    // The computed replacement for `{name:regex}` is `shellQuote('^' + escaped + '$')`, which
    // ALWAYS ends in the two literal characters `$` then `'` (the regex end-anchor immediately
    // followed by shellQuote's own closing quote) for EVERY `name`, including the empty string --
    // confirmed directly: before the fix, a critic round reproduced this exact case corrupting the
    // output via `String.prototype.replaceAll`'s own `GetSubstitution` reading that `$'` tail as
    // "insert everything that follows the match," regardless of `name`'s own content.
    expect(renderTestCommandTemplate('{name:regex}', { name: '' })).toBe("'^$'");
  });

  it('MUTATION EVIDENCE (critic-reproduced): text following the placeholder is never duplicated, and the closing quote is never eaten', () => {
    expect(renderTestCommandTemplate('-t {name:regex} --rest', { name: '' })).toBe(
      "-t '^$' --rest",
    );
    expect(renderTestCommandTemplate('-t {name:regex} --rest', { name: 'x' })).toBe(
      "-t '^x$' --rest",
    );
  });

  it('a regex-anchored name containing literal GetSubstitution-magic sequences decodes, through a real shell, to the anchored-and-escaped regex -- never corrupted or duplicated', () => {
    const name = "weird $& and $` and $' and $$ test";
    const rendered = renderTestCommandTemplate('{name:regex}', { name });
    // `$` is itself one of `escapeRegExp`'s own escaped regex metacharacters: every literal `$` in
    // `name` reads back as a literal, backslash-escaped `$`, never a bare, GetSubstitution-magic one.
    // The identical regex-metacharacter class `reporter.ts`'s own private `escapeRegExp` escapes --
    // reimplemented here, in the test, rather than importing a non-exported helper (R5).
    const regexMetacharacters = /[.*+?^${}()|[\]\\]/g;
    const escaped = name.replace(regexMetacharacters, '\\$&');
    const expectedRegexBody = `^${escaped}$`;
    expect(shellDecodesToOneArgument(rendered)).toBe(expectedRegexBody);
  });
});

describe('renderTestCommandTemplate -- untouched placeholders (specs/22 M17 P4) (18 §18.3)', () => {
  it('a placeholder with no corresponding value in `values` is left untouched, verbatim', () => {
    expect(renderTestCommandTemplate('run {files} -t {name}', {})).toBe('run {files} -t {name}');
    expect(renderTestCommandTemplate('run {name:regex}', {})).toBe('run {name:regex}');
  });

  it('{files} is substituted and {name}/{name:regex} are left alone when only `files` is given', () => {
    expect(renderTestCommandTemplate('run {files} -t {name}', { files: ['a.test.js'] })).toBe(
      "run 'a.test.js' -t {name}",
    );
  });
});

describe('withTimeoutOverride (specs/22 M17 P4)', () => {
  it("an explicit override wins over the command's own declared timeoutMs", () => {
    const command = {
      run: 'true',
      output: { source: 'stdout' as const },
      format: 'tap' as const,
      timeoutMs: 5_000,
    };
    expect(withTimeoutOverride(command, 400)).toEqual({ ...command, timeoutMs: 400 });
  });

  it("falls back to the command's own declared timeoutMs when no override is given", () => {
    const command = {
      run: 'true',
      output: { source: 'stdout' as const },
      format: 'tap' as const,
      timeoutMs: 5_000,
    };
    expect(withTimeoutOverride(command, undefined)).toBe(command);
  });

  it('a command with no declared timeoutMs at all: an override still applies, and omitting one leaves it undeclared', () => {
    const command = { run: 'true', output: { source: 'stdout' as const }, format: 'tap' as const };
    expect(withTimeoutOverride(command, 400)).toEqual({ ...command, timeoutMs: 400 });
    expect(withTimeoutOverride(command, undefined)).toBe(command);
  });
});
