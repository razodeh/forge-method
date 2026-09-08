/**
 * `formatJsonEvent` — the JSON mode row of `03` §3.5's table: one `{"v":1,...}` NDJSON line on
 * stdout per real engine event. A real serializer over `@forge/telemetry`'s own `ForgeEvent` shape
 * (already versioned via its own `v: 1` field), not a second event schema — `03` §3.5's own
 * versioning requirement is satisfied because `ForgeEvent` already carries it.
 *
 * @see specs/03 §3.5
 */
import type { ForgeEvent } from '@forge/telemetry/events';

/** Renders `event` as a single NDJSON line (no trailing newline — the caller writes the separator). */
export function formatJsonEvent(event: ForgeEvent): string {
  return JSON.stringify(event);
}
