/**
 * `forge test <plan|generate|report>` — every one of these three remaining subcommands is a real,
 * named `USR-003` refusal (no real mechanism exists anywhere in this codebase for any of them).
 * `run`/`coverage`/`flaky` each have their own real implementation now (`test/run.ts`,
 * `test/coverage.ts`, `test/flaky.ts`), covered by their own test files instead.
 *
 * @see specs/03 §3.2.5
 * @see PLAN-M8.md P4
 */
import { describe, expect, it } from 'vitest';

import { test as testSubcommand, type TestSubcommand } from '../../../src/commands/loop/test.ts';

describe('test', () => {
  it.each(['plan', 'generate', 'report'] as const satisfies readonly TestSubcommand[])(
    'throws USR-003 for %s',
    (sub) => {
      expect(() => testSubcommand(sub)).toThrow(expect.objectContaining({ code: 'USR-003' }));
    },
  );
});
