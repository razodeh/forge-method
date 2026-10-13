/**
 * A worker-thread fixture that deliberately crashes, registering the IDENTICAL
 * `process.on('uncaughtException', ...)` signalling contract `normalize-worker.ts`'s own real,
 * production worker uses — pointed at by `normalize-budget.test.ts`'s own `workerUrl` test seam
 * (`applyNormalizeRulesToTextBounded`'s own optional 5th parameter) to prove a REAL worker crash
 * produces `{status: 'crashed'}`, not a hung or crashed calling process, without mutating the real
 * production worker file to do it.
 *
 * @see specs/22 M17 P14
 */
import { workerData } from 'node:worker_threads';

import { SYNC_CRASHED, type NormalizeWorkerData } from '../../../../src/commands/parity/normalize-worker-protocol.ts';

const data = workerData as NormalizeWorkerData;

process.on('uncaughtException', () => {
  try {
    Atomics.store(data.sync, 0, SYNC_CRASHED);
    Atomics.notify(data.sync, 0);
  } catch {
    // See the real worker's own identical handler for why this is the last resort.
  } finally {
    process.exit(1);
  }
});

throw new Error('deliberate fixture crash, before this thread ever reaches a real result');
