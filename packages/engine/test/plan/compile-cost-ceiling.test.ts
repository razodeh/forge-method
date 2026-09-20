/**
 * What a step reserves against the run budget, decided at compile time (`PLAN-M13.md` P12, `Q208` finding
 * 2): only steps that start a model session can spend model money, so only they reserve anything. A
 * `command` step (`forge kb sync`) used to be charged the agent-sized default.
 *
 * @see specs/06 §6.3, §6.9
 * @see specs/20 §20.8
 */
import { describe, expect, it } from 'vitest';

import { compilePlan } from '../../src/plan/compile.ts';
import type { StepNode } from '../../src/plan/index.ts';
import { parseWorkflow } from '../../src/workflow/parse.ts';

function compile(yaml: string): readonly StepNode[] {
  const parsed = parseWorkflow(yaml);
  if (!parsed.success) throw new Error(parsed.issues.map((i) => i.message).join('; '));
  const compiled = compilePlan(parsed.workflow, {});
  if (!compiled.success) throw new Error(compiled.issues.map((i) => i.message).join('; '));
  return compiled.nodes;
}

const WORKFLOW = `
id: wf
name: Cost fixture
version: 1.0.0
description: one of each kind that matters for a reservation
levels: [L0]
steps:
  - id: think
    kind: agent
    agent: em
    brief: briefs/run-retro.md
  - id: think-capped
    kind: agent
    agent: em
    brief: briefs/run-retro.md
    limits: { maxTurns: 5, maxCostUsd: 0.75 }
  - id: sync
    kind: command
    run: 'forge kb sync'
    inline: true
  - id: check
    kind: gate
    gate: G-Design
  - id: mark
    kind: checkpoint
`;

describe('compilePlan reservation by step kind', () => {
  const nodes = compile(WORKFLOW);
  const byId = (id: string): StepNode => {
    const found = nodes.find((n) => n.id === `wf:${id}`);
    if (found === undefined) throw new Error(`no node ${id}`);
    return found;
  };

  it('reserves nothing for a command step: it spends no model money', () => {
    expect(byId('sync').limits.maxCostUsd).toBe(0);
  });

  it('reserves nothing for gate and checkpoint steps', () => {
    expect(byId('check').limits.maxCostUsd).toBe(0);
    expect(byId('mark').limits.maxCostUsd).toBe(0);
  });

  it("keeps an agent step's own declared limit and marks it final", () => {
    expect(byId('think-capped').limits.maxCostUsd).toBe(0.75);
    expect(byId('think-capped').maxCostSource).toBe('step');
  });

  it('gives an agent step with no declared limit the placeholder and marks it open to resolution', () => {
    expect(byId('think').limits.maxCostUsd).toBe(2);
    expect(byId('think').maxCostSource).toBe('default');
  });

  it('marks no source on a step that runs no model', () => {
    expect(byId('sync').maxCostSource).toBeUndefined();
  });
});
