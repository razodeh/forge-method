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

const PASSING_CHECK = `  deterministic:
    - id: ok
      run: "echo '{\\"ok\\":true}'"
      failOn: "!ok"
`;

afterEach(cleanupAll);

describe('loadGateRegistry', () => {
  it('parses the real fixture gate file into a GateDefinition, defaulting an absent openQuestionsPolicy', async () => {
    const project = await createTestProject();
    const registry = await loadGateRegistry(project.paths, CHECKS_ROOT);
    expect(registry.get(FIXTURE_GATE_ID)).toEqual({
      id: FIXTURE_GATE_ID,
      checks: {
        deterministic: [{ id: 'always-ok', run: 'echo \'{"ok":true}\'', failOn: '!ok' }],
        advisory: [],
      },
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

  it('reads the approval block a gate carries (10 section 10.3), for `forge gate approve` to enforce', async () => {
    const project = await createTestProject();
    await writeFile(
      path.join(project.dir, CHECKS_ROOT, 'G-Appr.gate.yaml'),
      `id: G-Appr\nautonomyOverride: alwaysHuman\nchecks:\n${PASSING_CHECK}approval:\n  required: true\n  roles: [human]\n  quorum: 1\n`,
    );
    const registry = await loadGateRegistry(project.paths, CHECKS_ROOT);
    expect(registry.get('G-Appr')).toMatchObject({
      autonomyOverride: 'alwaysHuman',
      approval: { required: true, roles: ['human'], quorum: 1 },
    });
  });

  // `PLAN-M13.md` P41 (the P35 finding). These four used to load as an EMPTY gate, which passes vacuously
  // (`evaluateGate` is `checks.every(...)`): a gate that cannot fail, written by a typo, with no message.
  describe('refuses a gate document that would pass vacuously (GATE-506), naming the file and the key', () => {
    it.each([
      [
        'a misspelled "checks" key',
        'id: G-Typo\nchekcs:\n  deterministic: []\n',
        'chekcs',
        'checks',
      ],
      [
        'a misspelled "deterministic" key',
        `id: G-Typo\nchecks:\n  determinstic:\n    - id: a\n      run: x\n      failOn: "!ok"\n`,
        'checks.determinstic',
        'deterministic',
      ],
      [
        'a singular "check" key',
        `id: G-Typo\ncheck:\n  deterministic:\n    - id: a\n      run: x\n      failOn: "!ok"\n`,
        'check',
        'checks',
      ],
      [
        'a misspelled "failOn" inside a check',
        `id: G-Typo\nchecks:\n  deterministic:\n    - id: a\n      run: x\n      failon: "!ok"\n`,
        'checks.deterministic[0].failon',
        'failOn',
      ],
    ])('%s', async (_label, content, key, suggestion) => {
      const project = await createTestProject();
      await writeFile(path.join(project.dir, CHECKS_ROOT, 'G-Typo.gate.yaml'), content);
      const error = await loadGateRegistry(project.paths, CHECKS_ROOT).catch((e: unknown) => e);
      expect(error).toMatchObject({ code: 'GATE-506' });
      const message = (error as Error).message;
      expect(message).toContain('G-Typo.gate.yaml');
      expect(message).toContain(key);
      expect(message).toContain(`did you mean "${suggestion}"`);
    });

    it.each([
      ['no checks key at all', 'id: G-Minimal\n'],
      ['an empty checks mapping', 'id: G-Empty\nchecks: {}\n'],
      [
        'an empty deterministic list',
        'id: G-Empty\nchecks:\n  deterministic: []\n  advisory: []\n',
      ],
      [
        'advisory checks only (advisory checks never fail a gate, 10 section 10.3 rule 2)',
        'id: G-Adv\nchecks:\n  deterministic: []\n  advisory:\n    - id: r\n      agent: critic\n      brief: briefs/x.md\n',
      ],
    ])('a gate with no deterministic check: %s', async (_label, content) => {
      const project = await createTestProject();
      await writeFile(path.join(project.dir, CHECKS_ROOT, 'G-Zero.gate.yaml'), content);
      const error = await loadGateRegistry(project.paths, CHECKS_ROOT).catch((e: unknown) => e);
      expect(error).toMatchObject({ code: 'GATE-506' });
      expect((error as Error).message).toContain('G-Zero.gate.yaml');
      expect((error as Error).message).toContain('deterministic check');
    });

    it.each([
      [
        'a check with no failOn',
        `id: G-X\nchecks:\n  deterministic:\n    - id: a\n      run: x\n`,
        'checks.deterministic[0].failOn',
      ],
      [
        'a non-list deterministic',
        `id: G-X\nchecks:\n  deterministic: nope\n`,
        'checks.deterministic',
      ],
      [
        'an unknown openQuestionsPolicy',
        `id: G-X\nopenQuestionsPolicy: maybe\nchecks:\n${PASSING_CHECK}`,
        'openQuestionsPolicy',
      ],
      [
        'a quorum of zero',
        `id: G-X\nchecks:\n${PASSING_CHECK}approval:\n  quorum: 0\n`,
        'approval.quorum',
      ],
      [
        'an unknown approval key',
        `id: G-X\nchecks:\n${PASSING_CHECK}approval:\n  role: [human]\n`,
        'approval.role',
      ],
      [
        'duplicate check ids',
        `id: G-X\nchecks:\n  deterministic:\n    - id: a\n      run: x\n      failOn: "!ok"\n    - id: a\n      run: y\n      failOn: "!ok"\n`,
        'checks.deterministic[1].id',
      ],
    ])('%s', async (_label, content, key) => {
      const project = await createTestProject();
      await writeFile(path.join(project.dir, CHECKS_ROOT, 'G-X.gate.yaml'), content);
      const error = await loadGateRegistry(project.paths, CHECKS_ROOT).catch((e: unknown) => e);
      expect(error).toMatchObject({ code: 'GATE-506' });
      expect((error as Error).message).toContain(key);
    });

    it('an unparseable gate file, and two files claiming one gate id', async () => {
      const project = await createTestProject();
      await writeFile(
        path.join(project.dir, CHECKS_ROOT, 'G-Bad.gate.yaml'),
        'id: [unterminated\n',
      );
      await expect(loadGateRegistry(project.paths, CHECKS_ROOT)).rejects.toMatchObject({
        code: 'GATE-506',
      });
      await writeFile(
        path.join(project.dir, CHECKS_ROOT, 'G-Bad.gate.yaml'),
        `id: G-Dup\nchecks:\n${PASSING_CHECK}`,
      );
      await writeFile(
        path.join(project.dir, CHECKS_ROOT, 'G-Dup2.gate.yaml'),
        `id: G-Dup\nchecks:\n${PASSING_CHECK}`,
      );
      const error = await loadGateRegistry(project.paths, CHECKS_ROOT).catch((e: unknown) => e);
      expect(error).toMatchObject({ code: 'GATE-506' });
      expect((error as Error).message).toContain('G-Dup');
    });

    it('does not stop at a valid gate next to an invalid one: the invalid one is the error', async () => {
      const project = await createTestProject();
      await writeFile(
        path.join(project.dir, CHECKS_ROOT, 'G-Typo.gate.yaml'),
        'id: G-Typo\nchekcs: {}\n',
      );
      await expect(loadGateRegistry(project.paths, CHECKS_ROOT)).rejects.toMatchObject({
        code: 'GATE-506',
      });
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
