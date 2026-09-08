/**
 * `formatStreamLine` — the Stream mode row of `03` §3.5's table: line-oriented,
 * `[lane][agent][step]`-prefixed, ANSI only when colour is allowed.
 *
 * @see specs/03 §3.5
 */
import { renderValue } from '@forge/core/errors';
import type { ForgeEvent } from '@forge/telemetry/events';

import type { StreamFormatContext } from './types.ts';

const ANSI = { dim: '\x1b[2m', reset: '\x1b[0m' } as const;

/** `[lane][agent][step]`, each segment `-` when the event carries no value for it. */
function prefix(event: ForgeEvent): string {
  const lane = event.laneId ?? '-';
  const agent = event.agentId ?? '-';
  const step = event.stepId ?? '-';
  return `[${lane}][${agent}][${step}]`;
}

/**
 * Renders one `ForgeEvent` as a single Stream-mode line: `[lane][agent][step] Type payload`. The
 * prefix is dimmed when colour is allowed, matching `@forge/core/errors/format.ts`'s own
 * colour-as-parameter discipline — never sniffed from `process.stdout` here.
 */
export function formatStreamLine(event: ForgeEvent, ctx: StreamFormatContext): string {
  const rawPrefix = prefix(event);
  const paintedPrefix = ctx.color ? `${ANSI.dim}${rawPrefix}${ANSI.reset}` : rawPrefix;
  const payload = event.payload === undefined ? '' : ` ${renderValue(event.payload)}`;
  return `${paintedPrefix} ${event.type}${payload}`;
}
