/**
 * `scanTargetsFor` — every string leaf of a resolved entity's own value.
 *
 * @see PLAN-M2.md P9
 */
import { describe, expect, it } from 'vitest';

import { scanTargetsFor } from '../../src/compile/scan.ts';

describe('scanTargetsFor', () => {
  it('collects a top-level string field', () => {
    expect(scanTargetsFor('agents:backend', { mandate: 'Own backend implementation.' })).toEqual([
      { location: 'agents:backend.mandate', text: 'Own backend implementation.' },
    ]);
  });

  it('collects a nested string field', () => {
    expect(scanTargetsFor('agents:backend', { persona: { voice: 'terse' } })).toEqual([
      { location: 'agents:backend.persona.voice', text: 'terse' },
    ]);
  });

  it('collects string entries from arrays, indexed', () => {
    expect(scanTargetsFor('agents:backend', { skills: ['a', 'b'] })).toEqual([
      { location: 'agents:backend.skills[0]', text: 'a' },
      { location: 'agents:backend.skills[1]', text: 'b' },
    ]);
  });

  it('ignores non-string leaves (numbers, booleans, null)', () => {
    expect(scanTargetsFor('x', { count: 3, enabled: true, missing: null })).toEqual([]);
  });

  it('returns [] for a bare string root, correctly tagged with the base path', () => {
    expect(scanTargetsFor('x', 'hello')).toEqual([{ location: 'x', text: 'hello' }]);
  });

  it('walks a mix of nesting shapes in one pass', () => {
    const targets = scanTargetsFor('checks:acme-licence', {
      remedy: 'Run the fix.',
      appliesTo: { gates: ['G-Verify', 'G-Deliver'] },
    });
    expect(targets).toEqual([
      { location: 'checks:acme-licence.remedy', text: 'Run the fix.' },
      { location: 'checks:acme-licence.appliesTo.gates[0]', text: 'G-Verify' },
      { location: 'checks:acme-licence.appliesTo.gates[1]', text: 'G-Deliver' },
    ]);
  });
});
