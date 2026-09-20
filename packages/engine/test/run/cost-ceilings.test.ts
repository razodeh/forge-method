/**
 * `resolveStepCostCeilings` — the per-step cost ceiling hierarchy (`PLAN-M13.md` P12, `Q210`,
 * `Q208` finding 2): the workflow step's own limit, then the agent's `limits.max_cost_usd`, then the
 * project's `budget.perStepUsdDefault`, then the compile placeholder. Steps that run no model reserve 0.
 *
 * @see specs/05 §5.2
 * @see specs/06 §6.9
 * @see specs/18 §18.2
 */
import { ForgeError } from '@forge/core/errors';
import { describe, expect, it } from 'vitest';

import { toAgentId } from '../../src/plan/index.ts';
import { resolveStepCostCeilings, type CostCeilingSource } from '../../src/run/cost-ceilings.ts';
import { node } from '../dispatch/helpers.ts';

function source(
  agents: Readonly<Record<string, number>>,
  perStepUsdDefault?: number,
): CostCeilingSource & { readonly loads: string[] } {
  const loads: string[] = [];
  return {
    loads,
    assembly: {
      loadAgent: (id) => {
        loads.push(id);
        const cost = agents[id];
        if (cost === undefined) {
          return Promise.reject(
            new ForgeError('RUN-056', { agentId: id, path: `.forge/agents/${id}.yaml` }),
          );
        }
        return Promise.resolve({ limits: { max_cost_usd: cost } });
      },
    },
    ...(perStepUsdDefault === undefined ? {} : { budget: { perStepUsdDefault } }),
  };
}

const open = (id: string, agent: string | undefined) =>
  node({
    id,
    kind: 'agent',
    ...(agent === undefined ? {} : { agent: toAgentId(agent) }),
    limits: { maxTurns: 20, wallClockMs: 1, maxCostUsd: 2 },
    maxCostSource: 'default',
  });

async function ceilingOf(
  n: ReturnType<typeof node>,
  src: CostCeilingSource,
): Promise<number | undefined> {
  const [resolved] = await resolveStepCostCeilings([n], src);
  return resolved?.limits.maxCostUsd;
}

describe('resolveStepCostCeilings', () => {
  it("uses the agent's own limits.max_cost_usd when the step declared none", async () => {
    const [resolved] = await resolveStepCostCeilings([open('wf:a', 'em')], source({ em: 3 }, 9));
    expect(resolved?.limits.maxCostUsd).toBe(3);
    expect(resolved?.maxCostSource).toBe('agent');
  });

  it('lowers the reservation when the agent is cheaper than the placeholder', async () => {
    expect(await ceilingOf(open('wf:a', 'cheap'), source({ cheap: 0.5 }))).toBe(0.5);
  });

  it("never overrides a limit the workflow step itself declared, even above the agent's", async () => {
    const declared = node({
      id: 'wf:a',
      kind: 'agent',
      agent: toAgentId('em'),
      limits: { maxTurns: 20, wallClockMs: 1, maxCostUsd: 7 },
      maxCostSource: 'step',
    });
    const [resolved] = await resolveStepCostCeilings([declared], source({ em: 3 }, 9));
    expect(resolved).toBe(declared);
    expect(resolved?.limits.maxCostUsd).toBe(7);
  });

  it('falls back to budget.perStepUsdDefault when the agent cannot be loaded (its own refusal happens at dispatch)', async () => {
    const [resolved] = await resolveStepCostCeilings([open('wf:a', 'ghost')], source({}, 1.25));
    expect(resolved?.limits.maxCostUsd).toBe(1.25);
    expect(resolved?.maxCostSource).toBe('config');
  });

  it("a project default is a default, not a cap: the agent's own, higher ceiling still wins", async () => {
    const [resolved] = await resolveStepCostCeilings(
      [open('wf:a', 'big')],
      source({ big: 5 }, 0.5),
    );
    expect(resolved?.limits.maxCostUsd).toBe(5);
    expect(resolved?.maxCostSource).toBe('agent');
  });

  it('propagates any failure other than a missing agent: a transient error must not silently reserve the placeholder', async () => {
    const flaky: CostCeilingSource = {
      assembly: { loadAgent: () => Promise.reject(new Error('EMFILE: too many open files')) },
    };
    await expect(resolveStepCostCeilings([open('wf:a', 'em')], flaky)).rejects.toThrow('EMFILE');
  });

  it('keeps the compile placeholder when there is neither an agent value nor a project default', async () => {
    const original = open('wf:a', 'ghost');
    const [resolved] = await resolveStepCostCeilings([original], source({}));
    expect(resolved).toBe(original);
    expect(resolved?.limits.maxCostUsd).toBe(2);
  });

  it('gives a session step (no agent id on the node) the project default', async () => {
    const session = node({
      id: 'wf:s',
      kind: 'session',
      limits: { maxTurns: 20, wallClockMs: 1, maxCostUsd: 2 },
      maxCostSource: 'default',
    });
    expect(await ceilingOf(session, source({}, 4))).toBe(4);
  });

  it('leaves a step that reserves nothing (a command step) untouched', async () => {
    const command = node({
      id: 'wf:c',
      kind: 'command',
      run: 'forge kb sync',
      limits: { maxTurns: 20, wallClockMs: 1, maxCostUsd: 0 },
    });
    const src = source({ em: 3 }, 9);
    const [resolved] = await resolveStepCostCeilings([command], src);
    expect(resolved).toBe(command);
    expect(src.loads).toEqual([]);
  });

  it('loads each agent once however many steps use it', async () => {
    const src = source({ em: 3 });
    const resolved = await resolveStepCostCeilings(
      [open('wf:a', 'em'), open('wf:b', 'em'), open('wf:c', 'em')],
      src,
    );
    expect(resolved.map((n) => n.limits.maxCostUsd)).toEqual([3, 3, 3]);
    expect(src.loads).toEqual(['em']);
  });

  it('ignores a non-finite or negative agent ceiling rather than reserving it', async () => {
    expect(await ceilingOf(open('wf:a', 'bad'), source({ bad: Number.NaN }, 1.5))).toBe(1.5);
    expect(await ceilingOf(open('wf:a', 'bad'), source({ bad: -1 }, 1.5))).toBe(1.5);
  });

  it('does not mutate its input nodes', async () => {
    const original = open('wf:a', 'em');
    await resolveStepCostCeilings([original], source({ em: 3 }));
    expect(original.limits.maxCostUsd).toBe(2);
    expect(original.maxCostSource).toBe('default');
  });
});
