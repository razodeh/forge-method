/**
 * `forge test <plan|generate|run|report|flaky|coverage>` — `03` §3.2.5. `run` (`PLAN-M8.md` P4),
 * `coverage` (P6), and `flaky` (P7) each now have a real implementation (`test/run.ts`,
 * `test/coverage.ts`, `test/flaky.ts`) — this file's own remaining scope is `plan`/`generate`/
 * `report`, none of which has a real mechanism anywhere in this codebase: no test-strategy-planning
 * workflow (`10` §10.5's own 20-workflow table has none — the identical gap `PLAN-M6.md` C4's own
 * `forge plan testing` already recorded, `SPEC-QUESTIONS.md` Q107), no real test-generation, no
 * report-formatting command. Refused loudly (`USR-003`) rather than guessed at, the same discipline
 * C4 already established for `forge plan data/testing` and `forge merge --abort`.
 *
 * @see specs/03 §3.2.5
 * @see PLAN-M8.md P4
 * @see PLAN-M8.md P6
 * @see PLAN-M8.md P7
 */
import { ForgeError } from '@forge/core/errors';

export type TestSubcommand = 'plan' | 'generate' | 'report';

/** @throws {ForgeError} `USR-003`, always — every one of the three remaining subcommands. */
export function test(sub: TestSubcommand): never {
  throw new ForgeError('USR-003', { feature: `forge test ${sub}` });
}
