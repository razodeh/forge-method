/**
 * `forge ask <question>` — a real, named `USR-003` refusal per `PLAN-M6.md` C5's own explicit scope
 * boundary (`session`/`ask` ship as CLI surface only; `panel` alone gets real dispatch).
 *
 * @see specs/03 §3.2.6
 */
import { describe, expect, it } from 'vitest';

import { ask } from '../../../src/commands/loop/ask.ts';
import { AD_HOC_LIMITS } from '../../../src/commands/loop/ad-hoc-step.ts';

describe('ask', () => {
  it('throws USR-003, always', () => {
    expect(() => ask()).toThrow(expect.objectContaining({ code: 'USR-003' }));
  });

  it("AD_HOC_LIMITS (ad-hoc-step.ts) is unchanged: `forge debug`/`forge review`/`forge panel` moved to the dispatched agent's own declared limits (PLAN-M14.md P32), but this constant -- the one ad-hoc-step.ts's own doc comment still names as this command's concept -- keeps its original value", () => {
    expect(AD_HOC_LIMITS).toEqual({ maxTurns: 20, wallClockMs: 600_000, maxCostUsd: 2.0 });
  });
});
