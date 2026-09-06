/**
 * `frameworkOverlaySchema`, `checkFrameworkRemovalStillReferenced` — `15` §15.7's "Framework
 * overlays" subsection.
 *
 * @see specs/15 §15.7
 * @see PLAN-M2.md P6
 */
import { describe, expect, it } from 'vitest';

import {
  checkFrameworkRemovalStillReferenced,
  frameworkOverlaySchema,
} from '../../src/workflows/framework.ts';

describe('frameworkOverlaySchema', () => {
  it('accepts the 15 §15.7 worked example', () => {
    const result = frameworkOverlaySchema.safeParse({
      criteria: {
        $replaceWhere: [
          { id: 'onboarding-simplicity', weight: 0.05 },
          { id: 'access-control-granularity', weight: 0.25 },
        ],
      },
      options: { $remove: ['meta-repo'] },
      rules: {
        $append: [
          { if: 'true', then: { eliminate: ['polyrepo'], reason: 'ACME platform policy PLAT-14' } },
        ],
      },
    });
    expect(result.success).toBe(true);
  });

  it("rejects a criteria item with no id via $append (a full item, unlike $replaceWhere's partial patch)", () => {
    const result = frameworkOverlaySchema.safeParse({
      criteria: { $append: [{ weight: 0.1 }] },
    });
    expect(result.success).toBe(false);
  });

  it('rejects an unrecognised top-level field', () => {
    const result = frameworkOverlaySchema.safeParse({ options: [], extra: true });
    expect(result.success).toBe(false);
  });

  it('rejects an unrecognised array operator', () => {
    const result = frameworkOverlaySchema.safeParse({ options: { $insertAfter: [] } });
    expect(result.success).toBe(false);
  });
});

describe('checkFrameworkRemovalStillReferenced', () => {
  it('refuses removing a framework a gate config still names', () => {
    const findings = checkFrameworkRemovalStillReferenced(
      ['meta-repo'],
      new Map([['meta-repo', ['G-Design']]]),
    );
    expect(findings).toEqual([
      {
        severity: 'error',
        code: 'framework-still-referenced',
        message: 'Framework "meta-repo" is still named by gate(s) G-Design and cannot be removed.',
      },
    ]);
  });

  it('allows removing a framework nothing references', () => {
    const findings = checkFrameworkRemovalStillReferenced(['meta-repo'], new Map());
    expect(findings).toEqual([]);
  });

  it('allows removing a framework whose reference list is present but empty', () => {
    const findings = checkFrameworkRemovalStillReferenced(
      ['meta-repo'],
      new Map([['meta-repo', []]]),
    );
    expect(findings).toEqual([]);
  });

  it('reports one finding per still-referenced framework, when several are removed at once', () => {
    const findings = checkFrameworkRemovalStillReferenced(
      ['meta-repo', 'polyrepo'],
      new Map([
        ['meta-repo', ['G-Design']],
        ['polyrepo', ['G-Verify']],
      ]),
    );
    expect(findings).toHaveLength(2);
  });
});
