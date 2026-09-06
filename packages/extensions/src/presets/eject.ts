/**
 * `ejectPreset` — `15` §15.9: "fully expandable into visible overlay files ... so nothing stays
 * magic."
 *
 * @see specs/15 §15.9
 * @see PLAN-M2.md P7
 */
import { ForgeError } from '@forge/core';

import { PRESET_REGISTRY } from './registry.ts';
import { serializePresetFiles } from './serialize.ts';
import type { OverlayFile, PresetDefinition } from './types.ts';

/** `PRESET_REGISTRY`'s own entry for `id`, or `undefined` if `id` names no registered preset. */
export function findPreset(id: string): PresetDefinition | undefined {
  return PRESET_REGISTRY.find((preset) => preset.id === id);
}

/**
 * `preset.id`'s files as plain YAML text — exactly what `applyPreset` writes to disk, returned
 * instead of written, per `forge preset apply <id> --eject`.
 *
 * @throws {ForgeError} `CFG-013` if `id` names no registered preset — `id` is real, user-typed
 * boundary input (`forge preset apply <id>`), not an internal invariant.
 */
export function ejectPreset(id: string): readonly OverlayFile[] {
  const preset = findPreset(id);
  if (preset === undefined) {
    throw new ForgeError('CFG-013', { id });
  }
  return serializePresetFiles(preset.files);
}
