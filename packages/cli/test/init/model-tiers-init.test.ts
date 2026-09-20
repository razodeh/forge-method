/**
 * `forge init` writes the model-tier map — `PLAN-M13.md` P5b (`SPEC-QUESTIONS.md` Q204).
 *
 * The centrepiece: on a fresh project initialised against the real, shipped agent roster and the real
 * Claude Code adapter, *every* installed agent resolves a model through the real `resolveStepModel`, with
 * no RUN-078. The set of tiers is derived from the agent definitions init actually installed, never
 * hard-coded, so a new agent on a new tier that nothing maps fails here.
 *
 * The real adapter is obtained through `adapter-kit`'s registry (a specifier built from data), exactly as
 * `bin.ts` does; only its `preflight` is stubbed, because a test machine may have no `claude` binary and
 * init's connectivity check is not what is under test.
 *
 * @see specs/05 §5.8
 * @see PLAN-M13.md P5b
 */
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import * as YAML from 'yaml';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { KNOWN_ADAPTER_MODULES, loadAdapterFactory } from '@forge/adapter-kit/registry';
import { MODEL_TIER_NAMES, type PlatformAdapter } from '@forge/adapter-kit/types';
import { resolveStepModel } from '@forge/agents/resolve';
import { ForgeError } from '@forge/core/errors';
import { ProjectPaths } from '@forge/core/fs';
import { configSchema, type ForgeConfig } from '@forge/schemas/config';
import { FakePlatformAdapter } from '@forge/testkit';

import { agentList } from '../../src/commands/agent.ts';
import { checkModelTiers } from '../../src/commands/doctor/model-tiers.ts';
import { runDoctor } from '../../src/commands/doctor/run-doctor.ts';
import { loadProjectAgent } from '../../src/commands/loop/agent-loader.ts';
import { runInit } from '../../src/init/run-init.ts';
import type { InitOptions, RunInitDeps } from '../../src/init/types.ts';

// Every init here installs the full shipped roster (hundreds of files); under a loaded machine two of them
// in one test can pass the default timeout.
vi.setConfig({ testTimeout: 180_000, hookTimeout: 300_000 });

const REAL_MODULES_DIR = fileURLToPath(new URL('../../../../modules/', import.meta.url));
const OPTIONS: InitOptions = { name: 'Tier Fixture', yes: true, level: 'L0' };

const FIXTURE_MODULES_DIR = fileURLToPath(new URL('./fixtures/modules/', import.meta.url));

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

// One real init per adapter, shared by every read-only test below: initialising the full shipped roster
// is the slow part of this file, and none of those tests mutates the project.
let adapter: PlatformAdapter;
let freshDir: string;
let fakeDir: string;
let freshResult: Awaited<ReturnType<typeof runInit>>;
let fakeResult: Awaited<ReturnType<typeof runInit>>;
// The real fake, forced to declare no tier defaults: the position the generic adapter is in. Set
// explicitly so this file's premise does not depend on what the test kit's fake happens to declare.
const fake: PlatformAdapter = Object.assign(
  Object.create(new FakePlatformAdapter()) as PlatformAdapter,
  {
    defaultTierModels: undefined,
  },
);
beforeAll(async () => {
  adapter = await realAdapter();
  freshDir = await tempDirNoCleanup();
  freshResult = await runInit(freshDir, OPTIONS, deps(adapter));
  fakeDir = await tempDirNoCleanup();
  fakeResult = await runInit(fakeDir, OPTIONS, deps(fake));
}, 300_000);
afterAll(async () => {
  await Promise.all([freshDir, fakeDir].map((dir) => rm(dir, { recursive: true, force: true })));
});

/** A copy of the shared fresh project, for a test that changes it. */
async function copyOfFresh(): Promise<string> {
  const dir = await tempDir();
  await cp(freshDir, dir, { recursive: true });
  return dir;
}

async function tempDirNoCleanup(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), 'forge-cli-tiers-'));
}

async function tempDir(): Promise<string> {
  const dir = await tempDirNoCleanup();
  dirs.push(dir);
  return dir;
}

/** The real registered adapter, its connectivity probe replaced by "ok". */
async function realAdapter(): Promise<PlatformAdapter> {
  const spec = KNOWN_ADAPTER_MODULES[0];
  if (spec === undefined) throw new Error('no adapter module is registered');
  const real = (await loadAdapterFactory(spec.packageName))({ env: {}, now: () => 0 });
  return Object.assign(Object.create(real) as PlatformAdapter, {
    preflight: () => Promise.resolve({ ok: true, issues: [] }),
  });
}

function deps(adapter: PlatformAdapter): RunInitDeps {
  return { candidateAdapters: [adapter], env: {}, modulesDir: REAL_MODULES_DIR };
}

async function readConfig(dir: string): Promise<ForgeConfig> {
  return configSchema.parse(
    YAML.parse(await readFile(path.join(dir, '.forge/config.yaml'), 'utf8')),
  );
}

async function installedAgents(dir: string) {
  const paths = new ProjectPaths(dir);
  const ids = await agentList({ paths, agentsRoot: '.forge/agents' });
  return Promise.all(ids.map((id) => loadProjectAgent(paths, '.forge/agents', id)));
}

describe('fresh init with the real adapter', () => {
  it('maps every tier the shipped agents use, so no agent step fails RUN-078', async () => {
    expect(freshResult.kind).toBe('initialized');
    const config = await readConfig(freshDir);
    const agents = await installedAgents(freshDir);
    expect(agents.length).toBeGreaterThan(20); // the real roster, not an empty directory

    const usedTiers = new Set(agents.map((agent) => agent.model.tier));
    expect(usedTiers.size).toBeGreaterThan(0);

    const listed = new Set((await adapter.listModels()).map((model) => model.id));
    for (const agent of agents) {
      const model = resolveStepModel(agent, config.models, adapter.id);
      // The resolved id is one the adapter itself reports: startSession would refuse anything else.
      expect(listed.has(model), `${agent.id} -> ${model}`).toBe(true);
    }
    for (const tier of usedTiers) {
      expect(Object.hasOwn(config.models.tiers[tier], adapter.id), tier).toBe(true);
    }
  });

  it('maps all three tiers, not only the ones today’s agents happen to use', async () => {
    const config = await readConfig(freshDir);
    for (const tier of MODEL_TIER_NAMES) {
      expect(config.models.tiers[tier][adapter.id], tier).toEqual(expect.any(String));
    }
  });

  it('reports the tiers as mapped in the init result, with nothing unmapped', () => {
    if (freshResult.kind !== 'initialized') throw new Error('expected a fresh init');
    expect(freshResult.modelTiers).toHaveLength(1);
    expect(freshResult.modelTiers[0]?.adapterId).toBe(adapter.id);
    expect(freshResult.modelTiers[0]?.unmapped).toEqual([]);
  });

  it('leaves the project healthy for doctor: no model-tiers failure', async () => {
    const check = await checkModelTiers(new ProjectPaths(freshDir), await readConfig(freshDir));
    expect(check.ok).toBe(true);
  });

  it('a config-provided value still wins over the default: resolveStepModel precedence is unchanged', async () => {
    const config = await readConfig(freshDir);
    const agent = (await installedAgents(freshDir))[0];
    if (agent === undefined) throw new Error('no agents installed');

    const edited: ForgeConfig['models'] = {
      ...config.models,
      tiers: {
        ...config.models.tiers,
        [agent.model.tier]: {
          ...config.models.tiers[agent.model.tier],
          [adapter.id]: 'my-pinned-model',
        },
      },
    };
    expect(resolveStepModel(agent, edited, adapter.id)).toBe('my-pinned-model');

    // The adapter-kit tier vocabulary and the resolver's own are one list: every name resolves.
    for (const tier of MODEL_TIER_NAMES) {
      const viaOverride: ForgeConfig['models'] = {
        ...config.models,
        overrides: { [agent.id]: tier },
      };
      expect(resolveStepModel(agent, viaOverride, adapter.id), tier).toBe(
        config.models.tiers[tier][adapter.id],
      );
    }

    // A per-agent tier override still redirects to *that* tier's entry, default or edited.
    const otherTier = MODEL_TIER_NAMES.find((tier) => tier !== agent.model.tier) ?? 'max';
    const overridden: ForgeConfig['models'] = {
      ...config.models,
      overrides: { [agent.id]: otherTier },
    };
    expect(resolveStepModel(agent, overridden, adapter.id)).toBe(
      config.models.tiers[otherTier][adapter.id],
    );
  });
});

describe('re-init on an existing project', () => {
  async function editConfig(dir: string, edit: (doc: YAML.Document) => void): Promise<string> {
    const configPath = path.join(dir, '.forge/config.yaml');
    const doc = YAML.parseDocument(await readFile(configPath, 'utf8'));
    edit(doc);
    await writeFile(configPath, `# hand-owned comment\n${doc.toString()}`);
    return configPath;
  }

  it('never overwrites a hand-edited tier value, and keeps the rest of the default map', async () => {
    const dir = await copyOfFresh();
    const configPath = await editConfig(dir, (doc) => {
      doc.setIn(['models', 'tiers', 'balanced', adapter.id], 'my-hand-edited-model');
    });

    const again = await runInit(dir, { ...OPTIONS, onConflict: 'keep-mine' }, deps(adapter));
    expect(again.kind).toBe('reinitialized');

    expect(await readFile(configPath, 'utf8')).toContain('# hand-owned comment');
    const config = await readConfig(dir);
    expect(config.models.tiers.balanced[adapter.id]).toBe('my-hand-edited-model');
    expect(config.models.tiers.max[adapter.id]).toEqual(expect.any(String));
    if (again.kind !== 'reinitialized') throw new Error('expected a re-init');
    expect(again.modelTiers[0]?.mapped.balanced).toBe('my-hand-edited-model');
    expect(again.modelTierNotes).toEqual([]);
  });

  it('never overwrites even a value the adapter does not list (the user’s edit is theirs)', async () => {
    const dir = await copyOfFresh();
    await editConfig(dir, (doc) => {
      doc.setIn(['models', 'tiers', 'max', adapter.id], 'some-future-model');
    });
    await runInit(dir, { ...OPTIONS, onConflict: 'keep-mine' }, deps(adapter));
    expect((await readConfig(dir)).models.tiers.max[adapter.id]).toBe('some-future-model');
  });

  it('backfills a project initialised before this piece existed (empty tiers) without touching anything else', async () => {
    const dir = await copyOfFresh();
    await editConfig(dir, (doc) => {
      doc.setIn(['models', 'tiers'], { frugal: {}, balanced: {}, max: {} });
      doc.setIn(['project', 'description'], 'edited by a human');
    });
    await runInit(dir, { ...OPTIONS, onConflict: 'keep-mine' }, deps(adapter));
    const config = await readConfig(dir);
    expect(config.project.description).toBe('edited by a human');
    for (const tier of MODEL_TIER_NAMES) {
      expect(config.models.tiers[tier][adapter.id], tier).toEqual(expect.any(String));
    }
  });

  it('is byte-stable for config.yaml when re-run on an already-complete project', async () => {
    const dir = await copyOfFresh();
    const configPath = path.join(dir, '.forge/config.yaml');
    const before = await readFile(configPath, 'utf8');
    await runInit(dir, { ...OPTIONS, onConflict: 'keep-mine' }, deps(adapter));
    await runInit(dir, { ...OPTIONS, onConflict: 'keep-mine' }, deps(adapter));
    expect(await readFile(configPath, 'utf8')).toBe(before);
  });
});

describe('an adapter that cannot name tier models (the generic adapter, or a failed listModels)', () => {
  // The real fake declares no `defaultTierModels`: the position the generic adapter is in.
  it('writes no model id at all, reports every tier unmapped with the reason, and init still succeeds', async () => {
    if (fakeResult.kind !== 'initialized') throw new Error('expected a fresh init');
    const config = await readConfig(fakeDir);
    expect(config.models.tiers).toEqual({ frugal: {}, balanced: {}, max: {} });
    expect(fakeResult.modelTiers[0]?.unmapped).toEqual([...MODEL_TIER_NAMES]);
    expect(fakeResult.modelTiers[0]?.note).toContain(fake.id);
  });

  it('a listModels() that rejects does not fail init and writes nothing', async () => {
    const real = await realAdapter();
    const flaky = Object.assign(Object.create(real) as PlatformAdapter, {
      listModels: () => Promise.reject(new Error('cannot list')),
    });
    const dir = await tempDir();
    // The small fixture roster: only config.yaml is under test here.
    const result = await runInit(dir, OPTIONS, {
      candidateAdapters: [flaky],
      env: {},
      modulesDir: FIXTURE_MODULES_DIR,
    });
    if (result.kind !== 'initialized') throw new Error('expected a fresh init');
    expect((await readConfig(dir)).models.tiers).toEqual({ frugal: {}, balanced: {}, max: {} });
    expect(result.modelTiers[0]?.note).toContain('cannot list');
  });

  it('forge doctor then names the unmapped tiers, the agents using them, and the remedy', async () => {
    const config = await readConfig(fakeDir);

    const check = await checkModelTiers(new ProjectPaths(fakeDir), config);
    expect(check.ok).toBe(false);
    expect(check.severity).toBe('warning');
    expect(check.message).toContain(fake.id);
    expect(check.message).toContain('RUN-078');
    expect(check.fix).toContain(`models.tiers.<tier>.${fake.id}`);

    const report = await runDoctor({
      paths: new ProjectPaths(fakeDir),
      projectRoot: fakeDir,
      config,
      env: {},
      processVersion: process.version,
    });
    expect(report.checks.find((c) => c.id === 'model-tiers')?.ok).toBe(false);

    // ...and that is exactly the failure a real step would hit.
    const agent = (await installedAgents(fakeDir))[0];
    if (agent === undefined) throw new Error('no agents installed');
    expect(() => resolveStepModel(agent, config.models, fake.id)).toThrow(ForgeError);
  });
});

describe('primary and fallback adapters', () => {
  const stubs = async () => (await import('./tier-stubs.ts')).stubAdapter;

  it('writes a vetted map for both, so a run that falls back does not hit RUN-078 on its first step', async () => {
    const stubAdapter = await stubs();
    const dir = await tempDir();
    const result = await runInit(
      dir,
      { ...OPTIONS, platform: 'stub', fallbackPlatform: 'stub2' },
      {
        candidateAdapters: [
          stubAdapter({}),
          stubAdapter({ id: 'stub2', models: ['q-mid'], defaults: { balanced: 'q-mid' } }),
        ],
        env: {},
        modulesDir: FIXTURE_MODULES_DIR,
      },
    );
    if (result.kind !== 'initialized') throw new Error('expected a fresh init');
    const config = await readConfig(dir);
    expect(config.models.tiers.balanced).toEqual({ stub: 'm-mid', stub2: 'q-mid' });
    expect(config.models.tiers.max).toEqual({ stub: 'm-big' }); // stub2 offers none: left unmapped
    expect(result.modelTiers.map((report) => report.adapterId)).toEqual(['stub', 'stub2']);
    expect(result.modelTiers[1]?.unmapped).toEqual(['frugal', 'max']);
  });

  it('writes one map, and reports once, when the fallback is the same adapter as the primary', async () => {
    const stubAdapter = await stubs();
    const dir = await tempDir();
    const result = await runInit(
      dir,
      { ...OPTIONS, platform: 'stub', fallbackPlatform: 'stub' },
      { candidateAdapters: [stubAdapter({})], env: {}, modulesDir: FIXTURE_MODULES_DIR },
    );
    if (result.kind !== 'initialized') throw new Error('expected a fresh init');
    expect(result.modelTiers).toHaveLength(1);
  });

  it('a re-init reports (not swallows) a recorded adapter it was not given', async () => {
    const stubAdapter = await stubs();
    const dir = await tempDir();
    const options = { ...OPTIONS, onConflict: 'keep-mine' } as const;
    await runInit(dir, options, {
      candidateAdapters: [stubAdapter({})],
      env: {},
      modulesDir: FIXTURE_MODULES_DIR,
    });
    const again = await runInit(dir, options, {
      candidateAdapters: [stubAdapter({ id: 'other' })],
      env: {},
      modulesDir: FIXTURE_MODULES_DIR,
    });
    if (again.kind !== 'reinitialized') throw new Error('expected a re-init');
    expect(again.modelTierNotes).toHaveLength(1);
    expect(again.modelTierNotes[0]).toContain('"stub"');
  });
});
