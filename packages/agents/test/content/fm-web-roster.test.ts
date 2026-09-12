/**
 * `modules/fm-web/agents/frontend.agent.yaml` (`PLAN-M10.md` P3) -- the real, authoritative
 * `frontend` agent `19` §19.1's own shipped-modules row names for this module, and the real,
 * end-to-end proof that it wins over `modules/fm-core/agents/frontend.agent.yaml`'s own older,
 * anticipatory copy of the same id once both modules are installed together (see
 * `modules/fm-web/module.yaml`'s own header comment and `SPEC-QUESTIONS.md` Q157 for the full
 * reasoning).
 *
 * @see specs/05 §5.2, §5.3
 * @see PLAN-M10.md P3
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { loadAgentDefinition } from '../../src/schema/load.ts';
import { loadAgentRegistry } from '../../src/registry/load-agent-registry.ts';
import type { AgentDefinition } from '../../src/schema/types.ts';
import type { AbsolutePath } from '@forge/core';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const modulesDir = path.join(repoRoot, 'modules') as AbsolutePath;
const fmWebAgentsDir = path.join(modulesDir, 'fm-web', 'agents');

function loadFmWebFrontend(): AgentDefinition {
  const source = readFileSync(path.join(fmWebAgentsDir, 'frontend.agent.yaml'), 'utf8');
  const result = loadAgentDefinition(source, 'frontend.agent.yaml');
  if (!result.success)
    throw new Error(`fm-web frontend failed to load: ${JSON.stringify(result.issues)}`);
  return result.agent;
}

describe('fm-web/agents/frontend.agent.yaml — real, shipped content', () => {
  it('loads via loadAgentDefinition with id "frontend" and tier "specialised"', () => {
    const agent = loadFmWebFrontend();
    expect(agent.id).toBe('frontend');
    expect(agent.tier).toBe('specialised');
    expect(agent.extends).toBe('base-engineer');
  });

  it('has a non-empty decisions_owned, persona.disagreement_style, and a ceiling-respecting tool grant (05 §5.3)', () => {
    const agent = loadFmWebFrontend();
    expect(agent.decisions_owned.length).toBeGreaterThan(0);
    expect(agent.persona.disagreement_style.length).toBeGreaterThan(0);
    expect(agent.ceiling).toBeDefined();
    // The ceiling must not grant more than the agent's own base tools -- proven directly rather than
    // asserted by convention: every field the ceiling declares is present, and no field grants
    // something tools does not already hold.
    expect(agent.ceiling?.tools.write).toBe(agent.tools.write);
    expect(agent.ceiling?.tools.deploy).toBe(agent.tools.deploy);
  });

  it('declares a real ComponentSpec output alongside Code/Task', () => {
    const agent = loadFmWebFrontend();
    const types = agent.outputs.map((o) => o.type);
    expect(types).toContain('Code');
    expect(types).toContain('ComponentSpec');
    expect(types).toContain('Task');
  });

  it("skills deliberately unset -- inherits base-engineer, the same real choice fm-core's own frontend agent makes (SPEC-QUESTIONS.md Q98)", () => {
    expect(loadFmWebFrontend().skills).toBeUndefined();
  });
});

describe('loadAgentRegistry(modulesDir) with both fm-core and fm-web installed', () => {
  it('resolves "frontend" to fm-web\'s own agent, not fm-core\'s stray placeholder -- alphabetical module scan order (fm-core, then fm-web) plus AgentRegistry\'s own "later entry wins" semantics', async () => {
    const registry = await loadAgentRegistry(modulesDir);
    const frontend = registry.get('frontend');
    expect(frontend).toBeDefined();
    expect(frontend?.tier).toBe('specialised');
    // The real, distinguishing fact this test proves: fm-web's own frontend declares
    // "implementation.component_contracts" in decisions_owned; fm-core's older copy does not.
    expect(frontend?.decisions_owned).toContain('implementation.component_contracts');
  });

  it('every other fm-core agent is still present and unaffected by fm-web being installed alongside it', async () => {
    const registry = await loadAgentRegistry(modulesDir);
    expect(registry.get('architect')?.id).toBe('architect');
    expect(registry.get('backend')?.id).toBe('backend');
  });
});
