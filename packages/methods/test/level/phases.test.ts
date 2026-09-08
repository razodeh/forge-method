/**
 * `phasesForLevel` — `10` §10.2's own literal level-mapping paragraph, `PLAN-M6.md` M3's own Checks
 * section.
 *
 * @see specs/10 §10.2
 * @see PLAN-M6.md M3
 */
import { describe, expect, it } from 'vitest';

import { phasesForLevel } from '../../src/level/phases.ts';

describe('phasesForLevel', () => {
  it('L0 runs {P6, P7} only', () => {
    expect(phasesForLevel('L0')).toEqual(['P6', 'P7']);
  });

  it('L1 adds {P5, P8} to L0', () => {
    expect(phasesForLevel('L1')).toEqual(['P6', 'P7', 'P5', 'P8']);
  });

  it('L2 adds {P2, P3, P9} to L1', () => {
    expect(phasesForLevel('L2')).toEqual(['P6', 'P7', 'P5', 'P8', 'P2', 'P3', 'P9']);
  });

  it('L3 and L4 both run every phase, P0 through P10', () => {
    const allPhases = ['P0', 'P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8', 'P9', 'P10'] as const;
    expect(phasesForLevel('L3')).toEqual(allPhases);
    expect(phasesForLevel('L4')).toEqual(allPhases);
  });

  it('every level below L3 is a strict subset of P0-P10, no phase invented', () => {
    const allPhases = new Set(phasesForLevel('L3'));
    for (const level of ['L0', 'L1', 'L2'] as const) {
      for (const phase of phasesForLevel(level)) {
        expect(allPhases.has(phase)).toBe(true);
      }
    }
  });
});
