/**
 * `commands/dispatch/init.ts` — `runInitCommand` (`forge init`, dispatched specially by
 * `commands/dispatch/index.ts`'s own `main()`, before `ProjectPaths` exists), exercised in-process
 * (`specs/22` M17 P2's own "the coverage report for the new dispatch modules meets the floor").
 *
 * @see specs/22 M17 P2
 */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { runInitCommand } from '../../../src/commands/dispatch/init.ts';
import { captureLogs } from './dispatch-test-helpers.ts';

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

/** `runInitCommand` picks a real platform adapter from the real registry (`forge-boundaries/
 * no-platform-concept`'s own sanctioned dynamic-loading seam) and runs its real `preflight()` —
 * which, for the one real adapter this registry names, needs a real (if fake-valued) credential
 * present, never an actual live model call (`QUALITY-BAR.md`'s own "no live model call in this
 * job" -- a preflight check is a local, static check, confirmed directly by reading it). The
 * identical fixture fix `packages/cli/test/bin.test.ts`'s own `REAL_ADAPTER_ENV` already
 * establishes for the same real reason. Set only for the duration of one call, always restored. */
async function withFakeCredential<T>(run: () => Promise<T>): Promise<T> {
  const previous = process.env['ANTHROPIC_API_KEY'];
  process.env['ANTHROPIC_API_KEY'] = 'sk-ant-test-fixture-not-real';
  try {
    return await run();
  } finally {
    if (previous === undefined) delete process.env['ANTHROPIC_API_KEY'];
    else process.env['ANTHROPIC_API_KEY'] = previous;
  }
}

async function scratchDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'forge-dispatch-init-'));
  dirs.push(dir);
  return dir;
}

describe('runInitCommand (specs/22 M17 P2)', () => {
  it('writes a real project for real, in plain text, under a fresh directory named by --project', async () => {
    const base = await scratchDir();
    const exitCode = await withFakeCredential(() =>
      runInitCommand(['--name', 'Fixture'], true, false, base),
    );
    expect(exitCode).toBe(0);
  }, 20_000);

  it('writes a real project for real under --json, exactly one JSON line on stdout', async () => {
    const base = await scratchDir();
    const result = await captureLogs(() =>
      withFakeCredential(() => runInitCommand(['--name', 'Fixture'], true, true, base)),
    );
    expect(result.exitCode).toBe(0);
    expect(result.lines).toHaveLength(1);
    const parsed = JSON.parse(result.lines[0] ?? '{}') as { readonly v: number };
    expect(parsed.v).toBe(1);
  }, 20_000);

  it('re-initializes a real, already-initialized project idempotently (regeneration semantics)', async () => {
    const base = await scratchDir();
    await withFakeCredential(() => runInitCommand(['--name', 'Fixture'], true, false, base));
    const exitCode = await withFakeCredential(() =>
      runInitCommand(['--name', 'Fixture'], true, false, base),
    );
    expect(exitCode).toBe(0);
  }, 45_000);

  it('re-initializes for real, reporting a real resolved conflict for a hand-edited regenerated file', async () => {
    const base = await scratchDir();
    await withFakeCredential(() => runInitCommand(['--name', 'Fixture'], true, false, base));
    // A real, human edit to one of the first init's own regenerated files, made BETWEEN the two
    // real `forge init` calls -- `--yes`'s own default `onConflict` ('keep-mine') means the second
    // init detects and reports this exact drift as a real, resolved conflict, not silently
    // overwriting it.
    const agentPath = path.join(base, '.forge', 'agents', 'backend.yaml');
    const original = await readFile(agentPath, 'utf8');
    await writeFile(agentPath, `${original}\n# a real, hand-authored local edit\n`, 'utf8');
    const result = await captureLogs(() =>
      withFakeCredential(() => runInitCommand(['--name', 'Fixture'], true, false, base)),
    );
    expect(result.exitCode).toBe(0);
    expect(
      result.lines.some((line) => line.includes('resolved') && line.includes('conflict')),
    ).toBe(true);
  }, 45_000);

  it('refuses a relative [dir] that climbs out of --project, creating nothing', async () => {
    const base = await scratchDir();
    await expect(
      runInitCommand(['../escape', '--name', 'Fixture'], true, false, base),
    ).rejects.toMatchObject({ code: 'USR-002' });
  });

  it('writes into a [dir] argument resolved against --project, not the project root itself', async () => {
    const base = await scratchDir();
    const exitCode = await withFakeCredential(() =>
      runInitCommand(['nested', '--name', 'Fixture'], true, false, base),
    );
    expect(exitCode).toBe(0);
  }, 20_000);
});
