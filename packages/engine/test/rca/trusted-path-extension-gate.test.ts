/**
 * `createRcaShell` — `forge debug`'s real `runShell` (`packages/cli/src/commands/loop/debug.ts`) — is the ONE
 * caller `PLAN-M14.md` P24 deliberately turns `VetOptions.allowTrustedPathExtension` on for
 * (`confined-command.ts`, `test-path.ts`'s `<trusted> <path> [-t/-g/-k <token>]` extension, built gated-off by
 * P5). Before P24, this file pinned the OPPOSITE fact (`createRcaShell` forwarded nothing beyond
 * `trustedCommands`, so the shape was refused exactly as before `test-path.ts` existed) — that gate is now
 * deliberately open, read directly from `rca/shell.ts`'s own current source, not assumed: `createRcaShell`
 * itself sets `allowTrustedPathExtension: true` and forwards `options.testRoots` on every proposed-command vet.
 * This file now pins the opened gate is exactly as narrow as `PLAN-M14.md` P24's own mandate: a proposal only
 * runs when it is one of `trustedCommands`, verbatim, plus one real, validated test path (or the extra word is
 * refused as `test-path`, never silently treated as `not-in-grant` the way an unrelated extra word still is) —
 * never a wider grant for anything else.
 *
 * @see SPEC-QUESTIONS.md Q230
 * @see PLAN-M14.md P5
 * @see PLAN-M14.md P24
 */
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createRcaShell } from '../../src/rca/shell.ts';

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function lane(): Promise<string> {
  const dir = await realpath(await mkdtemp(path.join(tmpdir(), 'forge-rca-gate-')));
  dirs.push(dir);
  return dir;
}

describe('createRcaShell: PLAN-M14.md P24 deliberately opens the <trusted> <path> extension, narrowly', () => {
  it('a real, existing test file appended to a configured trusted command now runs — the extension P5 gated off is live for the RCA loop specifically', async () => {
    const root = await lane();
    await mkdir(path.join(root, 'tests'));
    await writeFile(path.join(root, 'tests', 'x.test.ts'), '');
    // The identical shape debug.ts builds: an agent grant with no exec pattern of its own that covers the
    // configured command, plus trustedCommands from execution.testCommands — no `not-in-grant` refusal is
    // possible for this proposal through the ordinary grant check alone.
    const runShell = createRcaShell({
      grant: { exec: [], network: 'none' },
      trustedCommands: ['true'],
      root,
      parentEnv: process.env,
    });
    const result = await runShell('true tests/x.test.ts', root, 'proposed');
    expect(result.refusal).toBeUndefined();
    expect(result.exitCode).toBe(0);
  });

  it('a path outside the configured execution.testRoots is refused as test-path, not silently accepted — testRoots really reaches the vet', async () => {
    const root = await lane();
    await mkdir(path.join(root, 'tests'));
    await writeFile(path.join(root, 'tests', 'x.test.ts'), '');
    // Matches the built-in isTestPath fallback by name, but sits OUTSIDE the one configured root: only
    // narrowing by testRoots (not the unconfigured fallback) can refuse this.
    await writeFile(path.join(root, 'outside.test.ts'), '');
    const runShell = createRcaShell({
      grant: { exec: [], network: 'none' },
      trustedCommands: ['true'],
      root,
      testRoots: ['tests'],
      parentEnv: process.env,
    });
    const inside = await runShell('true tests/x.test.ts', root, 'proposed');
    expect(inside.refusal).toBeUndefined();
    expect(inside.exitCode).toBe(0);

    const outside = await runShell('true outside.test.ts', root, 'proposed');
    expect(outside.refusal).toMatchObject({ code: 'RUN-095', reason: 'test-path' });
    expect(outside.exitCode).toBe(126);
  });

  it('an extra word that is not a real, validated test path is refused as test-path (never silently widened to any file argument)', async () => {
    const root = await lane();
    const runShell = createRcaShell({
      grant: { exec: [], network: 'none' },
      trustedCommands: ['true'],
      root,
      parentEnv: process.env,
    });
    const result = await runShell('true ../escape.test.ts', root, 'proposed');
    expect(result.refusal).toMatchObject({ code: 'RUN-095', reason: 'test-path' });
    expect(result.exitCode).toBe(126);
  });

  it('a proposal that is not one of trustedCommands at all still gets the ordinary not-in-grant refusal, unaffected by the extension being open', async () => {
    const root = await lane();
    const runShell = createRcaShell({
      grant: { exec: [], network: 'none' },
      trustedCommands: ['true'],
      root,
      parentEnv: process.env,
    });
    const result = await runShell('false', root, 'proposed');
    expect(result.refusal).toMatchObject({ code: 'RUN-095', reason: 'not-in-grant' });
  });

  it('the bare configured command (no path suffix) still runs, unaffected — the real shape debug.ts builds via grantWithTestExec, where the derived pattern is in BOTH grant.exec and trustedCommands', async () => {
    const root = await lane();
    const runShell = createRcaShell({
      grant: { exec: ['true'], network: 'none' },
      trustedCommands: ['true'],
      root,
      parentEnv: process.env,
    });
    const result = await runShell('true', root, 'proposed');
    expect(result.exitCode).toBe(0);
    expect(result.refusal).toBeUndefined();
  });
});
