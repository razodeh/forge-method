/**
 * `loadAgentRegistry` — `05` §5.3's own canonical path convention, read into a real registry.
 *
 * @see specs/05 §5.3
 * @see PLAN-M6.md A4
 */
import { ProjectPaths, type AbsolutePath } from '@forge/core';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

import { loadAgentRegistry } from '../../src/registry/load-agent-registry.ts';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const realModulesDir = new ProjectPaths(repoRoot).resolveWithin('modules');

describe('loadAgentRegistry against the real, shipped modules/fm-core/agents/ roster', () => {
  it('loads all 29 real agent definitions (28-role roster plus base-engineer)', async () => {
    const registry = await loadAgentRegistry(realModulesDir);
    expect(registry.all()).toHaveLength(29);
  });

  it('every shipped agent is reachable by its own id', async () => {
    const registry = await loadAgentRegistry(realModulesDir);
    expect(registry.get('architect')?.id).toBe('architect');
    expect(registry.get('base-engineer')?.id).toBe('base-engineer');
    expect(registry.get('nonexistent-role')).toBeUndefined();
  });
});

describe('loadAgentRegistry against a fresh fixture tree', () => {
  let tmpRoot: string | undefined;

  afterEach(() => {
    if (tmpRoot !== undefined) rmSync(tmpRoot, { recursive: true, force: true });
    tmpRoot = undefined;
  });

  function freshModulesDir(): {
    modulesDir: AbsolutePath;
    write: (moduleId: string, agentId: string, yaml: string) => void;
  } {
    const root = mkdtempSync(path.join(tmpdir(), 'forge-agents-registry-'));
    tmpRoot = root;
    const paths = new ProjectPaths(root);
    const modulesDir = paths.resolveWithin('modules');
    mkdirSync(modulesDir, { recursive: true });
    return {
      modulesDir,
      write: (moduleId, agentId, yaml) => {
        const agentsDir = path.join(modulesDir, moduleId, 'agents');
        mkdirSync(agentsDir, { recursive: true });
        writeFileSync(path.join(agentsDir, `${agentId}.agent.yaml`), yaml);
      },
    };
  }

  const MINIMAL_AGENT = (id: string): string => `
id: ${id}
name: ${id}
version: 1.0.0
tier: core
mandate: test
decisions_owned: [x.y]
persona: { voice: v, stance: s, disagreement_style: d }
inputs: { required: [] }
outputs: [{ type: X, schema: x.schema.json, path: x.md }]
kb_write: []
tools: { read: true, write: false, network: false, git_commit: 'none', deploy: false }
model: { tier: balanced, thinking: medium }
limits: { max_turns: 1, wall_clock_ms: 1, max_cost_usd: 1 }
parallel_safety: { file_ownership: [], exclusive: false }
gates: { produces_evidence_for: [], may_approve: [] }
prompt: { system: p.md }
`;

  it('reads agents from more than one module, combined into one registry', async () => {
    const { modulesDir, write } = freshModulesDir();
    write('fm-core', 'a', MINIMAL_AGENT('a'));
    write('fm-web', 'b', MINIMAL_AGENT('b'));
    const registry = await loadAgentRegistry(modulesDir);
    expect(
      registry
        .all()
        .map((agent) => agent.id)
        .sort(),
    ).toEqual(['a', 'b']);
  });

  it('skips a module directory with no agents/ subdirectory at all, rather than throwing', async () => {
    const { modulesDir, write } = freshModulesDir();
    write('fm-core', 'a', MINIMAL_AGENT('a'));
    mkdirSync(path.join(modulesDir, 'fm-empty'), { recursive: true });
    const registry = await loadAgentRegistry(modulesDir);
    expect(registry.all().map((agent) => agent.id)).toEqual(['a']);
  });

  it('throws on a malformed agent document -- a shipped-content authoring bug, not ordinary runtime input', async () => {
    const { modulesDir, write } = freshModulesDir();
    write('fm-core', 'broken', 'id: broken\n');
    await expect(loadAgentRegistry(modulesDir)).rejects.toThrow(/broken/);
  });
});
