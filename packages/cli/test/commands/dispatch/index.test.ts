/**
 * `commands/dispatch/index.ts` — `main()`, the real `forge` argv dispatcher `bin.ts` now imports
 * and awaits, exercised in-process by manipulating `process.argv` directly (the one real, documented
 * exception to injecting ambient facts as parameters: `main()` IS the composition root that reads
 * `process.argv` for real, the identical role `bin.ts` itself held before this piece moved the real
 * dispatch chain out of it). `specs/22` M17 P2's own "the coverage report for the new dispatch
 * modules meets the floor" — this proves the real chain-of-responsibility assembly (`DISPATCHERS`,
 * the `--version`/`init` special cases, the final "not wired" fallback) end to end, in-process.
 *
 * @see specs/22 M17 P2
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { DEFAULT_CONFIG } from '@forge/schemas/config';
import * as YAML from 'yaml';
import { afterEach, describe, expect, it } from 'vitest';

import { main } from '../../../src/commands/dispatch/index.ts';
import { captureLogs } from './dispatch-test-helpers.ts';

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function configuredProject(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'forge-dispatch-index-'));
  dirs.push(dir);
  await mkdir(path.join(dir, '.forge'), { recursive: true });
  await writeFile(path.join(dir, '.forge/config.yaml'), YAML.stringify(DEFAULT_CONFIG));
  return dir;
}

/** Runs `main()` with a real, temporarily-replaced `process.argv`, always restored. */
async function runMain(args: readonly string[]): Promise<number> {
  const original = process.argv;
  process.argv = [original[0] ?? 'node', original[1] ?? 'forge', ...args];
  try {
    return await main();
  } finally {
    process.argv = original;
  }
}

describe('main() — the real dispatch chain assembly (specs/22 M17 P2)', () => {
  it('prints the real, installed version for "--version", with no project needed', async () => {
    const result = await captureLogs(() => runMain(['--version']));
    expect(result.exitCode).toBe(0);
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0]).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('rejects a stray extra positional after "--version", like every other zero-positional command', async () => {
    await expect(runMain(['--version', 'extra'])).rejects.toMatchObject({ code: 'USR-002' });
  });

  it('dispatches "status" through the real chain-of-responsibility to its real owner, dispatchLifecycle', async () => {
    const dir = await configuredProject();
    await expect(runMain(['status', '-C', dir, '--json'])).rejects.toMatchObject({
      code: 'RUN-048',
    });
  });

  it('dispatches "spec list" through the real chain to its real owner, dispatchSpec', async () => {
    const dir = await configuredProject();
    const exitCode = await runMain(['spec', 'list', '-C', dir]);
    expect(exitCode).toBe(0);
  });

  it('falls through every real dispatcher to the final "not wired" message for a bogus command', async () => {
    const dir = await configuredProject();
    const exitCode = await runMain(['totally-bogus-command', '-C', dir]);
    expect(exitCode).toBe(2);
  });

  it('falls through to "not wired" for a real, named, but genuinely never-wired subcommand', async () => {
    const dir = await configuredProject();
    // `agent list`/`workflow show` etc. (beyond `validate --all`) are real, disclosed, still-unwired
    // rows (`bin.ts`'s own original top doc comment) -- never silently handled by any area.
    const exitCode = await runMain(['agent', 'list', '-C', dir]);
    expect(exitCode).toBe(2);
  });
});
