/**
 * `fm-core`'s own real, shipped `modules/fm-core/module.yaml` (`PLAN-M10.md` P1) — checked against
 * this piece's own real, non-fixture `parseModule`/`resolveInstalledModules`: `PLAN-M10.md` P2's own
 * Checks text, "fm-core's own real module.yaml parses and resolves cleanly with zero other modules
 * installed."
 *
 * @see specs/19 §19.1
 * @see PLAN-M10.md P2
 */
import { ProjectPaths, type AbsolutePath } from '@forge/core';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { parseModule } from '../../src/module/parse.ts';
import { resolveInstalledModules } from '../../src/module/resolve.ts';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const modulesDir = new ProjectPaths(repoRoot).resolveWithin('modules');
const fmCoreManifest = path.join(modulesDir, 'fm-core', 'module.yaml') as AbsolutePath;

describe('fm-core/module.yaml — real, shipped content', () => {
  it('parses cleanly against moduleSchema', async () => {
    const definition = await parseModule(fmCoreManifest);
    expect(definition.id).toBe('fm-core');
    expect(definition.requires).toEqual([]);
    expect(definition.conflicts).toEqual([]);
    expect(definition.provides.agents).toContain('architect');
    expect(definition.provides.techniques).toContain('five-whys');
    expect(Object.keys(definition.ceilings)).toContain('backend');
  });

  it('resolves cleanly with zero other modules installed', async () => {
    const result = await resolveInstalledModules(['fm-core'], modulesDir, {
      forgeVersion: '1.0.0',
    });
    expect([...result.modules.keys()]).toEqual(['fm-core']);
    expect(result.provideConflicts).toEqual([]);
  });

  it('satisfies its own declared forgeVersion range for the version it declares itself compatible with', async () => {
    const definition = await parseModule(fmCoreManifest);
    // fm-core declares forgeVersion: '>=1.0 <2' — its own lower bound must itself satisfy the range,
    // or the range and the module's own installed reality would already disagree at the one point
    // that matters most.
    await expect(
      resolveInstalledModules(['fm-core'], modulesDir, { forgeVersion: '1.0.0' }),
    ).resolves.toBeDefined();
    expect(definition.forgeVersion).toBe('>=1.0 <2');
  });
});
