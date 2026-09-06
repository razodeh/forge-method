/**
 * `gateCheckSchema`, `checkBuiltInThreshold` — `15` §15.7's "Custom gate checks" subsection.
 *
 * @see specs/15 §15.7
 * @see PLAN-M2.md P6
 */
import { describe, expect, it } from 'vitest';

import { checkBuiltInThreshold, gateCheckSchema } from '../../src/workflows/gate-check.ts';

describe('gateCheckSchema', () => {
  it('accepts the 15 §15.7 worked example', () => {
    const result = gateCheckSchema.safeParse({
      id: 'acme:licence-policy',
      run: 'acme-licence-check --json',
      parser: 'json',
      failOn: 'violations > 0',
      remedy:
        'Run `acme-licence-check --explain` and either replace the dependency or file an exception.',
      appliesTo: { gates: ['G-Verify', 'G-Deliver'] },
      severity: 'error',
    });
    expect(result.success).toBe(true);
  });

  it('accepts a check with no parser declared', () => {
    const result = gateCheckSchema.safeParse({
      id: 'acme:no-parser',
      run: 'acme-check',
      failOn: 'exitCode != 0',
      remedy: 'Fix the check.',
      appliesTo: { gates: ['G-Verify'] },
      severity: 'warn',
    });
    expect(result.success).toBe(true);
  });

  for (const missing of ['id', 'run', 'failOn', 'remedy'] as const) {
    it(`rejects a check missing "${missing}"`, () => {
      const full: Record<string, unknown> = {
        id: 'acme:x',
        run: 'acme-check',
        failOn: 'exitCode != 0',
        remedy: 'Fix it.',
        appliesTo: { gates: ['G-Verify'] },
        severity: 'error',
      };
      Reflect.deleteProperty(full, missing);
      expect(gateCheckSchema.safeParse(full).success).toBe(false);
    });
  }

  it('rejects appliesTo.gates being empty', () => {
    const result = gateCheckSchema.safeParse({
      id: 'acme:x',
      run: 'acme-check',
      failOn: 'exitCode != 0',
      remedy: 'Fix it.',
      appliesTo: { gates: [] },
      severity: 'error',
    });
    expect(result.success).toBe(false);
  });

  it('rejects an unknown severity', () => {
    const result = gateCheckSchema.safeParse({
      id: 'acme:x',
      run: 'acme-check',
      failOn: 'exitCode != 0',
      remedy: 'Fix it.',
      appliesTo: { gates: ['G-Verify'] },
      severity: 'critical',
    });
    expect(result.success).toBe(false);
  });
});

describe('checkBuiltInThreshold', () => {
  it('returns undefined when the overlay value meets or exceeds the floor', () => {
    expect(
      checkBuiltInThreshold({
        checkId: 'coverage',
        field: 'coverage.min',
        floor: 80,
        overlayValue: 85,
      }),
    ).toBeUndefined();
    expect(
      checkBuiltInThreshold({
        checkId: 'coverage',
        field: 'coverage.min',
        floor: 80,
        overlayValue: 80,
      }),
    ).toBeUndefined();
  });

  it('records the delta when the overlay value is below the floor', () => {
    const finding = checkBuiltInThreshold({
      checkId: 'coverage',
      field: 'coverage.min',
      floor: 80,
      overlayValue: 65,
    });
    expect(finding).toEqual({
      severity: 'warning',
      code: 'threshold-below-floor',
      message:
        'Check "coverage"\'s "coverage.min" is set to 65, below the module floor of 80 (delta 15).',
      delta: 15,
    });
  });
});
