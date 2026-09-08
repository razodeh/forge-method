/**
 * `forge adopt` / `forge discover` — real, documented forward gaps (`03` §3.2.1, §3.2.2):
 * `PLAN-M6.md` C3's own Mandate explicitly sanctions refusing rather than fabricating a mechanism
 * that does not exist yet.
 */
import { describe, expect, it } from 'vitest';

import { ForgeError } from '@forge/core/errors';

import { adopt } from '../../src/commands/adopt.ts';
import { discover } from '../../src/commands/discover.ts';

describe('adopt', () => {
  it('refuses with a real, remediable USR-003 rather than fabricating brownfield ingestion', () => {
    expect(() => adopt()).toThrow(ForgeError);
    try {
      adopt();
    } catch (error) {
      expect((error as ForgeError).code).toBe('USR-003');
    }
  });
});

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
