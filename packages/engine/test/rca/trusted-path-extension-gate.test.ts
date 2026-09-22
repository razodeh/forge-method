/**
 * `createRcaShell` — `forge debug`'s real, unmodified `runShell` (`packages/cli/src/commands/loop/debug.ts`,
 * `runnable = fixGrant.exec === false ? [] : reproduceExec.patterns` passed as `trustedCommands`, since P23) —
 * is unaffected by `PLAN-M14.md` P5's `<trusted> <path> [-t <token>]` extension (`test-path.ts`,
 * `confined-command.ts`'s `vetProposedCommand`).
 *
 * `debug.ts` calls `createRcaShell({ grant, trustedCommands, root, parentEnv, onRefused })` — it never passes
 * `allowTrustedPathExtension` (`confined-command.ts`'s new `VetOptions` field, unset by every existing caller),
 * and `createRcaShell` itself forwards nothing beyond `trustedCommands` into `vetProposedCommand`'s options
 * (read directly from `rca/shell.ts`'s source, not assumed). So a REPRODUCE/PROVE proposal that adds a file
 * argument to one of the project's own configured test commands — exactly the shape this piece's validator
 * exists to accept once a caller opts in — must still be refused through the real, unmodified `createRcaShell`,
 * the same way it always was before `test-path.ts` existed. This file exercises that through the real function,
 * not a stub, so this piece's own claim ("the validator only, nothing consumes it yet") is a tested fact about
 * the real RCA-loop entry point, not just an assertion in a doc comment.
 *
 * @see SPEC-QUESTIONS.md Q230
 * @see PLAN-M14.md P5
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

describe('createRcaShell: the debug.ts call shape (trustedCommands, no new opt-in) never accepts the <path> extension', () => {
  it('a real, existing test file appended to a configured trusted command is still not-in-grant, exactly as before this piece', async () => {
    const root = await lane();
    await mkdir(path.join(root, 'tests'));
    await writeFile(path.join(root, 'tests', 'x.test.ts'), '');
    // The identical shape debug.ts builds: an agent grant with no exec pattern of its own that covers the
    // configured command, plus trustedCommands from execution.testCommands — no allowTrustedPathExtension,
    // because debug.ts (unmodified by this piece) does not know that option exists.
    const runShell = createRcaShell({
      grant: { exec: [], network: 'none' },
      trustedCommands: ['pnpm vitest run'],
      root,
      parentEnv: process.env,
    });
    const result = await runShell('pnpm vitest run tests/x.test.ts', root, 'proposed');
    expect(result.exitCode).toBe(126);
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
