/**
 * `<AppShell>` — the piece that makes `@forge/tui` a real, running application for the first time:
 * `04` §4.2's own global chrome (header/footer), screen switching, the modal stack, resize handling,
 * and every global key binding not already owned by a leaf component (`1`-`8`, `Tab`/`Shift+Tab`,
 * `p`/`r`/`a`/`x`, `Ctrl+L`, `q`).
 *
 * `<AppShell>` owns the one real `TuiStore<RunReadModel, ForgeEvent>` this application has: it wires
 * `client.subscribe` to `store.dispatch`, and is the *one place* that actually schedules a React
 * re-render from the resulting stream of store-change notifications, coalesced into the spec's own
 * 100ms redraw window (`04` §4.1) -- a `setTimeout` armed by the *first* notification in a window,
 * every later notification inside that same window landing on an already-armed timer and changing
 * nothing further, so a burst of N events inside one window produces exactly one `setState` call, not N.
 *
 * The modal stack is a real `readonly ModalEntry[]`, but only ever ONE `<Modal>` is ever mounted at a
 * time, always showing the topmost entry's own content -- this is what actually resolves the "two
 * simultaneously-open `<Modal>`s both respond to one `Esc`" hazard `<Modal>`'s own doc comment (M9 P5)
 * disclosed rather than fixed, attributing the fix to whichever real stack-owner eventually existed:
 * `<AppShell>` is that owner. Popping removes exactly the top entry (`Esc`, or the modal's own
 * `onClose`), never the whole stack. Screens (rendered as `ScreenComponent`s) are wrapped in `<Modal>`'s
 * own `ModalStackContext.Provider value={{ isBackgrounded: <any modal open> }}`, honouring the same
 * shared focus-trap contract P5 established -- a screen that itself calls `useIsBackgrounded()` and
 * folds it into its own `useInput({ isActive })` is correctly locked out while any modal is open.
 * `<Modal>`'s own rendered content -- including a modal pushing a *second* modal on top of itself, the
 * literal scenario `<Modal>`'s own P5 doc comment names -- is rendered *inside*
 * `AppModalStackContext.Provider`, not outside it: an earlier draft of this component nested the
 * `<Modal>` element outside that provider, which meant any modal's own content calling
 * `useAppModalStack()` silently read the context's own no-op default (`push`/`pop` that do nothing) and
 * could never actually stack a second modal at all -- caught by this piece's own test-writing, not a
 * critic round, before ever leaving this machine.
 *
 * `mode` is the *initial* `RenderMode`; `columns`/`lines` are re-derived live on Ink's own `resize`
 * event (`useStdout().stdout`, an `EventEmitter` in both the real terminal and `ink-testing-library`'s
 * own fake one) rather than only ever reflecting the one snapshot `detectRenderMode` took at startup --
 * `04` §4.1's own <100-cols/<24-rows collapse rules are applied here, once, not duplicated per screen.
 *
 * `p`/`r`/`a`/`x` are real key bindings this component owns, but the actual *effect* of each (pausing a
 * run, approving a gate, ...) is injected via optional callback props -- wiring them to a real engine
 * command is out of this piece's own scope (no command-dispatch mechanism exists yet); `<AppShell>`'s
 * own job is only to own the binding and never let a leaf component duplicate it. `Ctrl+L` ("force
 * redraw") flushes the coalesced read model immediately, bypassing whatever remains of the current
 * 100ms window, rather than performing a terminal-level ANSI clear this codebase has no other use for.
 *
 * `q` is deliberately gated on its own, separate `useInput`, reachable even while a screen has some
 * other modal of its own open -- a fresh critic round reproduced directly that gating it identically to
 * every other global key (`!anyModalOpen`) left a run's own quit-safety net completely unreachable,
 * silently, the moment a screen had any modal of its own open (a gate-review confirm, a destructive-
 * action prompt, ...): pressing `q` did nothing at all, rather than stacking the quit prompt on top, the
 * same "a second modal stacks over the first" contract this component's own modal stack already
 * promises in general. A *second* critic round then reproduced the real regression that fix itself
 * introduced: `q` firing unconditionally meant typing the literal letter "q" into any free-text
 * elicitation field (`<QuestionForm>`'s own `text` question kind, P5) was silently yanked out of the
 * field and into a quit prompt instead -- Ink's `useInput` has no "only the topmost consumer sees this
 * key" routing, every active hook receives the same keystroke regardless of visual stacking. Closed by
 * `ModalEntry.capturesTextInput`: a caller pushing a modal whose own content includes free-text entry
 * sets it, suppressing this binding while that entry is topmost (also guarding against a redundant
 * second push while the quit prompt itself is already showing).
 *
 * `client.onNotification` (P1's own "real, honest signal instead of a silently-stale read model" for a
 * genuine telemetry read gap or a throwing store listener) is wired alongside `client.subscribe`, not
 * left unused -- a fresh critic round reproduced directly that an earlier draft subscribed to events
 * only, so a real read-log corruption produced no visible signal at all. The latest notification renders
 * as a one-line `⚠ <message>` banner under the header; this is a minimal, real signal, not the fuller
 * `<Toast>` queue (P2) a later screen-integration piece may still choose to route it through instead.
 *
 * @see specs/04 §4.1, §4.2, §4.3
 * @see PLAN-M9.md P6
 */
import { Box, Text, useInput, useStdout } from 'ink';
import type { JSX, ReactNode } from 'react';
import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';

import type { RenderMode } from '../env.ts';
import type { EngineClient, EngineClientNotification } from '../state/engine-client.ts';
import { INITIAL_RUN_READ_MODEL, reduceRun, type RunReadModel } from '../state/run-read-model.ts';
import { createStore } from '../state/store.ts';
import { Modal, ModalStackContext as FocusTrapContext } from './modal.tsx';

const REDRAW_WINDOW_MS = 100;
const NARROW_COLUMNS_THRESHOLD = 100;
const SHORT_LINES_THRESHOLD = 24;

export type ScreenId = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

const ALL_SCREEN_IDS: readonly ScreenId[] = [1, 2, 3, 4, 5, 6, 7, 8];

export interface ScreenProps {
  readonly mode: RenderMode;
  readonly readModel: RunReadModel;
  readonly focusedPaneIndex: number;
}

export type ScreenComponent = (props: ScreenProps) => JSX.Element;

export interface ScreenEntry {
  readonly label: string;
  readonly component: ScreenComponent;
}

export interface ModalEntry {
  readonly id: string;
  readonly render: () => ReactNode;
  /** Set by whoever pushes this entry when its own content includes free-text entry (e.g. a
   * `<QuestionForm>` `text` question) -- suppresses the global `q` binding while this entry is
   * topmost, so typing the literal letter "q" into a field is never yanked into a quit prompt instead.
   * See this file's own top doc comment for the real, reproduced bug this closes. */
  readonly capturesTextInput?: boolean;
}

export interface ModalStackApi {
  readonly push: (entry: ModalEntry) => void;
  readonly pop: () => void;
}

const noopModalStackApi: ModalStackApi = { push: () => undefined, pop: () => undefined };
export const AppModalStackContext = createContext<ModalStackApi>(noopModalStackApi);

/** A screen (or anything else mounted under `<AppShell>`) calls this to push/pop its own modals onto
 * the one real stack `<AppShell>` owns -- see this file's own top doc comment for why only the topmost
 * entry is ever actually mounted as a `<Modal>`. */
export function useAppModalStack(): ModalStackApi {
  return useContext(AppModalStackContext);
}

export interface AppShellProps {
  readonly client: EngineClient;
  readonly screens: ReadonlyMap<ScreenId, ScreenEntry>;
  readonly mode: RenderMode;
  readonly productName: string;
  readonly stageLabel: string;
  readonly budgetCapUsd: number;
  readonly elapsedMs: number;
  readonly onQuit: () => void;
  readonly onPause?: () => void;
  readonly onResume?: () => void;
  readonly onApproveGate?: () => void;
  readonly onRejectGate?: () => void;
}

export function AppShell({
  client,
  screens,
  mode,
  productName,
  stageLabel,
  budgetCapUsd,
  elapsedMs,
  onQuit,
  onPause,
  onResume,
  onApproveGate,
  onRejectGate,
}: AppShellProps): JSX.Element {
  const store = useMemo(() => createStore(INITIAL_RUN_READ_MODEL, reduceRun), []);
  const [readModel, setReadModel] = useState<RunReadModel>(() => store.getState());
  const [notification, setNotification] = useState<EngineClientNotification | undefined>(undefined);
  const redrawScheduledRef = useRef(false);
  const redrawTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    const flush = (): void => {
      redrawScheduledRef.current = false;
      redrawTimerRef.current = undefined;
      setReadModel(store.getState());
    };
    const unsubscribeStore = store.subscribe(() => {
      if (redrawScheduledRef.current) return;
      redrawScheduledRef.current = true;
      redrawTimerRef.current = setTimeout(flush, REDRAW_WINDOW_MS);
    });
    const unsubscribeClient = client.subscribe((event) => {
      store.dispatch(event);
    });
    // `EngineClient.onNotification` is the one real, honest signal a caller gets when the underlying
    // telemetry read genuinely failed (a real log-read gap, or a listener throwing) -- `engine-client.ts`
    // (M9 P1) frames this explicitly as the alternative to a silent, stale read model. A fresh critic
    // round reproduced directly that this component subscribed to `client.subscribe` (events) but never
    // called `client.onNotification` at all: a real read-log corruption produced zero visible signal to
    // the user, the read model simply going stale with nothing on screen to say so.
    const unsubscribeNotifications = client.onNotification((nextNotification) => {
      setNotification(nextNotification);
    });
    return () => {
      unsubscribeStore();
      unsubscribeClient();
      unsubscribeNotifications();
      clearTimeout(redrawTimerRef.current);
      redrawTimerRef.current = undefined;
      redrawScheduledRef.current = false;
    };
  }, [client, store]);

  const { stdout } = useStdout();
  const [columns, setColumns] = useState(mode.columns);
  const [lines, setLines] = useState(mode.lines);

  useEffect(() => {
    function handleResize(): void {
      setColumns(stdout.columns || mode.columns);
      // `Stdout` (real or `ink-testing-library`'s own fake) may not expose `rows` at all.
      const liveLines = (stdout as { rows?: number }).rows;
      setLines(liveLines && liveLines > 0 ? liveLines : mode.lines);
    }
    stdout.on('resize', handleResize);
    return () => {
      stdout.off('resize', handleResize);
    };
  }, [stdout, mode.columns, mode.lines]);

  const liveMode: RenderMode = { ...mode, columns, lines };
  const isNarrow = columns < NARROW_COLUMNS_THRESHOLD;
  const isShort = lines < SHORT_LINES_THRESHOLD;

  const [activeScreen, setActiveScreen] = useState<ScreenId>(1);
  const [focusedPaneIndex, setFocusedPaneIndex] = useState(0);
  const [modalStack, setModalStack] = useState<readonly ModalEntry[]>([]);

  const modalStackApi = useMemo<ModalStackApi>(
    () => ({
      push: (entry) => {
        setModalStack((current) => [...current, entry]);
      },
      pop: () => {
        setModalStack((current) => current.slice(0, -1));
      },
    }),
    [],
  );

  const anyModalOpen = modalStack.length > 0;

  useInput(
    (input, key) => {
      const screenId = ALL_SCREEN_IDS.find((id) => input === String(id));
      if (screenId !== undefined) {
        setActiveScreen(screenId);
        setFocusedPaneIndex(0);
        return;
      }
      if (key.tab && key.shift) {
        setFocusedPaneIndex((current) => Math.max(0, current - 1));
        return;
      }
      if (key.tab) {
        setFocusedPaneIndex((current) => current + 1);
        return;
      }
      if (input === 'p') {
        onPause?.();
        return;
      }
      if (input === 'r') {
        onResume?.();
        return;
      }
      if (input === 'a') {
        onApproveGate?.();
        return;
      }
      if (input === 'x') {
        onRejectGate?.();
        return;
      }
      if (key.ctrl && input === 'l') {
        clearTimeout(redrawTimerRef.current);
        redrawTimerRef.current = undefined;
        redrawScheduledRef.current = false;
        setReadModel(store.getState());
      }
    },
    { isActive: !anyModalOpen },
  );

  const topModal = modalStack[modalStack.length - 1];

  // `q` is deliberately its own, separately-gated `useInput` -- reachable even while a screen's own
  // modal is open (unlike every other global key above, gated by `!anyModalOpen`), unless the quit
  // prompt is *already* the topmost entry (which would otherwise push a second, redundant one) OR the
  // topmost entry has declared `capturesTextInput` (a real, reproduced regression this second guard
  // closes: a first fix made `q` unconditionally reachable, which meant typing the literal letter "q"
  // into any free-text elicitation field -- `<QuestionForm>`'s own `text` question kind, already built
  // in P5 -- was silently yanked out of the field and into a quit prompt instead, since Ink's `useInput`
  // has no "only the topmost consumer sees this key" routing: every active hook receives the same
  // keystroke, regardless of which component is visually on top). A caller pushing a modal whose own
  // content includes free-text entry sets `capturesTextInput: true` on that `ModalEntry` to suppress
  // this binding while it's topmost; `Esc` still closes/pops it normally, after which `q` is reachable
  // again the ordinary way.
  useInput(
    (input) => {
      if (input !== 'q' || topModal?.id === 'quit-prompt' || topModal?.capturesTextInput) return;
      // A paused run is still a real, active run -- not yet finished, resuming still expected -- so it
      // gets the same quit confirmation a running one does, not just `'started'`/`'resumed'`.
      if (
        readModel.runStatus === 'started' ||
        readModel.runStatus === 'resumed' ||
        readModel.runStatus === 'paused'
      ) {
        modalStackApi.push({
          id: 'quit-prompt',
          render: () => <QuitPrompt onConfirm={onQuit} onCancel={modalStackApi.pop} />,
        });
      } else {
        onQuit();
      }
    },
    { isActive: true },
  );

  const activeEntry = screens.get(activeScreen);
  const ActiveScreenComponent = activeEntry?.component;

  const header = isNarrow
    ? ALL_SCREEN_IDS.map((id) =>
        id === activeScreen ? `[${String(id)}*]` : `[${String(id)}]`,
      ).join('')
    : `FORGE ▸ ${productName} ▸ Stage: ${stageLabel} ── ● ${String(
        [...readModel.laneStatuses.values()].filter((status) => status !== 'removed').length,
      )} lanes · $${readModel.spentUsd.toFixed(2)}/$${budgetCapUsd.toFixed(2)} · ${String(
        Math.round(elapsedMs / 60_000),
      )}m`;

  const footer = isShort
    ? '? help'
    : `${[...screens.entries()]
        .map(([id, entry]) => `[${String(id)}]${entry.label}`)
        .join(' ')}  ?help :cmd  q quit`;

  return (
    <Box flexDirection="column">
      <Text>{header}</Text>
      {notification ? (
        <Text {...(liveMode.color ? { color: 'yellow' } : {})}>⚠ {notification.message}</Text>
      ) : undefined}
      <AppModalStackContext.Provider value={modalStackApi}>
        <FocusTrapContext.Provider value={{ isBackgrounded: anyModalOpen }}>
          <Box flexDirection="column">
            {ActiveScreenComponent ? (
              <ActiveScreenComponent
                mode={liveMode}
                readModel={readModel}
                focusedPaneIndex={focusedPaneIndex}
              />
            ) : undefined}
          </Box>
        </FocusTrapContext.Provider>
        <Text>{footer}</Text>
        <Modal open={modalStack.length > 0} onClose={modalStackApi.pop}>
          {topModal?.render()}
        </Modal>
      </AppModalStackContext.Provider>
    </Box>
  );
}

function QuitPrompt({
  onConfirm,
  onCancel,
}: {
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}): JSX.Element {
  useInput((input) => {
    if (input === 'y') onConfirm();
    else if (input === 'n') onCancel();
  });
  return <Text>A run is active. Quit anyway? (y/n)</Text>;
}
