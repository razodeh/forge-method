/**
 * `forge test <plan|generate|run|report|flaky|coverage>` — `03` §3.2.5. No real mechanism exists
 * anywhere in this codebase for any of the six subcommands: no test-strategy-planning workflow (`10`
 * §10.5's own 20-workflow table has none — the identical gap `PLAN-M6.md` C4's own `forge plan
 * testing` already recorded, `SPEC-QUESTIONS.md` Q107), no real test-generation/execution/coverage
 * runner integration, no flaky-test tracker. Refused loudly (`USR-003`) rather than guessed at, the
 * same discipline C4 already established for `forge plan data/testing` and `forge merge --abort`.
 *
 * @see specs/03 §3.2.5
 */
import { ForgeError } from '@forge/core/errors';

export type TestSubcommand = 'plan' | 'generate' | 'run' | 'report' | 'flaky' | 'coverage';

/** @throws {ForgeError} `USR-003`, always — every one of the six subcommands. */
export function test(sub: TestSubcommand): never {
  throw new ForgeError('USR-003', { feature: `forge test ${sub}` });
}
