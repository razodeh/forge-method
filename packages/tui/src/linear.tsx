/**
 * `<LinearView>` — `04` §4.7's own `--linear` degradation mode: no panes, purely sequential output,
 * every state change announced as one line. Genuinely a *different* render path from the panelled
 * `<AppShell>` (P6), not a CSS-style reflow of it — `04` calls this mode out as "this doubles as the
 * CI-friendly mode," which this file reads as a real, load-bearing requirement, not a style preference:
 * deterministic (never wall-clock-derived), greppable (one event per line, plain text), and safe for a
 * non-interactive pipe (no `useInput` at all, anywhere in this file).
 *
 * `<AppShell>` itself never checked `RenderMode.linear` at all before this piece — a real, genuine gap
 * this piece's own mandate ("real fixes to any P2-P14 component found... not honouring `RenderMode`
 * correctly") exists to close: `<AppShell>` now branches to `<LinearView>` at its own final return,
 * after every one of its own hooks has already run (React's own rule — hooks must run unconditionally
 * every render; only the final JSX may branch), and its own two global `useInput` hooks are now also
 * gated `&& !liveMode.linear`, so linear mode is genuinely non-interactive, not merely visually plain.
 *
 * **Deliberately never colour-aware, regardless of `RenderMode.color`** — no `<Text>` in this file ever
 * sets a `color` prop, so Ink can never emit an ANSI colour escape for this subtree at all, trivially
 * satisfying `04` §4.7's own "zero ANSI escape codes... when `NO_COLOR`/`TERM=dumb` apply" requirement
 * by construction rather than by checking `mode.color` at every call site — colour has no real role in
 * a mode whose entire point is plain, greppable, CI-safe text.
 *
 * One line per real event, formatted generically from `ForgeEvent`'s own envelope fields (`type`,
 * `stepId`, `laneId`) rather than a bespoke, hand-written message for each of the real 37-member
 * `EventType` catalogue — deliberately: a generic, exhaustive-by-construction formatter (nothing here
 * switches on `event.type` at all) stays automatically correct as new event types are added, at the
 * cost of a slightly less narratively-worded line than a fully bespoke one per type would give.
 *
 * @see specs/04 §4.7
 * @see PLAN-M9.md P15
 * @see SPEC-QUESTIONS.md Q147
 */
import type { ForgeEvent } from '@forge/telemetry/events';
import { Box, Text } from 'ink';
import type { JSX } from 'react';
import { useEffect, useState } from 'react';

import type { EngineClient, EngineClientNotification } from './state/engine-client.ts';

export interface LinearViewProps {
  readonly client: EngineClient;
  readonly productName: string;
  readonly stageLabel: string;
}

/** One deterministic, plain-text line per real event -- `event.ts` (the event's own real timestamp
 * field), never the wall clock (`QUALITY-BAR.md` R10). */
export function describeEvent(event: ForgeEvent): string {
  const parts = [event.ts, event.type];
  if (event.stepId !== undefined) parts.push(`step=${event.stepId}`);
  if (event.laneId !== undefined) parts.push(`lane=${event.laneId}`);
  if (event.agentId !== undefined) parts.push(`agent=${event.agentId}`);
  return parts.join(' ');
}

function describeNotification(notification: EngineClientNotification): string {
  return `NOTICE ${notification.type} ${notification.message}`;
}

export function LinearView({ client, productName, stageLabel }: LinearViewProps): JSX.Element {
  const [lines, setLines] = useState<readonly string[]>(() => [
    `FORGE ${productName} -- stage ${stageLabel} -- linear mode`,
  ]);

  useEffect(() => {
    const unsubscribeEvents = client.subscribe((event) => {
      setLines((current) => [...current, describeEvent(event)]);
    });
    const unsubscribeNotifications = client.onNotification((notification) => {
      setLines((current) => [...current, describeNotification(notification)]);
    });
    return () => {
      unsubscribeEvents();
      unsubscribeNotifications();
    };
  }, [client]);

  return (
    <Box flexDirection="column">
      {/* Index-as-key is correct here, not merely convenient -- `lines` is strictly append-only (never
       * reordered, never spliced), exactly the one real case React's own "don't use the index as key"
       * caution doesn't apply to. */}
      {lines.map((line, index) => (
        <Text key={index}>{line}</Text>
      ))}
    </Box>
  );
}
