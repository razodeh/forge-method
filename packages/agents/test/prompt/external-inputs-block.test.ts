/**
 * `compilePrompt`'s block [4] rendering of `StepContext.externalInputs` — `PLAN-M14.md` P30, `20` §20.5
 * point 3 / `15` §15.5.4: a step's own declared `mcp:`/`fetch:https:` inputs, named separately from the
 * KB entries actually packed. Kept in its own file (not `prompt/compile-prompt.test.ts`) purely to avoid
 * two agents editing the same shared test file concurrently during this milestone's own gauntlet run —
 * no functional reason `renderStepBriefBlock`'s own coverage needs to live apart from the rest of block
 * [4]'s tests.
 *
 * @see specs/20 §20.5 point 3
 * @see specs/15 §15.5.4
 * @see PLAN-M14.md P30
 */
import { describe, expect, it } from 'vitest';

import type { StepContext } from '../../src/context/pack-for-step.ts';
import type { AgentContextPack } from '../../src/context/types.ts';
import { compilePrompt } from '../../src/prompt/compile-prompt.ts';
import type { PromptConstraints } from '../../src/prompt/types.ts';
import type { AgentDefinition } from '../../src/schema/types.ts';

const BASE_STEP: StepContext = {
  brief: 'Implement the billing invariant story.',
  declaredInputIds: [],
  produces: ['src/billing/invoice.ts'],
  consumes: [],
};

function baseAgent(overrides: Partial<AgentDefinition> = {}): AgentDefinition {
  return {
    id: 'test-agent',
    name: 'Test Agent',
    version: '1.0.0',
    tier: 'core',
    mandate: 'Implement billing features.',
    decisions_owned: ['billing.invariants'],
    persona: { voice: 'terse', stance: 'pragmatic', disagreement_style: 'direct' },
    inputs: { required: [] },
    outputs: [{ type: 'Invoice', schema: 'invoice.schema.json', path: 'src/billing/invoice.ts' }],
    kb_write: [],
    tools: { read: true, write: true, network: false, git_commit: 'lane', deploy: false },
    model: { tier: 'balanced', thinking: 'medium' },
    limits: { max_turns: 10, wall_clock_ms: 600_000, max_cost_usd: 5 },
    parallel_safety: { file_ownership: ['src/billing/**'], exclusive: true },
    gates: { produces_evidence_for: [], may_approve: [] },
    skills: [],
    prompt: { system: 'p.md' },
    ...overrides,
  };
}

function basePack(overrides: Partial<AgentContextPack> = {}): AgentContextPack {
  return {
    pinnedCore: { glossary: 'g', constraints: 'c', adrIndex: 'a', codingStandards: 'cs' },
    declaredInputs: [],
    retrieved: [],
    manifest: { ids: [], tokenCounts: {} },
    skills: [],
    ...overrides,
  };
}

const BASE_CONSTRAINTS: PromptConstraints = {
  tools: {
    read: true,
    write: true,
    exec: undefined,
    network: false,
    git_commit: 'lane',
    deploy: false,
  },
  forbiddenActions: ['deploy to production'],
  budget: { max_turns: 10, wall_clock_ms: 600_000, max_cost_usd: 5 },
  autonomy: 'guided',
};

function block4(step: StepContext): string {
  const prompt = compilePrompt(step, baseAgent(), basePack(), BASE_CONSTRAINTS, ['tests pass']);
  const found = prompt.blocks.find((block) => block.index === 4);
  if (found === undefined) throw new Error('no block [4] in the compiled prompt');
  return found.content;
}

describe('compilePrompt — block [4], StepContext.externalInputs (PLAN-M14.md P30)', () => {
  it('is absent when externalInputs is undefined: block [4] is exactly the brief, unchanged', () => {
    expect(block4(BASE_STEP)).toBe(BASE_STEP.brief);
  });

  it('is absent when externalInputs is an empty array, the same as undefined', () => {
    expect(block4({ ...BASE_STEP, externalInputs: [] })).toBe(BASE_STEP.brief);
  });

  it('lists every declared external input, each on its own line, after the brief', () => {
    const content = block4({
      ...BASE_STEP,
      externalInputs: ['mcp:jira/search_issues', 'fetch:https://example.com/incident'],
    });
    expect(content).toContain(BASE_STEP.brief);
    expect(content).toContain('External inputs for this step');
    expect(content).toContain('- mcp:jira/search_issues');
    expect(content).toContain('- fetch:https://example.com/incident');
    // The brief precedes the external-inputs section, never the reverse.
    expect(content.indexOf(BASE_STEP.brief)).toBeLessThan(content.indexOf('External inputs'));
  });

  it('names the untrusted-content posture (20 §20.5 point 3): read from outside the project, treated as data not instructions', () => {
    const content = block4({ ...BASE_STEP, externalInputs: ['mcp:jira/search_issues'] });
    expect(content).toMatch(/never from the project KB/);
    expect(content).toMatch(/not instructions/);
  });

  it('composes correctly with role-specific guidance: brief, then guidance, then external inputs', () => {
    const prompt = compilePrompt(
      { ...BASE_STEP, externalInputs: ['mcp:jira/search_issues'] },
      baseAgent(),
      basePack(),
      BASE_CONSTRAINTS,
      ['tests pass'],
      { roleSpecificGuidance: 'Prefer the existing invoice module.' },
    );
    const content = prompt.blocks.find((block) => block.index === 4)?.content ?? '';
    const briefIndex = content.indexOf(BASE_STEP.brief);
    const guidanceIndex = content.indexOf('Prefer the existing invoice module.');
    const externalIndex = content.indexOf('External inputs for this step');
    expect(briefIndex).toBeGreaterThanOrEqual(0);
    expect(guidanceIndex).toBeGreaterThan(briefIndex);
    expect(externalIndex).toBeGreaterThan(guidanceIndex);
  });
});
