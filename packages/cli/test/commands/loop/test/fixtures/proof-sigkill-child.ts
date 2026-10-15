/**
 * Fixture process for `proof-sigkill.test.ts`'s own real `SIGKILL` proof: a kill between
 * `runTranslatorProof` writing its own probe and reaching its `finally` leaves that probe (and its
 * crash-recovery lock) behind on disk, reclaimed by the NEXT invocation rather than left there
 * forever. Prints `STARTED` as soon as the process is alive, before calling `runTranslatorProof` at
 * all, so the parent test can confirm the child genuinely began before it is `SIGKILL`'d — never a
 * guessed, un-confirmed wall-clock window.
 *
 * Run via `node --experimental-strip-types` (this repository has no build step), the identical
 * pattern `binding-check-child.ts`/`hunk-mutation-check-child.ts` already establish for the identical
 * real-process-kill need.
 *
 * @see specs/22 M17 P6
 */
import { ProjectPaths } from '@forge/core/fs';

import { runTranslatorProof } from '../../../../../src/commands/loop/test/proof.ts';

const [, , projectRoot, probeRelPath] = process.argv;
if (projectRoot === undefined || probeRelPath === undefined) {
  throw new Error('usage: proof-sigkill-child.ts <projectRoot> <probeRelPath>');
}

process.stdout.write('STARTED\n');

try {
  await runTranslatorProof({
    // `runTranslatorProof` runs this SAME command for a pre-probe baseline FIRST, before it ever
    // writes its own probe or lock -- so this cannot be unconditionally slow (the parent test's own
    // kill delay would then land during the fast, harmless baseline call instead of the real run it
    // is meant to interrupt). A real marker file tells the two invocations apart: the first (the
    // baseline) writes it and returns immediately; every one after (the real run, once the probe and
    // lock already exist) sleeps, long enough that the parent's short, fixed kill delay always lands
    // well inside it.
    command: {
      run:
        `${process.execPath} -e "` +
        `const fs=require('fs'); ` +
        `if (fs.existsSync('ran-once.marker')) { setTimeout(() => {}, 5000); } ` +
        `else { fs.writeFileSync('ran-once.marker', ''); }"`,
      output: { source: 'stdout' },
      format: 'tap',
    },
    cwd: projectRoot,
    paths: new ProjectPaths(projectRoot),
    createTempPath: () => `${projectRoot}/tmp-output.raw`,
    probe: {
      path: probeRelPath,
      content: '// a real probe file for the sigkill fixture -- its own content is irrelevant\n',
      expectedName: 'irrelevant',
    },
    runnerVersion: '1.0.0',
    now: () => new Date(0).toISOString(),
  });
  process.stdout.write('DONE\n');
} catch (error) {
  process.stdout.write(`ERROR ${error instanceof Error ? error.message : String(error)}\n`);
}
