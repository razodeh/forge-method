/**
 * `@forge/extensions/presets` — signed, atomically-applied bundles, per `15` §15.9.
 *
 * @see specs/15 §15.9
 * @see PLAN-M2.md P7
 */
export { applyPreset, applyPresetDefinition } from './apply.ts';
export { ejectPreset, findPreset } from './eject.ts';
export { PRESET_REGISTRY } from './registry.ts';
export { KIND_SCHEMAS, presetSchema, type PresetSchema } from './schema.ts';
export {
  type AppliedPreset,
  type OverlayFile,
  type PresetDefinition,
  type PresetFindingSeverity,
  type PresetOverlayFile,
  type PresetOverlayKind,
  type PresetValidationFinding,
  type PresetValidationOutcome,
} from './types.ts';
export { validatePreset } from './validate.ts';
