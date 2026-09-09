/**
 * `forge customize` — a real, named refusal.
 */
import { describe, expect, it } from 'vitest';

import { customize } from '../../src/commands/customize.ts';

describe('customize', () => {
  it('is a real, named refusal — no interactive wizard mechanism exists', () => {
    expect(() => customize()).toThrow(expect.objectContaining({ code: 'USR-003' }));
  });
});
