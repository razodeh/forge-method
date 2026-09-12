/**
 * `forge discover` — a real, documented forward gap (`03` §3.2.2): `PLAN-M6.md` C3's own Mandate
 * explicitly sanctions refusing rather than fabricating a mechanism that does not exist yet.
 *
 * `forge adopt` (`03` §3.2.1) was the identical refusal stub through M6-M9; `PLAN-M10.md` P15-P19
 * built the real brownfield-ingestion pipeline this file used to test only as a refusal — see
 * `packages/cli/test/commands/adopt.test.ts` for its real tests now.
 */
import { describe, expect, it } from 'vitest';

import { ForgeError } from '@forge/core/errors';

import { discover } from '../../src/commands/discover.ts';

describe('discover', () => {
  it('refuses with a real, remediable USR-003 rather than fabricating workflow execution', () => {
    expect(() => discover()).toThrow(ForgeError);
    try {
      discover();
    } catch (error) {
      expect((error as ForgeError).code).toBe('USR-003');
    }
  });
});
