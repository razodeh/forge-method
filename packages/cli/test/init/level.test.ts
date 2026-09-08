/**
 * `resolveInitLevel` — `03` §3.3 step 4.
 *
 * @see specs/03 §3.3
 */
import { describe, expect, it } from 'vitest';

import { proposeLevel } from '@forge/methods/level';

import { resolveInitLevel } from '../../src/init/level.ts';
import type { InitOptions } from '../../src/init/types.ts';

const BASE: InitOptions = { name: 'Acme Billing', yes: true };

describe('resolveInitLevel', () => {
  it('uses the explicit --level override verbatim, without calling proposeLevel', () => {
    const result = resolveInitLevel({ ...BASE, level: 'L3' });
    expect(result.level).toBe('L3');
    expect(result.reasoning).toContain('L3');
  });

  it('falls back to a real proposeLevel call against conservative, greenfield-only signals', () => {
    const result = resolveInitLevel(BASE);
    const expected = proposeLevel({
      greenfield: true,
      userFacingCapabilities: 0,
      deployableUnits: 0,
      hasPersistentState: false,
      hasExternalIntegrations: false,
      regulatory: false,
      multiRuntime: false,
    });
    expect(result).toEqual(expected);
  });
});
