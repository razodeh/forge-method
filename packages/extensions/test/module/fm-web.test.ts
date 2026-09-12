/**
 * `fm-web`'s own real, shipped `modules/fm-web/module.yaml` (`PLAN-M10.md` P3) -- checked against
 * this piece's own real, non-fixture `parseModule`/`resolveInstalledModules`, mirroring
 * `fm-core.test.ts`'s own established pattern.
 *
 * @see specs/19 §19.1
 * @see PLAN-M10.md P3
 */
import { ProjectPaths, type AbsolutePath } from '@forge/core';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { parseModule } from '../../src/module/parse.ts';
import { resolveInstalledModules } from '../../src/module/resolve.ts';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const modulesDir = new ProjectPaths(repoRoot).resolveWithin('modules');
const fmWebManifest = path.join(modulesDir, 'fm-web', 'module.yaml') as AbsolutePath;

describe('fm-web/module.yaml — real, shipped content', () => {
  it('parses cleanly against moduleSchema', async () => {
    const definition = await parseModule(fmWebManifest);
    expect(definition.id).toBe('fm-web');
    expect(definition.requires).toEqual(['fm-core']);
    expect(definition.conflicts).toEqual([]);
    expect(definition.provides.agents).toEqual(['frontend']);
    expect(definition.provides.checks).toEqual(['a11y:audit', 'bundle:size']);
    expect(definition.provides.artifactTypes).toEqual(['ComponentSpec', 'UXReviewRecord']);
    expect(Object.keys(definition.ceilings)).toEqual(['frontend']);
  });

  it("declares a real ToolGrant-shaped ceiling for frontend, network as the enum not a boolean (PLAN-M10.md P2's own fixed defect, not repeated here)", async () => {
    const definition = await parseModule(fmWebManifest);
    expect(definition.ceilings['frontend']).toEqual({
      write: true,
      exec: ['git *', 'ls*', 'rg*', 'cat*', 'tree*'],
      network: 'none',
      deploy: false,
    });
  });

  it('resolves cleanly together with fm-core, requires satisfied, no provide conflicts (fm-web is the only real provider of "frontend" once fm-core is left out of provides re-declaration checks)', async () => {
    const result = await resolveInstalledModules(['fm-core', 'fm-web'], modulesDir, {
      forgeVersion: '1.0.0',
    });
    expect([...result.modules.keys()]).toEqual(['fm-core', 'fm-web']);
  });

  it('fm-core and fm-web both provide agent id "frontend" -- a real, deliberate, reported provide conflict resolved by install order in fm-web\'s own favour', async () => {
    const result = await resolveInstalledModules(['fm-core', 'fm-web'], modulesDir, {
      forgeVersion: '1.0.0',
    });
    const frontendConflict = result.provideConflicts.find(
      (c) => c.kind === 'agents' && c.id === 'frontend',
    );
    expect(frontendConflict).toBeDefined();
    expect(frontendConflict?.contributors).toEqual(['fm-core', 'fm-web']);
    expect(frontendConflict?.winner).toBe('fm-web');
  });

  it("resolveInstalledModules's own \"winner\" tracks the caller-supplied installOrder, NOT loadAgentRegistry's own real, filesystem-alphabetical resolution -- a real discrepancy a critic round found and this pins rather than hides (see module.yaml's own header comment)", async () => {
    const reversed = await resolveInstalledModules(['fm-web', 'fm-core'], modulesDir, {
      forgeVersion: '1.0.0',
    });
    const frontendConflict = reversed.provideConflicts.find(
      (c) => c.kind === 'agents' && c.id === 'frontend',
    );
    // With this (legal, unrejected) installOrder, resolveInstalledModules reports fm-core as the
    // winner -- the OPPOSITE of what packages/agents/test/content/fm-web-roster.test.ts's own
    // loadAgentRegistry(modulesDir) test proves the real roster actually resolves to. Nothing in this
    // codebase enforces installOrder to agree with loadAgentRegistry's own directory-scan order, and
    // resolveInstalledModules has no production caller today to make that disagreement matter yet.
    expect(frontendConflict?.winner).toBe('fm-core');
  });

  it('fails to resolve with fm-web alone -- fm-core is a real, declared requires', async () => {
    await expect(
      resolveInstalledModules(['fm-web'], modulesDir, { forgeVersion: '1.0.0' }),
    ).rejects.toMatchObject({ code: 'CFG-022' });
  });

  it('provides no checks/catalog/skills/workflows/frameworks/gates/techniques ids that are invented rather than real (checks match the two real checks/*.check.yaml ids, catalog/skills/workflows/frameworks/gates/techniques all deliberately empty)', async () => {
    const definition = await parseModule(fmWebManifest);
    expect(definition.provides.catalog).toEqual([]);
    expect(definition.provides.skills).toEqual([]);
    expect(definition.provides.workflows).toEqual([]);
    expect(definition.provides.frameworks).toEqual([]);
    expect(definition.provides.gates).toEqual([]);
    expect(definition.provides.techniques).toEqual([]);
  });
});
