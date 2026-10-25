/**
 * A worker-thread fixture that crashes immediately with NO `process.on('uncaughtException', ...)`
 * handler at all — the structural (`library` surface) counterpart to `crashing-no-handler-worker.ts`,
 * proving `normalize-library-budget.ts`'s own `worker.on('error', ...)` listener stops this from
 * crashing the CALLING process, even though it cannot signal promptly, so the caller still waits out
 * its own full budget before reporting `{status: 'timed-out'}`.
 *
 * @see specs/22 M17 P14
 * @see process/SPEC-QUESTIONS.md Q317 Decision 8
 */
throw new Error('deliberate fixture crash, with no handler of any kind to catch it');
