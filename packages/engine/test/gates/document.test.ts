/**
 * `validateGateDocument` / `parseGateDocument` — a gate document read strictly (`PLAN-M13.md` P41, the P35 finding: a
 * misspelled `checks:` used to become an empty gate, which passes vacuously).
 *
 * @see specs/10 §10.3
 * @see specs/15 §15.10 (I4)
 */
import { describe, expect, it } from 'vitest';

import { parseGateDocument, suggestKey, validateGateDocument } from '../../src/gates/document.ts';
import { evaluateGate } from '../../src/gates/evaluate.ts';

const CHECK = { id: 'a', run: 'x', failOn: 'errors > 0' };

describe('validateGateDocument', () => {
  it('reads the spec worked example (every key 10 §10.3 shows) into a definition', () => {
    const { definition, problems } = validateGateDocument({
      id: 'G-Design',
      name: 'Design gate',
      phase: 'P3',
      autonomyOverride: null,
      checks: {
        deterministic: [{ ...CHECK, parser: 'forge-json' }],
        advisory: [{ id: 'architect-review', agent: 'critic', brief: 'briefs/x.md' }],
      },
      openQuestionsPolicy: 'block',
      approval: { required: true, roles: ['human'], quorum: 1 },
      evidence: [{ artifact: 'ArchitectureSpec' }],
      onReject: { action: 'replan', target: 'P3' },
    });
    expect(problems).toEqual([]);
    expect(definition).toEqual({
      id: 'G-Design',
      checks: {
        deterministic: [{ ...CHECK, parser: 'forge-json' }],
        advisory: [{ id: 'architect-review', agent: 'critic', brief: 'briefs/x.md' }],
      },
      openQuestionsPolicy: 'block',
      approval: { required: true, roles: ['human'], quorum: 1 },
    });
  });

  it('a misspelled checks key is an unknown-key problem with a did-you-mean AND a no-deterministic-checks problem', () => {
    const { definition, problems } = validateGateDocument({
      id: 'G',
      chekcs: { deterministic: [CHECK] },
    });
    expect(definition).toBeUndefined();
    expect(problems.map((p) => p.code)).toEqual(['unknown-key', 'no-deterministic-checks']);
    expect(problems[0]?.message).toContain('did you mean "checks"');
  });

  it.each([
    ['checks absent', { id: 'G' }],
    ['checks null', { id: 'G', checks: null }],
    ['deterministic absent', { id: 'G', checks: { advisory: [] } }],
    ['deterministic null', { id: 'G', checks: { deterministic: null } }],
    ['deterministic empty', { id: 'G', checks: { deterministic: [] } }],
  ])('%s: no deterministic check', (_l, doc) => {
    expect(validateGateDocument(doc).problems.map((p) => p.code)).toContain(
      'no-deterministic-checks',
    );
  });

  it('a malformed entry is reported itself, not as "no deterministic check"', () => {
    const codes = validateGateDocument({
      id: 'G',
      checks: { deterministic: [{ id: 'a' }] },
    }).problems.map((p) => p.code);
    expect(codes).toEqual(['invalid-value', 'invalid-value']);
  });

  it('unknown keys are refused at every level', () => {
    const keys = (doc: unknown): string[] => validateGateDocument(doc).problems.map((p) => p.key);
    const base = { id: 'G', checks: { deterministic: [CHECK] } };
    expect(keys({ ...base, extra: 1 })).toEqual(['extra']);
    expect(keys({ ...base, approval: { quorom: 2 } })).toEqual(['approval.quorom']);
    expect(keys({ ...base, onReject: { act: 'x' } })).toEqual(['onReject.act']);
    expect(keys({ ...base, evidence: [{ artefact: 'x' }] })).toEqual(['evidence[0].artefact']);
    expect(keys({ id: 'G', checks: { deterministic: [{ ...CHECK, faliOn: 'x' }] } })).toEqual([
      'checks.deterministic[0].faliOn',
    ]);
  });

  it('flags advisory-structure problems as advisoryShape, except unknown keys', () => {
    const { problems } = validateGateDocument({
      id: 'G',
      checks: { deterministic: [CHECK], advisory: [{ agnet: 'critic' }] },
    });
    const byKey = Object.fromEntries(problems.map((p) => [p.key, p]));
    expect(byKey['checks.advisory[0].id']?.advisoryShape).toBe(true);
    expect(byKey['checks.advisory[0].agnet']?.code).toBe('unknown-key');
  });

  it('rejects wrong-typed values and does not throw for hostile input', () => {
    for (const doc of [
      null,
      7,
      'x',
      [],
      { id: 3 },
      { id: 'G', checks: [] },
      { id: 'G', checks: 'x' },
    ]) {
      expect(validateGateDocument(doc).problems.length).toBeGreaterThan(0);
    }
    const bad = (extra: Record<string, unknown>) =>
      validateGateDocument({ id: 'G', checks: { deterministic: [CHECK] }, ...extra }).problems
        .length;
    expect(bad({ openQuestionsPolicy: 'maybe' })).toBe(1);
    expect(bad({ autonomyOverride: 'never' })).toBe(1);
    expect(bad({ approval: { roles: [] } })).toBe(1);
    expect(bad({ approval: { quorum: 1.5 } })).toBe(1);
    expect(bad({ approval: { required: 'yes' } })).toBe(1);
  });

  it('flags a duplicate deterministic check id', () => {
    const { problems } = validateGateDocument({
      id: 'G',
      checks: { deterministic: [CHECK, CHECK] },
    });
    expect(problems.map((p) => [p.code, p.key])).toEqual([
      ['duplicate-check-id', 'checks.deterministic[1].id'],
    ]);
  });
});

describe('a check that could never pass is refused at load', () => {
  const keys = (check: Record<string, unknown>): string[] =>
    validateGateDocument({
      id: 'G',
      checks: { deterministic: [{ ...CHECK, ...check }] },
    }).problems.map((p) => p.key);
  it('an unparseable failOn', () => {
    expect(keys({ failOn: 'errors >' })).toEqual(['checks.deterministic[0].failOn']);
  });
  it('an unsupported parser (the evaluator would fail every run of it)', () => {
    expect(keys({ parser: 'xml' })).toEqual(['checks.deterministic[0].parser']);
    expect(keys({ parser: 'forge-json' })).toEqual([]);
    expect(keys({ parser: 'json' })).toEqual([]);
  });
  it('an advisory check that reuses a deterministic check id', () => {
    const { problems } = validateGateDocument({
      id: 'G',
      checks: {
        deterministic: [CHECK],
        advisory: [{ id: 'a', agent: 'critic', brief: 'briefs/x.md' }],
      },
    });
    expect(problems.map((p) => [p.code, p.key])).toEqual([
      ['duplicate-check-id', 'checks.advisory[0].id'],
    ]);
  });
});

describe('parseGateDocument', () => {
  it('throws GATE-506 naming the file, the first key and how many more problems follow', () => {
    try {
      parseGateDocument({ id: 'G', chekcs: {} }, 'G-X.gate.yaml');
      expect.unreachable();
    } catch (error) {
      expect(error).toMatchObject({ code: 'GATE-506' });
      const message = (error as Error).message;
      expect(message).toContain('G-X.gate.yaml');
      expect(message).toContain('chekcs');
      expect(message).toContain('1 more problem');
    }
  });

  it('a gate the loader accepts is never a gate that passes with zero checks', async () => {
    const definition = parseGateDocument({ id: 'G', checks: { deterministic: [CHECK] } }, 'f');
    expect(definition.checks.deterministic).toHaveLength(1);
    const result = await evaluateGate(definition, '/', () =>
      Promise.resolve({
        stdout: '{"errors":1}',
        exitCode: 0,
      }),
    );
    expect(result.passed).toBe(false);
  });
});

describe('suggestKey', () => {
  it('suggests case-only and one/two-edit neighbours, and nothing for a short unrelated key', () => {
    expect(suggestKey('Checks', ['checks'])).toBe('checks');
    expect(suggestKey('chekcs', ['id', 'checks'])).toBe('checks');
    expect(suggestKey('zz', ['id', 'in'])).toBeUndefined();
    expect(suggestKey('zzzzzz', ['checks'])).toBeUndefined();
  });
});
