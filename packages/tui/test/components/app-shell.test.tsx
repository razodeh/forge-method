/**
 * `<AppShell>` -- the piece that makes `@forge/tui` a real, running application: header/footer, screen
 * router, modal stack, resize, redraw coalescing, and every global key binding not already owned by a
 * leaf component.
 *
 * See `list-pane.test.tsx`'s own header comment for why every test that presses a key awaits `flush()`
 * once right after `render()`, before the first `stdin.write()`.
 *
 * @see specs/04 §4.1, §4.2, §4.3
 * @see PLAN-M9.md P6
 */
import { Text, useInput } from 'ink';
import { render } from 'ink-testing-library';
import stripAnsi from 'strip-ansi';
import { describe, expect, it, vi } from 'vitest';

import {
  AppShell,
  type AppShellProps,
  type ScreenEntry,
  type ScreenId,
  useAppModalStack,
} from '../../src/components/app-shell.tsx';
import { useIsBackgrounded } from '../../src/components/modal.tsx';
import { QuestionForm } from '../../src/components/question-form.tsx';
import type { RenderMode } from '../../src/env.ts';
import type { EngineClient, EngineClientNotification } from '../../src/state/engine-client.ts';
import type { ForgeEvent } from '@forge/telemetry/events';

const UP = '\x1B[A';
const DOWN = '\x1B[B';
const TAB = '\t';
const SHIFT_TAB = '\x1B[Z';
const ESC = '\x1B';

function flush(): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(resolve);
  });
}

interface StdinLike {
  write(data: string): void;
}

async function press(stdin: StdinLike, data: string): Promise<void> {
  stdin.write(data);
  await flush();
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

const MODE: RenderMode = { color: true, ascii: false, linear: false, columns: 120, lines: 40 };

function makeEvent(type: ForgeEvent['type'], overrides: Partial<ForgeEvent> = {}): ForgeEvent {
  return {
    v: 1,
    seq: 1,
    ts: '2026-01-01T00:00:00.000Z',
    runId: 'run-1',
    type,
    payload: {},
    ...overrides,
  };
}

function screenShowing(label: string): ScreenEntry {
  return {
    label,
    component: ({ focusedPaneIndex }) => (
      <Text>
        {label} (pane {String(focusedPaneIndex)})
      </Text>
    ),
  };
}

function allScreens(): ReadonlyMap<ScreenId, ScreenEntry> {
  return new Map<ScreenId, ScreenEntry>([
    [1, screenShowing('Home')],
    [2, screenShowing('Run')],
    [3, screenShowing('Specs')],
    [4, screenShowing('KB')],
    [5, screenShowing('Gates')],
    [6, screenShowing('Sessions')],
    [7, screenShowing('Cost')],
    [8, screenShowing('Customize')],
  ]);
}

function baseProps(overrides: Partial<AppShellProps> = {}): AppShellProps {
  return {
    client: createFakeClient(),
    screens: allScreens(),
    mode: MODE,
    productName: 'acme-billing',
    stageLabel: 'MVP (2/7 epics)',
    budgetCapUsd: 25,
    elapsedMs: 18 * 60_000,
    onQuit: () => undefined,
    ...overrides,
  };
}

async function renderShell(overrides: Partial<AppShellProps> = {}) {
  const result = render(<AppShell {...baseProps(overrides)} />);
  await flush();
  return result;
}

describe('AppShell', () => {
  it('renders the first screen by default', async () => {
    const { lastFrame } = await renderShell();
    expect(stripAnsi(lastFrame() ?? '')).toContain('Home (pane 0)');
  });

  it('a scripted 1..8 key sequence switches the active screen, each producing a distinct frame', async () => {
    const { lastFrame, stdin } = await renderShell();
    const seen = new Set<string>();
    for (let id = 1; id <= 8; id += 1) {
      await press(stdin, String(id));
      const frame = stripAnsi(lastFrame() ?? '');
      expect(seen.has(frame)).toBe(false);
      seen.add(frame);
    }
    expect(stripAnsi(lastFrame() ?? '')).toContain('Customize');
  });

  it('Tab/Shift+Tab cycles pane focus within a screen without ever changing the active screen', async () => {
    const { lastFrame, stdin } = await renderShell();
    await press(stdin, '3');
    expect(stripAnsi(lastFrame() ?? '')).toContain('Specs (pane 0)');
    await press(stdin, TAB);
    expect(stripAnsi(lastFrame() ?? '')).toContain('Specs (pane 1)');
    await press(stdin, TAB);
    expect(stripAnsi(lastFrame() ?? '')).toContain('Specs (pane 2)');
    await press(stdin, SHIFT_TAB);
    expect(stripAnsi(lastFrame() ?? '')).toContain('Specs (pane 1)');
  });

  it('switching the active screen resets pane focus back to 0', async () => {
    const { lastFrame, stdin } = await renderShell();
    await press(stdin, TAB);
    await press(stdin, TAB);
    expect(stripAnsi(lastFrame() ?? '')).toContain('Home (pane 2)');
    await press(stdin, '2');
    expect(stripAnsi(lastFrame() ?? '')).toContain('Run (pane 0)');
  });

  it('resizing below 100 columns collapses the header to the single-pane/tab-bar layout', async () => {
    const instance = await renderShell();
    const wideFrame = stripAnsi(instance.lastFrame() ?? '');
    expect(wideFrame).toContain('FORGE');

    Object.defineProperty(instance.stdout, 'columns', { configurable: true, get: () => 80 });
    (instance.stdout as unknown as { rows: number }).rows = 40;
    instance.stdout.emit('resize');
    await flush();
    const narrowFrame = stripAnsi(instance.lastFrame() ?? '');
    expect(narrowFrame).not.toContain('FORGE');
    expect(narrowFrame).toMatch(/^\[1\*\]\[2\]\[3\]\[4\]\[5\]\[6\]\[7\]\[8\]/);
  });

  it('resizing below 24 rows drops the footer to a single key hint', async () => {
    const instance = await renderShell();
    const wideFrame = stripAnsi(instance.lastFrame() ?? '');
    expect(wideFrame).toContain('quit');

    Object.defineProperty(instance.stdout, 'columns', { configurable: true, get: () => 120 });
    (instance.stdout as unknown as { rows: number }).rows = 10;
    instance.stdout.emit('resize');
    await flush();
    const shortFrame = stripAnsi(instance.lastFrame() ?? '');
    expect(shortFrame).toContain('? help');
    expect(shortFrame).not.toContain('quit');
  });

  it('a single open modal receives keys, and Esc pops it back to the bare screen', async () => {
    const onFirstModalKey = vi.fn();
    function FirstModalContent(): ReturnType<ScreenEntry['component']> {
      useInput(() => {
        onFirstModalKey();
      });
      return <Text>first modal</Text>;
    }

    function OpensFirstModal(): ReturnType<ScreenEntry['component']> {
      const { push } = useAppModalStack();
      const isBackgrounded = useIsBackgrounded();
      useInput(
        (input) => {
          if (input === 'o') {
            push({ id: 'first', render: () => <FirstModalContent /> });
          }
        },
        { isActive: !isBackgrounded },
      );
      return <Text>screen</Text>;
    }
    const screens = new Map<ScreenId, ScreenEntry>([
      [1, { label: 'Home', component: OpensFirstModal }],
    ]);

    const { lastFrame, stdin } = await renderShell({ screens });
    await press(stdin, 'o');
    expect(stripAnsi(lastFrame() ?? '')).toContain('first modal');

    await press(stdin, 'z'); // any key while the first modal is open reaches FirstModalContent...
    expect(onFirstModalKey).toHaveBeenCalledTimes(1);

    await press(stdin, ESC);
    // Popped exactly one level: back to the bare screen, since only one modal was ever actually pushed.
    expect(stripAnsi(lastFrame() ?? '')).not.toContain('first modal');
    expect(stripAnsi(lastFrame() ?? '')).toContain('screen');
  });

  it('a second, real modal pushed while the first is still open makes only the second respond to keys, and Esc pops exactly one level back to the first', async () => {
    const onFirstModalKey = vi.fn();
    function FirstModalContent(): ReturnType<ScreenEntry['component']> {
      const { push } = useAppModalStack();
      useInput((input) => {
        onFirstModalKey();
        if (input === 'o') push({ id: 'second', render: () => <Text>second modal</Text> });
      });
      return <Text>first modal</Text>;
    }
    function OpensFirstModal(): ReturnType<ScreenEntry['component']> {
      const { push } = useAppModalStack();
      const isBackgrounded = useIsBackgrounded();
      useInput(
        (input) => {
          if (input === 'o') push({ id: 'first', render: () => <FirstModalContent /> });
        },
        { isActive: !isBackgrounded },
      );
      return <Text>screen</Text>;
    }
    const screens = new Map<ScreenId, ScreenEntry>([
      [1, { label: 'Home', component: OpensFirstModal }],
    ]);

    const { lastFrame, stdin } = await renderShell({ screens });
    await press(stdin, 'o');
    expect(stripAnsi(lastFrame() ?? '')).toContain('first modal');
    await press(stdin, 'o');
    expect(stripAnsi(lastFrame() ?? '')).toContain('second modal');
    expect(onFirstModalKey).toHaveBeenCalledTimes(1); // only the "o" that opened it, never the one after

    await press(stdin, 'z');
    // The key reached nobody's useInput usefully observable here except proving the frame is unchanged
    // (still showing the second modal) -- the real proof is the next assertion: Esc pops exactly one
    // level, landing back on the FIRST modal, never all the way back to the bare screen.
    expect(stripAnsi(lastFrame() ?? '')).toContain('second modal');

    await press(stdin, ESC);
    expect(stripAnsi(lastFrame() ?? '')).toContain('first modal');
    expect(stripAnsi(lastFrame() ?? '')).not.toContain('second modal');

    await press(stdin, ESC);
    expect(stripAnsi(lastFrame() ?? '')).toContain('screen');
    expect(stripAnsi(lastFrame() ?? '')).not.toContain('first modal');
  });

  it('a scripted key sequence targeting content behind an open modal produces zero effect on that background content', async () => {
    const onBackgroundKey = vi.fn();
    function ScreenWithModal(): ReturnType<ScreenEntry['component']> {
      const { push } = useAppModalStack();
      const isBackgrounded = useIsBackgrounded();
      useInput(
        (input) => {
          if (input === 'o') push({ id: 'm', render: () => <Text>modal</Text> });
          onBackgroundKey();
        },
        { isActive: !isBackgrounded },
      );
      return <Text>home</Text>;
    }
    const screens = new Map<ScreenId, ScreenEntry>([
      [1, { label: 'Home', component: ScreenWithModal }],
    ]);
    const { lastFrame, stdin } = await renderShell({ screens });
    await press(stdin, 'o');
    expect(stripAnsi(lastFrame() ?? '')).toContain('modal');
    expect(onBackgroundKey).toHaveBeenCalledTimes(1); // the "o" that opened it
    // AppShell's own global keys (screen switching) must also be inert while a modal is open.
    await press(stdin, '2');
    expect(stripAnsi(lastFrame() ?? '')).toContain('modal');
    // And the background screen's own useInput -- which honours useIsBackgrounded() -- received
    // nothing further either.
    expect(onBackgroundKey).toHaveBeenCalledTimes(1);
  });

  it('p/r/a/x invoke their own injected callbacks, and are safe no-ops when no callback is given', async () => {
    const onPause = vi.fn();
    const onResume = vi.fn();
    const onApproveGate = vi.fn();
    const onRejectGate = vi.fn();
    const { stdin } = await renderShell({ onPause, onResume, onApproveGate, onRejectGate });
    await press(stdin, 'p');
    await press(stdin, 'r');
    await press(stdin, 'a');
    await press(stdin, 'x');
    expect(onPause).toHaveBeenCalledTimes(1);
    expect(onResume).toHaveBeenCalledTimes(1);
    expect(onApproveGate).toHaveBeenCalledTimes(1);
    expect(onRejectGate).toHaveBeenCalledTimes(1);

    // No callbacks given at all -- these keys must not throw.
    const { stdin: bareStdin } = await renderShell();
    await press(bareStdin, 'p');
    await press(bareStdin, 'r');
    await press(bareStdin, 'a');
    await press(bareStdin, 'x');
  });

  it('Ctrl+L flushes the coalesced read model immediately, without waiting for the 100ms window', async () => {
    const client = createFakeClient();
    let renderCount = 0;
    function CountingScreen(): ReturnType<ScreenEntry['component']> {
      renderCount += 1;
      return <Text>counting</Text>;
    }
    const screens = new Map<ScreenId, ScreenEntry>([
      [1, { label: 'Home', component: CountingScreen }],
    ]);
    const { stdin } = await renderShell({ client, screens });
    const countBeforeEmit = renderCount;

    client.emit(makeEvent('UsageRecorded', { payload: { costUsd: 1 } }));
    await flush();
    expect(renderCount).toBe(countBeforeEmit); // still inside the coalescing window

    await press(stdin, '\x0C'); // Ctrl+L
    expect(renderCount).toBe(countBeforeEmit + 1);
  });

  it('the header reports only active lanes, excluding any removed from the count', async () => {
    const client = createFakeClient();
    const { lastFrame } = await renderShell({ client });
    client.emit(makeEvent('LaneCreated', { laneId: 'lane-a' }));
    client.emit(makeEvent('LaneCreated', { laneId: 'lane-b' }));
    client.emit(makeEvent('LaneRemoved', { laneId: 'lane-b' }));
    await flush();
    await new Promise((resolve) => setTimeout(resolve, 110));
    await flush();
    expect(stripAnsi(lastFrame() ?? '')).toContain('● 1 lanes');
  });

  it('unmounting cleanly unsubscribes from both the store and the client, without throwing', async () => {
    const client = createFakeClient();
    const { unmount } = await renderShell({ client });
    expect(() => {
      unmount();
    }).not.toThrow();
    // A later event on an unmounted client's own listeners must not throw either.
    expect(() => {
      client.emit(makeEvent('RunStarted'));
    }).not.toThrow();
  });

  it('a real client.onNotification gap is wired to a visible banner, not silently dropped -- a fresh critic round reproduced the original design subscribing to client.subscribe (events) only, so a genuine telemetry read failure produced zero visible signal at all', async () => {
    const client = createFakeClient();
    const { lastFrame } = await renderShell({ client });
    expect(stripAnsi(lastFrame() ?? '')).not.toContain('⚠');

    const notification: EngineClientNotification = {
      type: 'gap',
      message: 'telemetry log unreadable',
    };
    client.emitNotification(notification);
    await flush();
    expect(stripAnsi(lastFrame() ?? '')).toContain('⚠ telemetry log unreadable');
  });

  it('"q" with no active run quits immediately via the injected callback', async () => {
    const onQuit = vi.fn();
    const { stdin } = await renderShell({ onQuit });
    await press(stdin, 'q');
    expect(onQuit).toHaveBeenCalledTimes(1);
  });

  it('"q" with an active run prompts instead of quitting silently, and "y" confirms', async () => {
    const onQuit = vi.fn();
    const client = createFakeClient();
    const { lastFrame, stdin } = await renderShell({ onQuit, client });
    client.emit(makeEvent('RunStarted'));
    await flush();
    await new Promise((resolve) => setTimeout(resolve, 110));
    await flush();

    await press(stdin, 'q');
    expect(onQuit).not.toHaveBeenCalled();
    expect(stripAnsi(lastFrame() ?? '')).toContain('Quit anyway?');
    await press(stdin, 'y');
    expect(onQuit).toHaveBeenCalledTimes(1);
  });

  it('"q" with an active run: "n" cancels, never quitting', async () => {
    const onQuit = vi.fn();
    const client = createFakeClient();
    const { lastFrame, stdin } = await renderShell({ onQuit, client });
    client.emit(makeEvent('RunStarted'));
    await flush();
    await new Promise((resolve) => setTimeout(resolve, 110));
    await flush();

    await press(stdin, 'q');
    await press(stdin, 'n');
    expect(onQuit).not.toHaveBeenCalled();
    expect(stripAnsi(lastFrame() ?? '')).not.toContain('Quit anyway?');
  });

  it('"q" with a PAUSED run also prompts, not just started/resumed -- a paused run is still active, not yet finished', async () => {
    const onQuit = vi.fn();
    const client = createFakeClient();
    const { lastFrame, stdin } = await renderShell({ onQuit, client });
    client.emit(makeEvent('RunStarted'));
    client.emit(makeEvent('RunPaused'));
    await flush();
    await new Promise((resolve) => setTimeout(resolve, 110));
    await flush();

    await press(stdin, 'q');
    expect(onQuit).not.toHaveBeenCalled();
    expect(stripAnsi(lastFrame() ?? '')).toContain('Quit anyway?');
  });

  it('"q" stacks the quit prompt on top of a screen\'s own already-open modal, rather than being silently swallowed -- a fresh critic round reproduced the original design gating "q" identically to every other global key (inert while any modal is open), leaving a run\'s own quit-safety net completely unreachable the moment a screen had any modal open', async () => {
    function OpensOwnModal(): ReturnType<ScreenEntry['component']> {
      const { push } = useAppModalStack();
      const isBackgrounded = useIsBackgrounded();
      useInput(
        (input) => {
          if (input === 'o') push({ id: 'own', render: () => <Text>own modal</Text> });
        },
        { isActive: !isBackgrounded },
      );
      return <Text>screen</Text>;
    }
    const screens = new Map<ScreenId, ScreenEntry>([
      [1, { label: 'Home', component: OpensOwnModal }],
    ]);
    const onQuit = vi.fn();
    const client = createFakeClient();
    const { lastFrame, stdin } = await renderShell({ onQuit, client, screens });
    client.emit(makeEvent('RunStarted'));
    await flush();
    await new Promise((resolve) => setTimeout(resolve, 110));
    await flush();

    await press(stdin, 'o');
    expect(stripAnsi(lastFrame() ?? '')).toContain('own modal');

    await press(stdin, 'q');
    expect(stripAnsi(lastFrame() ?? '')).toContain('Quit anyway?');
    expect(stripAnsi(lastFrame() ?? '')).not.toContain('own modal');

    // Cancelling the quit prompt pops exactly one level, back to the screen's own modal -- never all
    // the way back to the bare screen.
    await press(stdin, 'n');
    expect(stripAnsi(lastFrame() ?? '')).toContain('own modal');
    expect(onQuit).not.toHaveBeenCalled();
  });

  it('typing the literal letter "q" into a free-text elicitation field never triggers the quit prompt, when the pushed modal declares capturesTextInput -- a second critic round reproduced the first fix\'s own regression: an unconditionally-active "q" binding silently yanked a real, in-progress QuestionForm text answer into a quit prompt instead, since Ink\'s useInput has no "only the topmost consumer sees this key" routing', async () => {
    function OpensTextModal(): ReturnType<ScreenEntry['component']> {
      const { push } = useAppModalStack();
      const isBackgrounded = useIsBackgrounded();
      useInput(
        (input) => {
          if (input === 'o') {
            push({
              id: 'text-question',
              capturesTextInput: true,
              render: () => (
                <QuestionForm
                  questions={[{ id: 'q1', kind: 'text', prompt: 'Explain?' }]}
                  onAnswer={() => undefined}
                  focused
                />
              ),
            });
          }
        },
        { isActive: !isBackgrounded },
      );
      return <Text>screen</Text>;
    }
    const screens = new Map<ScreenId, ScreenEntry>([
      [1, { label: 'Home', component: OpensTextModal }],
    ]);
    const onQuit = vi.fn();
    const client = createFakeClient();
    const { lastFrame, stdin } = await renderShell({ onQuit, client, screens });
    client.emit(makeEvent('RunStarted'));
    await flush();
    await new Promise((resolve) => setTimeout(resolve, 110));
    await flush();

    await press(stdin, 'o');
    await press(stdin, 'quick fix');
    const frame = stripAnsi(lastFrame() ?? '');
    expect(frame).toContain('> quick fix');
    expect(frame).not.toContain('Quit anyway?');
    expect(onQuit).not.toHaveBeenCalled();
  });

  it('a burst of 50 real engine events arriving inside one 100ms window produces exactly one re-render, not 50', async () => {
    const client = createFakeClient();
    let renderCount = 0;
    function CountingScreen(): ReturnType<ScreenEntry['component']> {
      renderCount += 1;
      return <Text>counting</Text>;
    }
    const screens = new Map<ScreenId, ScreenEntry>([
      [1, { label: 'Home', component: CountingScreen }],
    ]);
    await renderShell({ client, screens });
    const countBeforeBurst = renderCount;

    for (let index = 0; index < 50; index += 1) {
      client.emit(makeEvent('UsageRecorded', { payload: { costUsd: 0.01 } }));
    }
    await flush();
    // Not yet flushed -- still inside the 100ms coalescing window.
    expect(renderCount).toBe(countBeforeBurst);

    await new Promise((resolve) => setTimeout(resolve, 110));
    await flush();
    expect(renderCount).toBe(countBeforeBurst + 1);
  });

  it('keys are ignored entirely when routed through the focus-trap while a modal is open, confirmed via the pane-focus Tab key too', async () => {
    function PushesModal(): ReturnType<ScreenEntry['component']> {
      const { push } = useAppModalStack();
      const isBackgrounded = useIsBackgrounded();
      useInput(
        (input) => {
          if (input === 'o') push({ id: 'm', render: () => <Text>modal</Text> });
        },
        { isActive: !isBackgrounded },
      );
      return <Text>home</Text>;
    }
    const screens = new Map<ScreenId, ScreenEntry>([
      [1, { label: 'Home', component: PushesModal }],
    ]);
    const { lastFrame, stdin } = await renderShell({ screens });
    await press(stdin, 'o');
    await press(stdin, TAB);
    await press(stdin, UP);
    await press(stdin, DOWN);
    expect(stripAnsi(lastFrame() ?? '')).toContain('modal');
  });
});
