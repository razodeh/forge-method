/**
 * `rankClaims`/`buildConfirmationBatch`/`applyConfirmationAnswer`/`runConfirmationFlow` — `17` §17.3's
 * own human-confirmation flow, and `PLAN-M10.md` P19's own literal Checks-section exit test: "the
 * human-confirmation flow caps at exactly 20 questions against a fixture with more than 20 high-impact
 * claims, the remainder become real `OQ-###` entries."
 *
 * @see specs/17 §17.3
 * @see PLAN-M10.md P19
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { SYSTEM_CLOCK } from '@forge/core';
import { ProjectPaths } from '@forge/core/fs';
import { afterEach, describe, expect, it } from 'vitest';

import {
  CONFIRMATION_QUESTION_CAP,
  applyConfirmationAnswer,
  buildConfirmationBatch,
  rankClaims,
  runConfirmationFlow,
  type ConfirmableClaim,
} from '../../src/adopt/confirmation.ts';

function claim(overrides: Partial<ConfirmableClaim> & { id: string }): ConfirmableClaim {
  return {
    section: 'architecture',
    statement: `Claim ${overrides.id}`,
    evidence: [{ kind: 'path', path: `src/${overrides.id}.ts` }],
    confidence: 'medium',
    impact: 'medium',
    consequenceIfWrong: 'A wrong decision could be made downstream.',
    ...overrides,
  };
}

function manyHighImpactClaims(count: number): ConfirmableClaim[] {
  return Array.from({ length: count }, (_, i) =>
    claim({ id: `HI-${String(i).padStart(2, '0')}`, impact: 'high', confidence: 'low' }),
  );
}

describe('rankClaims', () => {
  it('ranks by impact x uncertainty, descending', () => {
    const claims = [
      claim({ id: 'low-low', impact: 'low', confidence: 'high' }),
      claim({ id: 'high-low', impact: 'high', confidence: 'low' }),
      claim({ id: 'medium-medium', impact: 'medium', confidence: 'medium' }),
    ];
    const ranked = rankClaims(claims);
    expect(ranked.map((r) => r.claim.id)).toEqual(['high-low', 'medium-medium', 'low-low']);
  });

  it('excludes already-verified claims entirely — nothing to confirm about a proven fact', () => {
    const claims = [claim({ id: 'verified', impact: 'high', confidence: 'verified' })];
    expect(rankClaims(claims)).toEqual([]);
  });

  it('breaks ties deterministically by section then statement', () => {
    const claims = [
      claim({ id: 'b', section: 'z', statement: 'b', impact: 'high', confidence: 'low' }),
      claim({ id: 'a', section: 'a', statement: 'a', impact: 'high', confidence: 'low' }),
    ];
    const ranked = rankClaims(claims);
    expect(ranked.map((r) => r.claim.id)).toEqual(['a', 'b']);
  });
});

describe('buildConfirmationBatch — the literal M10 exit test (20-question cap)', () => {
  it('caps the batch at exactly 20 questions against a fixture with more than 20 high-impact claims', () => {
    const claims = manyHighImpactClaims(35);
    const { batch, deferred } = buildConfirmationBatch(claims);
    expect(batch.length).toBe(CONFIRMATION_QUESTION_CAP);
    expect(batch.length).toBe(20);
    expect(deferred.length).toBe(15);
  });

  it('never drops a claim: batch + deferred always accounts for every ranked claim', () => {
    const claims = manyHighImpactClaims(27);
    const { batch, deferred } = buildConfirmationBatch(claims);
    expect(batch.length + deferred.length).toBe(27);
  });

  it('does not cap at all when there are fewer than 20 claims', () => {
    const claims = manyHighImpactClaims(5);
    const { batch, deferred } = buildConfirmationBatch(claims);
    expect(batch.length).toBe(5);
    expect(deferred.length).toBe(0);
  });
});

describe('applyConfirmationAnswer', () => {
  it('"confirm" raises low/medium confidence to high and marks the claim active', () => {
    const outcome = applyConfirmationAnswer(claim({ id: 'c', confidence: 'low' }), 'confirm');
    expect(outcome).toMatchObject({
      confidence: 'high',
      status: 'active',
      openQuestion: undefined,
    });
  });

  it('"confirm" never lowers an already-high confidence, and never claims "verified"', () => {
    const outcome = applyConfirmationAnswer(claim({ id: 'c', confidence: 'high' }), 'confirm');
    expect(outcome.confidence).toBe('high');
  });

  it('"reject" drops to low confidence, draft status, and records a real open question', () => {
    const outcome = applyConfirmationAnswer(
      claim({ id: 'c', statement: 'The billing service owns the users table.' }),
      'reject',
    );
    expect(outcome.confidence).toBe('low');
    expect(outcome.status).toBe('draft');
    expect(outcome.openQuestion).toContain('The billing service owns the users table.');
  });

  it('"unknown" ("I don\'t know") always converts to confidence: low plus a real open question, never forces a guess', () => {
    const outcome = applyConfirmationAnswer(
      claim({ id: 'c', confidence: 'high', impact: 'high', consequenceIfWrong: 'Data loss.' }),
      'unknown',
    );
    expect(outcome.confidence).toBe('low');
    expect(outcome.status).toBe('draft');
    expect(outcome.openQuestion).toBeDefined();
    expect(outcome.openQuestion).toContain('Data loss.');
  });
});

describe('runConfirmationFlow', () => {
  const dirs: string[] = [];
  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  async function tempProject(): Promise<ProjectPaths> {
    const dir = await mkdtemp(path.join(tmpdir(), 'forge-kb-confirmation-'));
    dirs.push(dir);
    return new ProjectPaths(dir);
  }

  it('asks only about the capped batch and writes a real OQ-### for every deferred claim beyond the cap', async () => {
    const paths = await tempProject();
    const claims = manyHighImpactClaims(23);
    let askedCount = 0;

    const result = await runConfirmationFlow(
      { paths, clock: SYSTEM_CLOCK, kbRoot: 'kb' },
      'adoption',
      claims,
      (batch) => {
        askedCount = batch.length;
        const answers = new Map(batch.map((r) => [r.claim.id, 'confirm' as const]));
        return Promise.resolve(answers);
      },
    );

    expect(askedCount).toBe(20);
    // 23 claims - 20 confirmed = 3 deferred, each becoming a real OQ-###.
    expect(result.openQuestionIds.length).toBe(3);
    expect(result.openQuestionIds.every((id) => /^OQ-\d{3,4}$/.test(id))).toBe(true);
    // A real, distinct id per deferred claim — not merely the right count (a fresh critic round found
    // count-only assertions here would not catch a silent id collision).
    expect(new Set(result.openQuestionIds).size).toBe(3);
    expect(result.unresolved.length).toBe(3);
    expect(result.outcomes.length).toBe(20);
  });

  it('"I don\'t know" answers inside the batch itself also produce a real OQ-###, not silently dropped', async () => {
    const paths = await tempProject();
    const claims = [claim({ id: 'a', impact: 'high', confidence: 'low' })];

    const result = await runConfirmationFlow(
      { paths, clock: SYSTEM_CLOCK, kbRoot: 'kb' },
      'adoption',
      claims,
      () => Promise.resolve(new Map([['a', 'unknown' as const]])),
    );

    expect(result.openQuestionIds.length).toBe(1);
    expect(result.outcomes[0]?.confidence).toBe('low');
  });

  it('two "unknown" claims sharing identical statement text but different evidence still get two distinct OQ-###', async () => {
    const paths = await tempProject();
    const claims = [
      claim({
        id: 'a',
        statement: 'Boilerplate claim wording.',
        evidence: [{ kind: 'path', path: 'src/a.ts' }],
        impact: 'high',
        confidence: 'low',
      }),
      claim({
        id: 'b',
        statement: 'Boilerplate claim wording.',
        evidence: [{ kind: 'path', path: 'src/b.ts' }],
        impact: 'high',
        confidence: 'low',
      }),
    ];

    const result = await runConfirmationFlow(
      { paths, clock: SYSTEM_CLOCK, kbRoot: 'kb' },
      'adoption',
      claims,
      () =>
        Promise.resolve(
          new Map([
            ['a', 'unknown' as const],
            ['b', 'unknown' as const],
          ]),
        ),
    );

    expect(result.openQuestionIds).toHaveLength(2);
    expect(new Set(result.openQuestionIds).size).toBe(2);
  });

  it('a claim left entirely unanswered by the callback is treated as unresolved and gets a real OQ-###', async () => {
    const paths = await tempProject();
    const claims = [claim({ id: 'a', impact: 'high', confidence: 'low' })];

    const result = await runConfirmationFlow(
      { paths, clock: SYSTEM_CLOCK, kbRoot: 'kb' },
      'adoption',
      claims,
      () => Promise.resolve(new Map()),
    );

    expect(result.unresolved.map((c) => c.id)).toEqual(['a']);
    expect(result.openQuestionIds.length).toBe(1);
  });

  it('never calls ask at all when there is nothing to confirm (every claim already verified)', async () => {
    const paths = await tempProject();
    const claims = [claim({ id: 'a', confidence: 'verified' })];
    let asked = false;

    const result = await runConfirmationFlow(
      { paths, clock: SYSTEM_CLOCK, kbRoot: 'kb' },
      'adoption',
      claims,
      () => {
        asked = true;
        return Promise.resolve(new Map());
      },
    );

    expect(asked).toBe(false);
    expect(result.outcomes).toEqual([]);
    expect(result.openQuestionIds).toEqual([]);
  });
});
