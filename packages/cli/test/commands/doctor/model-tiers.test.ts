/**
 * `checkModelTiers` — `forge doctor`'s report of tiers that would fail RUN-078 (`PLAN-M13.md` P5b,
 * `SPEC-QUESTIONS.md` Q204). Scoped to the tiers the installed agents actually resolve to.
 *
 * @see specs/05 §5.8
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';
import { resolveStepModel } from '@forge/agents/resolve';
import { readProjectAgent } from '@forge/engine/dispatch';
import type { ForgeConfig } from '@forge/schemas/config';

import { agentNew } from '../../../src/commands/agent.ts';
import { checkModelTiers } from '../../../src/commands/doctor/model-tiers.ts';
import { stubAdapter } from '../../init/tier-stubs.ts';
import { cleanupAll, createTestProject, type TestProject } from './helpers.ts';

afterEach(cleanupAll);

function withModels(
  project: TestProject,
  primary: string,
  models: Partial<ForgeConfig['models']>,
): ForgeConfig {
  return {
    ...project.config,
    platform: { ...project.config.platform, primary },
    models: { ...project.config.models, ...models },
  };
}

async function installAgent(project: TestProject, id: string): Promise<void> {
  await agentNew({ paths: project.paths, agentsRoot: '.forge/agents' }, id, id);
}

describe('checkModelTiers', () => {
  it('passes when no agents are installed: nothing can fail yet', async () => {
    const project = await createTestProject();
    const check = await checkModelTiers(project.paths, withModels(project, 'x', {}));
    expect(check.ok).toBe(true);
  });

  it('with no platform recorded and no adapter given there is nothing to map for: passes, and says so', async () => {
    const project = await createTestProject();
    await installAgent(project, 'dev');
    const check = await checkModelTiers(project.paths, withModels(project, '', {}));
    expect(check.ok).toBe(true);
    expect(check.message).toContain('no platform');
  });

  it('with no platform recorded it checks the adapter a run would build for it (no false negative)', async () => {
    const project = await createTestProject();
    await installAgent(project, 'dev');
    const check = await checkModelTiers(
      project.paths,
      withModels(project, '', {}),
      stubAdapter({ id: 'fallback-choice' }),
    );
    expect(check.ok).toBe(false);
    expect(check.message).toContain('"fallback-choice"');
  });

  it('agrees with resolveStepModel, the function a real step calls, on every agent', async () => {
    const project = await createTestProject();
    for (const id of ['a', 'b', 'c']) await installAgent(project, id);
    const cases: readonly Partial<ForgeConfig['models']>[] = [
      {},
      { tiers: { frugal: {}, balanced: { x: 'ok' }, max: {} } },
      { tiers: { frugal: {}, balanced: { x: ' ' }, max: {} } },
      { tiers: { frugal: {}, balanced: { x: 'ok' }, max: {} }, overrides: { b: 'max' } },
      { tiers: { frugal: {}, balanced: { x: 'ok' }, max: {} }, overrides: { c: 'typo' } },
    ];
    for (const models of cases) {
      const config = withModels(project, 'x', models);
      let runtimeFails = false;
      for (const id of ['a', 'b', 'c']) {
        try {
          resolveStepModel(
            await readProjectAgent(project.paths, '.forge/agents', id),
            config.models,
            'x',
          );
        } catch {
          runtimeFails = true;
        }
      }
      expect((await checkModelTiers(project.paths, config)).ok, JSON.stringify(models)).toBe(
        !runtimeFails,
      );
    }
  });

  it('per 05 §5.8, fails when a mapped model is not one the adapter lists, naming what is available', async () => {
    const project = await createTestProject();
    await installAgent(project, 'dev');
    const tiers = { frugal: {}, balanced: { stub: 'stale-model' }, max: {} };
    const check = await checkModelTiers(
      project.paths,
      withModels(project, 'stub', { tiers }),
      stubAdapter({}),
    );
    expect(check.ok).toBe(false);
    // A warning, not exit-5 hard: an adapter's list may be a static table that does not gate what the
    // platform accepts (see model-tiers.ts). The available list is what §5.8 wants shown.
    expect(check.severity).toBe('warning');
    expect(check.fix).toContain('ignore this if your platform accepts');
    expect(check.message).toContain('"stale-model"');
    expect(check.message).toContain('m-mid'); // the available list
  });

  it('passes when the mapped model is one the adapter lists', async () => {
    const project = await createTestProject();
    await installAgent(project, 'dev');
    const tiers = { frugal: {}, balanced: { stub: 'm-mid' }, max: {} };
    const check = await checkModelTiers(
      project.paths,
      withModels(project, 'stub', { tiers }),
      stubAdapter({}),
    );
    expect(check.ok).toBe(true);
  });

  it('does not judge a model against an adapter that reports none (nothing to compare with)', async () => {
    const project = await createTestProject();
    await installAgent(project, 'dev');
    const tiers = { frugal: {}, balanced: { stub: 'anything' }, max: {} };
    const check = await checkModelTiers(
      project.paths,
      withModels(project, 'stub', { tiers }),
      stubAdapter({ models: [] }),
    );
    expect(check.ok).toBe(true);
  });

  it('caps a huge model catalogue in the message instead of printing all of it', async () => {
    const project = await createTestProject();
    await installAgent(project, 'dev');
    const tiers = { frugal: {}, balanced: { stub: 'stale' }, max: {} };
    const many = Array.from({ length: 500 }, (_, i) => `model-${String(i)}`);
    const check = await checkModelTiers(
      project.paths,
      withModels(project, 'stub', { tiers }),
      stubAdapter({ models: many }),
    );
    expect(check.message).toContain('+488 more');
    expect(check.message.length).toBeLessThan(1500);
  });

  it('strips bidi and line-separator characters from hostile ids', async () => {
    const project = await createTestProject();
    await installAgent(project, 'dev');
    const check = await checkModelTiers(
      project.paths,
      withModels(project, 'x', { overrides: { dev: 'max\u202Eevil\u2028ok config-validity' } }),
    );
    expect(check.message).not.toMatch(/[\u202E\u2028]/);
  });

  it('says so when it cannot verify models against an adapter (never implies it did)', async () => {
    const project = await createTestProject();
    await installAgent(project, 'dev');
    const tiers = { frugal: {}, balanced: { stub: 'anything' }, max: {} };
    const noAdapter = await checkModelTiers(project.paths, withModels(project, 'stub', { tiers }));
    expect(noAdapter.ok).toBe(true);
    expect(noAdapter.message).toContain('not verified');
    const wrongAdapter = await checkModelTiers(
      project.paths,
      withModels(project, 'stub', { tiers }),
      stubAdapter({ id: 'different' }),
    );
    expect(wrongAdapter.message).toContain('not verified');
    const nothingListed = await checkModelTiers(
      project.paths,
      withModels(project, 'stub', { tiers }),
      stubAdapter({ models: [] }),
    );
    expect(nothingListed.message).toContain('not verified');
  });

  it('a failing listModels() is noted, not fatal and not a false failure', async () => {
    const project = await createTestProject();
    await installAgent(project, 'dev');
    const tiers = { frugal: {}, balanced: { stub: 'anything' }, max: {} };
    const check = await checkModelTiers(
      project.paths,
      withModels(project, 'stub', { tiers }),
      stubAdapter({ models: new Error('offline') }),
    );
    expect(check.ok).toBe(true);
    expect(check.message).toContain('not verified');
    expect(check.message).toContain('offline');
  });

  it('warns (not a hard failure), naming the tier, the agent and the adapter, when an in-use tier is unmapped', async () => {
    const project = await createTestProject();
    await installAgent(project, 'dev'); // the scaffold's tier is `balanced`
    const check = await checkModelTiers(project.paths, withModels(project, 'x', {}));
    expect(check.ok).toBe(false);
    expect(check.severity).toBe('warning');
    expect(check.message).toContain('"balanced"');
    expect(check.message).toContain('"x"');
    expect(check.message).toContain('dev');
    expect(check.fix).toContain('models.tiers.<tier>.x');
  });

  it('passes once that tier has a model for the adapter, ignoring unmapped tiers no agent uses', async () => {
    const project = await createTestProject();
    await installAgent(project, 'dev');
    const tiers = { frugal: {}, balanced: { x: 'some-model' }, max: {} };
    const check = await checkModelTiers(project.paths, withModels(project, 'x', { tiers }));
    expect(check.ok).toBe(true);
  });

  it('treats a blank model as unmapped, exactly as resolveStepModel does', async () => {
    const project = await createTestProject();
    await installAgent(project, 'dev');
    const tiers = { frugal: {}, balanced: { x: '  ' }, max: {} };
    const check = await checkModelTiers(project.paths, withModels(project, 'x', { tiers }));
    expect(check.ok).toBe(false);
  });

  it('a mapping for a different adapter does not satisfy the recorded one', async () => {
    const project = await createTestProject();
    await installAgent(project, 'dev');
    const tiers = { frugal: {}, balanced: { other: 'some-model' }, max: {} };
    const check = await checkModelTiers(project.paths, withModels(project, 'x', { tiers }));
    expect(check.ok).toBe(false);
  });

  it('follows models.overrides: the overridden tier is the one that must be mapped', async () => {
    const project = await createTestProject();
    await installAgent(project, 'dev');
    const tiers = { frugal: {}, balanced: { x: 'a' }, max: {} };
    const check = await checkModelTiers(
      project.paths,
      withModels(project, 'x', { tiers, overrides: { dev: 'max' } }),
    );
    expect(check.ok).toBe(false);
    expect(check.message).toContain('"max"');
  });

  it('reports an override that names no real tier', async () => {
    const project = await createTestProject();
    await installAgent(project, 'dev');
    const tiers = { frugal: {}, balanced: { x: 'a' }, max: {} };
    const check = await checkModelTiers(
      project.paths,
      withModels(project, 'x', { tiers, overrides: { dev: 'maxx' } }),
    );
    expect(check.ok).toBe(false);
    expect(check.message).toContain('"maxx"');
  });

  it('never claims "no agents" when every agent file is unreadable', async () => {
    const project = await createTestProject();
    await mkdir(path.join(project.dir, '.forge/agents'), { recursive: true });
    await writeFile(path.join(project.dir, '.forge/agents/broken.yaml'), 'id: [unterminated\n');
    const check = await checkModelTiers(project.paths, withModels(project, 'x', {}));
    expect(check.message).toContain('could not be read');
    expect(check.message).toContain('broken');
    expect(check.message).not.toContain('no agents are installed');
  });

  it('names a schema-valid file whose own declared id disagrees with its file name as unreadable too (readProjectAgent refuses both the same way, PLAN-M14.md P32)', async () => {
    const project = await createTestProject();
    await installAgent(project, 'dev');
    const validYaml = await readFile(path.join(project.dir, '.forge/agents/dev.yaml'), 'utf8');
    // A real, schema-valid agent file -- parses cleanly on its own -- squatting under a file name that
    // does not match its own declared `id`.
    await writeFile(path.join(project.dir, '.forge/agents/impostor.yaml'), validYaml);
    const check = await checkModelTiers(project.paths, withModels(project, 'x', {}));
    expect(check.message).toContain('could not be read');
    expect(check.message).toContain('impostor');
  });

  it('a hostile override value cannot smuggle terminal escapes into the message', async () => {
    const project = await createTestProject();
    await installAgent(project, 'dev');
    const check = await checkModelTiers(
      project.paths,
      withModels(project, 'x', { overrides: { dev: 'max\u001b[2J' } }),
    );
    expect(check.ok).toBe(false);
    expect(check.message).not.toContain('\u001b');
  });

  it('a hostile value cannot start a second doctor report line (newlines collapsed)', async () => {
    const project = await createTestProject();
    await installAgent(project, 'dev');
    const check = await checkModelTiers(
      project.paths,
      withModels(project, 'x', { overrides: { dev: 'max\nok config-validity: fine' } }),
    );
    expect(check.message).not.toMatch(/[\r\n]/);
  });

  it('skips (and counts) an unreadable agent file instead of crashing', async () => {
    const project = await createTestProject();
    await installAgent(project, 'dev');
    await writeFile(path.join(project.dir, '.forge/agents/broken.yaml'), 'id: [unterminated\n');
    const tiers = { frugal: {}, balanced: { x: 'a' }, max: {} };
    const check = await checkModelTiers(project.paths, withModels(project, 'x', { tiers }));
    expect(check.ok).toBe(true);
    expect(check.message).toContain('1 agent file(s) could not be read');
    expect(check.message).toContain('broken');
  });
});
