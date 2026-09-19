/**
 * `resolveStepModel` — `PLAN-M13.md` P4, `05` §5.8.
 *
 * @see specs/05 §5.8
 * @see PLAN-M13.md P4
 */
import { isForgeError, type ForgeError } from '@forge/core';
import type { ForgeConfig } from '@forge/schemas/config';
import { describe, expect, it } from 'vitest';

import { resolveStepModel } from '../../src/resolve/model.ts';
import type { AgentDefinition } from '../../src/schema/types.ts';

function baseAgent(overrides: Partial<AgentDefinition> = {}): AgentDefinition {
  return {
    id: 'backend',
    name: 'Test Agent',
    version: '1.0.0',
    tier: 'core',
    mandate: 'Implement backend features.',
    decisions_owned: [],
    persona: { voice: 'terse', stance: 'pragmatic', disagreement_style: 'direct' },
    inputs: { required: [] },
    outputs: [{ type: 'Code', schema: 'code.schema.json', path: 'src/**' }],
    kb_write: [],
    tools: { read: true, write: true, network: false, git_commit: 'lane', deploy: false },
    model: { tier: 'balanced', thinking: 'medium' },
    limits: { max_turns: 10, wall_clock_ms: 600_000, max_cost_usd: 5 },
    parallel_safety: { file_ownership: ['src/**'], exclusive: true },
    gates: { produces_evidence_for: [], may_approve: [] },
    prompt: { system: 'p.md' },
    ...overrides,
  };
}

function models(overrides: Partial<ForgeConfig['models']> = {}): ForgeConfig['models'] {
  return {
    tiers: { frugal: {}, balanced: {}, max: {} },
    overrides: {},
    ...overrides,
  };
}

/** Asserts `fn` throws a typed `ForgeError` carrying exactly `code` (never merely "something threw"),
 * returning it so callers can also assert on its rendered detail. */
function expectCode(code: string, fn: () => unknown): ForgeError {
  try {
    fn();
  } catch (error) {
    expect(isForgeError(error)).toBe(true);
    if (!isForgeError(error)) throw error;
    expect(error.code).toBe(code);
    return error;
  }
  throw new Error(`expected a ${code} ForgeError, but nothing was thrown`);
}

const TEST_ADAPTER = 'test-adapter';

describe('resolveStepModel', () => {
  it("resolves the agent's own declared tier for the given adapter", () => {
    const agent = baseAgent({ model: { tier: 'balanced', thinking: 'medium' } });
    const cfg = models({ tiers: { frugal: {}, balanced: { [TEST_ADAPTER]: 'model-b' }, max: {} } });

    expect(resolveStepModel(agent, cfg, TEST_ADAPTER)).toBe('model-b');
  });

  it("a models.overrides entry for the agent id wins over the agent's own declared tier", () => {
    const agent = baseAgent({ id: 'architect', model: { tier: 'balanced', thinking: 'high' } });
    const cfg = models({
      tiers: {
        frugal: {},
        balanced: { [TEST_ADAPTER]: 'model-b' },
        max: { [TEST_ADAPTER]: 'model-m' },
      },
      overrides: { architect: 'max' },
    });

    expect(resolveStepModel(agent, cfg, TEST_ADAPTER)).toBe('model-m');
  });

  it("an override naming a non-real tier is a named RUN-078 error, not a silent fallback to the agent's own tier", () => {
    const agent = baseAgent({ id: 'architect', model: { tier: 'balanced', thinking: 'high' } });
    const cfg = models({
      tiers: { frugal: {}, balanced: { [TEST_ADAPTER]: 'model-b' }, max: {} },
      overrides: { architect: 'ludicrous' },
    });

    try {
      resolveStepModel(agent, cfg, TEST_ADAPTER);
      expect.unreachable('expected resolveStepModel to throw');
    } catch (error) {
      expect(isForgeError(error)).toBe(true);
      if (isForgeError(error)) {
        expect(error.code).toBe('RUN-078');
        expect(error.message).toContain('architect');
      }
    }
  });

  it('a real tier with no entry for this adapter is a named error, not undefined silently reaching the caller', () => {
    const agent = baseAgent({ model: { tier: 'frugal', thinking: 'low' } });
    const cfg = models({
      tiers: { frugal: { 'other-adapter': 'model-f' }, balanced: {}, max: {} },
    });

    const error = expectCode('RUN-078', () => resolveStepModel(agent, cfg, TEST_ADAPTER));
    expect(error.message).toContain(
      `no model configured for tier "frugal" on adapter "${TEST_ADAPTER}"`,
    );
  });

  it('a blank/whitespace-only configured model id is treated as unmapped, not passed through', () => {
    const agent = baseAgent({ model: { tier: 'frugal', thinking: 'low' } });
    const cfg = models({ tiers: { frugal: { [TEST_ADAPTER]: '   ' }, balanced: {}, max: {} } });

    expectCode('RUN-078', () => resolveStepModel(agent, cfg, TEST_ADAPTER));
  });

  it('a completely unconfigured tier (no adapters at all) is a named error', () => {
    const agent = baseAgent({ model: { tier: 'max', thinking: 'high' } });
    const cfg = models();

    expectCode('RUN-078', () => resolveStepModel(agent, cfg, TEST_ADAPTER));
  });

  it("an empty-string override is an invalid tier, never silently the agent's own tier", () => {
    const agent = baseAgent({ id: 'architect' });
    const cfg = models({
      tiers: { frugal: {}, balanced: { [TEST_ADAPTER]: 'model-b' }, max: {} },
      overrides: { architect: '' },
    });

    const error = expectCode('RUN-078', () => resolveStepModel(agent, cfg, TEST_ADAPTER));
    expect(error.message).toContain('is not one of frugal, balanced, max');
  });

  it('an adapter id naming an Object.prototype member is unmapped, not a raw TypeError', () => {
    const agent = baseAgent();
    const cfg = models({ tiers: { frugal: {}, balanced: { x: 'model-b' }, max: {} } });

    expectCode('RUN-078', () => resolveStepModel(agent, cfg, 'constructor'));
    expectCode('RUN-078', () => resolveStepModel(agent, cfg, 'toString'));
  });

  it('an agent id naming an Object.prototype member never picks up an inherited override', () => {
    const agent = baseAgent({ id: 'toString' });
    const cfg = models({ tiers: { frugal: {}, balanced: { [TEST_ADAPTER]: 'model-b' }, max: {} } });

    expect(resolveStepModel(agent, cfg, TEST_ADAPTER)).toBe('model-b');
  });
});
