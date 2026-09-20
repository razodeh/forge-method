/**
 * `runModuleConformance` — `19` §19.1's own `tests/` module-layout directory ("module conformance
 * tests"), with no runner anywhere in this repo before this piece. `PLAN-M11.md` P6's own Checks:
 * the four real, already-shipped modules (`fm-web`/`fm-service`/`fm-data`/`fm-mobile`, M10 P3-P6) all
 * pass their own conformance; a deliberately-broken fixture module (a `provides` entry naming a file
 * that does not exist) fails conformance with a named, actionable error.
 *
 * @see specs/19 §19.1
 * @see specs/19 §19.3
 * @see PLAN-M11.md P6
 */
import { isForgeError, ProjectPaths, type AbsolutePath } from '@forge/core';
import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import { runModuleConformance } from '../../src/install/conformance.ts';
import { DEFAULT_MAX_DECOMPRESSED_BYTES } from '../../src/install/tar-extract.ts';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const modulesDir = new ProjectPaths(repoRoot).resolveWithin('modules');

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function freshModuleDir(): Promise<AbsolutePath> {
  const dir = await mkdtemp(path.join(tmpdir(), 'forge-extensions-conformance-'));
  dirs.push(dir);
  return dir as AbsolutePath;
}

// `*.test.ts` files are exempted from the "no bare tmpdir" R10 rule (see `packages/cli/test/commands/
// module.test.ts`'s own identical note) — `runModuleConformance`'s own `workDir` option is production
// code's real, caller-injected substitute for that, so this is the one legitimate place a test needs
// a real `os.tmpdir()`-rooted directory to hand it, one per test file rather than one per call.
const sharedWorkDir = await mkdtemp(path.join(tmpdir(), 'forge-extensions-conformance-work-'));
dirs.push(sharedWorkDir);

async function runConformance(dir: AbsolutePath) {
  return runModuleConformance(dir, { workDir: sharedWorkDir });
}

async function writeYaml(dir: string, relPath: string, body: string): Promise<void> {
  const full = path.join(dir, relPath);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, body, 'utf8');
}

interface ModuleYamlOverrides {
  readonly id?: string;
  readonly provides?: Record<string, readonly string[]>;
}

async function writeModuleYaml(dir: string, overrides: ModuleYamlOverrides = {}): Promise<void> {
  const provides = overrides.provides ?? {};
  const providesYaml = Object.entries(provides)
    .map(([kind, ids]) => `  ${kind}: [${ids.map((id) => `'${id}'`).join(', ')}]`)
    .join('\n');
  await writeYaml(
    dir,
    'module.yaml',
    [
      `id: ${overrides.id ?? 'fixture-mod'}`,
      'name: Fixture Module',
      'version: 1.0.0',
      "forgeVersion: '>=1.0 <2'",
      'requires: []',
      'conflicts: []',
      'levels: [L1]',
      'ceilings: {}',
      'provides:',
      providesYaml.length > 0 ? providesYaml : '  agents: []',
      '',
    ].join('\n'),
  );
}

describe('runModuleConformance — the four real, shipped modules (PLAN-M11.md P6 Checks)', () => {
  it.each(['fm-web', 'fm-service', 'fm-data', 'fm-mobile'])(
    '%s passes its own real conformance (provides re-validated, no tests/ directory to run)',
    async (moduleId) => {
      const modulePath = path.join(modulesDir, moduleId) as AbsolutePath;
      const report = await runConformance(modulePath);
      expect(report.providesChecked).toBeGreaterThan(0);
      expect(report.testFilesRun).toBe(0);
    },
  );
});

describe('runModuleConformance — provides re-validation', () => {
  it('passes a real module whose every provides kind is backed by real, correctly-declared content', async () => {
    const dir = await freshModuleDir();
    await writeModuleYaml(dir, {
      provides: {
        agents: ['foo'],
        workflows: ['bar'],
        frameworks: ['baz'],
        gates: ['qux'],
        // A real id containing a colon whose own filename does NOT mechanically derive from it (the
        // exact shape `modules/fm-service/checks/contract-verify.check.yaml`'s own real id
        // `contract:verify` already has) — proves this is a real id-based lookup, not a filename
        // pattern guess.
        checks: ['some:check'],
        skills: ['skill-one'],
        artifactTypes: ['Thing'],
        catalog: ['entry-id'],
        techniques: ['tech'],
      },
    });
    await writeYaml(dir, 'agents/foo.agent.yaml', 'id: foo\n');
    await writeYaml(dir, 'workflows/bar.workflow.yaml', 'id: bar\n');
    await writeYaml(dir, 'frameworks/baz.framework.yaml', 'id: baz\n');
    await writeYaml(dir, 'gates/qux.gate.yaml', 'id: qux\n');
    await writeYaml(dir, 'checks/some-check.check.yaml', 'id: some:check\n');
    await writeYaml(dir, 'skills/skill-one/SKILL.md', '---\nid: skill-one\n---\nBody.\n');
    await writeYaml(
      dir,
      'schemas/thing.schema.json',
      JSON.stringify({ title: 'Thing', type: 'object' }),
    );
    await writeYaml(dir, 'catalog/group/entry.entry.yaml', 'id: entry-id\n');
    await writeYaml(dir, 'techniques/tech.technique.yaml', 'id: tech\n');

    const report = await runConformance(dir);
    expect(report.providesChecked).toBe(9);
    expect(report.testFilesRun).toBe(0);
  });

  it("passes a module whose provides entries are backed only by @forge/templates' own real core registries, with no module-local file at all", async () => {
    // Independent of any real shipped module's own incidental current shape (the four-real-modules
    // suite above happens to exercise this fallback too, via `fm-data`'s real `analytical-pipeline-
    // design` framework — but that coverage would silently vanish if that module ever stopped relying
    // on it). These five ids are real, stable `@forge/templates` entries
    // (`packages/templates/src/index.ts`'s own `FRAMEWORK_INDEX`/`GATE_INDEX`/`WORKFLOW_INDEX`/
    // `SKILL_INDEX`/`TEMPLATE_INDEX`), asserted against the documented contract directly rather than
    // riding on another module's own current, incidental content.
    const dir = await freshModuleDir();
    await writeModuleYaml(dir, {
      provides: {
        frameworks: ['repo-strategy'],
        gates: ['G-Problem'],
        workflows: ['intake'],
        skills: ['writing-an-adr'],
        artifactTypes: ['Vision'],
      },
    });
    // No agents/workflows/frameworks/gates/skills/schemas directories written at all — every one of
    // these five ids must resolve purely through the core-registry fallback.

    const report = await runConformance(dir);
    expect(report.providesChecked).toBe(5);
  });

  it('passes a module with an entirely empty provides block (nothing to check)', async () => {
    const dir = await freshModuleDir();
    await writeModuleYaml(dir);
    const report = await runConformance(dir);
    expect(report.providesChecked).toBe(0);
  });

  it("refuses (CFG-050) a provides.agents entry naming a file that does not exist — PLAN-M11.md P6's own literal fixture", async () => {
    const dir = await freshModuleDir();
    await writeModuleYaml(dir, { provides: { agents: ['ghost'] } });
    // No agents/ghost.agent.yaml written at all.

    const error = await runConformance(dir).catch((cause: unknown) => cause);
    expect(isForgeError(error)).toBe(true);
    if (isForgeError(error)) {
      expect(error.code).toBe('CFG-050');
      expect(error.message).toMatch(/agents/);
      expect(error.message).toMatch(/ghost/);
    }
  });

  it('refuses (CFG-050) a checks entry whose only same-directory file declares a different id (proves id-based, not filename-based, lookup)', async () => {
    const dir = await freshModuleDir();
    await writeModuleYaml(dir, { provides: { checks: ['wanted:id'] } });
    await writeYaml(dir, 'checks/wanted-id.check.yaml', 'id: different:id\n');

    await expect(runConformance(dir)).rejects.toMatchObject({ code: 'CFG-050' });
  });

  it('refuses (CFG-050) a skills entry with no real skills/<id>/SKILL.md directory', async () => {
    const dir = await freshModuleDir();
    await writeModuleYaml(dir, { provides: { skills: ['missing-skill'] } });

    await expect(runConformance(dir)).rejects.toMatchObject({ code: 'CFG-050' });
  });

  it('refuses (CFG-050) a skills entry whose real SKILL.md declares a different id than its own directory name claims', async () => {
    const dir = await freshModuleDir();
    await writeModuleYaml(dir, { provides: { skills: ['foo'] } });
    // The directory is named "foo" (what `provides.skills` claims), but the file's own front matter
    // declares a different id — a real id mismatch, not merely a missing file, and the exact gap a
    // path-only existence check (built from `id` itself, so it can never mismatch by construction)
    // would silently miss.
    await writeYaml(dir, 'skills/foo/SKILL.md', '---\nid: some-other-skill\n---\nBody.\n');

    await expect(runConformance(dir)).rejects.toMatchObject({ code: 'CFG-050' });
  });

  it('refuses (CFG-050) an artifactTypes entry with no schemas/*.schema.json declaring that title', async () => {
    const dir = await freshModuleDir();
    await writeModuleYaml(dir, { provides: { artifactTypes: ['Ghost'] } });
    await writeYaml(dir, 'schemas/real.schema.json', JSON.stringify({ title: 'Real' }));

    await expect(runConformance(dir)).rejects.toMatchObject({ code: 'CFG-050' });
  });

  it('reports every offending kind/id in one CFG-050, not merely the first', async () => {
    const dir = await freshModuleDir();
    await writeModuleYaml(dir, { provides: { agents: ['ghost-a'], workflows: ['ghost-b'] } });

    const error = await runConformance(dir).catch((cause: unknown) => cause);
    expect(isForgeError(error)).toBe(true);
    if (isForgeError(error)) {
      expect(error.message).toMatch(/ghost-a/);
      expect(error.message).toMatch(/ghost-b/);
    }
  });
});

describe('runModuleConformance — tests/*.test.ts execution', () => {
  it('discovers and runs a real, passing conformance test against a real FakePlatformAdapter', async () => {
    const dir = await freshModuleDir();
    await writeModuleYaml(dir);
    await writeYaml(
      dir,
      'tests/pass.test.ts',
      [
        "import { describe, it, expect } from 'vitest';",
        "import { FakePlatformAdapter } from '@forge/testkit';",
        '',
        "describe('fixture conformance', () => {",
        "  it('constructs a real fake adapter', async () => {",
        '    const adapter = new FakePlatformAdapter();',
        '    const capabilities = await adapter.capabilities();',
        '    expect(capabilities.mcp).toBe(true);',
        '  });',
        '});',
        '',
      ].join('\n'),
    );

    const report = await runConformance(dir);
    expect(report.testFilesRun).toBe(1);
  }, 30_000);

  it('refuses (CFG-051) with a named, actionable detail when a conformance test fails', async () => {
    const dir = await freshModuleDir();
    await writeModuleYaml(dir);
    await writeYaml(
      dir,
      'tests/fail.test.ts',
      [
        "import { describe, it, expect } from 'vitest';",
        '',
        "describe('fixture conformance', () => {",
        "  it('deliberately fails', () => {",
        '    expect(1).toBe(2);',
        '  });',
        '});',
        '',
      ].join('\n'),
    );

    const error = await runConformance(dir).catch((cause: unknown) => cause);
    expect(isForgeError(error)).toBe(true);
    if (isForgeError(error)) {
      expect(error.code).toBe('CFG-051');
      expect(error.message).toMatch(/deliberately fails/);
    }
  }, 30_000);

  const HAND_BUILT_REQUEST_TEST = (adapterArgs: string): string =>
    [
      "import { describe, it, expect } from 'vitest';",
      "import { FAKE_MODEL_ID, FakePlatformAdapter } from '@forge/testkit';",
      '',
      "describe('module drives the fake adapter with a hand-built request', () => {",
      "  it('starts a session', async () => {",
      `    const adapter = new FakePlatformAdapter(${adapterArgs});`,
      '    const handle = await adapter.startSession({',
      "      runId: 'r', stepId: 's', cwd: '',",
      "      systemPrompt: { mode: 'append', text: '' }, prompt: 'briefs/x.md',",
      "      model: FAKE_MODEL_ID, tools: { read: true, write: false, exec: false, network: 'none' },",
      "      permissionMode: 'auto', limits: {}, env: {}, abortSignal: new AbortController().signal,",
      '    });',
      '    expect((await handle.result()).ok).toBe(true);',
      '  });',
      '});',
      '',
    ].join('\n');

  it('a module test that hand-builds an empty/path prompt against the default (strict) fake fails with the strict-mode refusal named (PLAN-M13 P6)', async () => {
    const dir = await freshModuleDir();
    await writeModuleYaml(dir);
    await writeYaml(dir, 'tests/hand-built.test.ts', HAND_BUILT_REQUEST_TEST(''));

    const error = await runConformance(dir).catch((cause: unknown) => cause);
    expect(isForgeError(error)).toBe(true);
    if (isForgeError(error)) {
      expect(error.code).toBe('CFG-051');
      expect(error.message).toMatch(/strict mode/);
      expect(error.message).toMatch(/strict: false/);
    }
  }, 30_000);

  it('the same module test passes once it opts out with { strict: false }', async () => {
    const dir = await freshModuleDir();
    await writeModuleYaml(dir);
    await writeYaml(
      dir,
      'tests/hand-built.test.ts',
      HAND_BUILT_REQUEST_TEST('{}, { strict: false }'),
    );

    const report = await runConformance(dir);
    expect(report.testFilesRun).toBe(1);
  }, 30_000);

  it('refuses (CFG-051) when a test file throws at import/collection time, not only on a failed assertion', async () => {
    const dir = await freshModuleDir();
    await writeModuleYaml(dir);
    await writeYaml(
      dir,
      'tests/throws.test.ts',
      ["throw new Error('cannot even load this test file');", ''].join('\n'),
    );

    await expect(runConformance(dir)).rejects.toMatchObject({ code: 'CFG-051' });
  }, 30_000);

  it('wraps a raw filesystem failure (an unwritable workDir) into a real CFG-051, never a raw exception', async () => {
    const dir = await freshModuleDir();
    await writeModuleYaml(dir);
    await writeYaml(
      dir,
      'tests/pass.test.ts',
      "import { it, expect } from 'vitest';\nit('passes', () => { expect(1).toBe(1); });\n",
    );
    // A real file, not a directory, as `workDir` — `mkdir(workDirBase, { recursive: true })` fails
    // against it (`ENOTDIR`) before `mkdtemp` ever runs, exactly the "something other than the
    // discovered-tests machinery itself" failure a round-2 critic finding found this function's own
    // first draft let escape as a raw, untyped exception instead of a real `ForgeError`.
    const notADirectory = path.join(await freshModuleDir(), 'not-a-directory');
    await writeFile(notADirectory, 'blocked');

    const error = await runModuleConformance(dir, { workDir: notADirectory }).catch(
      (cause: unknown) => cause,
    );
    expect(isForgeError(error)).toBe(true);
    if (isForgeError(error)) {
      expect(error.code).toBe('CFG-051');
    }
  });

  it('does not refuse install-time conformance just because a module ships no tests/ directory at all', async () => {
    const dir = await freshModuleDir();
    await writeModuleYaml(dir);
    const report = await runConformance(dir);
    expect(report.testFilesRun).toBe(0);
  });

  it('never writes into the module\'s own directory — a real, read-only module directory (the local channel\'s own documented "read-only at this point" contract) still runs its own tests/*.test.ts', async () => {
    // Root bypasses the read-only permission bit this test relies on — a no-op under root rather than
    // a false failure, matching `packages/cli/test/commands/module.test.ts`'s own identical guard.
    if (typeof process.getuid === 'function' && process.getuid() === 0) return;

    const dir = await freshModuleDir();
    await writeModuleYaml(dir);
    await writeYaml(
      dir,
      'tests/pass.test.ts',
      [
        "import { describe, it, expect } from 'vitest';",
        "describe('fixture conformance', () => { it('passes', () => { expect(1).toBe(1); }); });",
        '',
      ].join('\n'),
    );
    await chmod(dir, 0o555);
    try {
      const report = await runConformance(dir);
      expect(report.testFilesRun).toBe(1);
    } finally {
      await chmod(dir, 0o755);
    }
  }, 30_000);

  it('refuses (CFG-051) with a real timeout detail when a test file hangs, rather than blocking forever', async () => {
    const dir = await freshModuleDir();
    await writeModuleYaml(dir);
    await writeYaml(
      dir,
      'tests/hang.test.ts',
      [
        "import { it } from 'vitest';",
        "it('hangs forever', () => new Promise(() => {}));",
        '',
      ].join('\n'),
    );

    const error = await runModuleConformance(dir, {
      workDir: sharedWorkDir,
      timeoutMs: 2_000,
    }).catch((cause: unknown) => cause);
    expect(isForgeError(error)).toBe(true);
    if (isForgeError(error)) {
      expect(error.code).toBe('CFG-051');
      expect(error.message).toMatch(/did not finish within 2000ms/);
    }
  }, 30_000);
});

describe('runModuleConformance — real I/O failures surface as a real ForgeError (round-4 critic findings)', () => {
  it('refuses (a real ForgeError, not a raw exception) a provides-referenced entry that is a dangling symlink', async () => {
    const dir = await freshModuleDir();
    await writeModuleYaml(dir, { provides: { agents: ['ghost'] } });
    await mkdir(path.join(dir, 'agents'), { recursive: true });
    // `listDirEntriesSorted`'s own `Dirent.isDirectory()` never follows a symlink, so this dangling
    // link reaches `assertWithinParseCap`'s real `stat` call, which used to throw a raw, untyped
    // `ENOENT` here instead of a real `ForgeError` — the exact class of bug round 3 fixed for a
    // sibling throw site in this same file, left open in this one until a round-4 critic finding.
    await symlink(path.join(dir, 'does-not-exist'), path.join(dir, 'agents', 'ghost.agent.yaml'));

    const error = await runConformance(dir).catch((cause: unknown) => cause);
    expect(isForgeError(error)).toBe(true);
  });
});

describe('runModuleConformance — per-file parse cap (CFG-052)', () => {
  it('refuses a provides-referenced file that exceeds the parse cap, rather than reading it unbounded', async () => {
    const dir = await freshModuleDir();
    await writeModuleYaml(dir, { provides: { agents: ['big'] } });
    // One byte over `DEFAULT_MAX_DECOMPRESSED_BYTES` (`packages/extensions/src/install/tar-extract.ts`)
    // — large enough to trip the cap, small enough (well under its own real ceiling) to write quickly.
    const oversized = `id: big\n# ${'x'.repeat(DEFAULT_MAX_DECOMPRESSED_BYTES + 1)}\n`;
    await writeYaml(dir, 'agents/big.agent.yaml', oversized);

    const error = await runConformance(dir).catch((cause: unknown) => cause);
    expect(isForgeError(error)).toBe(true);
    if (isForgeError(error)) {
      expect(error.code).toBe('CFG-052');
    }
  });

  it('refuses an oversized module.yaml itself, not only an oversized provides-referenced file', async () => {
    const dir = await freshModuleDir();
    // Directly overwrites `module.yaml` (not via `writeModuleYaml`, which writes a small, valid
    // document) with a real, still-parseable document padded past the cap — this is the file
    // `runModuleConformance` itself re-reads on every call, not one it merely reads mentioned by
    // `provides`, and a round-2 critic finding found it was the one file this piece left uncapped.
    await writeYaml(
      dir,
      'module.yaml',
      [
        'id: fixture-mod',
        'name: Fixture Module',
        'version: 1.0.0',
        "forgeVersion: '>=1.0 <2'",
        'requires: []',
        'conflicts: []',
        'levels: [L1]',
        'ceilings: {}',
        'provides: {}',
        `# ${'x'.repeat(DEFAULT_MAX_DECOMPRESSED_BYTES + 1)}`,
        '',
      ].join('\n'),
    );

    const error = await runConformance(dir).catch((cause: unknown) => cause);
    expect(isForgeError(error)).toBe(true);
    if (isForgeError(error)) {
      expect(error.code).toBe('CFG-052');
    }
  });
});
