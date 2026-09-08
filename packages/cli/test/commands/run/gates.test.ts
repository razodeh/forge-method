/**
 * `loadGateRegistry` — real `.forge/checks/*.gate.yaml` content parsed into `@forge/engine/gates`' own
 * `GateDefinition` shape.
 *
 * @see specs/10 §10.3
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { loadGateRegistry } from '../../../src/commands/run/gates.ts';
import { CHECKS_ROOT, FIXTURE_GATE_ID, cleanupAll, createTestProject } from './helpers.ts';

afterEach(cleanupAll);

describe('loadGateRegistry', () => {
  it('parses the real fixture gate file into a GateDefinition, defaulting an absent openQuestionsPolicy', async () => {
    const project = await createTestProject();
    const registry = await loadGateRegistry(project.paths, CHECKS_ROOT);
    expect(registry.get(FIXTURE_GATE_ID)).toEqual({
      id: FIXTURE_GATE_ID,
      checks: { deterministic: [], advisory: [] },
      openQuestionsPolicy: 'warn',
    });
  });

  it('reads real deterministic/advisory checks and an explicit openQuestionsPolicy', async () => {
    const project = await createTestProject();
    await writeFile(
      path.join(project.dir, CHECKS_ROOT, 'G-Full.gate.yaml'),
      `id: G-Full
name: Full fixture gate
phase: verify
checks:
  deterministic:
    - id: lint
      run: "echo '{\\"ok\\":true}'"
      parser: forge-json
      failOn: "!ok"
  advisory:
    - id: review
      agent: critic
      brief: "review the change"
openQuestionsPolicy: block
`,
    );
    const registry = await loadGateRegistry(project.paths, CHECKS_ROOT);
    const full = registry.get('G-Full');
    expect(full?.openQuestionsPolicy).toBe('block');
    expect(full?.checks.deterministic).toEqual([
      { id: 'lint', run: 'echo \'{"ok":true}\'', parser: 'forge-json', failOn: '!ok' },
    ]);
    expect(full?.checks.advisory).toEqual([
      { id: 'review', agent: 'critic', brief: 'review the change' },
    ]);
  });

  it('defaults every field a minimal gate file omits entirely: no checks key, no openQuestionsPolicy', async () => {
    const project = await createTestProject();
    await writeFile(path.join(project.dir, CHECKS_ROOT, 'G-Minimal.gate.yaml'), 'id: G-Minimal\n');
    const registry = await loadGateRegistry(project.paths, CHECKS_ROOT);
    expect(registry.get('G-Minimal')).toEqual({
      id: 'G-Minimal',
      checks: { deterministic: [], advisory: [] },
      openQuestionsPolicy: 'warn',
    });
  });

  it('ignores non-gate files in the checks directory', async () => {
    const project = await createTestProject();
    await writeFile(path.join(project.dir, CHECKS_ROOT, 'README.md'), '# not a gate\n');
    const registry = await loadGateRegistry(project.paths, CHECKS_ROOT);
    expect(registry.size).toBe(1);
  });

  it('returns an empty registry when the checks directory does not exist at all', async () => {
    const project = await createTestProject();
    const registry = await loadGateRegistry(project.paths, 'docs/forge/no-such-checks-dir');
    expect(registry.size).toBe(0);
  });

  it('descends only one directory of real gate files (no recursion needed by real projects)', async () => {
    const project = await createTestProject();
    await mkdir(path.join(project.dir, CHECKS_ROOT, 'subdir'), { recursive: true });
    await writeFile(
      path.join(project.dir, CHECKS_ROOT, 'subdir', 'G-Nested.gate.yaml'),
      'id: G-Nested\nchecks: { deterministic: [], advisory: [] }\n',
    );
    const registry = await loadGateRegistry(project.paths, CHECKS_ROOT);
    expect(registry.has('G-Nested')).toBe(false);
    expect(registry.has(FIXTURE_GATE_ID)).toBe(true);
  });
});
