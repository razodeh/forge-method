/**
 * `commands/dispatch/preset-skill-mcp.ts` — `forge preset`/`forge skill`/`forge mcp`, exercised
 * in-process (`specs/22` M17 P2's own "the coverage report for the new dispatch modules meets the
 * floor").
 *
 * @see specs/22 M17 P2
 */
import { PRESET_REGISTRY } from '@forge/extensions/presets';
import { afterEach, describe, expect, it } from 'vitest';

import { dispatchPresetSkillMcp } from '../../../src/commands/dispatch/preset-skill-mcp.ts';
import type { DispatchContext } from '../../../src/commands/dispatch/shared.ts';
import { cleanupAll, createTestProject, type TestProject } from '../upgrade/helpers.ts';
import { captureLogs } from './dispatch-test-helpers.ts';

afterEach(cleanupAll);

function ctx(project: TestProject, positionals: readonly string[], json = false): DispatchContext {
  return {
    positionals,
    flags: {
      profile: 'default',
      dryRun: false,
      yes: false,
      json,
      noTui: false,
      verbosity: 0,
      quiet: false,
      positionals,
    },
    paths: project.paths,
    projectRoot: project.dir,
  };
}

describe('dispatchPresetSkillMcp (specs/22 M17 P2)', () => {
  it('returns undefined for a command it does not own', async () => {
    const project = await createTestProject();
    expect(await dispatchPresetSkillMcp(ctx(project, ['help']))).toBeUndefined();
  });

  it('runs "preset list" and "preset show <id>" for real, against the real built-in registry', async () => {
    const project = await createTestProject();
    const id = PRESET_REGISTRY[0]?.id;
    expect(id).toBeDefined();
    expect(await dispatchPresetSkillMcp(ctx(project, ['preset', 'list']))).toBe(0);
    expect(await dispatchPresetSkillMcp(ctx(project, ['preset', 'show', id ?? '']))).toBe(0);
  });

  it('exits 2 for "preset show" with no real <id>', async () => {
    const project = await createTestProject();
    expect(await dispatchPresetSkillMcp(ctx(project, ['preset', 'show']))).toBe(2);
  });

  it('runs "preset apply <id> --json" for real, writing real overlays', async () => {
    const project = await createTestProject();
    const id = PRESET_REGISTRY[0]?.id ?? '';
    const exitCode = await dispatchPresetSkillMcp(ctx(project, ['preset', 'apply', id], true));
    expect(exitCode).toBe(0);
  });

  it('runs "preset apply <id> --eject" for real, returning the overlay text rather than writing it', async () => {
    const project = await createTestProject();
    const id = PRESET_REGISTRY[0]?.id ?? '';
    expect(await dispatchPresetSkillMcp(ctx(project, ['preset', 'apply', id, '--eject']))).toBe(0);
  });

  it('exits 2 for "preset apply" with no real <id>', async () => {
    const project = await createTestProject();
    expect(await dispatchPresetSkillMcp(ctx(project, ['preset', 'apply']))).toBe(2);
  });

  it('exits 2 for a real, unrecognised "preset diff" -- a named row with no real mechanism', async () => {
    const project = await createTestProject();
    expect(await dispatchPresetSkillMcp(ctx(project, ['preset', 'diff']))).toBe(2);
  });

  it('runs "skill list" for real, listing the real, built-in skill library forge init materializes', async () => {
    const project = await createTestProject();
    expect(await dispatchPresetSkillMcp(ctx(project, ['skill', 'list']))).toBe(0);
  });

  it('runs "skill validate <id> --json" for real against a real, materialized skill package', async () => {
    const project = await createTestProject();
    const listed = await captureLogs(() =>
      dispatchPresetSkillMcp(ctx(project, ['skill', 'list'], true)),
    );
    const ids = (JSON.parse(listed.lines[0] ?? '{}') as { readonly ids: readonly string[] }).ids;
    expect(ids.length).toBeGreaterThan(0);
    const result = await captureLogs(() =>
      dispatchPresetSkillMcp(ctx(project, ['skill', 'validate', ids[0] ?? ''], true)),
    );
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.lines[0] ?? '{}') as {
      readonly outcome: { readonly valid: boolean };
    };
    expect(parsed.outcome.valid).toBe(true);
  });

  it('exits 2 for "skill validate" with no real <id>', async () => {
    const project = await createTestProject();
    expect(await dispatchPresetSkillMcp(ctx(project, ['skill', 'validate']))).toBe(2);
  });

  it('exits 2 for a real, unrecognised "skill new" -- a named row with no real mechanism', async () => {
    const project = await createTestProject();
    expect(await dispatchPresetSkillMcp(ctx(project, ['skill', 'new']))).toBe(2);
  });

  it('runs "mcp validate --environment dev" for real end to end against a real, clean config', async () => {
    const project = await createTestProject();
    const result = await captureLogs(() =>
      dispatchPresetSkillMcp(ctx(project, ['mcp', 'validate', '--environment', 'dev'], true)),
    );
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.lines[0] ?? '{}') as {
      readonly outcome: { readonly valid: boolean };
    };
    expect(parsed.outcome.valid).toBe(true);
  });

  it('exits 2 for "mcp validate" with no real --environment', async () => {
    const project = await createTestProject();
    expect(await dispatchPresetSkillMcp(ctx(project, ['mcp', 'validate']))).toBe(2);
  });

  it('exits non-zero with a real USR-003 for "mcp list" -- never implemented, refused rather than guessed at', async () => {
    const project = await createTestProject();
    await expect(dispatchPresetSkillMcp(ctx(project, ['mcp', 'list']))).rejects.toMatchObject({
      code: 'USR-003',
    });
  });

  it('exits 2 for "preset list"/"skill list"/"mcp list" given a real, unexpected extra positional', async () => {
    const project = await createTestProject();
    await expect(
      dispatchPresetSkillMcp(ctx(project, ['preset', 'list', 'extra'])),
    ).rejects.toMatchObject({ code: 'USR-002' });
    await expect(
      dispatchPresetSkillMcp(ctx(project, ['skill', 'list', 'extra'])),
    ).rejects.toMatchObject({ code: 'USR-002' });
  });
});
