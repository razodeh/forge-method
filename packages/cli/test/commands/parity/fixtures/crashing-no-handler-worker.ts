/**
 * A worker-thread fixture that crashes immediately with NO `process.on('uncaughtException', ...)`
 * handler at all — the ORIGINAL gauntlet-round repro shape (before `normalize-worker.ts`'s own
 * handler existed): proves `normalize-budget.ts`'s own `worker.on('error', ...)` listener stops this
 * from crashing the CALLING process (Node's own default behaviour for an unhandled `'error'` event),
 * even though — confirmed directly, not merely asserted — it cannot signal promptly, so the caller
 * still waits out its own full budget before reporting `{status: 'timed-out'}`.
 *
 * @see specs/22 M17 P14
 */
throw new Error('deliberate fixture crash, with no handler of any kind to catch it');
