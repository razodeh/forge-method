/**
 * `hashFixDiff`/`detectForbiddenFixPattern` — `PLAN-M8.md` P8's own Checks section.
 *
 * @see specs/13 §13.2 F-DEBUG-1
 * @see specs/13 §13.2 F-DEBUG-2
 * @see PLAN-M8.md P8
 */
import { describe, expect, it } from 'vitest';

import { detectForbiddenFixPattern, hashFixDiff } from '../../src/rca/anti-thrash.ts';

describe('hashFixDiff', () => {
  it('hashes byte-identical diffs identically', () => {
    const diff = `--- a/src/x.ts\n+++ b/src/x.ts\n@@ -1,1 +1,1 @@\n-const x = 1;\n+const x = 2;\n`;
    expect(hashFixDiff(diff)).toBe(hashFixDiff(diff));
  });

  it('hashes two diffs identically when they differ only in whitespace', () => {
    const diffA = `--- a/src/x.ts\n+++ b/src/x.ts\n@@ -1,1 +1,1 @@\n-const x = 1;\n+const   x   =   2;\n`;
    const diffB = `--- a/src/x.ts\n+++ b/src/x.ts\n@@ -1,1 +1,1 @@\n-const x = 1;\n+const x = 2;\n`;
    expect(hashFixDiff(diffA)).toBe(hashFixDiff(diffB));
  });

  it('hashes two diffs identically when they differ only in comments', () => {
    const diffA = `--- a/src/x.ts\n+++ b/src/x.ts\n@@ -1,1 +1,1 @@\n-const x = 1;\n+const x = 2; // fixed the off-by-one\n`;
    const diffB = `--- a/src/x.ts\n+++ b/src/x.ts\n@@ -1,1 +1,1 @@\n-const x = 1;\n+const x = 2;\n`;
    expect(hashFixDiff(diffA)).toBe(hashFixDiff(diffB));
  });

  it('hashes two diffs identically when they differ only in a block comment', () => {
    const diffA = `--- a/src/x.ts\n+++ b/src/x.ts\n@@ -1,1 +1,1 @@\n-const x = 1;\n+/* fixed */ const x = 2;\n`;
    const diffB = `--- a/src/x.ts\n+++ b/src/x.ts\n@@ -1,1 +1,1 @@\n-const x = 1;\n+const x = 2;\n`;
    expect(hashFixDiff(diffA)).toBe(hashFixDiff(diffB));
  });

  it('hashes two diffs with a real, substantive difference differently', () => {
    const diffA = `--- a/src/x.ts\n+++ b/src/x.ts\n@@ -1,1 +1,1 @@\n-const x = 1;\n+const x = 2;\n`;
    const diffB = `--- a/src/x.ts\n+++ b/src/x.ts\n@@ -1,1 +1,1 @@\n-const x = 1;\n+const x = 3;\n`;
    expect(hashFixDiff(diffA)).not.toBe(hashFixDiff(diffB));
  });

  it('hashes the identical content change to two different files differently', () => {
    // A fresh critic round reproduced this directly: stripping every diff metadata line, including
    // the file-path headers, let "wrong file, try again" (a real, substantively different attempt)
    // hash identically to the first attempt, silently refusing it as thrash.
    const diffA = `--- a/src/line.ts\n+++ b/src/line.ts\n@@ -1,1 +1,1 @@\n-round(line);\n+round(subtotal);\n`;
    const diffB = `--- a/src/subtotal.ts\n+++ b/src/subtotal.ts\n@@ -1,1 +1,1 @@\n-round(line);\n+round(subtotal);\n`;
    expect(hashFixDiff(diffA)).not.toBe(hashFixDiff(diffB));
  });

  it('never lets a real string literal (a URL, e.g.) corrupt comment-stripping and swallow real code after it', () => {
    // A fresh critic round reproduced this directly: naive `//`-stripping applied to raw source text
    // ate everything after `//` inside a real string literal through to end-of-line — including real
    // code on the same line after the string — silently dropping it from the hash entirely. Blanking
    // string-literal *contents* before comment-stripping fixes that real corruption risk; the real,
    // disclosed trade-off (`anti-thrash.ts`'s own doc comment) is that two attempts differing *only*
    // inside a string's own content now also hash identically, treated the same as a whitespace-only
    // difference — a false "near-identical" refusal in that one narrow case, not silent data loss.
    const diffA = `+  const url = "https://x"; doSomethingImportant();\n`;
    const diffB = `+  const url = "https://y"; doSomethingImportant();\n`;
    expect(hashFixDiff(diffA)).toBe(hashFixDiff(diffB));
  });
});

describe('detectForbiddenFixPattern', () => {
  it('flags a broadened, empty catch block', () => {
    const diff = `+  try { risky(); } catch (e) {}\n`;
    expect(detectForbiddenFixPattern(diff)).toBeDefined();
  });

  it('flags an added sleep', () => {
    const diff = `+  await sleep(500);\n`;
    expect(detectForbiddenFixPattern(diff)).toBeDefined();
  });

  it('flags an added setTimeout used as a delay', () => {
    const diff = `+  setTimeout(() => resolve(), 200);\n`;
    expect(detectForbiddenFixPattern(diff)).toBeDefined();
  });

  it('flags an added retry loop', () => {
    const diff = `+  for (let retry = 0; retry < 3; retry++) { attempt(); }\n`;
    expect(detectForbiddenFixPattern(diff)).toBeDefined();
  });

  it('flags a loosened assertion', () => {
    const diff = `+  expect(result).toBeDefined();\n`;
    expect(detectForbiddenFixPattern(diff)).toBeDefined();
  });

  it('flags a null-check that silently returns', () => {
    const diff = `+  if (value === null) return;\n`;
    expect(detectForbiddenFixPattern(diff)).toBeDefined();
  });

  it('does not flag a real, ordinary fix with none of the forbidden shapes', () => {
    const diff = `+  const total = items.reduce((sum, item) => sum + item.price, 0);\n`;
    expect(detectForbiddenFixPattern(diff)).toBeUndefined();
  });

  it('does not flag a forbidden pattern that only appears on a removed line', () => {
    const diff = `-  await sleep(500);\n+  const total = compute();\n`;
    expect(detectForbiddenFixPattern(diff)).toBeUndefined();
  });

  it('does not flag a comment that only documents why a retry was deliberately not added', () => {
    const diff = `+  // no retry is needed here; the caller already serialises\n+  const total = compute();\n`;
    expect(detectForbiddenFixPattern(diff)).toBeUndefined();
  });

  it('does not flag a string literal that merely mentions a forbidden word', () => {
    const diff = `+  const msg = "please don't sleep on this bug";\n`;
    expect(detectForbiddenFixPattern(diff)).toBeUndefined();
  });

  it('does not flag a doc comment listing the forbidden words themselves', () => {
    const diff = `+  /** Never add a retry or a sleep here. */\n+  function compute() { return 1; }\n`;
    expect(detectForbiddenFixPattern(diff)).toBeUndefined();
  });

  it('does not flag an unrelated counter increment merely named "attempts"', () => {
    const diff = `+  metrics.attempts++;\n`;
    expect(detectForbiddenFixPattern(diff)).toBeUndefined();
  });

  it('does not flag a null-check with a real fallback value, only a bare skip', () => {
    const diff = `+  if (options === undefined) return defaults;\n`;
    expect(detectForbiddenFixPattern(diff)).toBeUndefined();
  });

  it('flags a null-check using loose equality with a bare skip', () => {
    const diff = `+  if (value == null) return;\n`;
    expect(detectForbiddenFixPattern(diff)).toBeDefined();
  });
});
