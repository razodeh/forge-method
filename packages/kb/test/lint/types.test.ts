/**
 * `sortFindings` — the canonical `(ruleId, entryId, message)` ordering every exported check in
 * `@forge/kb/lint` applies to its own return value (R10).
 *
 * @see PLAN-M3.md P10
 * @see SPEC-QUESTIONS.md Q56
 */
import { describe, expect, it } from 'vitest';

import { sortFindings, type KbFinding } from '../../src/lint/types.ts';

function finding(overrides: Partial<KbFinding> = {}): KbFinding {
  return { ruleId: 'kb:schema', severity: 'error', message: 'x', ...overrides };
}

describe('sortFindings', () => {
  it('sorts primarily by ruleId', () => {
    const sorted = sortFindings([
      finding({ ruleId: 'kb:staleness' }),
      finding({ ruleId: 'kb:orphan' }),
    ]);
    expect(sorted.map((f) => f.ruleId)).toEqual(['kb:orphan', 'kb:staleness']);
  });

  it('breaks a ruleId tie by entryId, treating a missing entryId as smaller than any real one', () => {
    const sorted = sortFindings([
      finding({ entryId: 'KB-ARCH-0002' }),
      finding({}),
      finding({ entryId: 'KB-ARCH-0001' }),
    ]);
    expect(sorted.map((f) => f.entryId)).toEqual([undefined, 'KB-ARCH-0001', 'KB-ARCH-0002']);
  });

  it('breaks a ruleId+entryId tie by message', () => {
    const sorted = sortFindings([
      finding({ entryId: 'KB-ARCH-0001', message: 'b' }),
      finding({ entryId: 'KB-ARCH-0001', message: 'a' }),
    ]);
    expect(sorted.map((f) => f.message)).toEqual(['a', 'b']);
  });

  it('leaves two byte-identical findings in a stable relative order rather than reordering them arbitrarily', () => {
    const first = finding({ entryId: 'KB-ARCH-0001', message: 'same' });
    const second = finding({ entryId: 'KB-ARCH-0001', message: 'same' });
    expect(sortFindings([first, second])).toEqual([first, second]);
  });

  it('does not mutate its input array', () => {
    const input = [finding({ ruleId: 'kb:staleness' }), finding({ ruleId: 'kb:orphan' })];
    const before = [...input];
    sortFindings(input);
    expect(input).toEqual(before);
  });
});
