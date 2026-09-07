/**
 * Fixture process for `events.test.ts`'s own fsync-durability proof (`18` §18.10: "this is the piece
 * the crash-resume capstone will trust blindly, so it earns its own direct proof here"). Appends one
 * event, signals success on stdout, then hangs — deliberately never exits on its own, so the parent test
 * controls the exact moment of death via `SIGKILL`, not a graceful exit that could itself flush state a
 * missing `fsync` would otherwise leave pending and mask the very bug this exists to catch.
 *
 * Run via `node --experimental-strip-types` (this repository has no build step; `.ts` files run
 * directly, and this Node version needs the flag for that outside vitest's own transform).
 */
import { appendEvent } from '../../src/events.ts';

const [, , projectRoot, runId] = process.argv;
if (projectRoot === undefined || runId === undefined) {
  throw new Error('usage: append-and-hang.ts <projectRoot> <runId>');
}

await appendEvent(projectRoot, runId, {
  ts: '2026-01-01T00:00:00.000Z',
  runId,
  type: 'RunStarted',
  payload: { marker: 'fsync-durability-check' },
});

process.stdout.write('APPENDED\n');
setInterval(() => undefined, 1000);
