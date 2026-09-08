/**
 * `phasesForLevel` — `10` §10.2's own literal level-mapping paragraph, made real.
 *
 * @see specs/10 §10.2
 * @see specs/01 §1.9
 * @see PLAN-M6.md M3
 */
import type { LifecyclePhase, ProjectLevel } from './types.ts';

const L0: readonly LifecyclePhase[] = ['P6', 'P7'];
const L1: readonly LifecyclePhase[] = [...L0, 'P5', 'P8'];
const L2: readonly LifecyclePhase[] = [...L1, 'P2', 'P3', 'P9'];
const L3_L4: readonly LifecyclePhase[] = [
  'P0',
  'P1',
  'P2',
  'P3',
  'P4',
  'P5',
  'P6',
  'P7',
  'P8',
  'P9',
  'P10',
];

/** "L0 runs {P6,P7} only; L1 adds {P5 light, P8}; L2 adds {P2 delta, P3 delta, P9}; L3/L4 run
 * everything" -- each level's own phase set is additive over the level below it. `10` §10.2's own "L4
 * adds G-Integration and a domain decomposition step in P3" is a gate and an in-phase step, neither its
 * own lifecycle phase, so L3 and L4 return the identical phase set here; a caller distinguishes the two
 * by level elsewhere (the extra gate, the extra step), not by this function. */
export function phasesForLevel(level: ProjectLevel): readonly LifecyclePhase[] {
  switch (level) {
    case 'L0':
      return L0;
    case 'L1':
      return L1;
    case 'L2':
      return L2;
    case 'L3':
    case 'L4':
      return L3_L4;
  }
}
