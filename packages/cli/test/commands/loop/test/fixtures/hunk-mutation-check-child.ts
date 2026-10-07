/**
 * Fixture process for `hunk-mutation-sigkill.test.ts`'s own `specs/22` M16 P12 "Tests first" proof:
 * SIGKILL mid-mutation (change-level OR hunk-level) leaves no worktree and no half-reverted tree,
 * exactly as M15's own `binding-check-child.ts` already proves for `runBindingCheck` alone. Runs one
 * real `runHunkMutationCheck` call against a real, pre-built fixture repo and prints
 * `STARTED`/`DONE`/`ERROR <message>` so the parent test can confirm the child genuinely reached a
 * running state before it is `SIGKILL`'d — never a guessed, un-confirmed wall-clock window.
 *
 * Run via `node --experimental-strip-types` (this repository has no build step), the identical
 * pattern `binding-check-child.ts` already establishes.
 *
 * @see specs/13 F-TEST-10
 * @see specs/22 M15 P3
 * @see specs/22 M16 P12
 */
import { runHunkMutationCheck } from '../../../../../src/commands/loop/test/hunk-mutation.ts';

const [, , projectRoot, runId, storyId, baseRevision, testCommand] = process.argv;
if (
  projectRoot === undefined ||
  runId === undefined ||
  storyId === undefined ||
  baseRevision === undefined ||
  testCommand === undefined
) {
  throw new Error(
    'usage: hunk-mutation-check-child.ts <projectRoot> <runId> <storyId> <baseRevision> <testCommand>',
  );
}

process.stdout.write('STARTED\n');

try {
  await runHunkMutationCheck(
    {
      projectRoot,
      runId,
      storyId,
      filesExpected: ['impl.js', 'impl.test.js'],
      testCommand,
      ecosystem: 'js',
      integrationBase: 'HEAD',
      baseRevision,
      clock: { now: () => '2026-09-30T12:00:00.000Z' },
      createTempPath: () => {
        throw new Error('createTempPath should not be called by the js/vitest branch');
      },
    },
    { maxHunks: 25 },
  );
  process.stdout.write('DONE\n');
} catch (error) {
  process.stderr.write(`${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
  process.exitCode = 1;
}
