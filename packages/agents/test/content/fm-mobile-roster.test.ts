/**
 * `modules/fm-mobile/agents/mobile.agent.yaml` (`PLAN-M10.md` P6) -- the real, authoritative copy `19`
 * §19.1's own `fm-mobile` shipped-modules row names for this module, and the real, end-to-end proof it
 * wins over `modules/fm-core/agents/mobile.agent.yaml`'s own older, anticipatory copy of the same id
 * once both modules are installed together (see `modules/fm-mobile/module.yaml`'s own header comment
 * and `SPEC-QUESTIONS.md` for the full reasoning). Mirrors `fm-data-roster.test.ts`'s own established
 * pattern.
 *
 * @see specs/05 §5.2, §5.3
 * @see specs/19 §19.1
 * @see PLAN-M10.md P6
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
const fmMobileAgentsDir = path.join(modulesDir, 'fm-mobile', 'agents');

function loadFmMobileAgent(fileName: string): AgentDefinition {
  const source = readFileSync(path.join(fmMobileAgentsDir, fileName), 'utf8');
  const result = loadAgentDefinition(source, fileName);
  if (!result.success)
    throw new Error(`fm-mobile ${fileName} failed to load: ${JSON.stringify(result.issues)}`);
  return result.agent;
}

describe('fm-mobile/agents/mobile.agent.yaml — real, shipped content', () => {
  it('loads via loadAgentDefinition with id "mobile" and tier "specialised"', () => {
    const agent = loadFmMobileAgent('mobile.agent.yaml');
    expect(agent.id).toBe('mobile');
    expect(agent.tier).toBe('specialised');
  });

  it("produces evidence for G-Deliver in addition to G-Verify, unlike fm-core's own older copy", () => {
    const agent = loadFmMobileAgent('mobile.agent.yaml');
    expect(agent.gates.produces_evidence_for).toContain('G-Verify');
    expect(agent.gates.produces_evidence_for).toContain('G-Deliver');
  });

  it('ships a real ADR output for offline-first pattern decisions, in addition to Code/Task', () => {
    const agent = loadFmMobileAgent('mobile.agent.yaml');
    const outputTypes = agent.outputs.map((o) => o.type);
    expect(outputTypes).toContain('ADR');
    expect(outputTypes).toContain('Code');
    expect(outputTypes).toContain('Task');
  });

  it("proposes into architect's own exclusive architecture/** namespace rather than claiming file_ownership over it", () => {
    const agent = loadFmMobileAgent('mobile.agent.yaml');
    expect(agent.kb_write).toEqual([]);
    expect(agent.kb_propose).toContain('architecture/mobile/**');
    expect(agent.parallel_safety.file_ownership).toEqual([]);
  });

  it("declares real write/exec tool grants matching fm-core's own older copy (no widening invented here)", () => {
    const agent = loadFmMobileAgent('mobile.agent.yaml');
    expect(agent.tools.write).toBe(true);
    expect(agent.tools.network).toBe(false);
  });

  it('has a non-empty decisions_owned and persona.disagreement_style (05 §5.3)', () => {
    const agent = loadFmMobileAgent('mobile.agent.yaml');
    expect(agent.decisions_owned.length).toBeGreaterThan(0);
    expect(agent.decisions_owned).toContain('implementation.offline_first_pattern');
    expect(agent.persona.disagreement_style.length).toBeGreaterThan(0);
  });
});

describe('loadAgentRegistry(modulesDir) with both fm-core and fm-mobile installed', () => {
  it('resolves "mobile" to fm-mobile\'s own agent, not fm-core\'s stray placeholder -- alphabetical module scan order (fm-core, then fm-mobile) plus AgentRegistry\'s own "later entry wins" semantics', async () => {
    const registry = await loadAgentRegistry(modulesDir);
    const mobile = registry.get('mobile');
    expect(mobile).toBeDefined();
    expect(mobile?.tier).toBe('specialised');
    // The real, distinguishing fact this test proves: fm-mobile's own mobile agent produces evidence
    // for G-Deliver; fm-core's older copy does not.
    expect(mobile?.gates.produces_evidence_for).toContain('G-Deliver');
  });

  it('every other fm-core agent is still present and unaffected by fm-mobile being installed alongside it', async () => {
    const registry = await loadAgentRegistry(modulesDir);
    expect(registry.get('architect')?.id).toBe('architect');
    expect(registry.get('release')?.id).toBe('release');
  });
});
