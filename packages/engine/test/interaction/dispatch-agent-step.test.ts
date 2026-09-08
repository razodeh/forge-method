/**
 * `dispatchAgentStep` — `05` §5.7's own seven interaction modes made runnable.
 *
 * @see specs/05 §5.7
 * @see specs/10 §10.1
 * @see SPEC-QUESTIONS.md Q104
 * @see PLAN-M6.md A6
 */
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { execa } from 'execa';
import { ForgeError } from '@forge/core/errors';
import { FakePlatformAdapter } from '@forge/testkit';
import { describe, expect, it } from 'vitest';

import { dispatchAgentStep } from '../../src/interaction/dispatch-agent-step.ts';
import { toAgentId } from '../../src/plan/index.ts';
import { createTestContext, node } from '../dispatch/helpers.ts';
import type { AgentDefinition } from '@forge/agents/schema';

// R10-restricted node:os in production code; the *.test.ts exemption only covers this file itself,
// matching every other @forge/engine/dispatch test's own duplicated helper convention.
async function createTempRepo(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), `forge-interaction-${prefix}-`));
  await execa('git', ['init', '--quiet', '-b', 'main'], { cwd: dir });
  await execa('git', ['commit', '--quiet', '--allow-empty', '-m', 'init'], { cwd: dir });
  return dir;
}

function testAgent(overrides: Partial<AgentDefinition> = {}): AgentDefinition {
  return {
    id: 'test-agent',
    name: 'Test Agent',
    version: '1.0.0',
    tier: 'core',
    mandate: 'Ship the feature.',
    decisions_owned: [],
    persona: { voice: 'terse', stance: 'pragmatic', disagreement_style: 'direct' },
    inputs: { required: [] },
    outputs: [{ type: 'X', schema: 'x.schema.json', path: 'x.md' }],
    kb_write: [],
    tools: { read: true, write: true, network: false, git_commit: 'lane', deploy: false },
    model: { tier: 'balanced', thinking: 'medium' },
    limits: { max_turns: 10, wall_clock_ms: 600_000, max_cost_usd: 5 },
    parallel_safety: { file_ownership: [], exclusive: false },
    gates: { produces_evidence_for: [], may_approve: [] },
    skills: [],
    prompt: { system: 'p.md' },
    ...overrides,
  };
}

describe('dispatchAgentStep', () => {
  it("solo delegates straight to runAgentStep unchanged -- one real session, no participants", async () => {
    const projectRoot = await createTempRepo('solo');
    const adapter = new FakePlatformAdapter();
    adapter.script(() => true, { text: ['implemented it'] });
    const ctx = createTestContext({ projectRoot, adapter });
    const stepNode = node({ id: 'wf:implement', kind: 'agent', agent: toAgentId('engineer'), brief: 'implement' });

    const result = await dispatchAgentStep(stepNode, testAgent(), ctx, 'solo');

    expect(result.outcome.status).toBe('succeeded');
    expect(result.participants).toBeUndefined();
    expect(result.reviewReport).toBeUndefined();
  });

  it('fan-out and relay also delegate straight to runAgentStep unchanged', async () => {
    for (const mode of ['fan-out', 'relay'] as const) {
      const projectRoot = await createTempRepo(`delegate-${mode}`);
      const adapter = new FakePlatformAdapter();
      adapter.script(() => true, { text: ['done'] });
      const ctx = createTestContext({ projectRoot, adapter });
      const stepNode = node({ id: 'wf:step', kind: 'agent', agent: toAgentId('engineer'), brief: 'do work' });

      const result = await dispatchAgentStep(stepNode, testAgent(), ctx, mode);
      expect(result.outcome.status).toBe('succeeded');
      expect(result.participants).toBeUndefined();
    }
  });

  it('pair drives a real author session AND a real reviewer session for one logical step', async () => {
    const projectRoot = await createTempRepo('pair');
    const adapter = new FakePlatformAdapter();
    adapter.script(
      (request) => request.stepId === 'wf:implement',
      { text: ['author wrote the code'] },
    );
    adapter.script(
      (request) => request.stepId === 'wf:implement:reviewer',
      { text: ['reviewer: looks good'] },
    );
    const ctx = createTestContext({ projectRoot, adapter });
    const stepNode = node({ id: 'wf:implement', kind: 'agent', agent: toAgentId('engineer'), brief: 'implement' });

    const result = await dispatchAgentStep(stepNode, testAgent(), ctx, 'pair');

    expect(result.outcome.status).toBe('succeeded');
    expect(result.outcome.detail.kind === 'agent' && result.outcome.detail.session.finalText).toBe(
      'author wrote the code',
    );
    expect(result.participants).toHaveLength(1);
    expect(result.participants?.[0]?.role).toBe('reviewer');
    expect(result.participants?.[0]?.session.finalText).toBe('reviewer: looks good');
  });

  it('panel drives one independent session per perspective, then a real synthesis session reconciling them -- more than one real session for one logical step', async () => {
    const projectRoot = await createTempRepo('panel');
    const adapter = new FakePlatformAdapter();
    adapter.script((request) => request.stepId === 'wf:decide:panel:cost', { text: ['cost says: cheap option A'] });
    adapter.script((request) => request.stepId === 'wf:decide:panel:risk', { text: ['risk says: option A is risky'] });
    adapter.script((request) => request.stepId === 'wf:decide', { text: ['synthesized: go with option B instead'] });
    const ctx = createTestContext({ projectRoot, adapter });
    const stepNode = node({ id: 'wf:decide', kind: 'agent', agent: toAgentId('architect'), brief: 'pick a stack' });

    const result = await dispatchAgentStep(stepNode, testAgent(), ctx, 'panel', {
      perspectives: ['cost', 'risk'],
    });

    expect(result.participants).toHaveLength(2);
    expect(result.participants?.map((p) => p.role)).toEqual(['panel:cost', 'panel:risk']);
    expect(result.outcome.detail.kind === 'agent' && result.outcome.detail.session.finalText).toBe(
      'synthesized: go with option B instead',
    );
  });

  it('panel throws RUN-046 when no perspectives are given', async () => {
    const projectRoot = await createTempRepo('panel-no-perspectives');
    const ctx = createTestContext({ projectRoot, adapter: new FakePlatformAdapter() });
    const stepNode = node({ id: 'wf:decide', kind: 'agent', agent: toAgentId('architect'), brief: 'pick a stack' });

    await expect(dispatchAgentStep(stepNode, testAgent(), ctx, 'panel')).rejects.toThrow(ForgeError);
  });

  it('debate is a bounded loop that terminates at exactly 3 rounds when neither side concedes', async () => {
    const projectRoot = await createTempRepo('debate-no-concede');
    const adapter = new FakePlatformAdapter();
    adapter.script((request) => request.stepId.includes(':debate:proposer:'), { text: ['I propose X'] });
    adapter.script((request) => request.stepId.includes(':debate:critic:'), { text: ['I disagree, still'] });
    adapter.script((request) => request.stepId === 'wf:debate', { text: ['ruling: X, with caveats'] });
    const ctx = createTestContext({ projectRoot, adapter });
    const stepNode = node({ id: 'wf:debate', kind: 'agent', agent: toAgentId('architect'), brief: 'settle it' });

    const result = await dispatchAgentStep(stepNode, testAgent(), ctx, 'debate');

    // 3 rounds x (proposer + critic) = 6 participants, never more, even though neither side conceded.
    expect(result.participants).toHaveLength(6);
    expect(result.outcome.detail.kind === 'agent' && result.outcome.detail.session.finalText).toBe(
      'ruling: X, with caveats',
    );
  });

  it('debate ends early, before the round cap, when the critic concedes', async () => {
    const projectRoot = await createTempRepo('debate-concede');
    const adapter = new FakePlatformAdapter();
    adapter.script((request) => request.stepId.includes(':debate:proposer:'), { text: ['I propose X'] });
    adapter.script((request) => request.stepId.includes(':debate:critic:'), { text: ['CONCEDE'] });
    adapter.script((request) => request.stepId === 'wf:debate', { text: ['ruling: X'] });
    const ctx = createTestContext({ projectRoot, adapter });
    const stepNode = node({ id: 'wf:debate', kind: 'agent', agent: toAgentId('architect'), brief: 'settle it' });

    const result = await dispatchAgentStep(stepNode, testAgent(), ctx, 'debate');

    // Conceded on round 1: exactly one proposer + one critic turn, not the full 3-round cap.
    expect(result.participants).toHaveLength(2);
  });

  it('debate clamps a caller-supplied maxDebateRounds above 3 down to 3', async () => {
    const projectRoot = await createTempRepo('debate-clamp');
    const adapter = new FakePlatformAdapter();
    adapter.script((request) => request.stepId.includes(':debate:proposer:'), { text: ['I propose X'] });
    adapter.script((request) => request.stepId.includes(':debate:critic:'), { text: ['still no'] });
    adapter.script((request) => request.stepId === 'wf:debate', { text: ['ruling'] });
    const ctx = createTestContext({ projectRoot, adapter });
    const stepNode = node({ id: 'wf:debate', kind: 'agent', agent: toAgentId('architect'), brief: 'settle it' });

    const result = await dispatchAgentStep(stepNode, testAgent(), ctx, 'debate', { maxDebateRounds: 10 });

    expect(result.participants).toHaveLength(6);
  });

  it("swarm-review's own four 10 §10.1 worked-example perspectives produce one real, de-duplicated ReviewReport", async () => {
    const projectRoot = await createTempRepo('swarm-review');
    const adapter = new FakePlatformAdapter();
    adapter.script((request) => request.stepId === 'wf:review:review:design', {
      text: ['design review done'],
      structured: ['inconsistent naming in module X', 'missing error boundary'],
    });
    adapter.script((request) => request.stepId === 'wf:review:review:security', {
      text: ['security review done'],
      structured: ['missing error boundary', 'no input sanitization on endpoint Y'],
    });
    adapter.script((request) => request.stepId === 'wf:review:review:testing', {
      text: ['testing review done'],
      structured: ['no test coverage for edge case Z'],
    });
    adapter.script((request) => request.stepId === 'wf:review:review:performance', {
      text: ['performance review done'],
      structured: [],
    });
    const ctx = createTestContext({ projectRoot, adapter });
    const stepNode = node({ id: 'wf:review', kind: 'agent', agent: toAgentId('reviewer'), brief: 'review the diff' });

    const result = await dispatchAgentStep(stepNode, testAgent(), ctx, 'swarm-review', {
      perspectives: ['design', 'security', 'testing', 'performance'],
    });

    expect(result.participants).toHaveLength(4);
    expect(result.reviewReport?.perspectives).toEqual(['design', 'security', 'testing', 'performance']);
    // 4 distinct summaries reported across perspectives, but "missing error boundary" was raised by
    // BOTH design and security -- the merged report has exactly 4 findings, not 5, and that one finding
    // carries both attributions: the real de-duplication the Checks text asks for.
    expect(result.reviewReport?.findings).toHaveLength(4);
    const shared = result.reviewReport?.findings.find((f) => f.summary === 'missing error boundary');
    expect(shared?.perspectives).toEqual(['design', 'security']);
  });

  it('swarm-review throws RUN-046 when no perspectives are given', async () => {
    const projectRoot = await createTempRepo('swarm-no-perspectives');
    const ctx = createTestContext({ projectRoot, adapter: new FakePlatformAdapter() });
    const stepNode = node({ id: 'wf:review', kind: 'agent', agent: toAgentId('reviewer'), brief: 'review' });

    await expect(dispatchAgentStep(stepNode, testAgent(), ctx, 'swarm-review')).rejects.toThrow(ForgeError);
  });
});
