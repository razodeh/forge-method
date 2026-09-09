/**
 * `forge ask <question>` — a real, named `USR-003` refusal per `PLAN-M6.md` C5's own explicit scope
 * boundary (`session`/`ask` ship as CLI surface only; `panel` alone gets real dispatch).
 *
 * @see specs/03 §3.2.6
 */
import { describe, expect, it } from 'vitest';

import { ask } from '../../../src/commands/loop/ask.ts';

describe('ask', () => {
  it('throws USR-003, always', () => {
    expect(() => ask()).toThrow(expect.objectContaining({ code: 'USR-003' }));
  });
});
