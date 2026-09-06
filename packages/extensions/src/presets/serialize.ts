/**
 * `serializePresetFiles` — the one place a preset's plain-object file `data` becomes YAML text.
 *
 * Both `applyPreset` and `ejectPreset` call this same function rather than each calling
 * `YAML.stringify` independently, so the files `applyPreset` writes to disk and the files
 * `ejectPreset` returns can never drift from each other by construction — the mechanical
 * precondition `AC15-8`'s round-trip property depends on (`SPEC-QUESTIONS.md` Q39).
 *
 * @see PLAN-M2.md P7
 * @see SPEC-QUESTIONS.md Q39
 */
import * as YAML from 'yaml';

import type { OverlayFile, PresetOverlayFile } from './types.ts';

export function serializePresetFiles(files: readonly PresetOverlayFile[]): readonly OverlayFile[] {
  return files.map((file) => ({ path: file.path, content: YAML.stringify(file.data) }));
}
