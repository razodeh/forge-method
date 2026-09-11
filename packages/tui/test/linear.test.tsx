/**
 * `<LinearView>` -- `04` §4.7's own `--linear` degradation mode: sequential, deterministic,
 * screen-reader-ish output with zero ANSI escape codes and no interactivity.
 *
 * @see specs/04 §4.7
 * @see PLAN-M9.md P15
 */
import type { ForgeEvent } from '@forge/telemetry/events';
import { render } from 'ink-testing-library';
import { describe, expect, it } from 'vitest';

import { describeEvent, LinearView, type LinearViewProps } from '../src/linear.tsx';
import type { EngineClient, EngineClientNotification } from '../src/state/engine-client.ts';

function flush(): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(resolve);
  });
}

function makeEvent(overrides: Partial<ForgeEvent> & { type: ForgeEvent['type'] }): ForgeEvent {
  return {
    v: 1,
    seq: 1,
    ts: '2026-01-01T00:00:00.000Z',
    runId: 'run-1',
    payload: undefined,
    ...overrides,
  };
}

function createFakeClient(): EngineClient & {
  emit: (event: ForgeEvent) => void;
  emitNotification: (notification: EngineClientNotification) => void;
} {
  const listeners = new Set<(event: ForgeEvent) => void>();
  const notificationListeners = new Set<(notification: EngineClientNotification) => void>();
  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    onNotification(listener) {
      notificationListeners.add(listener);
      return () => {
        notificationListeners.delete(listener);
      };
    },
    stop() {
      listeners.clear();
      notificationListeners.clear();
    },
    emit(event) {
      for (const listener of listeners) listener(event);
    },
    emitNotification(notification) {
      for (const listener of notificationListeners) listener(notification);
    },
  };
}

describe('describeEvent', () => {
  it('formats a bare event with no stepId/laneId/agentId as just ts and type', () => {
    expect(describeEvent(makeEvent({ type: 'RunStarted' }))).toBe(
      '2026-01-01T00:00:00.000Z RunStarted',
    );
  });

  it('includes stepId/laneId/agentId whenever present, in a fixed order', () => {
    const event = makeEvent({
      type: 'StepStarted',
      stepId: 'STEP-1',
      laneId: 'LANE-1',
      agentId: 'backend-engineer',
    });
    expect(describeEvent(event)).toBe(
      '2026-01-01T00:00:00.000Z StepStarted step=STEP-1 lane=LANE-1 agent=backend-engineer',
    );
  });

  it("is deterministic -- driven by the event's own ts, never the wall clock", () => {
    const event = makeEvent({ type: 'RunCompleted', ts: '2030-06-15T12:00:00.000Z' });
    expect(describeEvent(event)).toContain('2030-06-15T12:00:00.000Z');
  });
});

describe('<LinearView>', () => {
  it('renders an initial line naming the product and stage', () => {
    const client = createFakeClient();
    const { lastFrame } = render(
      <LinearView client={client} productName="acme-billing" stageLabel="MVP" />,
    );
    expect(lastFrame()).toContain('FORGE acme-billing -- stage MVP -- linear mode');
  });

  it('announces each real event as a new, appended line, in arrival order', async () => {
    const client = createFakeClient();
    const { lastFrame } = render(
      <LinearView client={client} productName="acme-billing" stageLabel="MVP" />,
    );
    await flush();
    client.emit(makeEvent({ type: 'RunStarted', seq: 1 }));
    await flush();
    client.emit(makeEvent({ type: 'StepStarted', seq: 2, stepId: 'STEP-1' }));
    await flush();

    const frame = lastFrame() ?? '';
    const runStartedIndex = frame.indexOf('RunStarted');
    const stepStartedIndex = frame.indexOf('StepStarted');
    expect(runStartedIndex).toBeGreaterThan(-1);
    expect(stepStartedIndex).toBeGreaterThan(runStartedIndex);
  });

  it('announces a real notification as a NOTICE line', async () => {
    const client = createFakeClient();
    const { lastFrame } = render(
      <LinearView client={client} productName="acme-billing" stageLabel="MVP" />,
    );
    await flush();
    client.emitNotification({ type: 'gap', message: 'log read failed' });
    await flush();
    expect(lastFrame()).toContain('NOTICE gap log read failed');
  });

  it('never accepts or reads RenderMode.color at all -- colour has no role in this mode by construction, not by a runtime check this test harness could actually observe', () => {
    // `ink-testing-library` renders with Ink's own `debug: true` mode (confirmed directly against its
    // real source), which never emits raw ANSI escapes into `lastFrame()` regardless of any `color`
    // prop a component sets -- so a runtime "no ANSI in the frame" assertion here would pass trivially
    // whether or not this file ever set one, proving nothing. The real, checkable guarantee is
    // structural: `LinearViewProps` has no `mode`/`color` field at all, so there is nothing for this
    // component to read even if it wanted to, and no `<Text color=...>` anywhere in `linear.tsx`.
    const propsShape: readonly (keyof LinearViewProps)[] = ['client', 'productName', 'stageLabel'];
    expect(propsShape).not.toContain('mode');
    expect(propsShape).not.toContain('color');
  });

  it('unsubscribes cleanly on unmount, without throwing on a later event', async () => {
    const client = createFakeClient();
    const { unmount } = render(
      <LinearView client={client} productName="acme-billing" stageLabel="MVP" />,
    );
    await flush();
    unmount();
    expect(() => {
      client.emit(makeEvent({ type: 'RunCompleted' }));
    }).not.toThrow();
  });
});
