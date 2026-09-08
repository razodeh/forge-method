/**
 * Fixture process for `crash-resume.test.ts`'s own E3 crash-resume proof (`06` §6.10: "A crash-resume
 * test... at 20 randomised points... is a required CI test"). Drives the fixture workflow
 * (`../fixture-workflow.ts`) to completion via `runEngine`, printing `EVENT <seq>` to stdout after every
 * durable event write so the parent test can `SIGKILL` this process at an exact, real point in a real
 * run — never a simulated one — rather than guessing at wall-clock timing.
 *
 * Run via `node --experimental-strip-types` (this repository has no build step; `.ts` files run
 * directly), the identical pattern `@forge/telemetry`'s own `append-and-hang.ts` fixture already
 * establishes and documents for the identical real-process-kill need.
 *
 * @see specs/06 §6.10
 * @see PLAN-M5.md P20
 */
import { runEngine } from '../../../src/run/run-engine.ts';
import { fixtureExpressionContext, fixtureRunEngineContext, FIXTURE_WORKFLOW_SOURCE } from '../fixture-workflow.ts';

const [, , projectRoot, runId, seed] = process.argv;
if (projectRoot === undefined || runId === undefined || seed === undefined) {
  throw new Error('usage: run-engine-child.ts <projectRoot> <runId> <seed>');
}

const baseCtx = fixtureRunEngineContext(projectRoot, runId, seed);
// Wraps the real telemetry facade rather than replacing it -- every event still actually reaches the
// real durable log (`18` §18.10) exactly as it would in production; this only adds the one thing this
// fixture process itself needs beyond that, a stdout signal the parent test can watch for.
const ctx = {
  ...baseCtx,
  telemetry: {
    async emit(event: Parameters<(typeof baseCtx)['telemetry']['emit']>[0]) {
      const fullEvent = await baseCtx.telemetry.emit(event);
      process.stdout.write(`EVENT ${String(fullEvent.seq)}\n`);
      return fullEvent;
    },
  },
};

try {
  await runEngine(FIXTURE_WORKFLOW_SOURCE, fixtureExpressionContext(), ctx);
  process.stdout.write('DONE\n');
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
}
