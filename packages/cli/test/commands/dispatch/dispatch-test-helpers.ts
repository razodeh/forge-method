/**
 * Shared test setup for `commands/dispatch/*.test.ts` (`specs/22` M17 P2) — on top of
 * `../helpers.ts`'s own real temp project, a FAST, minimal, schema-valid `.forge/config.yaml`
 * (`DEFAULT_CONFIG` serialized verbatim) for the many dispatch commands whose own `buildXContext`
 * calls `readConfig` unconditionally, even ahead of a usage check (`kb`'s own `runKbCommand` is one
 * real example, confirmed by reading it directly). This is deliberately NOT the real, much slower
 * `forge init`-produced project `packages/cli/test/commands/upgrade/helpers.ts` builds (git repo,
 * materialized workflows/agents/skills) — most dispatch commands need only a real, parseable config
 * file to get past `readConfig`, not a fully bootstrapped project; a handful that do need more
 * (`preset`/`skill`/`mcp`, `doctor`, `upgrade`) import that heavier helper directly instead.
 *
 * @see specs/22 M17 P2
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { DEFAULT_CONFIG } from '@forge/schemas/config';
import * as YAML from 'yaml';
import { vi } from 'vitest';

import { createTestProject as createBareProject, type TestProject } from '../helpers.ts';

export {
  cleanupAll,
  registerCleanup,
  KB_ROOT,
  SPECS_ROOT,
  REPORTS_ROOT,
  type TestProject,
} from '../helpers.ts';

/** `../helpers.ts`'s own bare project, plus a real, schema-valid `.forge/config.yaml` written
 * directly (never through a real `runInit`, which this file's own doc comment explains is overkill
 * for most dispatch commands' own real needs). */
export async function createConfiguredProject(): Promise<TestProject> {
  const project = await createBareProject();
  await mkdir(path.join(project.dir, '.forge'), { recursive: true });
  await writeFile(
    path.join(project.dir, '.forge', 'config.yaml'),
    YAML.stringify(DEFAULT_CONFIG),
    'utf8',
  );
  return project;
}

/** Captures every `console.log` line a real dispatch call makes, restoring the real one
 * unconditionally. `vi.spyOn` (never a direct `console.log = ...` reassignment) — the identical
 * lint-clean pattern `packages/kb/test/db/open.test.ts`'s own `vi.spyOn(console, 'warn')` already
 * establishes for intercepting a real console call under test, rather than this file inventing a
 * second way to do the same thing. */
export async function captureLogs(run: () => Promise<number | undefined>): Promise<{
  readonly exitCode: number | undefined;
  readonly lines: readonly string[];
}> {
  const spy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  try {
    const exitCode = await run();
    return { exitCode, lines: spy.mock.calls.map((call) => String(call[0])) };
  } finally {
    spy.mockRestore();
  }
}
