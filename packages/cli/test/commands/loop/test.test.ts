/**
 * `forge test <plan|generate|run|report|flaky|coverage>` — every subcommand is a real, named
 * `USR-003` refusal (no real mechanism exists anywhere in this codebase for any of them).
 *
 * @see specs/03 §3.2.5
 */
import { describe, expect, it } from 'vitest';

import { test as testSubcommand, type TestSubcommand } from '../../../src/commands/loop/test.ts';

describe('test', () => {
  it.each([
    'plan',
    'generate',
    'run',
    'report',
    'flaky',
    'coverage',
  ] as const satisfies readonly TestSubcommand[])('throws USR-003 for %s', (sub) => {
    expect(() => testSubcommand(sub)).toThrow(expect.objectContaining({ code: 'USR-003' }));
  });
});
