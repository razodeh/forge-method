/**
 * `createSystemTempPath` — the one real source of "an OS temp file path nothing else will collide
 * with" `runAndNormalize`'s pytest branch needs. `QUALITY-BAR.md` R10 forbids an uninjected
 * `crypto.randomUUID()`/`os.tmpdir()` in production code (a call site's own behaviour would depend
 * on which machine/process happened to run it, not on an explicit, replayable input) — every other
 * consumer takes this as an injected function instead, the same `Clock`/`SYSTEM_CLOCK` split
 * `@forge/core/clock.ts` already establishes for "now." Narrowly exempted by name in
 * `eslint.config.js`, not by directory, for the identical reason `clock.ts` itself is.
 *
 * @see QUALITY-BAR.md R10
 * @see PLAN-M8.md P3
 */
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';

export function createSystemTempPath(prefix: string): string {
  return path.join(tmpdir(), `${prefix}-${randomUUID()}`);
}

/** The bare OS temp directory root, with no path appended — `launcher-shim.ts`'s own
 * `sweepOrphanedLauncherShims` needs this to know WHERE to look for past `forge-launcher-*`
 * directories, not a fresh, uniquely-named one of its own. Still just the one host-fact read this
 * file is narrowly exempted for; listing what is already there stays this file's caller's own job
 * (`@forge/core/fs`'s sorted wrapper, or a locally-scoped equivalent), never this file's. */
export function systemTempRoot(): string {
  return tmpdir();
}
