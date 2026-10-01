/**
 * Fixture process for `binding-sigkill.test.ts`'s own `PLAN-M15.md` P3 "Tests first" proof: "SIGKILL
 * mid-mutation leaves no worktree and no half-reverted tree." Runs one real `runBindingCheck` call
 * against a real, pre-built fixture repo and prints `STARTED`/`DONE`/`ERROR <message>` so the parent
 * test can confirm the child genuinely reached a running state before it is `SIGKILL`'d — never a
 * guessed, un-confirmed wall-clock window.
 *
 * Run via `node --experimental-strip-types` (this repository has no build step), the identical pattern
 * `packages/engine/test/e2e/fixtures/run-engine-child.ts` already establishes for the identical
 * real-process-kill need.
 *
 * @see specs/22 M15 P3
 * @see PLAN-M15.md P3
 */
import { runBindingCheck } from '../../../../../src/commands/loop/test/binding.ts';

const [, , projectRoot, runId, storyId, baseRevision, testCommand] = process.argv;
if (
  projectRoot === undefined ||
  runId === undefined ||
  storyId === undefined ||
  baseRevision === undefined ||
  testCommand === undefined
) {
  throw new Error(
    'usage: binding-check-child.ts <projectRoot> <runId> <storyId> <baseRevision> <testCommand>',
  );
}

process.stdout.write('STARTED\n');

try {
  await runBindingCheck({
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
  });
  process.stdout.write('DONE\n');
} catch (error) {
  process.stderr.write(`${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
  process.exitCode = 1;
}
