/**
 * `loadGateRegistry` — real `.forge/checks/*.gate.yaml` content parsed into `@forge/engine/gates`' own
 * `GateDefinition` shape.
 *
 * @see specs/10 §10.3
 */
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';
import * as YAML from 'yaml';

import { loadGateRegistry } from '../../../src/commands/run/gates.ts';
import { CHECKS_ROOT, FIXTURE_GATE_ID, cleanupAll, createTestProject } from './helpers.ts';

/** The real, shipped `modules/` directory this checkout ships — used by the real-module-install case
 * below (`PLAN-M14.md` P20's own disclosed consequence, `SPEC-QUESTIONS.md`). */
const REAL_MODULES_DIR = fileURLToPath(new URL('../../../../../modules/', import.meta.url));

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

// `PLAN-M14.md` P20: `*.check.yaml` files attach to gates through `appliesTo` — `.forge/checks/`,
// `.forge/overrides/checks/` and `.forge/modules/<id>/checks/` for every manifest-listed module id,
// independent of whatever `checksRoot` the caller passes for the gate files themselves (this fixture's
// own `CHECKS_ROOT`, `docs/forge/checks`, deliberately is not under `.forge/`, proving the two are
// unrelated).
describe('*.check.yaml attachment through appliesTo', () => {
  const ONE_CHECK = (id: string, gates: string, extra = ''): string =>
    `id: ${id}\nrun: "echo '{\\"violations\\":0}'"\nfailOn: "violations > 0"\nremedy: "fix it"\nappliesTo: { gates: [${gates}] }\n${extra}`;

  it('an override check attaches, showing its own .forge/-stripped path as source', async () => {
    const project = await createTestProject();
    await mkdir(path.join(project.dir, '.forge/overrides/checks'), { recursive: true });
    await writeFile(
      path.join(project.dir, '.forge/overrides/checks/acme.check.yaml'),
      `${ONE_CHECK('acme:licence-policy', FIXTURE_GATE_ID)}severity: error\n`,
    );
    const registry = await loadGateRegistry(project.paths, CHECKS_ROOT);
    const attached = registry
      .get(FIXTURE_GATE_ID)
      ?.checks.deterministic.find((check) => check.id === 'acme:licence-policy');
    expect(attached).toMatchObject({
      id: 'acme:licence-policy',
      source: 'overrides/checks/acme.check.yaml',
    });
  });

  it('appliesTo naming an unknown gate is GATE-506 naming the file', async () => {
    const project = await createTestProject();
    await mkdir(path.join(project.dir, '.forge/overrides/checks'), { recursive: true });
    await writeFile(
      path.join(project.dir, '.forge/overrides/checks/bad.check.yaml'),
      `${ONE_CHECK('acme:x', 'G-No-Such-Gate')}severity: error\n`,
    );
    const error = await loadGateRegistry(project.paths, CHECKS_ROOT).catch((e: unknown) => e);
    expect(error).toMatchObject({ code: 'GATE-506' });
    expect((error as Error).message).toContain('bad.check.yaml');
    expect((error as Error).message).toContain('G-No-Such-Gate');
  });

  it("a duplicate id (colliding with the gate's own check) is GATE-506", async () => {
    const project = await createTestProject();
    await mkdir(path.join(project.dir, '.forge/overrides/checks'), { recursive: true });
    // `FIXTURE_GATE_YAML` (`helpers.ts`) declares the gate's own deterministic check as `always-ok`.
    await writeFile(
      path.join(project.dir, '.forge/overrides/checks/dup.check.yaml'),
      `${ONE_CHECK('always-ok', FIXTURE_GATE_ID)}severity: error\n`,
    );
    const error = await loadGateRegistry(project.paths, CHECKS_ROOT).catch((e: unknown) => e);
    expect(error).toMatchObject({ code: 'GATE-506' });
    expect((error as Error).message).toContain('dup.check.yaml');
  });

  it('two check files attaching the same id to the same gate is GATE-506 on the second', async () => {
    const project = await createTestProject();
    await mkdir(path.join(project.dir, '.forge/overrides/checks'), { recursive: true });
    await writeFile(
      path.join(project.dir, '.forge/overrides/checks/a.check.yaml'),
      `${ONE_CHECK('acme:x', FIXTURE_GATE_ID)}severity: error\n`,
    );
    await writeFile(
      path.join(project.dir, '.forge/overrides/checks/b.check.yaml'),
      `${ONE_CHECK('acme:x', FIXTURE_GATE_ID)}severity: warn\n`,
    );
    const error = await loadGateRegistry(project.paths, CHECKS_ROOT).catch((e: unknown) => e);
    expect(error).toMatchObject({ code: 'GATE-506' });
  });

  it("a manifest-listed module's own check attaches", async () => {
    const project = await createTestProject();
    await writeFile(
      path.join(project.dir, '.forge/manifest.yaml'),
      'version: 1\nmodules:\n  - id: acme-mod\n    version: "1.0.0"\n    checksum: "x"\n',
    );
    await mkdir(path.join(project.dir, '.forge/modules/acme-mod/checks'), { recursive: true });
    await writeFile(
      path.join(project.dir, '.forge/modules/acme-mod/checks/x.check.yaml'),
      `${ONE_CHECK('acme:module-check', FIXTURE_GATE_ID)}severity: error\n`,
    );
    const registry = await loadGateRegistry(project.paths, CHECKS_ROOT);
    const attached = registry
      .get(FIXTURE_GATE_ID)
      ?.checks.deterministic.find((check) => check.id === 'acme:module-check');
    expect(attached).toMatchObject({ source: 'modules/acme-mod/checks/x.check.yaml' });
  });

  it('a module listed in the manifest but with no real checks/ of its own attaches nothing (tolerant)', async () => {
    const project = await createTestProject();
    await writeFile(
      path.join(project.dir, '.forge/manifest.yaml'),
      'version: 1\nmodules:\n  - id: no-checks-mod\n    version: "1.0.0"\n    checksum: "x"\n',
    );
    const registry = await loadGateRegistry(project.paths, CHECKS_ROOT);
    expect(registry.get(FIXTURE_GATE_ID)?.checks.deterministic).toHaveLength(1);
  });

  it('a project with no manifest at all attaches nothing from .forge/modules/ (tolerant)', async () => {
    const project = await createTestProject();
    const registry = await loadGateRegistry(project.paths, CHECKS_ROOT);
    expect(registry.get(FIXTURE_GATE_ID)?.checks.deterministic).toHaveLength(1);
  });

  it('a warn check attaches under checks.warnings, never checks.deterministic, and never GATE-506s on a real gate', async () => {
    const project = await createTestProject();
    await mkdir(path.join(project.dir, '.forge/overrides/checks'), { recursive: true });
    await writeFile(
      path.join(project.dir, '.forge/overrides/checks/w.check.yaml'),
      `${ONE_CHECK('acme:warn-only', FIXTURE_GATE_ID)}severity: warn\n`,
    );
    const registry = await loadGateRegistry(project.paths, CHECKS_ROOT);
    const gate = registry.get(FIXTURE_GATE_ID);
    expect(gate?.checks.deterministic.some((check) => check.id === 'acme:warn-only')).toBe(false);
    expect(gate?.checks.warnings?.map((check) => check.id)).toEqual(['acme:warn-only']);
    expect(gate?.checks.warnings?.[0]).toMatchObject({ source: 'overrides/checks/w.check.yaml' });
  });

  it('a malformed check file (missing remedy) is GATE-506 naming the file', async () => {
    const project = await createTestProject();
    await mkdir(path.join(project.dir, '.forge/overrides/checks'), { recursive: true });
    await writeFile(
      path.join(project.dir, '.forge/overrides/checks/broken.check.yaml'),
      'id: acme:x\nrun: "echo hi"\nfailOn: "a"\nappliesTo: { gates: [G-Always] }\nseverity: error\n',
    );
    const error = await loadGateRegistry(project.paths, CHECKS_ROOT).catch((e: unknown) => e);
    expect(error).toMatchObject({ code: 'GATE-506' });
    expect((error as Error).message).toContain('broken.check.yaml');
  });

  it('a project with no overrides/module checks at all attaches nothing (fully tolerant)', async () => {
    const project = await createTestProject();
    const registry = await loadGateRegistry(project.paths, CHECKS_ROOT);
    expect(registry.get(FIXTURE_GATE_ID)?.checks.deterministic).toHaveLength(1);
    expect(registry.get(FIXTURE_GATE_ID)?.checks.warnings).toBeUndefined();
  });

  it('a genuinely missing checksRoot still runs the override-check scan (checksRoot and the check roots are independent)', async () => {
    const project = await createTestProject();
    await mkdir(path.join(project.dir, '.forge/overrides/checks'), { recursive: true });
    await writeFile(
      path.join(project.dir, '.forge/overrides/checks/acme.check.yaml'),
      `${ONE_CHECK('acme:x', FIXTURE_GATE_ID)}severity: error\n`,
    );
    // `checksRoot` genuinely does not exist under this fresh project (a made-up path, never
    // `docs/forge/checks`) -- with no real gate registered at all, `acme:x`'s own `appliesTo` names an
    // unknown gate, so it is refused as GATE-506. Before this piece's own ordering fix, a missing
    // `checksRoot` returned an empty registry immediately, WITHOUT ever looking at
    // `.forge/overrides/checks/` at all -- this proves the check-root scan genuinely still runs.
    const error = await loadGateRegistry(project.paths, 'no/such/checks/root').catch(
      (e: unknown) => e,
    );
    expect(error).toMatchObject({ code: 'GATE-506' });
    expect((error as Error).message).toContain('acme.check.yaml');
    expect((error as Error).message).toContain(FIXTURE_GATE_ID);
  });

  // `SPEC-QUESTIONS.md` Q229 D3's stance, extended by `PLAN-M14.md` P20 to check files (its own
  // Discloses note): before `PLAN-M14.md` P22, a real, shipped module's own check files carried no
  // `appliesTo`/`severity` at all, so installing one (`forge module add`, which really does copy a
  // module's own `checks/` into `.forge/modules/<id>/checks/` verbatim, `module.ts:453-470`) made
  // `loadGateRegistry` refuse every gate, not merely leave the new check unattached. `PLAN-M14.md` P22
  // closes that: this is the real, positive proof the real, shipped `fm-mobile` check now attaches for
  // real once the project it installs into has the `G-Verify` gate it names.
  it('installing a real shipped module (fm-mobile) attaches its own check for real, now that PLAN-M14.md P22 gives it an appliesTo/severity', async () => {
    const project = await createTestProject();
    // The real gate `device-matrix.check.yaml`'s own shipped `appliesTo.gates` names (`10` §10.3's own
    // catalogue; this fixture project's own `CHECKS_ROOT` otherwise carries only `FIXTURE_GATE_ID`).
    await writeFile(
      path.join(project.dir, CHECKS_ROOT, 'G-Verify.gate.yaml'),
      `id: G-Verify\nchecks:\n${PASSING_CHECK}`,
    );
    await writeFile(
      path.join(project.dir, '.forge/manifest.yaml'),
      'version: 1\nmodules:\n  - id: fm-mobile\n    version: "1.0.0"\n    checksum: "x"\n',
    );
    await cp(
      path.join(REAL_MODULES_DIR, 'fm-mobile/checks'),
      path.join(project.dir, '.forge/modules/fm-mobile/checks'),
      { recursive: true },
    );
    const registry = await loadGateRegistry(project.paths, CHECKS_ROOT);
    const attached = registry
      .get('G-Verify')
      ?.checks.deterministic.find((check) => check.id === 'device-matrix:coverage');
    expect(attached).toMatchObject({
      id: 'device-matrix:coverage',
      source: 'modules/fm-mobile/checks/device-matrix.check.yaml',
    });
  });

  // `PLAN-M14.md` P22's own mutation evidence: `appliesTo` removed from a real shipped check file is the
  // identical "names unknown gate" / structurally-invalid failure any hand-authored check file gets --
  // this pins that the real, shipped file is not special-cased, by removing its `appliesTo` for real (in
  // a private copy) and confirming `loadGateRegistry` refuses it exactly as `GATE-506` names.
  it('a real shipped check file with appliesTo stripped is GATE-506, not silently unattached', async () => {
    const project = await createTestProject();
    await writeFile(
      path.join(project.dir, CHECKS_ROOT, 'G-Verify.gate.yaml'),
      `id: G-Verify\nchecks:\n${PASSING_CHECK}`,
    );
    await writeFile(
      path.join(project.dir, '.forge/manifest.yaml'),
      'version: 1\nmodules:\n  - id: fm-mobile\n    version: "1.0.0"\n    checksum: "x"\n',
    );
    await mkdir(path.join(project.dir, '.forge/modules/fm-mobile/checks'), { recursive: true });
    const real = YAML.parse(
      await readFile(
        path.join(REAL_MODULES_DIR, 'fm-mobile/checks/device-matrix.check.yaml'),
        'utf8',
      ),
    ) as Record<string, unknown>;
    // Parsed and re-serialized (never a text-based strip): the real file's own doc comments legitimately
    // mention "appliesTo" in prose, so a text match for its absence would be meaningless; the real check
    // here is that the loader refuses a check document with no real `appliesTo` field, whatever the file's
    // own surrounding YAML comments say about it (comments are dropped by `YAML.parse`/`YAML.stringify`
    // regardless, so this mutation also proves the loader reads structure, not text).
    const { appliesTo: _appliesTo, ...withoutAppliesTo } = real;
    expect(withoutAppliesTo['id']).toBe('device-matrix:coverage');
    await writeFile(
      path.join(project.dir, '.forge/modules/fm-mobile/checks/device-matrix.check.yaml'),
      YAML.stringify(withoutAppliesTo),
    );
    const error = await loadGateRegistry(project.paths, CHECKS_ROOT).catch((e: unknown) => e);
    expect(error).toMatchObject({ code: 'GATE-506' });
    expect((error as Error).message).toContain('modules/fm-mobile/checks/device-matrix.check.yaml');
    expect((error as Error).message).toContain('appliesTo');
  });
});
