/**
 * `AgentRegistry` — `PLAN-M6.md` A1's own Checks section.
 *
 * @see specs/05 §5.3
 * @see PLAN-M6.md A1
 */
import { describe, expect, it } from 'vitest';

import { loadAgentDefinition } from '../../src/schema/load.ts';
import { AgentRegistry } from '../../src/registry/registry.ts';
import { ARCHITECT } from '../fixtures/architect.ts';

function loadAgent(source: string) {
  const result = loadAgentDefinition(source, 'x.agent.yaml');
  if (!result.success) throw new Error('fixture agent failed to load');
  return result.agent;
}

describe('AgentRegistry', () => {
  it('get() finds an agent by id', () => {
    const registry = new AgentRegistry([loadAgent(ARCHITECT)]);
    expect(registry.get('architect')?.name).toBe('System Architect');
  });

  it('get() returns undefined for an unknown id', () => {
    const registry = new AgentRegistry([loadAgent(ARCHITECT)]);
    expect(registry.get('not-a-real-agent')).toBeUndefined();
  });

  it('all() returns every registered agent', () => {
    const registry = new AgentRegistry([loadAgent(ARCHITECT)]);
    expect(registry.all()).toHaveLength(1);
  });

  it('add() with a repeated id replaces the earlier entry', () => {
    const registry = new AgentRegistry([loadAgent(ARCHITECT)]);
    const updated = loadAgent(
      ARCHITECT.replace('name: System Architect', 'name: Updated Architect'),
    );
    registry.add(updated);
    expect(registry.all()).toHaveLength(1);
    expect(registry.get('architect')?.name).toBe('Updated Architect');
  });
});
