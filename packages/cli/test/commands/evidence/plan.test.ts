/**
 * `computeProtection`/`computeStillReferenced` — the pure fixed-point decision logic, as plain data in
 * and data out (no filesystem, no clock): `18` §18.7 Retention, `process/SPEC-QUESTIONS.md` Q294
 * Decision 9.
 *
 * @see specs/18-persistence-config-and-schemas.md §18.7
 * @see process/plans/PLAN-M16.md P14
 * @see process/SPEC-QUESTIONS.md Q294 Decision 9
 */
import { describe, expect, it } from 'vitest';

import { computeProtection, computeStillReferenced } from '../../../src/commands/evidence/plan.ts';
import type {
  EvidenceEnumeration,
  EvidenceRecordInfo,
} from '../../../src/commands/evidence/types.ts';

function record(
  overrides: Partial<EvidenceRecordInfo> & Pick<EvidenceRecordInfo, 'id' | 'type' | 'numericId'>,
): EvidenceRecordInfo {
  return {
    subject: 'STORY-001',
    relPath: `reports/x/${overrides.id}.md`,
    sha256: 'a'.repeat(64),
    references: [],
    ...overrides,
  };
}

function enumeration(
  records: readonly EvidenceRecordInfo[],
  gateCitations: EvidenceEnumeration['gateCitations'] = [],
): EvidenceEnumeration {
  return { records, gateCitations };
}

describe('computeProtection (specs/22 M16 P14)', () => {
  it('keeps exactly the newest n per (type, subject) and reports why', () => {
    const records = Array.from({ length: 7 }, (_unused, index) =>
      record({ id: `MUT-00${String(index + 1)}`, type: 'MutationEvidence', numericId: index + 1 }),
    );
    const { protectedIds, reasons } = computeProtection(enumeration(records), 5);
    // Newest 5: ids 3..7 survive; 1 and 2 do not.
    expect([...protectedIds].sort()).toEqual([
      'MUT-003',
      'MUT-004',
      'MUT-005',
      'MUT-006',
      'MUT-007',
    ]);
    expect(reasons.get('MUT-007')).toEqual({ kind: 'newest', keep: 5 });
  });

  it('keeps the newest n independently per subject, never pooling two subjects together', () => {
    const records = [
      record({ id: 'MUT-001', type: 'MutationEvidence', numericId: 1, subject: 'STORY-001' }),
      record({ id: 'MUT-002', type: 'MutationEvidence', numericId: 2, subject: 'STORY-001' }),
      record({ id: 'MUT-003', type: 'MutationEvidence', numericId: 3, subject: 'STORY-002' }),
    ];
    const { protectedIds } = computeProtection(enumeration(records), 1);
    // Keep 1 per subject: the newest of STORY-001 (MUT-002) AND the newest of STORY-002 (MUT-003,
    // which also happens to be the global highest id, so it is doubly protected) both survive.
    expect([...protectedIds].sort()).toEqual(['MUT-002', 'MUT-003']);
  });

  it('never prunes the highest id of a type, across every subject, under --keep 1', () => {
    // 6 records, two subjects, --keep 1: the global highest MUT id (MUT-006, subject STORY-002) is
    // also the newest for ITS OWN subject — ids are a single counter per type (never per subject), so
    // the global max can never belong to a subject where something else outranks it. §18.7 states the
    // highest-id rule as its own, explicit guarantee anyway (not merely an accident of --keep), which
    // the next test exercises as a property across many random shapes rather than one fixed example.
    const records = [
      ...Array.from({ length: 5 }, (_unused, index) =>
        record({
          id: `MUT-00${String(index + 1)}`,
          type: 'MutationEvidence',
          numericId: index + 1,
          subject: 'STORY-001',
        }),
      ),
      record({ id: 'MUT-006', type: 'MutationEvidence', numericId: 6, subject: 'STORY-002' }),
    ];
    const { protectedIds, reasons } = computeProtection(enumeration(records), 1);
    expect([...protectedIds].sort()).toEqual(['MUT-005', 'MUT-006']);
    // MUT-006 is the newest of its OWN subject too, so "newest" (not "highest-id") is the reason this
    // function actually reports for it — "highest-id" seeds the identical id but never overwrites a
    // reason `protect()` already recorded (`18` §18.7: "n of at least 1 already implies it").
    expect(reasons.get('MUT-006')).toEqual({ kind: 'newest', keep: 1 });
  });

  it('the highest-id rule holds on its own, independent of --keep: isolated with keep=0 (an input only this unit test, not any real caller, may pass — §18.7: "n >= 1 already implies it... stated on its own")', () => {
    const records = Array.from({ length: 3 }, (_unused, index) =>
      record({
        id: `MUT-00${String(index + 1)}`,
        type: 'MutationEvidence',
        numericId: index + 1,
        subject: 'STORY-001',
      }),
    );
    const { protectedIds, reasons } = computeProtection(enumeration(records), 0);
    // "newest 0" keeps nothing on its own — the highest-id rule is the ONLY thing standing between
    // this input and protecting nothing at all.
    expect([...protectedIds]).toEqual(['MUT-003']);
    expect(reasons.get('MUT-003')).toEqual({ kind: 'highest-id' });
  });

  it('property: for any set of records and any keep >= 1, the highest id of every type present is always protected', () => {
    // A hand-rolled seeded PRNG (QUALITY-BAR.md R10: no Math.random in a test that must reproduce) —
    // xorshift32, tiny and adequate for generating shapes, not cryptography.
    let state = 0x2fa1_c3b7;
    const next = (): number => {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      return (state >>> 0) / 0xffffffff;
    };
    const types: EvidenceRecordInfo['type'][] = [
      'MutationEvidence',
      'EvidenceBundle',
      'ParityEvidence',
    ];
    for (let trial = 0; trial < 200; trial += 1) {
      const recordCount = 1 + Math.floor(next() * 12);
      const subjectCount = 1 + Math.floor(next() * 4);
      const keep = 1 + Math.floor(next() * 5);
      const byType = new Map<EvidenceRecordInfo['type'], EvidenceRecordInfo[]>();
      for (let index = 0; index < recordCount; index += 1) {
        const type = types[Math.floor(next() * types.length)]!;
        const subject = `STORY-${String(Math.floor(next() * subjectCount))}`;
        const existing = byType.get(type) ?? [];
        const numericId = existing.length + 1;
        existing.push(record({ id: `${type}-${String(numericId)}`, type, numericId, subject }));
        byType.set(type, existing);
      }
      const records = [...byType.values()].flat();
      const { protectedIds } = computeProtection(enumeration(records), keep);
      for (const [type, group] of byType) {
        const highest = group.reduce((max, current) =>
          current.numericId > max.numericId ? current : max,
        );
        expect(
          protectedIds.has(highest.id),
          `trial ${String(trial)}: ${type}'s highest id ${highest.id} was pruned`,
        ).toBe(true);
      }
    }
  });

  it('protects an EvidenceBundle referenced by a gate citation, AND propagates to what that bundle itself references (the fixed point, not a single pass)', () => {
    // EVID-001 is old enough that --keep would prune it on its own; it is kept ONLY because a gate
    // cites it by specific id. The bundle itself references MUT-001, which --keep would also prune on
    // its own. A "protect on one pass, not a fixed point" bug seeds EVID-001 (direct citation) but
    // never re-examines it to pick up what it, in turn, references.
    const records = [
      record({ id: 'EVID-001', type: 'EvidenceBundle', numericId: 1, references: ['MUT-001'] }),
      record({ id: 'EVID-002', type: 'EvidenceBundle', numericId: 2, references: [] }),
      record({ id: 'MUT-001', type: 'MutationEvidence', numericId: 1 }),
      record({ id: 'MUT-002', type: 'MutationEvidence', numericId: 2 }),
    ];
    const gateCitations = [
      {
        gateId: 'G-Verify',
        ref: 'EvidenceBundle(EVID-001)',
        type: 'EvidenceBundle' as const,
        id: 'EVID-001',
      },
    ];
    const { protectedIds, reasons } = computeProtection(enumeration(records, gateCitations), 1);
    expect(protectedIds.has('EVID-001')).toBe(true);
    expect(reasons.get('EVID-001')).toEqual({
      kind: 'referenced-by-gate',
      gateId: 'G-Verify',
      ref: 'EvidenceBundle(EVID-001)',
    });
    // The real, load-bearing assertion: MUT-001 survives purely because EVID-001 cites it, even
    // though MUT-001 is NOT the newest-1 of its own subject and is NOT the highest MUT id.
    expect(protectedIds.has('MUT-001')).toBe(true);
    expect(reasons.get('MUT-001')).toEqual({ kind: 'referenced-by-record', by: 'EVID-001' });
    // MUT-002 is the newest-1/highest MUT id, protected on its own rule, not via EVID-001.
    expect(protectedIds.has('MUT-002')).toBe(true);
  });

  it('a record referenced ONLY by a record this same prune removes is not protected, regardless of visit order', () => {
    // EVID-001 (old, --keep 1 removes it, nothing cites it) references MUT-001 (also old). MUT-001
    // must NOT survive: its only citation comes from a record that itself does not survive.
    const forward: EvidenceRecordInfo[] = [
      record({ id: 'EVID-001', type: 'EvidenceBundle', numericId: 1, references: ['MUT-001'] }),
      record({ id: 'EVID-002', type: 'EvidenceBundle', numericId: 2, references: [] }),
      record({ id: 'MUT-001', type: 'MutationEvidence', numericId: 1 }),
      record({ id: 'MUT-002', type: 'MutationEvidence', numericId: 2 }),
    ];
    const reversed = [...forward].reverse();
    for (const records of [forward, reversed]) {
      const { protectedIds } = computeProtection(enumeration(records), 1);
      expect(protectedIds.has('EVID-001')).toBe(false);
      expect(protectedIds.has('MUT-001')).toBe(false);
      expect(protectedIds.has('EVID-002')).toBe(true);
      expect(protectedIds.has('MUT-002')).toBe(true);
    }
  });

  it('the fixed point genuinely needs more than one propagation pass when a chain is two hops deep, in EITHER record order', () => {
    // Today's real schemas never let an EvidenceBundle reference another EvidenceBundle (`references`
    // only ever holds MUT/PAR ids in production — this piece's own report names every real reference
    // field found), so a real fixture can never need a SECOND propagation pass: every real chain is
    // exactly one hop. `references` itself is typed as a bare `readonly string[]`, with nothing at the
    // type level forbidding this shape, so this test constructs the one case that WOULD need a real
    // fixed point rather than a single pass, to prove the `while` loop is load-bearing and not simply
    // "one pass that happens to already be enough" dressed up as a loop. Two record orders: one where
    // the referencing bundle is seen before the one it references (needs two passes to converge) and
    // one where it is seen after (one pass already suffices) — both must reach the identical fixed
    // point regardless (`18` §18.7: "the outcome does not depend on the order in which records are
    // visited").
    // EVID-C is the newest/highest EvidenceBundle for its subject under --keep 1, so EVID-A and
    // EVID-B are BOTH, independently, exactly what --keep/highest-id would prune on their own —
    // neither can lean on that rule the way the earlier, flawed version of this test accidentally did.
    const gateCited = record({
      id: 'EVID-A',
      type: 'EvidenceBundle',
      numericId: 1,
      references: ['EVID-B'],
    });
    const chained = record({
      id: 'EVID-B',
      type: 'EvidenceBundle',
      numericId: 2,
      references: ['MUT-001'],
    });
    const newest = record({ id: 'EVID-C', type: 'EvidenceBundle', numericId: 3, references: [] });
    const target = record({ id: 'MUT-001', type: 'MutationEvidence', numericId: 1 });
    const filler = record({ id: 'MUT-002', type: 'MutationEvidence', numericId: 2 });
    const gateCitations = [
      {
        gateId: 'G-X',
        ref: 'EvidenceBundle(EVID-A)',
        type: 'EvidenceBundle' as const,
        id: 'EVID-A',
      },
    ];
    for (const records of [
      [chained, gateCited, newest, target, filler],
      [gateCited, chained, newest, target, filler],
    ]) {
      const { protectedIds } = computeProtection(enumeration(records, gateCitations), 1);
      expect(protectedIds.has('EVID-A')).toBe(true);
      // The real, load-bearing assertion: EVID-B is cited by NOTHING directly (no gate names it, and
      // it is not the newest/highest of its type) — it survives ONLY via EVID-A's own reference, and
      // MUT-001 survives ONLY via EVID-B's, two hops from the one real seed.
      expect(protectedIds.has('EVID-B')).toBe(true);
      expect(protectedIds.has('MUT-001')).toBe(true);
    }
  });

  it('a gate citation naming an id that does not exist on disk protects nothing (it cannot protect what is not there)', () => {
    const records = [record({ id: 'MUT-001', type: 'MutationEvidence', numericId: 1 })];
    const gateCitations = [
      {
        gateId: 'G-X',
        ref: 'MutationEvidence(MUT-999)',
        type: 'MutationEvidence' as const,
        id: 'MUT-999',
      },
    ];
    const { protectedIds } = computeProtection(enumeration(records, gateCitations), 1);
    expect(protectedIds.has('MUT-999')).toBe(false);
    // MUT-001 still survives on its own (newest-1/highest), unaffected by the dangling citation.
    expect(protectedIds.has('MUT-001')).toBe(true);
  });
});

describe('computeStillReferenced (specs/22 M16 P14)', () => {
  it('reports a candidate referenced by a surviving EvidenceBundle, and ignores a citation from a bundle that is itself dead', () => {
    const records = [
      record({ id: 'EVID-001', type: 'EvidenceBundle', numericId: 1, references: ['MUT-001'] }),
      record({ id: 'EVID-002', type: 'EvidenceBundle', numericId: 2, references: ['MUT-002'] }),
    ];
    const candidateIds = new Set(['MUT-001', 'MUT-002']);
    // EVID-002 is itself one of THIS prune's own candidates (about to be removed) — its own citation
    // of MUT-002 must not count; EVID-001 survives, so its citation of MUT-001 does.
    const deadBundleIds = new Set(['EVID-002']);
    const stillReferenced = computeStillReferenced(
      enumeration(records),
      candidateIds,
      deadBundleIds,
    );
    expect(stillReferenced.has('MUT-001')).toBe(true);
    expect(stillReferenced.has('MUT-002')).toBe(false);
  });

  it('reports a candidate referenced by a gate citation', () => {
    const gateCitations = [
      {
        gateId: 'G-X',
        ref: 'MutationEvidence(MUT-001)',
        type: 'MutationEvidence' as const,
        id: 'MUT-001',
      },
    ];
    const stillReferenced = computeStillReferenced(
      enumeration([], gateCitations),
      new Set(['MUT-001']),
      new Set(),
    );
    expect(stillReferenced.has('MUT-001')).toBe(true);
  });

  it('reports nothing for a candidate no current store references', () => {
    const stillReferenced = computeStillReferenced(
      enumeration([]),
      new Set(['MUT-001']),
      new Set(),
    );
    expect(stillReferenced.size).toBe(0);
  });

  it('a dead-classified bundle that is itself spared by a late gate citation must also spare what IT references — the second pass needs its own fixed point, not a single pass', () => {
    // EVID-001 was classified "dead" by the FIRST enumeration pass (it is one of `deadBundleIds`) —
    // but a gate citation arriving before the SECOND enumeration names it directly, so it actually
    // survives this run (`stillReferenced.has('EVID-001')` must be true). Once that is known, its own
    // reference to MUT-001 must count too: a single pass that permanently excludes every
    // `deadBundleIds` member (the committed bug) would report MUT-001 as unreferenced and let it be
    // removed, even though the record that cites it — EVID-001 — is sitting right there on disk, not
    // actually gone. This is the exact scenario `prune.test.ts`'s own end-to-end repro proves against
    // real files; this is its pure, direct-unit-level twin.
    const records = [
      record({ id: 'EVID-001', type: 'EvidenceBundle', numericId: 1, references: ['MUT-001'] }),
      record({ id: 'MUT-001', type: 'MutationEvidence', numericId: 1 }),
    ];
    const gateCitations = [
      {
        gateId: 'G-Late',
        ref: 'EvidenceBundle(EVID-001)',
        type: 'EvidenceBundle' as const,
        id: 'EVID-001',
      },
    ];
    const candidateIds = new Set(['EVID-001', 'MUT-001']);
    const deadBundleIds = new Set(['EVID-001']);
    const stillReferenced = computeStillReferenced(
      enumeration(records, gateCitations),
      candidateIds,
      deadBundleIds,
    );
    expect(stillReferenced.has('EVID-001')).toBe(true);
    // The real, load-bearing assertion: MUT-001 survives too, purely because EVID-001 — which turns
    // out not to be removed after all — cites it.
    expect(stillReferenced.has('MUT-001')).toBe(true);
  });

  it('the correction chains across two hops: D is newly cited, which spares X (D references X), which in turn spares W (X references W) — neither X nor W is cited directly by anything', () => {
    // Today's real schemas never let an EvidenceBundle reference another EvidenceBundle (the identical
    // fact `computeProtection`'s own two-hop test above states for the first pass), so this exact shape
    // cannot arise from real on-disk files — it is constructed here, the same way, to prove the `while`
    // loop genuinely reaches a fixed point rather than stopping after one "unexclude and redo" pass,
    // which would only be enough for a one-hop chain and would silently under-protect a deeper one.
    const recordD = record({
      id: 'EVID-D',
      type: 'EvidenceBundle',
      numericId: 1,
      references: ['EVID-X'],
    });
    const recordX = record({
      id: 'EVID-X',
      type: 'EvidenceBundle',
      numericId: 2,
      references: ['MUT-W'],
    });
    const recordW = record({ id: 'MUT-W', type: 'MutationEvidence', numericId: 1 });
    const gateCitations = [
      {
        gateId: 'G-Late',
        ref: 'EvidenceBundle(EVID-D)',
        type: 'EvidenceBundle' as const,
        id: 'EVID-D',
      },
    ];
    const candidateIds = new Set(['EVID-D', 'EVID-X', 'MUT-W']);
    const deadBundleIds = new Set(['EVID-D', 'EVID-X']);
    for (const records of [
      [recordD, recordX, recordW],
      [recordX, recordD, recordW],
      [recordW, recordX, recordD],
    ]) {
      const stillReferenced = computeStillReferenced(
        enumeration(records, gateCitations),
        candidateIds,
        deadBundleIds,
      );
      expect(stillReferenced.has('EVID-D')).toBe(true);
      // EVID-X is cited by nothing directly — it survives ONLY because EVID-D (itself only just now
      // known to survive) references it.
      expect(stillReferenced.has('EVID-X')).toBe(true);
      // MUT-W is cited by nothing directly either — it survives ONLY via EVID-X's own reference, two
      // hops from the one real citation, regardless of the order records are visited in (`18` §18.7:
      // "the outcome does not depend on the order in which records are visited" — stated for the first
      // pass, proven here to hold for the second too).
      expect(stillReferenced.has('MUT-W')).toBe(true);
    }
  });
});
