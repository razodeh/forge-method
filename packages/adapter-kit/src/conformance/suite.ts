/**
 * `runAdapterConformanceSuite` — `07` §7.6's 16-test suite, runnable against *any* `PlatformAdapter`.
 * Registers real vitest `describe`/`it` blocks into whichever file calls it (this package depends on
 * `vitest`'s own test globals at runtime, not only for its own tests, per `PLAN-M4.md` P4's own Surface
 * section) rather than producing a report object — `forge doctor --adapter <id> --conformance` (a later
 * milestone's CLI) is a thin wrapper around running this same suite and reading its pass/fail.
 *
 * @see specs/07 §7.6
 * @see specs/15 §15.6
 * @see SPEC-QUESTIONS.md Q60
 * @see PLAN-M4.md P4
 */
import { beforeAll, describe } from 'vitest';

import type { PlatformAdapter } from '../types/adapter.ts';
import { registerCapabilityGatedTests } from './capabilities.ts';
import { registerControlAndAbortTests } from './control-and-abort.ts';
import { createConformanceContext } from './context.ts';
import { registerFilesystemTests } from './filesystem.ts';
import type { ConformanceOptions } from './fixtures.ts';
import { registerSecretsTests } from './secrets.ts';
import { registerSessionBasicsTests } from './session-basics.ts';

/** `07` §7.6's own closing line: "Adapters that fail C2, C5, C13, C14 or C16 MUST be rejected at load
 * time — these are safety-critical." Exported so a caller (this milestone's own P5 test, and any future
 * `forge doctor` wrapper) can assert specifically that none of these five are the ones that failed. */
export const SAFETY_CRITICAL_CONFORMANCE_IDS = ['C2', 'C5', 'C13', 'C14', 'C16'] as const;

export function runAdapterConformanceSuite(
  createAdapter: () => PlatformAdapter | Promise<PlatformAdapter>,
  options: ConformanceOptions,
): void {
  describe('adapter conformance (07 §7.6)', () => {
    const { context, setAdapter, setCapabilities } = createConformanceContext(options);

    beforeAll(async () => {
      const adapter = await createAdapter();
      setAdapter(adapter);
      setCapabilities(await adapter.capabilities());
    });

    registerSessionBasicsTests(context);
    registerFilesystemTests(context);
    registerControlAndAbortTests(context);
    registerSecretsTests(context);
    registerCapabilityGatedTests(context);
  });
}
