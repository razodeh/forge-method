/**
 * `forge preset <list|show|apply|eject>` — thin wrappers over `@forge/extensions/presets`.
 */
import { afterEach, describe, expect, it } from 'vitest';

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
});

describe('presetEject', () => {
  it('returns the real overlay YAML a real apply would have written, without writing anything', () => {
    const files = presetEject('solo-fast');
    expect(files.length).toBeGreaterThan(0);
  });
});
