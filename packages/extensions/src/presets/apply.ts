/**
 * `applyPreset` — `15` §15.9: "applied atomically."
 *
 * @see specs/15 §15.9
 * @see PLAN-M2.md P7
 */
import { ForgeError, writeFileAtomic, type AbsolutePath, type ProjectPaths } from '@forge/core';
import fsp from 'node:fs/promises';

import { findPreset } from './eject.ts';
import { serializePresetFiles } from './serialize.ts';
import { validatePreset } from './validate.ts';
import type { AppliedPreset, PresetDefinition } from './types.ts';

/**
 * Writes `preset`'s files under `target`'s project root, refusing the *whole* preset — writing
 * nothing — if any one of its component overlays would fail validation on its own (`15` §15.9's own
 * atomicity requirement: not a partial write followed by a partial rollback, but nothing written at
 * all until every file is already known to be valid).
 *
 * `writeFileAtomic` only guarantees single-file atomicity (`@forge/core/fs`'s own temp-write +
 * fsync + rename), not a cross-file transaction — a multi-file preset (`enterprise-rigor`, `regulated`)
 * whose second or later file fails to write (a path escaping the project root, a permissions error)
 * would otherwise leave the earlier files it already wrote behind, silently breaking "applied
 * atomically" for exactly the presets most likely to have more than one file. Every successfully
 * written path is tracked and best-effort deleted if a later write in the same call fails, so a
 * failure never leaves a partial preset visible — the original error still propagates regardless of
 * whether cleanup itself succeeds.
 *
 * Exported separately from `applyPreset` (below) so the pre-write validation refusal is directly
 * testable against a hand-built, deliberately-broken `PresetDefinition` — every real `PRESET_REGISTRY`
 * entry always validates (enforced by its own test suite), which would otherwise make that refusal
 * branch unreachable through `applyPreset`'s own registry-id-only surface.
 *
 * @throws {ForgeError} `CFG-011` if `preset`'s own content fails validation.
 */
export async function applyPresetDefinition(
  preset: PresetDefinition,
  target: ProjectPaths,
): Promise<AppliedPreset> {
  const outcome = validatePreset(preset);
  if (!outcome.valid) {
    throw new ForgeError('CFG-011', {
      path: `preset:${preset.id}`,
      detail: `refuses to apply — ${String(outcome.findings.length)} of its own overlay(s) failed validation: ${outcome.findings.map((finding) => `${finding.path} (${finding.message})`).join('; ')}`,
    });
  }

  const files = serializePresetFiles(preset.files);
  const written: AbsolutePath[] = [];
  try {
    for (const file of files) {
      const resolved = target.resolveWithin(file.path);
      await writeFileAtomic(resolved, file.content);
      written.push(resolved);
    }
  } catch (cause) {
    // allSettled, not all: a cleanup failure (e.g. a permissions change mid-run) must never mask the
    // original write failure that triggered rollback in the first place.
    await Promise.allSettled(written.map((path) => fsp.rm(path, { force: true })));
    throw cause;
  }
  return { id: preset.id, files };
}

/**
 * Writes `id`'s registered preset files under `target`'s project root.
 *
 * @throws {ForgeError} `CFG-013` if `id` names no registered preset.
 * @throws {ForgeError} `CFG-011` if the preset's own content fails validation (should never happen
 * for a committed `PRESET_REGISTRY` entry — see `applyPresetDefinition`'s own doc comment for why the
 * check still runs).
 */
export async function applyPreset(id: string, target: ProjectPaths): Promise<AppliedPreset> {
  const preset = findPreset(id);
  if (preset === undefined) {
    throw new ForgeError('CFG-013', { id });
  }
  return applyPresetDefinition(preset, target);
}
