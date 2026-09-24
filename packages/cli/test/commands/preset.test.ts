/**
 * `forge preset <list|show|apply|eject>` — thin wrappers over `@forge/extensions/presets`.
 */
import { afterEach, describe, expect, it } from 'vitest';

import { loadGateRegistry } from '../../src/commands/run/gates.ts';
import { presetApply, presetEject, presetList, presetShow } from '../../src/commands/preset.ts';
import { cleanupAll, createTestProject } from './upgrade/helpers.ts';

afterEach(cleanupAll);

describe('presetList / presetShow', () => {
  it('lists every real, registered preset', () => {
    const presets = presetList();
    expect(presets.some((preset) => preset.id === 'solo-fast')).toBe(true);
  });

  it('shows one real, registered preset by id', () => {
    const preset = presetShow('startup-lean');
    expect(preset.id).toBe('startup-lean');
  });

  it('throws CFG-013 for an id that is not really registered', () => {
    expect(() => presetShow('not-a-real-preset')).toThrow(
      expect.objectContaining({ code: 'CFG-013' }),
    );
  });
});

describe('presetApply', () => {
  it('writes real overlay files into a real project', async () => {
    const project = await createTestProject();
    const applied = await presetApply({ paths: project.paths }, 'solo-fast');
    expect(applied.files.length).toBeGreaterThan(0);
  });

  // `PLAN-M14.md` P20: `*.check.yaml` files attach to gates through `appliesTo` — the `regulated` preset's
  // own `regulated-compliance-matrix.check.yaml` (`extensions/src/presets/registry.ts`) already declares
  // `appliesTo: { gates: ['G-Design'] }`, so it should genuinely attach the moment it is applied, with no
  // change needed to the preset itself.
  it("the regulated preset's own compliance-matrix check attaches to G-Design through appliesTo", async () => {
    const project = await createTestProject();
    await presetApply({ paths: project.paths }, 'regulated');
    const registry = await loadGateRegistry(project.paths, '.forge/checks');
    const design = registry.get('G-Design');
    const attached = design?.checks.deterministic.find(
      (check) => check.id === 'regulated:compliance-matrix',
    );
    expect(attached).toMatchObject({
      id: 'regulated:compliance-matrix',
      source: 'overrides/checks/regulated-compliance-matrix.check.yaml',
    });
  });
});

describe('presetEject', () => {
  it('returns the real overlay YAML a real apply would have written, without writing anything', () => {
    const files = presetEject('solo-fast');
    expect(files.length).toBeGreaterThan(0);
  });
});
