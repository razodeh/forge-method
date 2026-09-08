/**
 * `proposeLevel` — `PLAN-M6.md` M3's own Checks section.
 *
 * @see specs/01 §1.9
 * @see PLAN-M6.md M3
 */
import { describe, expect, it } from 'vitest';

import { proposeLevel } from '../../src/level/propose.ts';
import type { LevelSignals } from '../../src/level/types.ts';

const BASE: LevelSignals = {
  greenfield: false,
  userFacingCapabilities: 0,
  deployableUnits: 1,
  hasPersistentState: false,
  hasExternalIntegrations: false,
  regulatory: false,
  multiRuntime: false,
};

describe('proposeLevel', () => {
  it('a brownfield signal set with no capability/state/integration signal at all proposes L0 (Patch)', () => {
    const result = proposeLevel(BASE);
    expect(result.level).toBe('L0');
    expect(result.reasoning.length).toBeGreaterThan(0);
  });

  it('exactly one new user-facing capability, brownfield, proposes L1 (Feature)', () => {
    const result = proposeLevel({ ...BASE, userFacingCapabilities: 1 });
    expect(result.level).toBe('L1');
  });

  it('two or more user-facing capabilities proposes L2 (Capability)', () => {
    expect(proposeLevel({ ...BASE, userFacingCapabilities: 2 }).level).toBe('L2');
  });

  it('persistent state alone proposes L2 (Capability), even with zero new capabilities', () => {
    expect(proposeLevel({ ...BASE, hasPersistentState: true }).level).toBe('L2');
  });

  it('an external integration alone proposes L2 (Capability)', () => {
    expect(proposeLevel({ ...BASE, hasExternalIntegrations: true }).level).toBe('L2');
  });

  it('greenfield proposes L3 (Product)', () => {
    expect(proposeLevel({ ...BASE, greenfield: true }).level).toBe('L3');
  });

  it('greenfield outranks a weaker L2-level signal (persistent state) checked later in priority order', () => {
    const result = proposeLevel({ ...BASE, greenfield: true, hasPersistentState: true });
    expect(result.level).toBe('L3');
  });

  it('greenfield outranks an external-integration signal too', () => {
    expect(proposeLevel({ ...BASE, greenfield: true, hasExternalIntegrations: true }).level).toBe(
      'L3',
    );
  });

  it('a single capability with persistent state resolves to L2, not L1 -- state is checked first', () => {
    const result = proposeLevel({ ...BASE, userFacingCapabilities: 1, hasPersistentState: true });
    expect(result.level).toBe('L2');
  });

  it('a single capability with an external integration resolves to L2, not L1', () => {
    const result = proposeLevel({
      ...BASE,
      userFacingCapabilities: 1,
      hasExternalIntegrations: true,
    });
    expect(result.level).toBe('L2');
  });

  it('a regulatory signal proposes L4 (Platform) regardless of every other signal, including greenfield', () => {
    const result = proposeLevel({ ...BASE, greenfield: true, regulatory: true });
    expect(result.level).toBe('L4');
  });

  it('multiRuntime proposes L4 (Platform) even alongside a greenfield signal', () => {
    expect(proposeLevel({ ...BASE, greenfield: true, multiRuntime: true }).level).toBe('L4');
  });

  it('more than one deployable unit proposes L4 (Platform) even alongside a greenfield signal', () => {
    expect(proposeLevel({ ...BASE, greenfield: true, deployableUnits: 2 }).level).toBe('L4');
  });

  it('more than one runtime/language involved proposes L4 (Platform)', () => {
    expect(proposeLevel({ ...BASE, multiRuntime: true }).level).toBe('L4');
  });

  it('more than one deployable unit proposes L4 (Platform)', () => {
    expect(proposeLevel({ ...BASE, deployableUnits: 2 }).level).toBe('L4');
  });

  it('reasoning names the driving signal', () => {
    expect(proposeLevel({ ...BASE, regulatory: true }).reasoning).toMatch(/regulatory/);
    expect(proposeLevel({ ...BASE, greenfield: true }).reasoning).toMatch(/greenfield/);
  });

  it('is deterministic: identical signals always propose the identical level and reasoning', () => {
    const signals: LevelSignals = { ...BASE, userFacingCapabilities: 2 };
    expect(proposeLevel(signals)).toEqual(proposeLevel(signals));
  });
});
