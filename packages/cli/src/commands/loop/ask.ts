/**
 * `forge ask <question>` — `03` §3.2.6: "One-shot question answered strictly from the KB, with
 * citations." `PLAN-M6.md` C5's own Mandate text is explicit: `session`/`ask`/`panel` ship as CLI
 * command surface only, each with a "not yet implemented" real error for its own actual mechanism —
 * `forge panel` is named as the *one* partial exception, since A6's `dispatchAgentStep` gives it a
 * real, already-built mechanism to call directly (`review.ts`/`panel.ts`, this same module). `ask` has
 * no such exception: a real, citation-backed, KB-grounded one-shot answer needs more than a bare
 * `dispatchAgentStep` call (retrieval, grounding, citation formatting — none of which this milestone
 * builds), so it is refused the same way `session` is, not given a synthetic workflow of its own.
 *
 * @see specs/03 §3.2.6
 */
import { ForgeError } from '@forge/core/errors';

/** @throws {ForgeError} `USR-003`, always. */
export function ask(): never {
  throw new ForgeError('USR-003', { feature: 'forge ask' });
}
