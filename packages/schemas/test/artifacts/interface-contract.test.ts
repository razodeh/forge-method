/**
 * `interfaceContractSchema` — base front matter narrowed to `type: 'InterfaceContract'`; see
 * `SPEC-QUESTIONS.md` Q20 for why this schema carries no type-specific fields.
 *
 * @see specs/09 §9.6
 * @see specs/21 §21.3
 * @see SPEC-QUESTIONS.md Q20
 */
import { describe, expect, it } from 'vitest';

import { interfaceContractSchema } from '../../src/artifacts/interface-contract.ts';

function validInterfaceContract(): Record<string, unknown> {
  return {
    id: 'INT-004',
    type: 'InterfaceContract',
    schemaVersion: 1,
    title: 'Invoice API',
    status: 'active',
    created: '2026-03-04',
    updated: '2026-03-04',
    revision: 1,
    author: 'architect',
    changelog: [],
  };
}

describe('interfaceContractSchema — valid', () => {
  it('accepts base front matter with type InterfaceContract', () => {
    expect(interfaceContractSchema.safeParse(validInterfaceContract()).success).toBe(true);
  });
});

describe('interfaceContractSchema — invalid, each asserting the error path', () => {
  it('rejects an id whose prefix does not match its type', () => {
    const result = interfaceContractSchema.safeParse({ ...validInterfaceContract(), id: 'DM-004' });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toEqual(['id']);
  });

  it('rejects a type other than the literal "InterfaceContract"', () => {
    const result = interfaceContractSchema.safeParse({
      ...validInterfaceContract(),
      type: 'DataModel',
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toEqual(['type']);
  });

  it('rejects an unknown top-level key', () => {
    const result = interfaceContractSchema.safeParse({
      ...validInterfaceContract(),
      extra: 'nope',
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toEqual([]);
  });
});
