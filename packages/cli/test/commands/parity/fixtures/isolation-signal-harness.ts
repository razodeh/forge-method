/**
 * A tiny, standalone child-process harness for `candidate-isolation.test.ts`'s own real-signal
 * tests: real signal delivery has to land on a SEPARATE process, never the test runner's own, since
 * `withParityDirHidden`'s signal handler calls `process.exit`. Spawned with `root` as `argv[2]`:
 * opens a `withParityDirHidden` window over a callback that never resolves on its own, prints
 * `HIDDEN` to stdout the instant the window is open (the parent test's own signal to send the real
 * signal), and otherwise waits forever for that signal to end it.
 *
 * @see specs/22 M17 P14
 */
import { withParityDirHidden } from '../../../../src/commands/parity/candidate-isolation.ts';

const root = process.argv[2];
if (root === undefined) throw new Error('usage: isolation-signal-harness.ts <root>');

await withParityDirHidden(root, async () => {
  process.stdout.write('HIDDEN\n');
  // A bare `await new Promise(() => {})` holds nothing else alive -- Node's own idle-event-loop
  // detection then exits the process on its own (observed directly: exit code 0 or 13, racing
  // ahead of the signal this harness exists to wait for), bypassing the signal handler entirely.
  // `setInterval` is a real libuv handle that keeps the event loop genuinely open until a signal
  // (or the test's own timeout) ends this process.
  await new Promise(() => {
    setInterval(() => {
      // Never fires meaningfully -- exists only to keep the event loop alive.
    }, 60_000);
  });
});
