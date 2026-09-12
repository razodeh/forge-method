/**
 * `@forge/sessions/phase-machine`'s own barrel -- a gauntlet critic round found `MAX_AGENT_PARTICIPANTS`
 * (`16` §16.8's own "5 agents + human" bound) missing from this export list even though its sibling
 * bound `DIVERGE_IDEA_CAP` was exported right next to it, making the real constant unreachable to any
 * consumer outside this package without hardcoding the number `RUN-067`'s own remedy also names.
 *
 * @see PLAN-M10.md P9
 */
import { describe, expect, it } from 'vitest';

import * as phaseMachineBarrel from '../../src/phase-machine/index.ts';
import * as packageBarrel from '../../src/index.ts';

describe('the phase-machine barrel exports every real bound', () => {
  it('exports DIVERGE_IDEA_CAP and MAX_AGENT_PARTICIPANTS as the real numbers', () => {
    expect(phaseMachineBarrel.DIVERGE_IDEA_CAP).toBe(30);
    expect(phaseMachineBarrel.MAX_AGENT_PARTICIPANTS).toBe(5);
  });

  it('re-exports both bounds through the package root barrel too', () => {
    expect(packageBarrel.DIVERGE_IDEA_CAP).toBe(30);
    expect(packageBarrel.MAX_AGENT_PARTICIPANTS).toBe(5);
  });
});
