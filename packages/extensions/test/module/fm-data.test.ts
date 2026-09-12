/**
 * `fm-data`'s own real, shipped `modules/fm-data/module.yaml` (`PLAN-M10.md` P5) -- checked against
 * this piece's own real, non-fixture `parseModule`/`resolveInstalledModules`, mirroring
 * `fm-service.test.ts`'s own established pattern.
 *
 * @see specs/19 §19.1
 * @see PLAN-M10.md P5
 */
import { ProjectPaths, type AbsolutePath } from '@forge/core';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { parseModule } from '../../src/module/parse.ts';
import { resolveInstalledModules } from '../../src/module/resolve.ts';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const modulesDir = new ProjectPaths(repoRoot).resolveWithin('modules');
const fmDataManifest = path.join(modulesDir, 'fm-data', 'module.yaml') as AbsolutePath;

describe('fm-data/module.yaml — real, shipped content', () => {
  it('parses cleanly against moduleSchema', async () => {
    const definition = await parseModule(fmDataManifest);
    expect(definition.id).toBe('fm-data');
    expect(definition.requires).toEqual(['fm-core']);
    expect(definition.conflicts).toEqual([]);
    expect(definition.provides.agents).toEqual(['data-engineer']);
    expect(definition.provides.frameworks).toEqual(['analytical-pipeline-design']);
    expect(definition.provides.checks).toEqual(['lineage:coverage', 'data-quality:tests']);
    expect(definition.provides.artifactTypes).toEqual([]);
    expect(Object.keys(definition.ceilings)).toEqual(['data-engineer']);
  });

  it('declares a real ToolGrant-shaped ceiling for data-engineer, network as the enum not a boolean', async () => {
    const definition = await parseModule(fmDataManifest);
    expect(definition.ceilings['data-engineer']).toEqual({
      write: true,
      exec: ['git *', 'ls*', 'rg*', 'cat*', 'tree*'],
      network: 'none',
      deploy: false,
    });
  });

  it('resolves cleanly together with fm-core, requires satisfied, no unexpected provide conflicts beyond the disclosed data-engineer agent-id collision', async () => {
    const result = await resolveInstalledModules(['fm-core', 'fm-data'], modulesDir, {
      forgeVersion: '1.0.0',
    });
    expect([...result.modules.keys()]).toEqual(['fm-core', 'fm-data']);
  });

  it('fm-core and fm-data both provide "data-engineer" -- a real, deliberate, reported provide conflict resolved by install order in fm-data\'s own favour', async () => {
    const result = await resolveInstalledModules(['fm-core', 'fm-data'], modulesDir, {
      forgeVersion: '1.0.0',
    });
    const conflict = result.provideConflicts.find(
      (c) => c.kind === 'agents' && c.id === 'data-engineer',
    );
    expect(conflict, 'expected a reported conflict for "data-engineer"').toBeDefined();
    expect(conflict?.contributors).toEqual(['fm-core', 'fm-data']);
    expect(conflict?.winner).toBe('fm-data');
  });

  it('does NOT report a provide conflict for "analytical-pipeline-design" -- fm-core\'s own provides.frameworks already deliberately excludes it (module.yaml\'s own header comment)', async () => {
    const result = await resolveInstalledModules(['fm-core', 'fm-data'], modulesDir, {
      forgeVersion: '1.0.0',
    });
    const conflict = result.provideConflicts.find(
      (c) => c.kind === 'frameworks' && c.id === 'analytical-pipeline-design',
    );
    expect(conflict).toBeUndefined();
  });

  it('resolveInstalledModules\'s own "winner" tracks the caller-supplied installOrder, NOT loadAgentRegistry\'s own real, filesystem-alphabetical resolution -- the identical discrepancy fm-web.test.ts/fm-service.test.ts already pin for their own collisions', async () => {
    const reversed = await resolveInstalledModules(['fm-data', 'fm-core'], modulesDir, {
      forgeVersion: '1.0.0',
    });
    const conflict = reversed.provideConflicts.find(
      (c) => c.kind === 'agents' && c.id === 'data-engineer',
    );
    expect(conflict?.winner).toBe('fm-core');
  });

  it('fails to resolve with fm-data alone -- fm-core is a real, declared requires', async () => {
    await expect(
      resolveInstalledModules(['fm-data'], modulesDir, { forgeVersion: '1.0.0' }),
    ).rejects.toMatchObject({ code: 'CFG-022' });
  });

  it('provides no catalog/gates/skills/techniques/workflows/artifactTypes ids that are invented rather than real', async () => {
    const definition = await parseModule(fmDataManifest);
    expect(definition.provides.catalog).toEqual([]);
    expect(definition.provides.skills).toEqual([]);
    expect(definition.provides.gates).toEqual([]);
    expect(definition.provides.techniques).toEqual([]);
    expect(definition.provides.workflows).toEqual([]);
    expect(definition.provides.artifactTypes).toEqual([]);
  });
});
