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
import type { SessionRequest } from '@forge/adapter-kit';
import { FAKE_MODEL_ID, FakePlatformAdapter } from '@forge/testkit';
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

describe('dispatchAgentStep -- participant sessions carry the real compiled prompt (PLAN-M13 P5, D9)', () => {
  it('every panel participant gets the nine-block system prompt (the turn text as block [4]), a read-only per-agent grant and the tier-resolved model, never ctx.tools/ctx.model', async () => {
    const projectRoot = await createTempRepo('participant-prompt');
    const requests: SessionRequest[] = [];
    const adapter = new FakePlatformAdapter();
    adapter.script(
      (request) => {
        requests.push(request);
        return true;
      },
      { text: ['answer'] },
    );
    const ctx = createTestContext({
      projectRoot,
      adapter,
      model: 'POISON-MODEL',
      tools: { read: false, write: true, exec: ['rm -rf *'], network: 'full' },
    });
    const stepNode = node({
      id: 'wf:panel',
      kind: 'agent',
      agent: toAgentId('test-agent'),
      brief: 'Which database should we use?',
    });

    await dispatchAgentStep(stepNode, testAgent(), ctx, 'panel', { perspectives: ['cost'] });

    const participant = requests.find((request) => request.stepId === 'wf:panel:panel:cost');
    expect(participant).toBeDefined();
    if (participant === undefined) return;
    for (let block = 1; block <= 9; block += 1) {
      expect(participant.systemPrompt.text).toContain(`## [${String(block)}] `);
    }
    expect(participant.systemPrompt.text).toContain('Which database should we use?');
    expect(participant.systemPrompt.text).toContain(
      'Answer independently from the "cost" perspective.',
    );
    expect(participant.tools).toEqual({ read: true, write: false, exec: false, network: 'none' });
    expect(participant.model).toBe(FAKE_MODEL_ID);
    expect(participant.model).not.toBe('POISON-MODEL');
    expect(participant.permissionMode).toBe('deny-unlisted');
  });

  it("swarm-review perspective sessions look up the agent's prompt.briefs['swarm-review'] and attach it to block [4]; a differently-keyed brief does not attach", async () => {
    const projectRoot = await createTempRepo('swarm-briefkey');
    const requests: SessionRequest[] = [];
    const adapter = new FakePlatformAdapter();
    adapter.script(
      (request) => {
        requests.push(request);
        return true;
      },
      { text: ['x'], structured: { findings: [], checked: ['a'] } },
    );
    const ctx = createTestContext({ projectRoot, adapter });
    const stepNode = node({
      id: 'wf:rev',
      kind: 'agent',
      agent: toAgentId('test-agent'),
      brief: 'Review it.',
    });
    const agent = testAgent({
      prompt: {
        system: 'prompts/test.system.md',
        briefs: {
          'swarm-review': 'prompts/test.swarm-review.md',
          'unrelated-key': 'prompts/test.unrelated.md',
        },
      },
    });

    await dispatchAgentStep(stepNode, agent, ctx, 'swarm-review', {
      perspectives: ['design', 'security'],
    });

    expect(requests).toHaveLength(2);
    for (const request of requests) {
      // (the fixture assembly returns a reference as its own text)
      expect(request.systemPrompt.text).toContain(
        'Role-specific guidance for this step:\nprompts/test.swarm-review.md',
      );
      expect(request.systemPrompt.text).not.toContain('prompts/test.unrelated.md');
    }
  });

  it('a participant session whose agent has an unmapped model tier throws RUN-078 and dispatches nothing', async () => {
    const projectRoot = await createTempRepo('participant-no-model');
    const adapter = new FakePlatformAdapter();
    let started = 0;
    adapter.script(
      () => {
        started += 1;
        return true;
      },
      { text: ['x'] },
    );
    const base = createTestContext({ projectRoot, adapter });
    const ctx = {
      ...base,
      assembly: {
        ...base.assembly,
        models: { tiers: { frugal: {}, balanced: {}, max: {} }, overrides: {} },
      },
    };
    const stepNode = node({
      id: 'wf:panel',
      kind: 'agent',
      agent: toAgentId('test-agent'),
      brief: 'q',
    });

    await expect(
      dispatchAgentStep(stepNode, testAgent(), ctx, 'panel', { perspectives: ['cost'] }),
    ).rejects.toMatchObject({ code: 'RUN-078' });
    expect(started).toBe(0);
  });

  it('every participant session carries the FORGE run/step/agent marker (@forge/core/session-marker, PLAN-M14.md P4): FORGE_RUN_ID === ctx.runId, FORGE_STEP_ID === its own stepId, FORGE_AGENT_ID === the dispatching agent, for every perspective', async () => {
    const projectRoot = await createTempRepo('participant-marker');
    const requests: SessionRequest[] = [];
    const adapter = new FakePlatformAdapter();
    adapter.script(
      (request) => {
        requests.push(request);
        return true;
      },
      { text: ['x'], structured: { findings: [], checked: ['a'] } },
    );
    const ctx = createTestContext({ projectRoot, adapter, runId: 'run-participant-marker' });
    const stepNode = node({
      id: 'wf:marked-review',
      kind: 'agent',
      agent: toAgentId('test-agent'),
      brief: 'Review it.',
    });

    await dispatchAgentStep(stepNode, testAgent(), ctx, 'swarm-review', {
      perspectives: ['design', 'security'],
    });

    expect(requests).toHaveLength(2);
    for (const request of requests) {
      expect(request.env['FORGE_RUN_ID']).toBe('run-participant-marker');
      expect(request.env['FORGE_STEP_ID']).toBe(request.stepId);
      expect(request.env['FORGE_AGENT_ID']).toBe('test-agent');
    }
    // Each perspective is its own session, with its own stepId -- the marker is not one shared value.
    expect(new Set(requests.map((request) => request.env['FORGE_STEP_ID']))).toEqual(
      new Set(requests.map((request) => request.stepId)),
    );
  });
});

describe('dispatchAgentStep', () => {
  it('solo delegates straight to runAgentStep unchanged -- one real session, no participants', async () => {
    const projectRoot = await createTempRepo('solo');
    const adapter = new FakePlatformAdapter();
    adapter.script(() => true, { text: ['implemented it'] });
    const ctx = createTestContext({ projectRoot, adapter });
    const stepNode = node({
      id: 'wf:implement',
      kind: 'agent',
      agent: toAgentId('engineer'),
      brief: 'implement',
    });

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
      const stepNode = node({
        id: 'wf:step',
        kind: 'agent',
        agent: toAgentId('engineer'),
        brief: 'do work',
      });

      const result = await dispatchAgentStep(stepNode, testAgent(), ctx, mode);
      expect(result.outcome.status).toBe('succeeded');
      expect(result.participants).toBeUndefined();
    }
  });

  it('pair drives a real author session AND a real reviewer session for one logical step', async () => {
    const projectRoot = await createTempRepo('pair');
    const adapter = new FakePlatformAdapter();
    adapter.script((request) => request.stepId === 'wf:implement', {
      text: ['author wrote the code'],
    });
    adapter.script((request) => request.stepId === 'wf:implement:reviewer', {
      text: ['reviewer: looks good'],
    });
    const ctx = createTestContext({ projectRoot, adapter });
    const stepNode = node({
      id: 'wf:implement',
      kind: 'agent',
      agent: toAgentId('engineer'),
      brief: 'implement',
    });

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
    adapter.script((request) => request.stepId === 'wf:decide:panel:cost', {
      text: ['cost says: cheap option A'],
    });
    adapter.script((request) => request.stepId === 'wf:decide:panel:risk', {
      text: ['risk says: option A is risky'],
    });
    adapter.script((request) => request.stepId === 'wf:decide', {
      text: ['synthesized: go with option B instead'],
    });
    const ctx = createTestContext({ projectRoot, adapter });
    const stepNode = node({
      id: 'wf:decide',
      kind: 'agent',
      agent: toAgentId('architect'),
      brief: 'pick a stack',
    });

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
    const stepNode = node({
      id: 'wf:decide',
      kind: 'agent',
      agent: toAgentId('architect'),
      brief: 'pick a stack',
    });

    await expect(dispatchAgentStep(stepNode, testAgent(), ctx, 'panel')).rejects.toThrow(
      ForgeError,
    );
  });

  it('debate is a bounded loop that terminates at exactly 3 rounds when neither side concedes', async () => {
    const projectRoot = await createTempRepo('debate-no-concede');
    const adapter = new FakePlatformAdapter();
    adapter.script((request) => request.stepId.includes(':debate:proposer:'), {
      text: ['I propose X'],
    });
    adapter.script((request) => request.stepId.includes(':debate:critic:'), {
      text: ['I disagree, still'],
    });
    adapter.script((request) => request.stepId === 'wf:debate', {
      text: ['ruling: X, with caveats'],
    });
    const ctx = createTestContext({ projectRoot, adapter });
    const stepNode = node({
      id: 'wf:debate',
      kind: 'agent',
      agent: toAgentId('architect'),
      brief: 'settle it',
    });

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
    adapter.script((request) => request.stepId.includes(':debate:proposer:'), {
      text: ['I propose X'],
    });
    adapter.script((request) => request.stepId.includes(':debate:critic:'), { text: ['CONCEDE'] });
    adapter.script((request) => request.stepId === 'wf:debate', { text: ['ruling: X'] });
    const ctx = createTestContext({ projectRoot, adapter });
    const stepNode = node({
      id: 'wf:debate',
      kind: 'agent',
      agent: toAgentId('architect'),
      brief: 'settle it',
    });

    const result = await dispatchAgentStep(stepNode, testAgent(), ctx, 'debate');

    // Conceded on round 1: exactly one proposer + one critic turn, not the full 3-round cap.
    expect(result.participants).toHaveLength(2);
  });

  it('debate clamps a caller-supplied maxDebateRounds above 3 down to 3', async () => {
    const projectRoot = await createTempRepo('debate-clamp');
    const adapter = new FakePlatformAdapter();
    adapter.script((request) => request.stepId.includes(':debate:proposer:'), {
      text: ['I propose X'],
    });
    adapter.script((request) => request.stepId.includes(':debate:critic:'), { text: ['still no'] });
    adapter.script((request) => request.stepId === 'wf:debate', { text: ['ruling'] });
    const ctx = createTestContext({ projectRoot, adapter });
    const stepNode = node({
      id: 'wf:debate',
      kind: 'agent',
      agent: toAgentId('architect'),
      brief: 'settle it',
    });

    const result = await dispatchAgentStep(stepNode, testAgent(), ctx, 'debate', {
      maxDebateRounds: 10,
    });

    expect(result.participants).toHaveLength(6);
  });

  it('debate embeds a caller-supplied steelManRequirement, and the round-1 opposing-case-first instruction, in round 1 only (16 §16.7 point 3) -- neither leaks into round 2', async () => {
    const projectRoot = await createTempRepo('debate-steelman');
    const adapter = new FakePlatformAdapter();
    const prompts: Record<string, string> = {};
    adapter.script(
      (request) => {
        // The task text plays block [4] of the compiled system prompt (PLAN-M13 P5, D9); the user turn is a
        // fixed kickoff line, so the full effective prompt is both together.
        prompts[request.stepId] = `${request.systemPrompt.text}\n${request.prompt}`;
        return request.stepId.includes(':debate:proposer:round-1');
      },
      { text: ['round 1: opposing case first, then mine'] },
    );
    adapter.script(
      (request) => {
        // The task text plays block [4] of the compiled system prompt (PLAN-M13 P5, D9); the user turn is a
        // fixed kickoff line, so the full effective prompt is both together.
        prompts[request.stepId] = `${request.systemPrompt.text}\n${request.prompt}`;
        return request.stepId.includes(':debate:critic:round-1');
      },
      { text: ['round 1 critique -- not conceding yet'] },
    );
    adapter.script(
      (request) => {
        // The task text plays block [4] of the compiled system prompt (PLAN-M13 P5, D9); the user turn is a
        // fixed kickoff line, so the full effective prompt is both together.
        prompts[request.stepId] = `${request.systemPrompt.text}\n${request.prompt}`;
        return request.stepId.includes(':debate:proposer:round-2');
      },
      { text: ['round 2: my case'] },
    );
    adapter.script(
      (request) => {
        // The task text plays block [4] of the compiled system prompt (PLAN-M13 P5, D9); the user turn is a
        // fixed kickoff line, so the full effective prompt is both together.
        prompts[request.stepId] = `${request.systemPrompt.text}\n${request.prompt}`;
        return request.stepId.includes(':debate:critic:round-2');
      },
      { text: ['CONCEDE'] },
    );
    adapter.script((request) => request.stepId === 'wf:debate', { text: ['ruling'] });
    const ctx = createTestContext({ projectRoot, adapter });
    const stepNode = node({
      id: 'wf:debate',
      kind: 'agent',
      agent: toAgentId('architect'),
      brief: 'settle the tradeoff',
    });

    const result = await dispatchAgentStep(stepNode, testAgent(), ctx, 'debate', {
      steelManRequirement:
        'For each of the two contested options, first state the strongest possible case for the other.',
    });

    expect(result.participants).toHaveLength(4); // 2 rounds x (proposer + critic)
    const round1Proposer = prompts['wf:debate:debate:proposer:round-1'] ?? '';
    const round1Critic = prompts['wf:debate:debate:critic:round-1'] ?? '';
    const round2Proposer = prompts['wf:debate:debate:proposer:round-2'] ?? '';
    const round2Critic = prompts['wf:debate:debate:critic:round-2'] ?? '';

    expect(round1Proposer).toContain(
      'For each of the two contested options, first state the strongest possible case for the other.',
    );
    expect(round1Proposer).toContain("opposing side's case");
    expect(round1Critic).toContain(
      'For each of the two contested options, first state the strongest possible case for the other.',
    );
    // Round 1's own requirement is round-1-only content -- it must not leak into round 2's prompts.
    expect(round2Proposer).not.toContain("opposing side's case");
    expect(round2Critic).not.toContain("opposing side's case");
  });

  it('debate omits the steel-man instruction entirely when no steelManRequirement is supplied (ordinary debate, unaffected)', async () => {
    const projectRoot = await createTempRepo('debate-no-steelman');
    const adapter = new FakePlatformAdapter();
    const prompts: Record<string, string> = {};
    adapter.script(
      (request) => {
        // The task text plays block [4] of the compiled system prompt (PLAN-M13 P5, D9); the user turn is a
        // fixed kickoff line, so the full effective prompt is both together.
        prompts[request.stepId] = `${request.systemPrompt.text}\n${request.prompt}`;
        return request.stepId.includes(':debate:proposer:');
      },
      { text: ['I propose X'] },
    );
    adapter.script((request) => request.stepId.includes(':debate:critic:'), { text: ['CONCEDE'] });
    adapter.script((request) => request.stepId === 'wf:debate', { text: ['ruling'] });
    const ctx = createTestContext({ projectRoot, adapter });
    const stepNode = node({
      id: 'wf:debate',
      kind: 'agent',
      agent: toAgentId('architect'),
      brief: 'settle it',
    });

    await dispatchAgentStep(stepNode, testAgent(), ctx, 'debate');

    expect(prompts['wf:debate:debate:proposer:round-1']).not.toContain("opposing side's case");
  });

  it("swarm-review's own four 10 §10.1 worked-example perspectives produce one real, de-duplicated ReviewReport — kept at the more severe of two colliding ratings", async () => {
    const projectRoot = await createTempRepo('swarm-review');
    const adapter = new FakePlatformAdapter();
    adapter.script((request) => request.stepId === 'wf:review:review:design', {
      text: ['design review done'],
      structured: {
        findings: [
          { summary: 'inconsistent naming in module X', severity: 'minor' },
          { summary: 'missing error boundary', severity: 'major' },
        ],
        checked: ['naming conventions', 'error handling'],
      },
    });
    adapter.script((request) => request.stepId === 'wf:review:review:security', {
      text: ['security review done'],
      structured: {
        findings: [
          { summary: 'missing error boundary', severity: 'blocking' },
          { summary: 'no input sanitization on endpoint Y', severity: 'blocking' },
        ],
        checked: ['input validation', 'error handling'],
      },
    });
    adapter.script((request) => request.stepId === 'wf:review:review:testing', {
      text: ['testing review done'],
      structured: {
        findings: [{ summary: 'no test coverage for edge case Z', severity: 'major' }],
        checked: ['ac binding'],
      },
    });
    // Zero real findings, but a real, non-empty `checked` list — genuinely looked and found nothing,
    // so this is NOT flagged as an empty review (`13` §13.3's own "no findings *and* no evidence").
    adapter.script((request) => request.stepId === 'wf:review:review:performance', {
      text: ['performance review done'],
      structured: { findings: [], checked: ['hot paths', 'query patterns'] },
    });
    const ctx = createTestContext({ projectRoot, adapter });
    const stepNode = node({
      id: 'wf:review',
      kind: 'agent',
      agent: toAgentId('reviewer'),
      brief: 'review the diff',
    });

    const result = await dispatchAgentStep(stepNode, testAgent(), ctx, 'swarm-review', {
      perspectives: ['design', 'security', 'testing', 'performance'],
    });

    expect(result.participants).toHaveLength(4);
    expect(result.reviewReport?.perspectives).toEqual([
      'design',
      'security',
      'testing',
      'performance',
    ]);
    // 4 distinct summaries reported across perspectives, but "missing error boundary" was raised by
    // BOTH design and security -- the merged report has exactly 4 findings, not 5, and that one finding
    // carries both attributions: the real de-duplication the Checks text asks for.
    expect(result.reviewReport?.findings).toHaveLength(4);
    const shared = result.reviewReport?.findings.find(
      (f) => f.summary === 'missing error boundary',
    );
    expect(shared?.perspectives).toEqual(['design', 'security']);
    // design rated it `major`, security rated it `blocking` — the merged finding keeps `blocking`,
    // the more severe of the two, never the less severe one (a real, deliberate policy: under-
    // reporting severity is the one failure mode that matters, `ReviewFinding`'s own doc comment).
    expect(shared?.severity).toBe('blocking');
  });

  it('swarm-review synthesises a real, minor finding for a perspective reporting no findings and no evidence of what it examined', async () => {
    const projectRoot = await createTempRepo('swarm-review-empty');
    const adapter = new FakePlatformAdapter();
    adapter.script((request) => request.stepId === 'wf:review:review:design', {
      structured: { findings: [], checked: [] },
    });
    adapter.script((request) => request.stepId === 'wf:review:review:security', {
      structured: { findings: [{ summary: 'a real finding', severity: 'minor' }], checked: ['x'] },
    });
    const ctx = createTestContext({ projectRoot, adapter });
    const stepNode = node({
      id: 'wf:review',
      kind: 'agent',
      agent: toAgentId('reviewer'),
      brief: 'review the diff',
    });

    const result = await dispatchAgentStep(stepNode, testAgent(), ctx, 'swarm-review', {
      perspectives: ['design', 'security'],
    });

    expect(result.reviewReport?.findings).toHaveLength(2);
    const empty = result.reviewReport?.findings.find((f) => f.perspectives.includes('design'));
    expect(empty?.severity).toBe('minor');
    expect(empty?.summary).toContain('design');
    expect(empty?.summary).toContain('no findings');
  });

  it("deduplicates a real finding whose own summary text byte-matches a DIFFERENT perspective's own synthesised empty-review summary, into one finding kept at the more severe rating", async () => {
    const projectRoot = await createTempRepo('swarm-review-empty-collision');
    const adapter = new FakePlatformAdapter();
    // design reports nothing at all -- synthesises `emptyReviewFinding('design')`, whose own exact
    // summary text is `design reported no findings and no evidence of what it examined`.
    adapter.script((request) => request.stepId === 'wf:review:review:design', {
      structured: { findings: [], checked: [] },
    });
    // documentation independently reports a REAL finding sharing that identical summary text (a
    // contrived but real byte-for-byte collision) at a more severe rating than the synthesised `minor`.
    adapter.script((request) => request.stepId === 'wf:review:review:documentation', {
      structured: {
        findings: [
          {
            summary: 'design reported no findings and no evidence of what it examined',
            severity: 'blocking',
          },
        ],
        checked: ['x'],
      },
    });
    const ctx = createTestContext({ projectRoot, adapter });
    const stepNode = node({
      id: 'wf:review',
      kind: 'agent',
      agent: toAgentId('reviewer'),
      brief: 'review the diff',
    });

    const result = await dispatchAgentStep(stepNode, testAgent(), ctx, 'swarm-review', {
      perspectives: ['design', 'documentation'],
    });

    // One real finding, not two -- the synthesised empty-review summary and documentation's own real
    // finding collapsed into a single, de-duplicated entry carrying both attributions.
    expect(result.reviewReport?.findings).toHaveLength(1);
    const merged = result.reviewReport?.findings[0];
    expect(merged?.perspectives).toEqual(['design', 'documentation']);
    // kept at `blocking`, the more severe of the synthesised `minor` and documentation's real `blocking`.
    expect(merged?.severity).toBe('blocking');
  });

  it("swarm-review throws CFG-501, dispatching no real session at all, when the reviewing agent is the diff's own authoring agent", async () => {
    const projectRoot = await createTempRepo('swarm-review-self');
    const adapter = new FakePlatformAdapter();
    // No script registered for any request at all -- a real session dispatch would still "succeed"
    // against the fake's own default script, so a thrown CFG-501 here can only mean the refusal
    // happened before any session was even attempted.
    const ctx = createTestContext({ projectRoot, adapter });
    const stepNode = node({
      id: 'wf:review',
      kind: 'agent',
      agent: toAgentId('reviewer'),
      brief: 'review the diff',
    });

    await expect(
      dispatchAgentStep(stepNode, testAgent({ id: 'engineer' }), ctx, 'swarm-review', {
        perspectives: ['design'],
        authoringAgentIds: ['engineer'],
      }),
    ).rejects.toMatchObject({ code: 'CFG-501' });
  });

  it('swarm-review throws CFG-501 when the reviewing agent id appears anywhere in a real, multi-agent authoringAgentIds list (a real multi-lane merge)', async () => {
    const projectRoot = await createTempRepo('swarm-review-self-multi');
    const adapter = new FakePlatformAdapter();
    const ctx = createTestContext({ projectRoot, adapter });
    const stepNode = node({
      id: 'wf:review',
      kind: 'agent',
      agent: toAgentId('reviewer'),
      brief: 'review the diff',
    });

    await expect(
      dispatchAgentStep(stepNode, testAgent({ id: 'engineer' }), ctx, 'swarm-review', {
        perspectives: ['design'],
        authoringAgentIds: ['architect', 'engineer', 'reviewer'],
      }),
    ).rejects.toMatchObject({ code: 'CFG-501' });
  });

  it('swarm-review dispatches normally when authoringAgentIds is given but does not match the reviewing agent', async () => {
    const projectRoot = await createTempRepo('swarm-review-not-self');
    const adapter = new FakePlatformAdapter();
    adapter.script(() => true, { structured: { findings: [], checked: ['x'] } });
    const ctx = createTestContext({ projectRoot, adapter });
    const stepNode = node({
      id: 'wf:review',
      kind: 'agent',
      agent: toAgentId('reviewer'),
      brief: 'review the diff',
    });

    const result = await dispatchAgentStep(
      stepNode,
      testAgent({ id: 'engineer' }),
      ctx,
      'swarm-review',
      {
        perspectives: ['design'],
        authoringAgentIds: ['someone-else'],
      },
    );
    expect(result.participants).toHaveLength(1);
  });

  it('swarm-review dispatches normally when authoringAgentIds is a real, empty array', async () => {
    const projectRoot = await createTempRepo('swarm-review-empty-authors');
    const adapter = new FakePlatformAdapter();
    adapter.script(() => true, { structured: { findings: [], checked: ['x'] } });
    const ctx = createTestContext({ projectRoot, adapter });
    const stepNode = node({
      id: 'wf:review',
      kind: 'agent',
      agent: toAgentId('reviewer'),
      brief: 'review the diff',
    });

    const result = await dispatchAgentStep(
      stepNode,
      testAgent({ id: 'engineer' }),
      ctx,
      'swarm-review',
      { perspectives: ['design'], authoringAgentIds: [] },
    );
    expect(result.participants).toHaveLength(1);
  });

  it('swarm-review tolerates a real, malformed structured response — a bad entry is skipped, real entries survive it', async () => {
    const projectRoot = await createTempRepo('swarm-review-malformed');
    const adapter = new FakePlatformAdapter();
    // No `structured` at all -- read as zero findings, zero checked, not thrown away.
    adapter.script((request) => request.stepId === 'wf:review:review:design', { text: ['done'] });
    // `structured` present but not an object at all (a bare array of strings -- the old, pre-P10
    // shape); `findings`/`checked` are not real arrays inside it either.
    adapter.script((request) => request.stepId === 'wf:review:review:security', {
      structured: ['not the new shape at all'],
    });
    // `findings` is a real array, but its own entries are a mix of well-formed and malformed: a
    // missing `severity`, a `severity` outside the real three-value enum, a non-string `summary`, and
    // one genuinely well-formed entry that must survive its own malformed siblings.
    adapter.script((request) => request.stepId === 'wf:review:review:testing', {
      structured: {
        findings: [
          { summary: 'no severity at all' },
          { summary: 'bad severity', severity: 'catastrophic' },
          { summary: 42, severity: 'minor' },
          { summary: 'a real, well-formed finding', severity: 'blocking' },
        ],
        checked: ['x', 7, 'y'],
      },
    });
    const ctx = createTestContext({ projectRoot, adapter });
    const stepNode = node({
      id: 'wf:review',
      kind: 'agent',
      agent: toAgentId('reviewer'),
      brief: 'review the diff',
    });

    const result = await dispatchAgentStep(stepNode, testAgent(), ctx, 'swarm-review', {
      perspectives: ['design', 'security', 'testing'],
    });

    expect(result.participants).toHaveLength(3);
    // design and security both had zero real findings and zero real "checked" evidence -- both get a
    // real, synthetic empty-review finding of their own.
    expect(result.reviewReport?.findings.some((f) => f.perspectives.includes('design'))).toBe(true);
    expect(result.reviewReport?.findings.some((f) => f.perspectives.includes('security'))).toBe(
      true,
    );
    // testing's one well-formed finding survived its own three malformed siblings.
    const real = result.reviewReport?.findings.find(
      (f) => f.summary === 'a real, well-formed finding',
    );
    expect(real?.severity).toBe('blocking');
  });

  it('swarm-review throws RUN-046 when no perspectives are given', async () => {
    const projectRoot = await createTempRepo('swarm-no-perspectives');
    const ctx = createTestContext({ projectRoot, adapter: new FakePlatformAdapter() });
    const stepNode = node({
      id: 'wf:review',
      kind: 'agent',
      agent: toAgentId('reviewer'),
      brief: 'review',
    });

    await expect(dispatchAgentStep(stepNode, testAgent(), ctx, 'swarm-review')).rejects.toThrow(
      ForgeError,
    );
  });
});
