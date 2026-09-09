/**
 * `forge preset <list|apply|eject>` — `03` §3.2.8, a thin wrapper over `@forge/extensions/presets`'
 * own already-built surface (M2).
 *
 * @see specs/03 §3.2.8
 */
import { ForgeError } from '@forge/core';
import type { ProjectPaths } from '@forge/core/fs';
import {
  applyPreset,
  ejectPreset,
  findPreset,
  PRESET_REGISTRY,
  type AppliedPreset,
  type OverlayFile,
  type PresetDefinition,
} from '@forge/extensions/presets';

export interface PresetCommandContext {
  readonly paths: ProjectPaths;
}

/** `list` — every real, registered preset. */
export function presetList(): readonly PresetDefinition[] {
  return PRESET_REGISTRY;
}

/** `show <id>` — one real, registered preset's own full definition. */
export function presetShow(id: string): PresetDefinition {
  const preset = findPreset(id);
  if (preset === undefined) {
    throw new ForgeError('CFG-013', { id });
  }
  return preset;
}

/** `apply <id>` — real, atomic overlay writes into the real project (`applyPreset`'s own real rollback
 * on partial failure). */
export async function presetApply(ctx: PresetCommandContext, id: string): Promise<AppliedPreset> {
  return applyPreset(id, ctx.paths);
}

/** `apply <id> --eject` — the real overlay YAML `applyPreset` would have written, returned as text
 * rather than written to disk, per `ejectPreset`'s own doc comment. */
export function presetEject(id: string): readonly OverlayFile[] {
  return ejectPreset(id);
}
