/**
 * `inboundHandoffFor` — `05` §5.6: "The receiving agent's context pack always includes the inbound
 * handoff record."
 *
 * @see specs/05 §5.6
 * @see PLAN-M6.md A7
 */
import type { HandoffRecord } from '@forge/schemas/artifacts';

/**
 * `stepId` is matched against `HandoffRecord.step`'s own `"<from> → <to>"` label by its trailing
 * segment — `05` §5.6's own worked example (`"design-system → initialize-repo"`) names both the
 * handing-off and receiving step in one human label, with no separate machine-addressable "receiving
 * step id" field of its own; the substring after the last `→` is the one part of that label that
 * actually identifies which step should receive this record. A record whose own `step` carries no `→`
 * at all matches nothing (never a false positive against an unrelated, differently-shaped label).
 */
function receivingStepOf(step: string): string | undefined {
  const parts = step.split('→');
  const last = parts.at(-1)?.trim();
  return parts.length > 1 && last !== undefined && last.length > 0 ? last : undefined;
}

/**
 * A fresh critic round flagged that a bare `.find` silently returns whichever matching record
 * happens to appear first in `records`' own array order when more than one handoff names the same
 * receiving step (a real possibility for a fan-in step with several predecessors) — an arbitrary,
 * undocumented, and untested choice. `05` §5.6's own singular "the receiving agent's context pack
 * always includes the inbound handoff record" (and this function's own singular `HandoffRecord |
 * undefined` return type, not an array) commits to exactly one record being "the" answer, so ties are
 * broken deliberately here: the most recently emitted match wins (`timestamp`, ISO-8601, string-
 * comparable in chronological order) — the record with the freshest content for the receiving agent's
 * own context pack, not an accident of whatever order the caller's own `records` array happens to be
 * built in.
 */
export function inboundHandoffFor(
  stepId: string,
  records: readonly HandoffRecord[],
): HandoffRecord | undefined {
  let latest: HandoffRecord | undefined;
  for (const candidate of records) {
    if (receivingStepOf(candidate.step) !== stepId) continue;
    if (latest === undefined || candidate.timestamp > latest.timestamp) latest = candidate;
  }
  return latest;
}
