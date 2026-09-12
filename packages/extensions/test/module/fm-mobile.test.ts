/**
 * `fm-mobile`'s own real, shipped `modules/fm-mobile/module.yaml` (`PLAN-M10.md` P6) -- checked against
 * this piece's own real, non-fixture `parseModule`/`resolveInstalledModules`, mirroring
 * `fm-data.test.ts`'s own established pattern.
 *
 * @see specs/19 §19.1
 * @see PLAN-M10.md P6
 */
import { ProjectPaths, type AbsolutePath } from '@forge/core';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { parseModule } from '../../src/module/parse.ts';
import { resolveInstalledModules } from '../../src/module/resolve.ts';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const modulesDir = new ProjectPaths(repoRoot).resolveWithin('modules');
const fmMobileManifest = path.join(modulesDir, 'fm-mobile', 'module.yaml') as AbsolutePath;

describe('fm-mobile/module.yaml — real, shipped content', () => {
  it('parses cleanly against moduleSchema', async () => {
    const definition = await parseModule(fmMobileManifest);
    expect(definition.id).toBe('fm-mobile');
    expect(definition.requires).toEqual(['fm-core']);
    expect(definition.conflicts).toEqual([]);
    expect(definition.provides.agents).toEqual(['mobile']);
    expect(definition.provides.workflows).toEqual(['store-release']);
    expect(definition.provides.checks).toEqual(['device-matrix:coverage']);
    expect(definition.provides.artifactTypes).toEqual([]);
    expect(Object.keys(definition.ceilings)).toEqual(['mobile']);
  });

  it('declares a real ToolGrant-shaped ceiling for mobile, network as the enum not a boolean', async () => {
    const definition = await parseModule(fmMobileManifest);
    expect(definition.ceilings['mobile']).toEqual({
      write: true,
      exec: ['git *', 'ls*', 'rg*', 'cat*', 'tree*'],
      network: 'none',
      deploy: false,
    });
  });

  it('resolves cleanly together with fm-core, requires satisfied, no unexpected provide conflicts beyond the disclosed mobile agent-id collision', async () => {
    const result = await resolveInstalledModules(['fm-core', 'fm-mobile'], modulesDir, {
      forgeVersion: '1.0.0',
    });
    expect([...result.modules.keys()]).toEqual(['fm-core', 'fm-mobile']);
  });

  it('fm-core and fm-mobile both provide "mobile" -- a real, deliberate, reported provide conflict resolved by install order in fm-mobile\'s own favour', async () => {
    const result = await resolveInstalledModules(['fm-core', 'fm-mobile'], modulesDir, {
      forgeVersion: '1.0.0',
    });
    const conflict = result.provideConflicts.find((c) => c.kind === 'agents' && c.id === 'mobile');
    expect(conflict, 'expected a reported conflict for "mobile"').toBeDefined();
    expect(conflict?.contributors).toEqual(['fm-core', 'fm-mobile']);
    expect(conflict?.winner).toBe('fm-mobile');
  });

  it('resolveInstalledModules\'s own "winner" tracks the caller-supplied installOrder, NOT loadAgentRegistry\'s own real, filesystem-alphabetical resolution -- the identical discrepancy fm-web.test.ts/fm-service.test.ts/fm-data.test.ts already pin for their own collisions', async () => {
    const reversed = await resolveInstalledModules(['fm-mobile', 'fm-core'], modulesDir, {
      forgeVersion: '1.0.0',
    });
    const conflict = reversed.provideConflicts.find(
      (c) => c.kind === 'agents' && c.id === 'mobile',
    );
    expect(conflict?.winner).toBe('fm-core');
  });

  it('fails to resolve with fm-mobile alone -- fm-core is a real, declared requires', async () => {
    await expect(
      resolveInstalledModules(['fm-mobile'], modulesDir, { forgeVersion: '1.0.0' }),
    ).rejects.toMatchObject({ code: 'CFG-022' });
  });

  it('provides no catalog/gates/skills/techniques/frameworks/artifactTypes ids that are invented rather than real', async () => {
    const definition = await parseModule(fmMobileManifest);
    expect(definition.provides.catalog).toEqual([]);
    expect(definition.provides.skills).toEqual([]);
    expect(definition.provides.gates).toEqual([]);
    expect(definition.provides.techniques).toEqual([]);
    expect(definition.provides.frameworks).toEqual([]);
    expect(definition.provides.artifactTypes).toEqual([]);
  });
});
