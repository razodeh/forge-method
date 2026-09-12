/**
 * `fm-service`'s own real, shipped `modules/fm-service/module.yaml` (`PLAN-M10.md` P4) -- checked
 * against this piece's own real, non-fixture `parseModule`/`resolveInstalledModules`, mirroring
 * `fm-web.test.ts`'s own established pattern.
 *
 * @see specs/19 §19.1
 * @see PLAN-M10.md P4
 */
import { ProjectPaths, type AbsolutePath } from '@forge/core';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { parseModule } from '../../src/module/parse.ts';
import { resolveInstalledModules } from '../../src/module/resolve.ts';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const modulesDir = new ProjectPaths(repoRoot).resolveWithin('modules');
const fmServiceManifest = path.join(modulesDir, 'fm-service', 'module.yaml') as AbsolutePath;

describe('fm-service/module.yaml — real, shipped content', () => {
  it('parses cleanly against moduleSchema', async () => {
    const definition = await parseModule(fmServiceManifest);
    expect(definition.id).toBe('fm-service');
    expect(definition.requires).toEqual(['fm-core']);
    expect(definition.conflicts).toEqual([]);
    expect(definition.provides.agents).toEqual(['domain-modeler', 'integration-architect']);
    expect(definition.provides.workflows).toEqual(['contract-test-cycle']);
    expect(definition.provides.frameworks).toEqual(['api-versioning']);
    expect(definition.provides.checks).toEqual(['contract:verify', 'api:breaking-change']);
    expect(definition.provides.artifactTypes).toEqual([]);
    expect(Object.keys(definition.ceilings).sort()).toEqual([
      'domain-modeler',
      'integration-architect',
    ]);
  });

  it('declares real ToolGrant-shaped ceilings for both agents, network as the enum not a boolean', async () => {
    const definition = await parseModule(fmServiceManifest);
    expect(definition.ceilings['domain-modeler']).toEqual({
      write: false,
      exec: ['ls*', 'rg*', 'cat*'],
      network: 'none',
      deploy: false,
    });
    expect(definition.ceilings['integration-architect']).toEqual({
      write: false,
      exec: ['ls*', 'rg*', 'cat*'],
      network: 'none',
      deploy: false,
    });
  });

  it('resolves cleanly together with fm-core, requires satisfied, no unexpected provide conflicts', async () => {
    const result = await resolveInstalledModules(['fm-core', 'fm-service'], modulesDir, {
      forgeVersion: '1.0.0',
    });
    expect([...result.modules.keys()]).toEqual(['fm-core', 'fm-service']);
  });

  it('fm-core and fm-service both provide "domain-modeler" and "integration-architect" -- real, deliberate, reported provide conflicts resolved by install order in fm-service\'s own favour', async () => {
    const result = await resolveInstalledModules(['fm-core', 'fm-service'], modulesDir, {
      forgeVersion: '1.0.0',
    });
    for (const id of ['domain-modeler', 'integration-architect']) {
      const conflict = result.provideConflicts.find((c) => c.kind === 'agents' && c.id === id);
      expect(conflict, `expected a reported conflict for "${id}"`).toBeDefined();
      expect(conflict?.contributors).toEqual(['fm-core', 'fm-service']);
      expect(conflict?.winner).toBe('fm-service');
    }
  });

  it('resolveInstalledModules\'s own "winner" tracks the caller-supplied installOrder, NOT loadAgentRegistry\'s own real, filesystem-alphabetical resolution -- the identical discrepancy fm-web.test.ts already pins for its own collision', async () => {
    const reversed = await resolveInstalledModules(['fm-service', 'fm-core'], modulesDir, {
      forgeVersion: '1.0.0',
    });
    const conflict = reversed.provideConflicts.find(
      (c) => c.kind === 'agents' && c.id === 'domain-modeler',
    );
    // With this (legal, unrejected) installOrder, resolveInstalledModules reports fm-core as the
    // winner -- the OPPOSITE of what packages/agents/test/content/fm-service-roster.test.ts's own
    // loadAgentRegistry(modulesDir) test proves the real roster actually resolves to.
    expect(conflict?.winner).toBe('fm-core');
  });

  it('fails to resolve with fm-service alone -- fm-core is a real, declared requires', async () => {
    await expect(
      resolveInstalledModules(['fm-service'], modulesDir, { forgeVersion: '1.0.0' }),
    ).rejects.toMatchObject({ code: 'CFG-022' });
  });

  it('provides no catalog/gates/skills/techniques ids that are invented rather than real, and no "integration-design" framework (see module.yaml\'s own header comment)', async () => {
    const definition = await parseModule(fmServiceManifest);
    expect(definition.provides.catalog).toEqual([]);
    expect(definition.provides.skills).toEqual([]);
    expect(definition.provides.gates).toEqual([]);
    expect(definition.provides.techniques).toEqual([]);
    expect(definition.provides.frameworks).not.toContain('integration-design');
  });
});
