/**
 * `describePruneReason` — the one pure function behind every human/`--json`-shared reason string
 * `forge evidence prune` reports (`types.ts`).
 *
 * @see process/plans/PLAN-M16.md P14
 */
import { describe, expect, it } from 'vitest';

import { describePruneReason } from '../../../src/commands/evidence/types.ts';

describe('describePruneReason (specs/22 M16 P14)', () => {
  it('renders every real PruneReason kind as a distinct, non-empty sentence fragment', () => {
    const cases: Parameters<typeof describePruneReason>[0][] = [
      { kind: 'newest', keep: 5 },
      { kind: 'highest-id' },
      { kind: 'referenced-by-record', by: 'EVID-001' },
      { kind: 'referenced-by-gate', gateId: 'G-Verify', ref: 'MutationEvidence(MUT-001)' },
      { kind: 'removed' },
      { kind: 'pending', by: 'EVID-001' },
    ];
    const rendered = cases.map((reason) => describePruneReason(reason));
    for (const text of rendered) {
      expect(text.length).toBeGreaterThan(0);
    }
    expect(new Set(rendered).size).toBe(rendered.length);
    expect(describePruneReason({ kind: 'newest', keep: 5 })).toContain('5');
    expect(describePruneReason({ kind: 'highest-id' })).toContain('highest');
    expect(describePruneReason({ kind: 'referenced-by-record', by: 'EVID-001' })).toContain(
      'EVID-001',
    );
    expect(
      describePruneReason({
        kind: 'referenced-by-gate',
        gateId: 'G-Verify',
        ref: 'MutationEvidence(MUT-001)',
      }),
    ).toContain('G-Verify');
    expect(describePruneReason({ kind: 'pending', by: 'EVID-001' })).toContain('EVID-001');
  });
});
