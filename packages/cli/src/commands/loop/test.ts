/**
 * `forge test <plan|generate|run|report|flaky|coverage>` — `03` §3.2.5. `run` now has a real
 * implementation (`test/run.ts`, `PLAN-M8.md` P4) — this file's own remaining scope is the other
 * five, none of which has a real mechanism anywhere in this codebase: no test-strategy-planning
 * workflow (`10` §10.5's own 20-workflow table has none — the identical gap `PLAN-M6.md` C4's own
 * `forge plan testing` already recorded, `SPEC-QUESTIONS.md` Q107), no real test-generation, no
 * report-formatting command, no flaky-test tracker (P7), no coverage runner integration (P6).
 * Refused loudly (`USR-003`) rather than guessed at, the same discipline C4 already established for
 * `forge plan data/testing` and `forge merge --abort`.
 *
 * @see specs/03 §3.2.5
 * @see PLAN-M8.md P4
 */
import { ForgeError } from '@forge/core/errors';

export type TestSubcommand = 'plan' | 'generate' | 'report' | 'flaky' | 'coverage';

/** @throws {ForgeError} `USR-003`, always — every one of the five remaining subcommands. */
export function test(sub: TestSubcommand): never {
  throw new ForgeError('USR-003', { feature: `forge test ${sub}` });
}
