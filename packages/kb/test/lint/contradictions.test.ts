/**
 * `checkContradictions` — `08` §8.7's own "Contradiction detection implementation" paragraph: the
 * curated antonym-pair tag conflict, conflicting ADR statuses, and two `accepted` ADRs in the same
 * scope with no supersession link.
 *
 * @see specs/08 §8.7
 * @see SPEC-QUESTIONS.md Q56
 * @see PLAN-M3.md P10
 */
import { describe, expect, it } from 'vitest';

import { checkContradictions } from '../../src/lint/contradictions.ts';
import { adr, kbEntry } from './factories.ts';

describe('checkContradictions — antonym-pair tag conflicts', () => {
  it('flags two active entries in the same section, applying to the same subject, with opposing tags', () => {
    const a = kbEntry({
      id: 'KB-ARCH-0001',
      section: 'architecture',
      status: 'active',
      applies_to: ['component:api'],
      tags: ['sync'],
    });
    const b = kbEntry({
      id: 'KB-ARCH-0002',
      section: 'architecture',
      status: 'active',
      applies_to: ['component:api'],
      tags: ['async'],
    });
    const findings = checkContradictions([a, b], []);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.ruleId).toBe('kb:contradiction');
    expect(findings[0]?.severity).toBe('error');
  });

  it("flags the reverse assignment too (first entry carries the pair's second tag, second entry the first)", () => {
    const a = kbEntry({ section: 'architecture', applies_to: ['component:api'], tags: ['async'] });
    const b = kbEntry({ section: 'architecture', applies_to: ['component:api'], tags: ['sync'] });
    const findings = checkContradictions([a, b], []);
    expect(findings).toHaveLength(1);
  });

  it('does not flag the same tag conflict when the two entries do not share an applies_to subject', () => {
    const a = kbEntry({ section: 'architecture', applies_to: ['component:api'], tags: ['sync'] });
    const b = kbEntry({ section: 'architecture', applies_to: ['component:db'], tags: ['async'] });
    expect(checkContradictions([a, b], [])).toEqual([]);
  });

  it('does not flag the same tag conflict when the two entries are in different sections', () => {
    const a = kbEntry({ section: 'architecture', applies_to: ['component:api'], tags: ['sync'] });
    const b = kbEntry({ section: 'data', applies_to: ['component:api'], tags: ['async'] });
    expect(checkContradictions([a, b], [])).toEqual([]);
  });

  it('does not flag a non-active entry, even with an otherwise-conflicting tag', () => {
    const a = kbEntry({
      section: 'architecture',
      applies_to: ['component:api'],
      tags: ['sync'],
      status: 'active',
    });
    const b = kbEntry({
      section: 'architecture',
      applies_to: ['component:api'],
      tags: ['async'],
      status: 'draft',
    });
    expect(checkContradictions([a, b], [])).toEqual([]);
  });

  it('does not flag two entries whose tags are not an antonym pair at all', () => {
    const a = kbEntry({ section: 'architecture', applies_to: ['component:api'], tags: ['sync'] });
    const b = kbEntry({ section: 'architecture', applies_to: ['component:api'], tags: ['data'] });
    expect(checkContradictions([a, b], [])).toEqual([]);
  });
});

describe('checkContradictions — conflicting ADR statuses', () => {
  it('flags an ADR that claims to supersede another whose own status/superseded_by disagree', () => {
    const a = adr({ id: 'ADR-0002', supersedes: ['ADR-0001'] });
    const b = adr({ id: 'ADR-0001', status: 'accepted', superseded_by: null });
    const findings = checkContradictions([], [a, b]);
    expect(findings.some((f) => f.ruleId === 'kb:contradiction' && f.entryId === 'ADR-0002')).toBe(
      true,
    );
  });

  it('does not flag a consistent supersession pair', () => {
    const a = adr({ id: 'ADR-0002', supersedes: ['ADR-0001'] });
    const b = adr({ id: 'ADR-0001', status: 'superseded', superseded_by: 'ADR-0002' });
    expect(checkContradictions([], [a, b])).toEqual([]);
  });

  it("does not flag a supersedes id that does not resolve to a real entry (that is checkDanglingRefs' job)", () => {
    const a = adr({ id: 'ADR-0002', supersedes: ['ADR-0099'] });
    expect(checkContradictions([], [a])).toEqual([]);
  });

  it('applies the identical check to KB entries, which share the same status/supersedes/superseded_by shape', () => {
    const a = kbEntry({ id: 'KB-ARCH-0002', supersedes: ['KB-ARCH-0001'] });
    const b = kbEntry({ id: 'KB-ARCH-0001', status: 'active', superseded_by: null });
    const findings = checkContradictions([a, b], []);
    expect(findings.some((f) => f.entryId === 'KB-ARCH-0002')).toBe(true);
  });

  it('also catches a cross-kind pair — a KB entry claiming to supersede an ADR that disagrees', () => {
    // A gauntlet critic found the two same-kind calls (KB entries, then ADRs, separately) meant a
    // cross-kind pair like this one was silently never checked at all — `supersedes` is a generic id
    // list on both schemas, so a KB entry naming an ADR id here is a legal, real combination.
    const a = kbEntry({ id: 'KB-ARCH-0001', supersedes: ['ADR-0001'] });
    const b = adr({ id: 'ADR-0001', status: 'accepted', superseded_by: null });
    const findings = checkContradictions([a], [b]);
    expect(
      findings.some((f) => f.ruleId === 'kb:contradiction' && f.entryId === 'KB-ARCH-0001'),
    ).toBe(true);
  });
});

describe('checkContradictions — determinism: symmetric pair conflicts do not depend on input array order', () => {
  it('reports the identical antonym-tag finding regardless of which entry comes first in the array', () => {
    const a = kbEntry({
      id: 'KB-ARCH-0001',
      section: 'architecture',
      applies_to: ['component:api'],
      tags: ['sync'],
    });
    const b = kbEntry({
      id: 'KB-ARCH-0002',
      section: 'architecture',
      applies_to: ['component:api'],
      tags: ['async'],
    });
    const forward = checkContradictions([a, b], []);
    const reversed = checkContradictions([b, a], []);
    expect(JSON.stringify(forward)).toBe(JSON.stringify(reversed));
  });

  it('reports the identical ADR-scope-conflict finding regardless of which ADR comes first in the array', () => {
    const a = adr({ id: 'ADR-0001', status: 'accepted', category: 'architecture' });
    const b = adr({ id: 'ADR-0002', status: 'accepted', category: 'architecture' });
    const entries = [
      kbEntry({ applies_to: ['component:api'], sources: [{ kind: 'decision', ref: 'ADR-0001' }] }),
      kbEntry({ applies_to: ['component:api'], sources: [{ kind: 'decision', ref: 'ADR-0002' }] }),
    ];
    const forward = checkContradictions(entries, [a, b]);
    const reversed = checkContradictions(entries, [b, a]);
    expect(JSON.stringify(forward)).toBe(JSON.stringify(reversed));
  });
});

describe('checkContradictions — two accepted ADRs, same category, overlapping scope, no supersession link', () => {
  it('flags the pair', () => {
    const a = adr({ id: 'ADR-0001', status: 'accepted', category: 'architecture' });
    const b = adr({ id: 'ADR-0002', status: 'accepted', category: 'architecture' });
    const entries = [
      kbEntry({ applies_to: ['component:api'], sources: [{ kind: 'decision', ref: 'ADR-0001' }] }),
      kbEntry({ applies_to: ['component:api'], sources: [{ kind: 'decision', ref: 'ADR-0002' }] }),
    ];
    const findings = checkContradictions(entries, [a, b]);
    expect(findings.some((f) => f.ruleId === 'kb:contradiction' && f.entryId === 'ADR-0001')).toBe(
      true,
    );
  });

  it('clears once a supersedes link is added between the two', () => {
    const a = adr({
      id: 'ADR-0001',
      status: 'accepted',
      category: 'architecture',
      supersedes: ['ADR-0002'],
    });
    const b = adr({
      id: 'ADR-0002',
      status: 'superseded',
      category: 'architecture',
      superseded_by: 'ADR-0001',
    });
    const entries = [
      kbEntry({ applies_to: ['component:api'], sources: [{ kind: 'decision', ref: 'ADR-0001' }] }),
      kbEntry({ applies_to: ['component:api'], sources: [{ kind: 'decision', ref: 'ADR-0002' }] }),
    ];
    const findings = checkContradictions(entries, [a, b]);
    expect(findings.some((f) => f.entryId === 'ADR-0001' || f.entryId === 'ADR-0002')).toBe(false);
  });

  it('does not flag two accepted ADRs in different categories', () => {
    const a = adr({ id: 'ADR-0001', status: 'accepted', category: 'architecture' });
    const b = adr({ id: 'ADR-0002', status: 'accepted', category: 'data' });
    const entries = [
      kbEntry({ applies_to: ['component:api'], sources: [{ kind: 'decision', ref: 'ADR-0001' }] }),
      kbEntry({ applies_to: ['component:api'], sources: [{ kind: 'decision', ref: 'ADR-0002' }] }),
    ];
    expect(checkContradictions(entries, [a, b])).toEqual([]);
  });

  it('does not flag two accepted ADRs with non-overlapping scope', () => {
    const a = adr({ id: 'ADR-0001', status: 'accepted', category: 'architecture' });
    const b = adr({ id: 'ADR-0002', status: 'accepted', category: 'architecture' });
    const entries = [
      kbEntry({ applies_to: ['component:api'], sources: [{ kind: 'decision', ref: 'ADR-0001' }] }),
      kbEntry({ applies_to: ['component:db'], sources: [{ kind: 'decision', ref: 'ADR-0002' }] }),
    ];
    expect(checkContradictions(entries, [a, b])).toEqual([]);
  });
});
