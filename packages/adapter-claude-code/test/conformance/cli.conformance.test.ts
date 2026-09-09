/**
 * `07` §7.6's 16-test adapter conformance suite, run for real against `ClaudeCodeAdapter` pinned to the
 * `cli` transport -- `PLAN-M7.md` P9's own concrete deliverable, the first thing M7's own Acceptance
 * line names.
 *
 * See `sdk.conformance.test.ts`'s own top-of-file doc comment for the full rationale shared by both
 * files (the live-run gate, the warm-up-session trick, the dual-auth-mode matrix, and why this file is
 * the one place allowed to read `process.env`/`tmpdir()`/the wall clock directly) -- this file differs
 * only in pinning `transport: 'cli'` instead of `'sdk'`.
 *
 * @see specs/07 §7.6
 * @see PLAN-M7.md P9
 */
import { tmpdir } from 'node:os';

import { afterAll, describe, expect, it } from 'vitest';

import { runAdapterConformanceSuite } from '@forge/adapter-kit/conformance';

import { probeAuthAvailability } from '../../src/auth.ts';
import { createWarmedAdapter, realAmbientEnv } from './create-warmed-adapter.ts';
import {
  buildConformanceOptions,
  cleanupConformanceScratchDirs,
  CONFORMANCE_SECRET_ENV_VAR,
  CONFORMANCE_SECRET_VALUE,
} from './fixture-options.ts';
import { planLiveRuns } from './live-gate.ts';

process.env[CONFORMANCE_SECRET_ENV_VAR] = CONFORMANCE_SECRET_VALUE;

const liveEnv = process.env;
const auth = await probeAuthAvailability(liveEnv);
const runs = planLiveRuns(liveEnv, auth);
const scratchBaseDir = tmpdir();

let liveAdapterConstructions = 0;

function warmCliAdapter(bare: boolean) {
  liveAdapterConstructions += 1;
  return createWarmedAdapter(
    'cli',
    bare,
    realAmbientEnv(liveEnv, bare),
    () => Date.now(),
    scratchBaseDir,
  );
}

if (runs.length === 0) {
  describe('adapter conformance (07 §7.6) — cli transport', () => {
    it(
      liveEnv['FORGE_LIVE'] !== '1'
        ? 'skipped: FORGE_LIVE is not set to "1"'
        : 'skipped: FORGE_LIVE=1 but no real credential (ANTHROPIC_API_KEY or a claude subscription login) is available',
      (testCtx) => {
        expect(liveAdapterConstructions).toBe(0);
        testCtx.skip();
      },
    );
  });
} else {
  for (const run of runs) {
    describe(`adapter conformance (07 §7.6) — cli transport, ${run.bare ? 'bare/api-key' : 'non-bare/subscription'} mode (${run.reason})`, () => {
      afterAll(cleanupConformanceScratchDirs);
      runAdapterConformanceSuite(
        () => warmCliAdapter(run.bare),
        buildConformanceOptions(scratchBaseDir),
      );
    });
  }
}
