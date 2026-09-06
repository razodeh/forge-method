/**
 * `templateOverlaySchema`, `requiredFieldsFor`, `checkTemplateRequiredFields` — `15` §15.7's
 * "Template overlays" subsection.
 *
 * @see specs/15 §15.7
 * @see PLAN-M2.md P6
 */
import { describe, expect, it } from 'vitest';

import {
  checkTemplateRequiredFields,
  requiredFieldsFor,
  templateOverlaySchema,
} from '../../src/workflows/template.ts';

describe('templateOverlaySchema', () => {
  it('accepts a plain front-matter-shaped object', () => {
    const result = templateOverlaySchema.safeParse({ id: 'STORY-001', title: 'x' });
    expect(result.success).toBe(true);
  });

  it('rejects a bare array', () => {
    expect(templateOverlaySchema.safeParse(['a', 'b']).success).toBe(false);
  });

  it('rejects a scalar', () => {
    expect(templateOverlaySchema.safeParse('not-an-object').success).toBe(false);
  });
});

describe('requiredFieldsFor', () => {
  it("includes Story's own required fields and the base front matter's required fields", () => {
    const fields = requiredFieldsFor('Story');
    for (const expected of ['id', 'type', 'title', 'status', 'epic', 'capability', 'dod_profile']) {
      expect(fields).toContain(expected);
    }
  });

  it('excludes a field the base front matter marks optional ("run")', () => {
    expect(requiredFieldsFor('Story')).not.toContain('run');
  });

  it('works for a second, unrelated artifact type (ADR)', () => {
    const fields = requiredFieldsFor('ADR');
    expect(fields).toContain('id');
    expect(fields.length).toBeGreaterThan(0);
  });
});

describe('checkTemplateRequiredFields', () => {
  it('flags every required field missing from the overlay front matter', () => {
    const findings = checkTemplateRequiredFields('Story', { id: 'STORY-001', title: 'x' });
    expect(findings.some((f) => f.message.includes('epic'))).toBe(true);
    expect(findings.length).toBe(requiredFieldsFor('Story').length - 2);
  });

  it('produces no findings when every required field is present', () => {
    const complete = Object.fromEntries(requiredFieldsFor('Story').map((field) => [field, 'x']));
    expect(checkTemplateRequiredFields('Story', complete)).toEqual([]);
  });

  it('does not flag an optional field that is missing', () => {
    const complete = Object.fromEntries(requiredFieldsFor('Story').map((field) => [field, 'x']));
    const findings = checkTemplateRequiredFields('Story', complete);
    expect(findings).toEqual([]);
  });
});
