/**
 * `ejectPreset`, `findPreset` — `15` §15.9: "fully expandable into visible overlay files."
 *
 * @see specs/15 §15.9
 * @see PLAN-M2.md P7
 */
import { isForgeError } from '@forge/core';
import * as YAML from 'yaml';
import { describe, expect, it } from 'vitest';

import { ejectPreset, findPreset } from '../../src/presets/eject.ts';
import { PRESET_REGISTRY } from '../../src/presets/registry.ts';

describe('findPreset', () => {
  it('returns the matching registry entry', () => {
    expect(findPreset('solo-fast')?.id).toBe('solo-fast');
  });

  it('returns undefined for an unknown id', () => {
    expect(findPreset('does-not-exist')).toBeUndefined();
  });
});

describe('ejectPreset', () => {
  it('returns one OverlayFile per preset file, same paths, in order', () => {
    const preset = PRESET_REGISTRY.find((entry) => entry.id === 'enterprise-rigor');
    const files = ejectPreset('enterprise-rigor');
    expect(files.map((file) => file.path)).toEqual(preset?.files.map((file) => file.path));
  });

  it("serializes each file's data as parseable YAML round-tripping to the same plain object", () => {
    const preset = PRESET_REGISTRY.find((entry) => entry.id === 'solo-fast');
    const files = ejectPreset('solo-fast');
    for (const [i, file] of files.entries()) {
      expect(YAML.parse(file.content)).toEqual(preset?.files[i]?.data);
    }
  });

  it('throws CFG-013 for an unknown preset id', () => {
    try {
      ejectPreset('does-not-exist');
      expect.unreachable('ejectPreset should have thrown');
    } catch (error) {
      expect(isForgeError(error)).toBe(true);
      if (isForgeError(error)) {
        expect(error.code).toBe('CFG-013');
        expect(error.remedy.length).toBeGreaterThan(0);
      }
    }
  });

  it('ejects every registered preset without throwing', () => {
    for (const preset of PRESET_REGISTRY) {
      expect(() => ejectPreset(preset.id)).not.toThrow();
    }
  });
});
