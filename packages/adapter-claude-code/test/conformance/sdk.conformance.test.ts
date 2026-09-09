/**
 * `07` §7.6's 16-test adapter conformance suite, run for real against `ClaudeCodeAdapter` pinned to the
 * `sdk` transport -- `PLAN-M7.md` P9's own concrete deliverable, the first thing M7's own Acceptance
 * line names.
 *
 * Gated by `planLiveRuns` (`live-gate.ts`): with no `FORGE_LIVE=1`, or no real credential available,
 * every test in this file reports skipped, with the real reason in its own name, and no live adapter
 * is ever constructed -- checked directly below via a local counter, not merely inferred from "it
 * finished fast." `probeAuthAvailability` itself runs unconditionally regardless of `FORGE_LIVE`
 * (its own doc comment: "makes no live API call and costs nothing... reads local session state") --
 * matching this package's own established precedent (`auth.test.ts`, `preflight.test.ts`), not a new
 * network call this file introduces.
 *
 * When both a real API key and a real subscription login are available in the same environment at
 * once (the coordinator's own stated intent -- "provide api key also so we can test both scenarios"),
 * the full suite runs once under each, in two separate `describe` blocks, not just whichever mode
 * happened to be configured first.
 *
 * This file (unlike `create-warmed-adapter.ts`/`fixture-options.ts`) is a real `*.test.ts` file, so
 * `eslint.config.js`'s own R10 exemption glob covers it -- it is the one place in this whole
 * conformance suite allowed to read `process.env`/`node:os`'s `tmpdir()`/the wall clock directly, and
 * does so exactly once each, passing the results down explicitly to every helper that needs them.
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

// C13's own real ambient-leak vector -- set here, in the real test process's own environment, never
// passed to the adapter's own `env` or to any SessionRequest.env this suite builds (fixture-options.ts
// covers the second half; this covers the first).
process.env[CONFORMANCE_SECRET_ENV_VAR] = CONFORMANCE_SECRET_VALUE;

const liveEnv = process.env;
const auth = await probeAuthAvailability(liveEnv);
const runs = planLiveRuns(liveEnv, auth);
const scratchBaseDir = tmpdir();

/** Real, runtime-checked proof that no live adapter is ever constructed when no live run is
 * configured -- incremented only inside the `runs.length > 0` branch below, never reachable from the
 * skip branch by construction, and asserted `0` there directly rather than merely inferred. */
let liveAdapterConstructions = 0;

function warmSdkAdapter(bare: boolean) {
  liveAdapterConstructions += 1;
  return createWarmedAdapter(
    'sdk',
    bare,
    realAmbientEnv(liveEnv, bare),
    () => Date.now(),
    scratchBaseDir,
  );
}

if (runs.length === 0) {
  describe('adapter conformance (07 §7.6) — sdk transport', () => {
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
    describe(`adapter conformance (07 §7.6) — sdk transport, ${run.bare ? 'bare/api-key' : 'non-bare/subscription'} mode (${run.reason})`, () => {
      afterAll(cleanupConformanceScratchDirs);
      runAdapterConformanceSuite(
        () => warmSdkAdapter(run.bare),
        buildConformanceOptions(scratchBaseDir),
      );
    });
  }
}
