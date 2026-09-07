/**
 * `adrScope`/`owningAdrIds` — the KB-entry-as-bridge mechanism `SPEC-QUESTIONS.md` Q56 (points 2–3)
 * uses in place of a field neither `adrSchema` nor `Component` has.
 *
 * @see SPEC-QUESTIONS.md Q56
 * @see PLAN-M3.md P10
 */
import { describe, expect, it } from 'vitest';

import { adrScope, owningAdrIds } from '../../src/lint/kb-links.ts';
import { adr, kbEntry } from './factories.ts';

describe('adrScope', () => {
  it('is the union of applies_to across every KB entry citing the ADR as a decision source', () => {
    const entries = [
      kbEntry({
        id: 'KB-ARCH-0001',
        applies_to: ['component:api', 'component:db'],
        sources: [{ kind: 'decision', ref: 'ADR-0001' }],
      }),
      kbEntry({
        id: 'KB-ARCH-0002',
        applies_to: ['component:worker'],
        sources: [{ kind: 'decision', ref: 'ADR-0001' }],
      }),
    ];
    expect(adrScope('ADR-0001', entries)).toEqual(
      new Set(['component:api', 'component:db', 'component:worker']),
    );
  });

  it('ignores a KB entry that cites a different ADR, or cites this one via a non-decision source', () => {
    const entries = [
      kbEntry({ applies_to: ['component:api'], sources: [{ kind: 'decision', ref: 'ADR-0002' }] }),
      kbEntry({ applies_to: ['component:db'], sources: [{ kind: 'human', ref: 'ADR-0001' }] }),
    ];
    expect(adrScope('ADR-0001', entries)).toEqual(new Set());
  });

  it('ignores a non-active KB entry, even one that otherwise cites the ADR correctly', () => {
    // A gauntlet critic found this filter missing: a single `deprecated`/`draft` entry was enough to
    // silently establish real scope for an ADR, the same way `checkAntonymTagConflicts` already
    // requires `status === 'active'` before trusting an entry's own claims.
    const entries = [
      kbEntry({
        status: 'deprecated',
        applies_to: ['component:api'],
        sources: [{ kind: 'decision', ref: 'ADR-0001' }],
      }),
      kbEntry({
        status: 'draft',
        applies_to: ['component:db'],
        sources: [{ kind: 'decision', ref: 'ADR-0001' }],
      }),
    ];
    expect(adrScope('ADR-0001', entries)).toEqual(new Set());
  });
});

describe('owningAdrIds', () => {
  it('names every ADR whose derived scope contains the component id', () => {
    const owner = adr({ id: 'ADR-0001' });
    const other = adr({ id: 'ADR-0002' });
    const entries = [
      kbEntry({ applies_to: ['component:api'], sources: [{ kind: 'decision', ref: 'ADR-0001' }] }),
    ];
    expect(owningAdrIds('component:api', entries, [owner, other])).toEqual(['ADR-0001']);
    expect(owningAdrIds('component:db', entries, [owner, other])).toEqual([]);
  });
});
