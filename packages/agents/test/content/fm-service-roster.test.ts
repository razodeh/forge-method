/**
 * `modules/fm-service/agents/{domain-modeler,integration-architect}.agent.yaml` (`PLAN-M10.md` P4) --
 * the real, authoritative copies `19` §19.1's own shipped-modules row names for this module, and the
 * real, end-to-end proof that both win over `modules/fm-core/agents/*.agent.yaml`'s own older,
 * anticipatory copies of the same ids once both modules are installed together (see
 * `modules/fm-service/module.yaml`'s own header comment and `SPEC-QUESTIONS.md` for the full
 * reasoning). Mirrors `fm-web-roster.test.ts`'s own established pattern.
 *
 * @see specs/05 §5.2, §5.3
 * @see PLAN-M10.md P4
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
const fmServiceAgentsDir = path.join(modulesDir, 'fm-service', 'agents');

function loadFmServiceAgent(fileName: string): AgentDefinition {
  const source = readFileSync(path.join(fmServiceAgentsDir, fileName), 'utf8');
  const result = loadAgentDefinition(source, fileName);
  if (!result.success)
    throw new Error(`fm-service ${fileName} failed to load: ${JSON.stringify(result.issues)}`);
  return result.agent;
}

describe('fm-service/agents/domain-modeler.agent.yaml — real, shipped content', () => {
  it('loads via loadAgentDefinition with id "domain-modeler" and tier "specialised"', () => {
    const agent = loadFmServiceAgent('domain-modeler.agent.yaml');
    expect(agent.id).toBe('domain-modeler');
    expect(agent.tier).toBe('specialised');
  });

  it("produces evidence for G-Integration in addition to G-Design, unlike fm-core's own older copy", () => {
    const agent = loadFmServiceAgent('domain-modeler.agent.yaml');
    expect(agent.gates.produces_evidence_for).toContain('G-Design');
    expect(agent.gates.produces_evidence_for).toContain('G-Integration');
  });

  it('has a non-empty decisions_owned and persona.disagreement_style (05 §5.3)', () => {
    const agent = loadFmServiceAgent('domain-modeler.agent.yaml');
    expect(agent.decisions_owned.length).toBeGreaterThan(0);
    expect(agent.persona.disagreement_style.length).toBeGreaterThan(0);
  });
});

describe('fm-service/agents/integration-architect.agent.yaml — real, shipped content', () => {
  it('loads via loadAgentDefinition with id "integration-architect" and tier "specialised"', () => {
    const agent = loadFmServiceAgent('integration-architect.agent.yaml');
    expect(agent.id).toBe('integration-architect');
    expect(agent.tier).toBe('specialised');
  });

  it("its own mandate names the real api-versioning framework it owns, unlike fm-core's own older copy -- deliberately NOT also listed under this agent's own frameworks: (see the agent file's own doc comment: agentValidateAll only knows @forge/templates' core FRAMEWORK_INDEX, not a module-owned framework, and a first draft that did list it broke packages/cli/test/commands/agent.test.ts's real, complete-roster fixture)", () => {
    const agent = loadFmServiceAgent('integration-architect.agent.yaml');
    expect(agent.mandate).toContain('api-versioning');
    expect(agent.frameworks).toContain('communication-integration-patterns');
    expect(agent.frameworks).not.toContain('api-versioning');
  });

  it('has a non-empty decisions_owned and persona.disagreement_style (05 §5.3)', () => {
    const agent = loadFmServiceAgent('integration-architect.agent.yaml');
    expect(agent.decisions_owned.length).toBeGreaterThan(0);
    expect(agent.persona.disagreement_style.length).toBeGreaterThan(0);
  });
});

describe('loadAgentRegistry(modulesDir) with both fm-core and fm-service installed', () => {
  it('resolves "domain-modeler" to fm-service\'s own agent, not fm-core\'s stray placeholder -- alphabetical module scan order (fm-core, then fm-service) plus AgentRegistry\'s own "later entry wins" semantics', async () => {
    const registry = await loadAgentRegistry(modulesDir);
    const domainModeler = registry.get('domain-modeler');
    expect(domainModeler).toBeDefined();
    expect(domainModeler?.tier).toBe('specialised');
    // The real, distinguishing fact this test proves: fm-service's own domain-modeler produces
    // evidence for G-Integration; fm-core's older copy does not.
    expect(domainModeler?.gates.produces_evidence_for).toContain('G-Integration');
  });

  it('resolves "integration-architect" to fm-service\'s own agent, not fm-core\'s stray placeholder', async () => {
    const registry = await loadAgentRegistry(modulesDir);
    const integrationArchitect = registry.get('integration-architect');
    expect(integrationArchitect).toBeDefined();
    expect(integrationArchitect?.tier).toBe('specialised');
    // The real, distinguishing fact: fm-service's own integration-architect's mandate names the real
    // api-versioning framework it owns; fm-core's older copy's mandate does not.
    expect(integrationArchitect?.mandate).toContain('api-versioning');
  });

  it('every other fm-core agent is still present and unaffected by fm-service being installed alongside it', async () => {
    const registry = await loadAgentRegistry(modulesDir);
    expect(registry.get('architect')?.id).toBe('architect');
    expect(registry.get('backend')?.id).toBe('backend');
  });
});
