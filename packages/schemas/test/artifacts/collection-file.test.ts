/**
 * `risksFileSchema`/`assumptionsFileSchema`/`openQuestionsFileSchema`/`environmentsFileSchema` — the
 * on-disk shape of a populated `collection: true` KB file.
 *
 * @see specs/08 §8.2
 * @see specs/18 §18.6
 * @see SPEC-QUESTIONS.md Q50
 */
import { describe, expect, it } from 'vitest';

import {
  assumptionsFileSchema,
  environmentsFileSchema,
  openQuestionsFileSchema,
  risksFileSchema,
} from '../../src/artifacts/collection-file.ts';

/** `18` §18.6's base front-matter fields every artifact file carries — minus `id`, which a
 * collection file (naming many ids, not one) never has at this level. */
function baseFileFields(): Record<string, unknown> {
  return {
    schemaVersion: 1,
    title: 'Risk register',
    status: 'active',
    created: '2026-01-05',
    updated: '2026-01-05',
    revision: 1,
    author: 'architect',
    changelog: [],
  };
}

function validRisk(id: string): Record<string, unknown> {
  return {
    id,
    statement: 'Quick invoice path bypasses tax validation',
    likelihood: 'medium',
    impact: 'high',
    mitigation: 'Route the quick path through the same validator as the full form',
    owner: 'architect',
  };
}

function validAssumption(id: string): Record<string, unknown> {
  return {
    id,
    text: 'Single deployable at MVP; second service arrives at M2',
    confidence: 'high',
    validate_by: 'stage plan review at M2 kickoff',
  };
}

function validOpenQuestion(id: string): Record<string, unknown> {
  return { id, question: 'Do we need a separate package for shared domain types?', status: 'open' };
}

function validEnvironment(id: string): Record<string, unknown> {
  return {
    id,
    purpose: 'staging',
    url: 'https://staging.example.com',
    deploy_trigger: 'merge to main',
    data_policy: 'synthetic data only',
    secrets_source: 'vault:staging',
    owner: 'platform',
    access: 'request via #platform-access',
  };
}

describe('risksFileSchema', () => {
  it('accepts a populated register with more than one entry', () => {
    const result = risksFileSchema.safeParse({
      ...baseFileFields(),
      type: 'Risk',
      risks: [validRisk('RISK-001'), validRisk('RISK-002')],
    });
    expect(result.success).toBe(true);
  });

  it('accepts an empty register (no risks recorded yet)', () => {
    const result = risksFileSchema.safeParse({ ...baseFileFields(), type: 'Risk', risks: [] });
    expect(result.success).toBe(true);
  });

  it('rejects a type literal that does not match Risk', () => {
    const result = risksFileSchema.safeParse({
      ...baseFileFields(),
      type: 'Assumption',
      risks: [],
    });
    expect(result.success).toBe(false);
  });

  it('rejects an unknown top-level key', () => {
    const result = risksFileSchema.safeParse({
      ...baseFileFields(),
      type: 'Risk',
      risks: [],
      extra: 'nope',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a missing base front-matter field (title)', () => {
    const fields = baseFileFields();
    delete fields['title'];
    const result = risksFileSchema.safeParse({ ...fields, type: 'Risk', risks: [] });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toEqual(['title']);
  });

  it('rejects a malformed entry inside the list, naming its own path', () => {
    const result = risksFileSchema.safeParse({
      ...baseFileFields(),
      type: 'Risk',
      risks: [{ ...validRisk('RISK-001'), owner: '' }],
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toEqual(['risks', 0, 'owner']);
  });
});

describe('assumptionsFileSchema', () => {
  it('accepts a populated register with more than one entry', () => {
    const result = assumptionsFileSchema.safeParse({
      ...baseFileFields(),
      type: 'Assumption',
      assumptions: [validAssumption('ASM-001'), validAssumption('ASM-002')],
    });
    expect(result.success).toBe(true);
  });
});

describe('openQuestionsFileSchema', () => {
  it('accepts a populated register with more than one entry', () => {
    const result = openQuestionsFileSchema.safeParse({
      ...baseFileFields(),
      type: 'OpenQuestion',
      open_questions: [validOpenQuestion('OQ-001'), validOpenQuestion('OQ-002')],
    });
    expect(result.success).toBe(true);
  });
});

describe('environmentsFileSchema', () => {
  it('accepts a populated register with more than one entry', () => {
    const result = environmentsFileSchema.safeParse({
      ...baseFileFields(),
      type: 'Environment',
      environments: [validEnvironment('ENV-001'), validEnvironment('ENV-002')],
    });
    expect(result.success).toBe(true);
  });
});
