/**
 * `classifyReferenceRefShape`/`classifyReferenceRefFormat` (specs/22 M16 P2) — `13` F-TEST-9's
 * `reference.ref` format: a full commit sha (40 or 64 lower-case hex digits) or a tag name
 * `git check-ref-format` accepts as `refs/tags/<name>`; `HEAD`, a bare branch name, an abbreviated
 * sha and an upper-case sha are each `invalid`.
 *
 * Real `git check-ref-format` calls throughout — no mock of git exists in this suite.
 *
 * @see specs/13-frameworks-testing-and-debugging.md F-TEST-9
 * @see process/SPEC-QUESTIONS.md Q294 (Decision 3's exactness rules)
 */
import { describe, expect, it } from 'vitest';

import {
  classifyReferenceRefFormat,
  classifyReferenceRefShape,
  isAcceptedTagName,
} from '../../../src/commands/parity/reference-ref.ts';

const SHA40 = 'a'.repeat(40);
const SHA64 = 'b'.repeat(64);

describe('classifyReferenceRefShape (specs/22 M16 P2)', () => {
  it('accepts a full 40-digit lower-case sha', () => {
    expect(classifyReferenceRefShape(SHA40)).toEqual({ kind: 'sha', sha: SHA40 });
  });

  it('accepts a full 64-digit lower-case sha (a SHA-256 repository)', () => {
    expect(classifyReferenceRefShape(SHA64)).toEqual({ kind: 'sha', sha: SHA64 });
  });

  it('rejects the same 40 digits upper-cased', () => {
    const result = classifyReferenceRefShape(SHA40.toUpperCase());
    expect(result.kind).toBe('invalid');
  });

  it('rejects the same 64 digits upper-cased', () => {
    const result = classifyReferenceRefShape(SHA64.toUpperCase());
    expect(result.kind).toBe('invalid');
  });

  it('rejects a mixed-case 40-digit string with just one upper-case letter', () => {
    const mixed = `A${SHA40.slice(1)}`;
    expect(classifyReferenceRefShape(mixed).kind).toBe('invalid');
  });

  it('rejects an abbreviated sha (right alphabet, wrong length) rather than trying it as a tag', () => {
    const result = classifyReferenceRefShape('a1b2c3d');
    expect(result.kind).toBe('invalid');
  });

  it('rejects the literal "HEAD" outright', () => {
    const result = classifyReferenceRefShape('HEAD');
    expect(result.kind).toBe('invalid');
    expect(result.kind === 'invalid' && result.reason).toMatch(/HEAD/);
  });

  it('rejects an empty string', () => {
    expect(classifyReferenceRefShape('').kind).toBe('invalid');
    expect(classifyReferenceRefShape('   ').kind).toBe('invalid');
  });

  it('defers an ordinary tag-shaped name ("v1.0") to the async git check, as maybe-tag', () => {
    expect(classifyReferenceRefShape('v1.0')).toEqual({ kind: 'maybe-tag', name: 'v1.0' });
  });

  it('defers a bare branch-shaped name ("main") too: nothing distinguishes it from a tag by text alone', () => {
    expect(classifyReferenceRefShape('main')).toEqual({ kind: 'maybe-tag', name: 'main' });
  });
});

describe('isAcceptedTagName (specs/22 M16 P2) — real `git check-ref-format`', () => {
  it('accepts an ordinary tag name', async () => {
    expect(await isAcceptedTagName('v1.0')).toBe(true);
  });

  it('rejects "v1~1" (git check-ref-format refuses "~" in a refname component)', async () => {
    expect(await isAcceptedTagName('v1~1')).toBe(false);
  });

  it('rejects a name with a space', async () => {
    expect(await isAcceptedTagName('bad name')).toBe(false);
  });

  it('is unaffected by a name that looks like a flag: it is always argv-prefixed "refs/tags/"', async () => {
    expect(await isAcceptedTagName('-rf')).toBe(true);
  });
});

describe('classifyReferenceRefFormat (specs/22 M16 P2) — the full async check', () => {
  it('resolves a sha without needing git at all', async () => {
    expect(await classifyReferenceRefFormat(SHA40)).toEqual({ kind: 'sha', sha: SHA40 });
  });

  it('resolves an accepted tag name to {kind: "tag"}', async () => {
    expect(await classifyReferenceRefFormat('v1.0')).toEqual({ kind: 'tag', name: 'v1.0' });
  });

  it('resolves "v1~1" to invalid (check-ref-format rejects it as "refs/tags/v1~1")', async () => {
    const result = await classifyReferenceRefFormat('v1~1');
    expect(result.kind).toBe('invalid');
  });

  it('resolves "HEAD" to invalid without ever calling git (the sync shape check short-circuits)', async () => {
    const result = await classifyReferenceRefFormat('HEAD');
    expect(result.kind).toBe('invalid');
  });

  it('resolves an abbreviated sha to invalid without ever calling git', async () => {
    const result = await classifyReferenceRefFormat('deadbee');
    expect(result.kind).toBe('invalid');
  });

  it('resolves an upper-case sha to invalid', async () => {
    const result = await classifyReferenceRefFormat(SHA40.toUpperCase());
    expect(result.kind).toBe('invalid');
  });
});
