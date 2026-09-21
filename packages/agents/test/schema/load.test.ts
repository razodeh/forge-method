/**
 * `loadAgentDefinition`/`readAgentDefinition` — `PLAN-M6.md` A1's own Checks section.
 *
 * @see specs/05 §5.3
 * @see PLAN-M6.md A1
 */
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { ProjectPaths } from '@forge/core';
import { describe, expect, it } from 'vitest';

import { loadAgentDefinition, readAgentDefinition } from '../../src/schema/load.ts';
import { ARCHITECT } from '../fixtures/architect.ts';

describe('loadAgentDefinition', () => {
  it('round-trips the full 05 §5.3 architect worked example with every field intact', () => {
    const result = loadAgentDefinition(ARCHITECT, 'architect.agent.yaml');

    if (!result.success)
      throw new Error(`expected success, got issues: ${JSON.stringify(result.issues)}`);
    const agent = result.agent;
    expect(agent.id).toBe('architect');
    expect(agent.name).toBe('System Architect');
    expect(agent.version).toBe('1.2.0');
    expect(agent.tier).toBe('core');
    expect(agent.extends).toBe('base-engineer');
    expect(agent.decisions_owned).toHaveLength(4);
    expect(agent.persona.voice).toContain('precise');
    expect(agent.inputs.required).toHaveLength(3);
    expect(agent.inputs.optional).toHaveLength(2);
    expect(agent.outputs).toHaveLength(5);
    expect(agent.outputs.find((o) => o.type === 'ADR')?.cardinality).toBe('many');
    expect(agent.outputs.find((o) => o.type === 'HandoffRecord')?.cardinality).toBeUndefined();
    expect(agent.kb_write).toEqual(['architecture/**', 'decisions/**']);
    expect(agent.kb_propose).toEqual(['data/**', 'constraints/**']);
    expect(agent.tools.read).toBe(true);
    expect(agent.tools.write).toBe(true);
    expect(agent.tools.network).toBe(false);
    expect(agent.tools.git_commit).toBe('docs-only');
    expect(agent.model).toEqual({ tier: 'max', thinking: 'high' });
    expect(agent.limits).toEqual({ max_turns: 40, wall_clock_ms: 900000, max_cost_usd: 6 });
    expect(agent.parallel_safety.exclusive).toBe(true);
    expect(agent.gates.may_approve).toEqual([]);
    expect(agent.gates.produces_evidence_for).toEqual(['G-Design', 'G-Integration']);
    expect(agent.frameworks).toHaveLength(3);
    expect(agent.skills).toHaveLength(5);
    expect(agent.mcp).toEqual([{ server: 'acme-confluence', tools: ['search', 'get_page'] }]);
    expect(agent.ceiling?.tools.network).toBe('none');
    expect(agent.ceiling?.tools.write).toBe(true);
    expect(agent.prompt.system).toBe('prompts/architect.system.md');
    expect(agent.prompt.briefs?.['select-architecture-style']).toBe(
      'prompts/architect.select-architecture-style.md',
    );
  });

  it('rejects a genuine YAML syntax error as a real issue, not a thrown error', () => {
    const result = loadAgentDefinition('id: a\n  bad indentation:', 'bad.agent.yaml');
    expect(result.success).toBe(false);
  });

  it('rejects an unknown top-level field rather than silently ignoring it (.strict())', () => {
    const source = ARCHITECT.replace('tier: core', 'tier: core\nbogus_field: 1');
    const result = loadAgentDefinition(source, 'x.agent.yaml');
    expect(result.success).toBe(false);
  });

  it('rejects an input ref naming neither artifact nor kb', () => {
    const source = ARCHITECT.replace('- artifact: DomainModel', '- notrealkey: DomainModel');
    const result = loadAgentDefinition(source, 'x.agent.yaml');
    expect(result.success).toBe(false);
  });

  it('accepts an entry with no extends, mcp, ceiling, frameworks, or skills -- all optional', () => {
    // Removes a whole top-level YAML block by key name: the key's own line plus every subsequent
    // indented line, up to (not including) the next non-indented (top-level) line or EOF -- robust to
    // exactly how each block is shaped, unlike a hand-tuned regex per field.
    function removeYamlBlock(text: string, key: string): string {
      const lines = text.split('\n');
      const startIndex = lines.findIndex((line) => line.startsWith(`${key}:`));
      if (startIndex === -1) throw new Error(`fixture has no top-level "${key}:" block to remove`);
      let endIndex = startIndex + 1;
      while (endIndex < lines.length && /^(\s|$)/.test(lines[endIndex]!)) endIndex += 1;
      lines.splice(startIndex, endIndex - startIndex);
      return lines.join('\n');
    }

    let source = ARCHITECT;
    for (const key of ['extends', 'mcp', 'ceiling', 'frameworks', 'skills']) {
      source = removeYamlBlock(source, key);
    }

    const result = loadAgentDefinition(source, 'x.agent.yaml');
    if (!result.success)
      throw new Error(`expected success, got issues: ${JSON.stringify(result.issues)}`);
    expect(result.agent.extends).toBeUndefined();
    expect(result.agent.ceiling).toBeUndefined();
    expect(result.agent.mcp).toBeUndefined();
    expect(result.agent.frameworks).toBeUndefined();
    expect(result.agent.skills).toBeUndefined();
  });

  it('rejects "architect" declaring a non-empty may_approve -- 05 §5.2\'s own roster rule', () => {
    const source = ARCHITECT.replace('may_approve: []', 'may_approve: [ G-Design ]');
    const result = loadAgentDefinition(source, 'architect.agent.yaml');
    expect(result.success).toBe(false);
    if (result.success) throw new Error('expected failure');
    expect(result.issues.some((i) => i.path === 'gates.may_approve')).toBe(true);
  });

  it('rejects "reviewer" declaring an implementation-shaped output', () => {
    const source = ARCHITECT.replace('id: architect', 'id: reviewer').replace(
      'type: ADR',
      'type: Code',
    );
    const result = loadAgentDefinition(source, 'reviewer.agent.yaml');
    expect(result.success).toBe(false);
    if (result.success) throw new Error('expected failure');
    expect(result.issues.some((i) => i.path === 'outputs')).toBe(true);
  });

  it('does not flag a non-review role declaring an implementation-shaped output', () => {
    const source = ARCHITECT.replace('type: ADR', 'type: Code');
    const result = loadAgentDefinition(source, 'architect.agent.yaml');
    expect(result.success).toBe(true);
  });

  it('does not flag "diagnostician" declaring a Code-typed output -- a failing test proving a bug is legitimately code-shaped (05 §5.2\'s own roster table: "RCA record, failing test, fix plan")', () => {
    const source = ARCHITECT.replace('id: architect', 'id: diagnostician').replace(
      'type: ADR',
      'type: Code',
    );
    const result = loadAgentDefinition(source, 'diagnostician.agent.yaml');
    expect(result.success).toBe(true);
  });

  it('does not flag "critic" declaring a Code-typed output -- 05 §5.2\'s own roster table lists its outputs as "Objection list with severity + test"', () => {
    const source = ARCHITECT.replace('id: architect', 'id: critic').replace(
      'type: ADR',
      'type: Code',
    );
    const result = loadAgentDefinition(source, 'critic.agent.yaml');
    expect(result.success).toBe(true);
  });

  it('does not flag "test-architect" declaring a Code-typed output', () => {
    const source = ARCHITECT.replace('id: architect', 'id: test-architect').replace(
      'type: ADR',
      'type: Code',
    );
    const result = loadAgentDefinition(source, 'test-architect.agent.yaml');
    expect(result.success).toBe(true);
  });
});

describe('readAgentDefinition', () => {
  it('reads a real file from disk through ProjectPaths, containment-checked', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'forge-agents-load-'));
    await writeFile(path.join(root, 'architect.agent.yaml'), ARCHITECT);
    const paths = new ProjectPaths(root);

    const result = await readAgentDefinition(paths, 'architect.agent.yaml');

    expect(result.success).toBe(true);
  });

  it('rejects a path escaping the project root, via ProjectPaths itself, not a raw fs error', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'forge-agents-load-'));
    const paths = new ProjectPaths(root);

    await expect(readAgentDefinition(paths, '../outside.agent.yaml')).rejects.toThrow();
  });
});
