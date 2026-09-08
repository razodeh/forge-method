/**
 * `content.ts` — reading `@forge/templates`' own real, already-shipped content and `@forge/agents`'
 * real, resolved roster.
 *
 * @see specs/03 §3.3
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  readArtifactTemplateFiles,
  readCheckFiles,
  readFrameworkFiles,
  readResolvedAgents,
  readSkillFiles,
  readWorkflowFiles,
} from '../../src/init/content.ts';

const fixtureModulesDir = fileURLToPath(new URL('./fixtures/modules/', import.meta.url));

describe('reading real @forge/templates content', () => {
  it('reads every real workflow file with real, non-empty content', async () => {
    const files = await readWorkflowFiles();
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      expect(file.relPath.endsWith('.workflow.yaml')).toBe(true);
      expect(file.content.length).toBeGreaterThan(0);
    }
  });

  it('reads every real framework file', async () => {
    const files = await readFrameworkFiles();
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) expect(file.relPath.endsWith('.framework.yaml')).toBe(true);
  });

  it('reads every real check (gate) file', async () => {
    const files = await readCheckFiles();
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) expect(file.relPath.endsWith('.gate.yaml')).toBe(true);
  });

  it('reads every real artifact template file', async () => {
    const files = await readArtifactTemplateFiles();
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) expect(file.relPath.endsWith('.md')).toBe(true);
  });

  it('reads every real skill file, recursively, preserving its own relative nested path', async () => {
    const files = await readSkillFiles();
    expect(files.length).toBeGreaterThan(0);
    const skillMdFiles = files.filter((file) => file.relPath.endsWith('/SKILL.md'));
    expect(skillMdFiles.length).toBeGreaterThan(0);
    // Every skill lives one directory deep: <skill-id>/SKILL.md, not flattened and not deeper.
    for (const file of skillMdFiles) {
      expect(file.relPath.split('/')).toHaveLength(2);
    }
  });
});

describe('reading a real, resolved agent roster', () => {
  it('resolves the fixture module’s one standalone agent (no extends)', async () => {
    const agents = await readResolvedAgents(fixtureModulesDir);
    expect(agents).toHaveLength(1);
    expect(agents[0]).toMatchObject({ id: 'tester', displayName: 'Fixture Tester' });
    expect(agents[0]?.yaml).toContain('id: tester');
  });

  it('resolves the real, complete 28-role roster (plus base-engineer) against modules/ at the repo root', async () => {
    const repoRoot = path.resolve(fileURLToPath(new URL('../../../../', import.meta.url)));
    const agents = await readResolvedAgents(path.join(repoRoot, 'modules'));
    // 28 roster roles + base-engineer, the same total A3's own whole-roster test asserts.
    expect(agents.length).toBeGreaterThanOrEqual(29);
    // `frontend` is the one real roster agent that omits its own `skills:` and genuinely inherits
    // base-engineer's own list via `extends` (SPEC-QUESTIONS.md Q99) — a real assertion that
    // `resolveExtends` actually ran, not just that architect's own fully-redeclared file was echoed.
    const frontend = agents.find((agent) => agent.id === 'frontend');
    expect(frontend).toBeDefined();
    expect(frontend?.yaml).toContain('tdd-loop-discipline');
  });
});
