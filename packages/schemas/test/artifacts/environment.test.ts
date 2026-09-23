/**
 * `environmentSchema` — one `ENV-###` entry in `kb/delivery/environments.md`.
 *
 * @see specs/14-frameworks-delivery-and-operations.md §14
 * @see specs/21 §21.3
 */
import { describe, expect, it } from 'vitest';

import { environmentSchema } from '../../src/artifacts/environment.ts';

function validEnvironment(): Record<string, unknown> {
  return {
    id: 'ENV-001',
    purpose: 'Production',
    url: 'https://app.acme-billing.example',
    deploy_trigger: 'tag v*.*.* on main',
    data_policy: 'real customer data; PII redaction on logs',
    secrets_source: 'vault:production/acme-billing',
    owner: 'sre',
    access: 'request via #access-requests, approved by sre lead',
  };
}

describe('environmentSchema — valid', () => {
  it('accepts a well-formed environment entry', () => {
    expect(environmentSchema.safeParse(validEnvironment()).success).toBe(true);
  });

  it('accepts with no sources field at all (PLAN-M14.md P11: sources is optional here)', () => {
    const result = environmentSchema.safeParse(validEnvironment());
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.sources).toBeUndefined();
  });

  it('accepts a well-formed sources array', () => {
    const result = environmentSchema.safeParse({
      ...validEnvironment(),
      sources: [{ kind: 'human', ref: 'platform team handoff 2026-01-01' }],
    });
    expect(result.success).toBe(true);
  });
});

describe('environmentSchema — sources shape (PLAN-M14.md P11)', () => {
  it('rejects a source with an unknown kind', () => {
    const result = environmentSchema.safeParse({
      ...validEnvironment(),
      sources: [{ kind: 'guess', ref: 'x' }],
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toEqual(['sources', 0, 'kind']);
  });
});

describe('environmentSchema — invalid, each asserting the error path', () => {
  it('rejects an id whose prefix does not match Environment', () => {
    const result = environmentSchema.safeParse({ ...validEnvironment(), id: 'RUN-001' });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toEqual(['id']);
  });

  it('rejects a missing data_policy', () => {
    const withoutDataPolicy = validEnvironment();
    delete withoutDataPolicy['data_policy'];
    const result = environmentSchema.safeParse(withoutDataPolicy);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toEqual(['data_policy']);
  });

  it('rejects a missing secrets_source', () => {
    const withoutSecretsSource = validEnvironment();
    delete withoutSecretsSource['secrets_source'];
    const result = environmentSchema.safeParse(withoutSecretsSource);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toEqual(['secrets_source']);
  });

  it('rejects an unknown key', () => {
    const result = environmentSchema.safeParse({ ...validEnvironment(), extra: 'nope' });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toEqual([]);
  });
});
