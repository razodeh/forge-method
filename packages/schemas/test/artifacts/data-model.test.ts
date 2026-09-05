/**
 * `dataModelSchema` — base front matter narrowed to `type: 'DataModel'`; see `SPEC-QUESTIONS.md` Q20
 * for why this schema carries no type-specific fields.
 *
 * @see specs/09 §9.6
 * @see specs/21 §21.3
 * @see SPEC-QUESTIONS.md Q20
 */
import { describe, expect, it } from 'vitest';

import { dataModelSchema } from '../../src/artifacts/data-model.ts';

function validDataModel(): Record<string, unknown> {
  return {
    id: 'DM-002',
    type: 'DataModel',
    schemaVersion: 1,
    title: 'Invoice line item',
    status: 'active',
    created: '2026-03-04',
    updated: '2026-03-04',
    revision: 1,
    author: 'data-architect',
    changelog: [],
  };
}

describe('dataModelSchema — valid', () => {
  it('accepts base front matter with type DataModel', () => {
    expect(dataModelSchema.safeParse(validDataModel()).success).toBe(true);
  });
});

describe('dataModelSchema — invalid, each asserting the error path', () => {
  it('rejects an id whose prefix does not match its type', () => {
    const result = dataModelSchema.safeParse({ ...validDataModel(), id: 'INT-002' });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toEqual(['id']);
  });

  it('rejects a type other than the literal "DataModel"', () => {
    const result = dataModelSchema.safeParse({ ...validDataModel(), type: 'InterfaceContract' });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toEqual(['type']);
  });

  it('rejects an unknown top-level key', () => {
    const result = dataModelSchema.safeParse({ ...validDataModel(), extra: 'nope' });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toEqual([]);
  });
});
