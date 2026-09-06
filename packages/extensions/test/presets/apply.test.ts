/**
 * `applyPreset` — `15` §15.9: "applied atomically," and the mechanical precondition behind
 * `AC15-8`'s round trip (`SPEC-QUESTIONS.md` Q39): `applyPreset`'s writes and `ejectPreset`'s own
 * output must agree on exactly what a preset is.
 *
 * @see specs/15 §15.9
 * @see PLAN-M2.md P7
 * @see SPEC-QUESTIONS.md Q39
 */
import { ProjectPaths, isForgeError, readTextFile } from '@forge/core';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { applyPreset, applyPresetDefinition } from '../../src/presets/apply.ts';
import { ejectPreset } from '../../src/presets/eject.ts';
import { PRESET_REGISTRY } from '../../src/presets/registry.ts';
import { validatePreset } from '../../src/presets/validate.ts';
import type { PresetDefinition } from '../../src/presets/types.ts';

let projectRoot: string | undefined;
let extraCleanupDir: string | undefined;

function freshProject(): { root: string; paths: ProjectPaths } {
  const root = mkdtempSync(path.join(tmpdir(), 'forge-presets-'));
  projectRoot = root;
  return { root, paths: new ProjectPaths(root) };
}

afterEach(() => {
  if (projectRoot !== undefined) rmSync(projectRoot, { recursive: true, force: true });
  projectRoot = undefined;
  if (extraCleanupDir !== undefined) rmSync(extraCleanupDir, { recursive: true, force: true });
  extraCleanupDir = undefined;
});

describe('applyPreset', () => {
  it("writes every file at its declared path, with content identical to ejectPreset's own output", async () => {
    const { paths } = freshProject();
    const applied = await applyPreset('enterprise-rigor', paths);
    const ejected = ejectPreset('enterprise-rigor');

    expect(applied.files).toEqual(ejected);

    for (const file of ejected) {
      const onDisk = await readTextFile(paths.resolveWithin(file.path));
      expect(onDisk).toBe(file.content);
    }
  });

  it('applies every registered preset without throwing, each writing at least one file', async () => {
    for (const preset of PRESET_REGISTRY) {
      const { paths } = freshProject();
      const applied = await applyPreset(preset.id, paths);
      expect(applied.id).toBe(preset.id);
      expect(applied.files.length).toBeGreaterThan(0);
    }
  });

  it('throws CFG-013 for an unknown preset id, writing nothing', async () => {
    const { paths } = freshProject();
    try {
      await applyPreset('does-not-exist', paths);
      expect.unreachable('applyPreset should have thrown');
    } catch (error) {
      expect(isForgeError(error)).toBe(true);
      if (isForgeError(error)) expect(error.code).toBe('CFG-013');
    }
  });

  it('refuses the whole preset — writing nothing — when one of its files fails validation', async () => {
    const { paths } = freshProject();
    const broken: PresetDefinition = {
      id: 'fixture-atomic',
      posture: 'A fixture preset with one invalid file, to prove atomicity.',
      files: [
        { path: 'valid.agent.yaml', kind: 'agentOverlay', data: { model: { tier: 'frugal' } } },
        { path: 'invalid.agent.yaml', kind: 'agentOverlay', data: { gates: ['G-Design'] } },
      ],
    };
    expect(validatePreset(broken).valid).toBe(false);

    // Every real PRESET_REGISTRY entry always validates (registry.test.ts), which would otherwise
    // make this refusal branch unreachable through applyPreset's own registry-id-only surface —
    // applyPresetDefinition exists specifically so this atomicity guarantee is directly testable.
    await expect(applyPresetDefinition(broken, paths)).rejects.toThrow();

    // Neither file should exist on disk — not even the one that would have validated on its own.
    await expect(readTextFile(paths.resolveWithin('valid.agent.yaml'))).rejects.toThrow();
    await expect(readTextFile(paths.resolveWithin('invalid.agent.yaml'))).rejects.toThrow();
  });

  it('applyPresetDefinition is a real ForgeError (CFG-011) with an actionable remedy', async () => {
    const { paths } = freshProject();
    const broken: PresetDefinition = {
      id: 'fixture-atomic-2',
      posture: 'A fixture preset with one invalid file.',
      files: [{ path: 'invalid.agent.yaml', kind: 'agentOverlay', data: { gates: ['G-Design'] } }],
    };
    try {
      await applyPresetDefinition(broken, paths);
      expect.unreachable('applyPresetDefinition should have thrown');
    } catch (error) {
      expect(isForgeError(error)).toBe(true);
      if (isForgeError(error)) {
        expect(error.code).toBe('CFG-011');
        expect(error.remedy.length).toBeGreaterThan(0);
      }
    }
  });

  it('rolls back an already-written file when a later file in the same preset fails to write', async () => {
    const { root, paths } = freshProject();
    const outside = mkdtempSync(path.join(tmpdir(), 'forge-presets-outside-'));
    extraCleanupDir = outside;

    // A directory inside the project root that is actually a symlink to somewhere outside it:
    // resolveWithin refuses any path traversing through it (a symlink escaping realBase), simulating
    // a write failure partway through a multi-file preset without needing to mock the filesystem.
    mkdirSync(path.join(root, 'escaping-parent'));
    symlinkSync(outside, path.join(root, 'escaping-parent', 'escape'));

    const twoFile: PresetDefinition = {
      id: 'fixture-rollback',
      posture: 'A fixture preset whose second file fails to write, to prove rollback.',
      files: [
        { path: 'first.agent.yaml', kind: 'agentOverlay', data: { model: { tier: 'frugal' } } },
        {
          path: 'escaping-parent/escape/second.agent.yaml',
          kind: 'agentOverlay',
          data: { model: { tier: 'frugal' } },
        },
      ],
    };
    expect(validatePreset(twoFile).valid).toBe(true);

    await expect(applyPresetDefinition(twoFile, paths)).rejects.toThrow();

    // The first file, successfully written before the second file's write failed, must not survive —
    // otherwise "applied atomically" would be broken for every multi-file preset.
    await expect(readTextFile(paths.resolveWithin('first.agent.yaml'))).rejects.toThrow();
  });
});
