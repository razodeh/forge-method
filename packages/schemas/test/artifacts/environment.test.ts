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
