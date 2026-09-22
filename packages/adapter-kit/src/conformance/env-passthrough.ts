/**
 * Env passthrough — `PLAN-M14.md` P4's own additional check, run by the same shared suite every real
 * adapter's conformance test already exercises `07` §7.6's C1-C16 against, but not itself one of that
 * fixed, normative sixteen (`07` §7.6 is unchanged by this milestone): it proves the one fact P4's own
 * FORGE run/step/agent marker depends on -- that a key set only on `SessionRequest.env` genuinely
 * reaches the real, spawned subprocess a session runs as, not merely an in-process object a mocked
 * spawn call captured (`adapter.test.ts`'s own "session environment" unit test already proves the
 * *merge*; this proves the *delivery*).
 *
 * @see specs/07 §7.2
 * @see PLAN-M14.md P4
 */
import { describe, expect, it } from 'vitest';

import type { ConformanceContext } from './context.ts';
import { CONFORMANCE_ENV_PROBE_VALUE, CONFORMANCE_ENV_PROBE_VAR } from './fixtures.ts';
import { collectEvents, withTimeout } from './helpers.ts';

export async function checkEnvReachesSubprocess(context: ConformanceContext): Promise<void> {
  const prompt = context.options.envProbePrompt;
  if (prompt === undefined) {
    throw new Error('env-passthrough: no envProbePrompt fixture was supplied.');
  }
  const cwd = await context.options.createScratchDir();
  const handle = await context.getAdapter().startSession(
    context.buildRequest({
      cwd,
      prompt,
      env: { [CONFORMANCE_ENV_PROBE_VAR]: CONFORMANCE_ENV_PROBE_VALUE },
    }),
  );
  const events = await withTimeout(
    collectEvents(handle),
    30000,
    'env-passthrough: session did not end within 30s',
  );
  const result = await withTimeout(
    handle.result(),
    5000,
    'env-passthrough: result() did not settle within 5s',
  );
  const observedText = [
    result.finalText,
    ...events.filter((event) => event.type === 'text').map((event) => event.text),
  ].join('\n');
  expect(observedText).toContain(CONFORMANCE_ENV_PROBE_VALUE);
}

export function registerEnvPassthroughTests(context: ConformanceContext): void {
  describe('env passthrough (07 §7.2 SessionRequest.env; PLAN-M14.md P4, not one of 07 §7.6’s fixed C1-C16)', () => {
    it('a key set only on SessionRequest.env reaches the real, spawned subprocess', async (testCtx) => {
      // Skipped only on a missing fixture (there is no adapter-reported capability to gate this on --
      // see `ConformanceOptions.envProbePrompt`'s own doc comment for why that is the honest condition
      // here, unlike C8/C9/C15/C16 above).
      testCtx.skip(
        context.options.envProbePrompt === undefined,
        'no envProbePrompt fixture supplied (adapter is not a real, subprocess-spawning one)',
      );
      await checkEnvReachesSubprocess(context);
    });
  });
}
