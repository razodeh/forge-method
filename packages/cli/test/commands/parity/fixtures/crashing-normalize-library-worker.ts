/**
 * A worker-thread fixture that deliberately crashes, registering the IDENTICAL
 * `process.on('uncaughtException', ...)` signalling contract `normalize-library-worker.ts`'s own
 * real, production worker uses — pointed at by `normalize-library-budget.test.ts`'s own `workerUrl`
 * test seam (`applyNormalizeRulesToLibraryValueBounded`'s own optional 4th parameter) to prove a REAL
 * worker crash produces `{status: 'crashed'}`, not a hung or crashed calling process, without
 * mutating the real production worker file to do it — the structural (`library` surface) counterpart
 * to `crashing-normalize-worker.ts`.
 *
 * @see specs/22 M17 P14
 * @see process/SPEC-QUESTIONS.md Q317 Decision 8
 */
import { workerData } from 'node:worker_threads';

import { SYNC_CRASHED, type NormalizeLibraryWorkerData } from '../../../../src/commands/parity/normalize-library-worker-protocol.ts';

const data = workerData as NormalizeLibraryWorkerData;

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
