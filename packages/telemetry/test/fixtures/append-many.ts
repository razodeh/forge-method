/**
 * Fixture process for `events.test.ts`'s own real cross-process concurrency proof (`specs/22` M15 P14:
 * a real live run found two genuinely separate OS processes appending to the same run's own event log
 * at close to the same real moment can both compute the identical next `seq` and both write it,
 * producing a real, reproducible duplicate — this fixture is one of several real, separate processes
 * the parent test spawns at once against the same run, each appending a run of real events, so the
 * parent can assert the merged, real on-disk log is genuinely gapless and duplicate-free afterward).
 *
 * Run via `node --experimental-strip-types` (this repository has no build step).
 */
import { appendEvent } from '../../src/events.ts';

const [, , projectRoot, runId, countArg, markerArg] = process.argv;
if (projectRoot === undefined || runId === undefined || countArg === undefined || markerArg === undefined) {
  throw new Error('usage: append-many.ts <projectRoot> <runId> <count> <marker>');
}
const count = Number(countArg);

for (let i = 0; i < count; i += 1) {
  await appendEvent(projectRoot, runId, {
    ts: '2026-01-01T00:00:00.000Z',
    runId,
    type: 'RunStarted',
    payload: { marker: markerArg, index: i },
  });
}

process.stdout.write('DONE\n');
