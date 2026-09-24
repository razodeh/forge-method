/**
 * `validateGateDocument` / `parseGateDocument` — a gate document read strictly (`PLAN-M13.md` P41, the P35 finding: a
 * misspelled `checks:` used to become an empty gate, which passes vacuously).
 *
 * `validateCheckDocument` / `parseCheckDocument` (`PLAN-M14.md` P20) — a standalone `*.check.yaml`
 * document (`15` §15.7's own worked example) read exactly as strictly.
 *
 * @see specs/10 §10.3
 * @see specs/15 §15.7
 * @see specs/15 §15.10 (I4)
 */
import { describe, expect, it } from 'vitest';

import {
  parseCheckDocument,
  parseGateDocument,
  suggestKey,
  validateCheckDocument,
  validateGateDocument,
} from '../../src/gates/document.ts';
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
      evidence: [{ artifact: 'ArchitectureSpec' }],
    });
  });

  // `PLAN-M14.md` P19: `evidence:` used to be validated for shape and then dropped; it is now carried
  // through into the definition (`approve.ts`'s own `GATE-511` conflict check reads it).
  it('evidence entries parse into the definition, in the Type(*) form too; a misspelled artifact key is unknown-key AND a missing artifact', () => {
    const { definition, problems } = validateGateDocument({
      id: 'G',
      checks: { deterministic: [CHECK] },
      evidence: [{ artifact: 'InterfaceContract(*)' }, { artifact: 'ArchitectureSpec' }],
    });
    expect(problems).toEqual([]);
    expect(definition?.evidence).toEqual([
      { artifact: 'InterfaceContract(*)' },
      { artifact: 'ArchitectureSpec' },
    ]);

    const bad = validateGateDocument({
      id: 'G',
      checks: { deterministic: [CHECK] },
      evidence: [{ artefact: 'InterfaceContract' }],
    });
    expect(bad.definition).toBeUndefined();
    expect(bad.problems.map((p) => p.code)).toEqual(['unknown-key', 'invalid-value']);
    expect(bad.problems.map((p) => p.key)).toEqual([
      'evidence[0].artefact',
      'evidence[0].artifact',
    ]);
  });

  it('a gate with no evidence: at all carries no evidence field (not an empty array)', () => {
    const { definition } = validateGateDocument({ id: 'G', checks: { deterministic: [CHECK] } });
    expect(definition).not.toHaveProperty('evidence');
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
    // `PLAN-M14.md` P19: `evidence[0]`'s own required `artifact` field is now also validated (present,
    // non-blank) -- the misspelled key is BOTH an unknown key of its own AND a missing `artifact`.
    expect(keys({ ...base, evidence: [{ artefact: 'x' }] })).toEqual([
      'evidence[0].artefact',
      'evidence[0].artifact',
    ]);
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

// `PLAN-M14.md` P20: a standalone `*.check.yaml` (`15` §15.7's own "Custom gate checks" subsection).
describe('validateCheckDocument', () => {
  const SPEC_EXAMPLE = {
    id: 'acme:licence-policy',
    run: 'acme-licence-check --json',
    parser: 'json',
    failOn: 'violations > 0',
    remedy:
      'Run `acme-licence-check --explain` and either replace the dependency or file an exception.',
    appliesTo: { gates: ['G-Verify', 'G-Deliver'] },
    severity: 'error',
  };

  it("accepts 15 §15.7's own worked example verbatim", () => {
    const { document, problems } = validateCheckDocument(SPEC_EXAMPLE);
    expect(problems).toEqual([]);
    expect(document).toEqual(SPEC_EXAMPLE);
  });

  it('accepts optional name/description, and an explicit parser: forge-json', () => {
    const { document, problems } = validateCheckDocument({
      ...SPEC_EXAMPLE,
      name: 'Licence policy',
      description: 'Fails when a disallowed licence is introduced.',
      parser: 'forge-json',
    });
    expect(problems).toEqual([]);
    expect(document).toMatchObject({
      name: 'Licence policy',
      description: 'Fails when a disallowed licence is introduced.',
      parser: 'forge-json',
    });
  });

  it('a check with no name/description at all carries neither field (not blank strings)', () => {
    const { document } = validateCheckDocument(SPEC_EXAMPLE);
    expect(document).not.toHaveProperty('name');
    expect(document).not.toHaveProperty('description');
  });

  it('refuses appliesTo: { gate: ... } with a did-you-mean, and an empty appliesTo.gates', () => {
    const misspelled = validateCheckDocument({
      ...SPEC_EXAMPLE,
      appliesTo: { gate: ['G-Verify'] },
    });
    expect(misspelled.document).toBeUndefined();
    const unknownKey = misspelled.problems.find((p) => p.code === 'unknown-key');
    expect(unknownKey?.key).toBe('appliesTo.gate');
    expect(unknownKey?.message).toContain('did you mean "gates"');

    const empty = validateCheckDocument({ ...SPEC_EXAMPLE, appliesTo: { gates: [] } });
    expect(empty.document).toBeUndefined();
    expect(empty.problems.map((p) => p.key)).toContain('appliesTo.gates');
  });

  it('refuses severity: fatal (only error/warn)', () => {
    const { document, problems } = validateCheckDocument({ ...SPEC_EXAMPLE, severity: 'fatal' });
    expect(document).toBeUndefined();
    expect(problems.map((p) => p.key)).toEqual(['severity']);
  });

  it('refuses a missing remedy', () => {
    const withoutRemedy: Record<string, unknown> = { ...SPEC_EXAMPLE };
    delete withoutRemedy['remedy'];
    const { document, problems } = validateCheckDocument(withoutRemedy);
    expect(document).toBeUndefined();
    expect(problems.map((p) => p.key)).toEqual(['remedy']);
  });

  it('refuses an unparseable failOn', () => {
    const { document, problems } = validateCheckDocument({
      ...SPEC_EXAMPLE,
      failOn: 'violations >',
    });
    expect(document).toBeUndefined();
    expect(problems.map((p) => p.key)).toEqual(['failOn']);
  });

  it('refuses parser: yaml (an unsupported parser, the evaluator would fail every run of it)', () => {
    const { document, problems } = validateCheckDocument({ ...SPEC_EXAMPLE, parser: 'yaml' });
    expect(document).toBeUndefined();
    expect(problems.map((p) => p.key)).toEqual(['parser']);
  });

  it('rejects wrong-typed values and does not throw for hostile input', () => {
    for (const doc of [null, 7, 'x', [], { id: 3 }]) {
      expect(validateCheckDocument(doc).problems.length).toBeGreaterThan(0);
    }
  });
});

describe('parseCheckDocument', () => {
  it('throws GATE-506 naming the file and the first offending key', () => {
    try {
      parseCheckDocument({ id: 'x', run: 'x', failOn: 'a' }, 'acme.check.yaml');
      expect.unreachable();
    } catch (error) {
      expect(error).toMatchObject({ code: 'GATE-506' });
      const message = (error as Error).message;
      expect(message).toContain('acme.check.yaml');
      expect(message).toContain('remedy');
    }
  });

  it('a check the loader accepts has a real appliesTo.gates list', () => {
    const document = parseCheckDocument(
      {
        id: 'acme:licence-policy',
        run: 'acme-licence-check --json',
        failOn: 'violations > 0',
        remedy: 'fix it',
        appliesTo: { gates: ['G-Verify'] },
        severity: 'error',
      },
      'acme.check.yaml',
    );
    expect(document.appliesTo.gates).toEqual(['G-Verify']);
  });
});
