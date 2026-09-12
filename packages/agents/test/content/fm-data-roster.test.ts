/**
 * `modules/fm-data/agents/data-engineer.agent.yaml` (`PLAN-M10.md` P5) -- the real, authoritative copy
 * `19` §19.1's own `fm-data` shipped-modules row names for this module, and the real, end-to-end proof
 * it wins over `modules/fm-core/agents/data-engineer.agent.yaml`'s own older, anticipatory copy of the
 * same id once both modules are installed together (see `modules/fm-data/module.yaml`'s own header
 * comment and `SPEC-QUESTIONS.md` for the full reasoning). Mirrors `fm-service-roster.test.ts`'s own
 * established pattern.
 *
 * @see specs/05 §5.2, §5.3
 * @see PLAN-M10.md P5
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
const fmDataAgentsDir = path.join(modulesDir, 'fm-data', 'agents');

function loadFmDataAgent(fileName: string): AgentDefinition {
  const source = readFileSync(path.join(fmDataAgentsDir, fileName), 'utf8');
  const result = loadAgentDefinition(source, fileName);
  if (!result.success)
    throw new Error(`fm-data ${fileName} failed to load: ${JSON.stringify(result.issues)}`);
  return result.agent;
}

describe('fm-data/agents/data-engineer.agent.yaml — real, shipped content', () => {
  it('loads via loadAgentDefinition with id "data-engineer" and tier "specialised"', () => {
    const agent = loadFmDataAgent('data-engineer.agent.yaml');
    expect(agent.id).toBe('data-engineer');
    expect(agent.tier).toBe('specialised');
  });

  it("produces evidence for G-Design in addition to G-Verify, unlike fm-core's own older copy", () => {
    const agent = loadFmDataAgent('data-engineer.agent.yaml');
    expect(agent.gates.produces_evidence_for).toContain('G-Design');
    expect(agent.gates.produces_evidence_for).toContain('G-Verify');
  });

  it('ships real DataModel/Diagram outputs for warehouse modelling and pipeline diagrams, in addition to Code/Task', () => {
    const agent = loadFmDataAgent('data-engineer.agent.yaml');
    const outputTypes = agent.outputs.map((o) => o.type);
    expect(outputTypes).toContain('DataModel');
    expect(outputTypes).toContain('Diagram');
    expect(outputTypes).toContain('Code');
    expect(outputTypes).toContain('Task');
  });

  it("proposes into data-architect's own exclusive docs/forge/kb/data/** namespace rather than claiming file_ownership over it", () => {
    const agent = loadFmDataAgent('data-engineer.agent.yaml');
    expect(agent.kb_write).toEqual([]);
    expect(agent.kb_propose).toContain('data/warehouse/**');
    expect(agent.kb_propose).toContain('data/views/**');
    expect(agent.parallel_safety.file_ownership).toEqual([]);
  });

  it("lists the module-owned analytical-pipeline-design framework directly -- safe here, unlike PLAN-M10.md P4's own real agentValidateAll bug, because this id is already a member of @forge/templates' core FRAMEWORK_INDEX regardless of which module ships it", () => {
    const agent = loadFmDataAgent('data-engineer.agent.yaml');
    expect(agent.frameworks).toContain('analytical-pipeline-design');
  });

  it('has a non-empty decisions_owned and persona.disagreement_style (05 §5.3)', () => {
    const agent = loadFmDataAgent('data-engineer.agent.yaml');
    expect(agent.decisions_owned.length).toBeGreaterThan(0);
    expect(agent.persona.disagreement_style.length).toBeGreaterThan(0);
  });
});

describe('loadAgentRegistry(modulesDir) with both fm-core and fm-data installed', () => {
  it('resolves "data-engineer" to fm-data\'s own agent, not fm-core\'s stray placeholder -- alphabetical module scan order (fm-core, then fm-data) plus AgentRegistry\'s own "later entry wins" semantics', async () => {
    const registry = await loadAgentRegistry(modulesDir);
    const dataEngineer = registry.get('data-engineer');
    expect(dataEngineer).toBeDefined();
    expect(dataEngineer?.tier).toBe('specialised');
    // The real, distinguishing fact this test proves: fm-data's own data-engineer produces evidence
    // for G-Design; fm-core's older copy does not.
    expect(dataEngineer?.gates.produces_evidence_for).toContain('G-Design');
  });

  it('every other fm-core agent is still present and unaffected by fm-data being installed alongside it', async () => {
    const registry = await loadAgentRegistry(modulesDir);
    expect(registry.get('architect')?.id).toBe('architect');
    expect(registry.get('data-architect')?.id).toBe('data-architect');
  });
});
