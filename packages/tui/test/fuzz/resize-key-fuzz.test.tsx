/**
 * `tui fuzz`: `04` §4.8's own first named milestone exit-test surface (`PLAN-M9.md` P16) -- a real,
 * seeded 10,000-iteration random resize + key fuzz test driving a real, fully-composed `<AppShell>`
 * (mounted once, per the Check's own "mounted once via ink-testing-library"), asserting no thrown error
 * escapes the render tree and no unhandled promise rejection occurs across the whole run.
 *
 * **Seeded, not `Math.random()`**: `mulberry32` below is a small, deterministic PRNG seeded from a
 * fixed constant -- a failure is reproducible from the logged seed and iteration index, never a genuine
 * one-off flake this suite could neither reproduce nor debug.
 *
 * **Two, deliberately different detection paths -- not one boundary covering everything**:
 * `ink-testing-library`'s own `render()` already wraps every tree in Ink's own internal error boundary
 * (`InternalApp`, confirmed directly against `ink@5.2.1`'s own source) -- a component that throws during
 * *render* is caught *there* and never escapes as a JS exception this test could `try`/`catch`, it only
 * ever surfaces as a `console.error` call. `<FuzzErrorBoundary>` below is deliberately placed as the
 * immediate parent of `<AppShell>` for exactly that class of throw. **But a round-1 critic found this
 * package's own real interactive logic overwhelmingly lives in `useInput` handlers, not render bodies**
 * (every one of the 8 real screens fuzzed below), **and Ink's own key-dispatch runs entirely outside
 * React's render/commit cycle** -- a plain, synchronous `EventEmitter.emit` chain starting at
 * `stdin.write()` -- so a throw from inside a `useInput` handler propagates synchronously back out of
 * `stdin.write()` itself and is never seen by any React error boundary at all, verified directly by
 * probing Ink's own dispatch internals. `dispatchOneAction()` below wraps the real key/resize call sites
 * (`stdin.write`/`stdout.emit('resize')`) in its own `try`/`catch`, recording into the identical
 * `caughtErrors` array the boundary uses. A round-2 critic found a *third* such site -- the main loop's
 * own periodic `client.emit(...)` (below), since `store.dispatch` (`store.ts`) deliberately re-throws if
 * any of its own listeners throws and `fuzzClient()`'s own `emit` has no per-listener isolation the way
 * the real `EngineClient.notify()` does -- now wrapped identically, at its own call site. All three
 * detection paths converge on the same "iteration N, seed S, reproducible" diagnostic.
 *
 * **The mutation-tested negative control** (the Check's own "a deliberately-reintroduced known bug...
 * actually fails it"): a second, small test wraps a deliberately broken screen component (throws for a
 * real, reachable narrow-terminal condition, from its own render body) in the identical
 * `<FuzzErrorBoundary>` wiring the main fuzz test relies on, and resizes to a column count *known* to
 * trigger it -- proving that specific detection path actually works, deterministically, rather than
 * trusting the main run's own random coverage to have happened to touch a broken path. It covers the
 * render-phase path only; the `try`/`catch` around `dispatchOneAction()` covers the event-handler-phase
 * path by construction (a synchronous `catch` around the one call site that can throw needs no separate
 * proof the way an asynchronous React error boundary does).
 *
 * **A real async surface, not just wiring**: the original draft's fake `EngineClient` never actually
 * called a subscribed listener, so `<AppShell>`'s own real, debounced `store.dispatch` ->
 * `setTimeout(flush, REDRAW_WINDOW_MS)` redraw path -- the one genuinely asynchronous code path in the
 * whole fuzzed component tree -- never fired once across all 10,000 iterations, leaving the
 * `process.on('unhandledRejection', ...)` listener below with no real async work to ever catch a
 * rejection from. `fuzzClient()` below actually delivers a real, synthetic `ForgeEvent` through its
 * listeners periodically during the loop, interleaved with the random resize/key chaos -- exercising
 * real timer scheduling/clearing races against both further dispatches and eventual unmount.
 *
 * @see specs/04 §4.8
 * @see PLAN-M9.md P16
 */
import { Component, type JSX, type ReactNode } from 'react';
import { Text, useInput } from 'ink';
import { render } from 'ink-testing-library';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  AppShell,
  type ScreenEntry,
  type ScreenId,
  type ScreenProps,
} from '../../src/components/app-shell.tsx';
import type { RenderMode } from '../../src/env.ts';
import type { EngineClient } from '../../src/state/engine-client.ts';
import type { ForgeEvent } from '@forge/telemetry/events';
import { INITIAL_RUN_READ_MODEL } from '../../src/state/run-read-model.ts';
import { CostScreen } from '../../src/screens/cost.tsx';
import { CustomizeScreen } from '../../src/screens/customize.tsx';
import { GatesScreen } from '../../src/screens/gates.tsx';
import { HomeScreen } from '../../src/screens/home.tsx';
import { KbScreen } from '../../src/screens/kb.tsx';
import { RunBoard } from '../../src/screens/run-board.tsx';
import { SessionsScreen } from '../../src/screens/sessions.tsx';
import { SpecsScreen } from '../../src/screens/specs.tsx';
import { SpecGraph } from '@forge/core/graph';

function flush(): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(resolve);
  });
}

/** A small, deterministic PRNG (mulberry32) -- seeded, so a failure is reproducible from the logged seed
 * and iteration index alone, never a genuine one-off flake. */
function mulberry32(seed: number): () => number {
  let state = seed;
  return function next(): number {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pickFrom<T>(rng: () => number, items: readonly T[]): T {
  const index = Math.floor(rng() * items.length);
  return items[Math.min(index, items.length - 1)]!;
}

const KEY_POOL: readonly string[] = [
  '1',
  '2',
  '3',
  '4',
  '5',
  '6',
  '7',
  '8',
  '\t',
  '\x1B[Z', // Tab / Shift+Tab
  '\x1B[A',
  '\x1B[B',
  '\x1B[C',
  '\x1B[D', // arrows
  '\r',
  '\x1B',
  '\x7F', // Enter / Esc / Backspace
  ' ',
  '/',
  ':',
  'q',
  'g',
  'G',
  'j',
  'k',
  'c',
  's',
  'd',
  't',
  'e',
  'r',
  'E',
  'a',
  'm',
  'x',
  'n',
  'o',
  'z',
  '?',
  '.',
  '-',
  '0',
  '9',
];

interface FuzzErrorBoundaryProps {
  readonly onError: (error: unknown) => void;
  readonly children: ReactNode;
}

interface FuzzErrorBoundaryState {
  readonly hasError: boolean;
}

/** Placed as `<AppShell>`'s own immediate parent -- inside Ink's tree, outside `<AppShell>` itself -- so
 * a real render-time throw from anywhere inside it is caught *here* first, recorded explicitly via
 * `onError`, and this boundary then renders `null` for that one bad commit rather than propagating
 * further (matching this codebase's own "isolate one bad listener/component, never let it take down the
 * rest" discipline already established in `store.ts`/`engine-client.ts`). */
class FuzzErrorBoundary extends Component<FuzzErrorBoundaryProps, FuzzErrorBoundaryState> {
  override state: FuzzErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): FuzzErrorBoundaryState {
    return { hasError: true };
  }

  override componentDidCatch(error: unknown): void {
    this.props.onError(error);
  }

  override render(): ReactNode {
    if (this.state.hasError) return null;
    return this.props.children;
  }
}

const FIXED_PROJECT = {
  name: 'acme-billing',
  level: 'L2' as const,
  platform: 'adapter-x',
  stages: ['MVP'],
  currentStageIndex: 0,
  autonomy: 'supervised' as const,
};

const FIXED_HEALTH = {
  kb: { entries: 10, stale: 0, contradictions: 0 },
  specs: { epics: 2, stories: 5, orphanStories: 0, traceabilityPct: 100 },
  build: { passing: true, lastRunAgo: '1m', testsPassed: 10, testsTotal: 10, coveragePct: 90 },
  gates: [],
};

/** A real, fully-composed 8-screen map -- every real screen this milestone shipped, not a stand-in --
 * each wrapped with the minimal, representative fixed data `test/ascii-matrix.test.tsx` (P15) already
 * established works cleanly for exactly this "compose a real screen behind `ScreenProps` alone" need. */
function realScreens(): ReadonlyMap<ScreenId, ScreenEntry> {
  return new Map<ScreenId, ScreenEntry>([
    [
      1,
      {
        label: 'Home',
        component: (props: ScreenProps) => (
          <HomeScreen
            {...props}
            project={FIXED_PROJECT}
            health={FIXED_HEALTH}
            nextActionCandidates={[]}
            recentActivity={[]}
          />
        ),
      },
    ],
    [
      2,
      {
        label: 'Run',
        component: (props: ScreenProps) => (
          <RunBoard
            {...props}
            lanes={[{ id: 'lane-1', label: 'lane one', status: 'running' }]}
            laneDetails={
              new Map([
                [
                  'lane-1',
                  {
                    id: 'lane-1',
                    headline: 'step 1',
                    transcript: ['line one', 'line two'],
                    diffPatch: '',
                    files: [],
                    checks: [],
                    prompt: 'do the thing',
                  },
                ],
              ])
            }
            scheduler={{
              ready: 1,
              running: 1,
              runningCap: 2,
              blocked: 0,
              mergeQueue: 0,
              spentUsd: 1,
              budgetCapUsd: 10,
            }}
            interjectSupported
            onCommand={() => undefined}
          />
        ),
      },
    ],
    [
      3,
      {
        label: 'Specs',
        component: (props: ScreenProps) => (
          <SpecsScreen {...props} graph={SpecGraph.build([])} onCommand={() => undefined} />
        ),
      },
    ],
    [
      4,
      {
        label: 'KB',
        component: (props: ScreenProps) => (
          <KbScreen
            {...props}
            entries={[]}
            findings={[]}
            diagramsByEntryId={new Map()}
            writeHistoryByEntryId={new Map()}
            onCommand={() => undefined}
            onOpenDiagram={() => undefined}
          />
        ),
      },
    ],
    [
      5,
      {
        label: 'Gates',
        component: (props: ScreenProps) => (
          <GatesScreen
            {...props}
            gates={[
              {
                id: 'gate-1',
                label: 'gate one',
                status: 'pass',
                deterministicChecks: [{ id: 'check-1', status: 'pass', detail: 'ok' }],
                advisoryChecks: [],
                openQuestions: [],
                alwaysHuman: false,
              },
            ]}
            onCommand={() => undefined}
          />
        ),
      },
    ],
    [
      6,
      {
        label: 'Sessions',
        component: (props: ScreenProps) => (
          <SessionsScreen {...props} sessions={[]} onCommand={() => undefined} />
        ),
      },
    ],
    [
      7,
      {
        label: 'Cost',
        component: (props: ScreenProps) => (
          <CostScreen
            {...props}
            entries={[]}
            runLabel="acme-billing"
            stageBreakdown={[]}
            burnDownSeries={[1, 2]}
            velocitySeries={[1, 2]}
            mergedStoryCount={1}
          />
        ),
      },
    ],
    [
      8,
      {
        label: 'Customize',
        component: (props: ScreenProps) => (
          <CustomizeScreen
            {...props}
            modifiedCountBySurfaceId={new Map()}
            fieldsBySurfaceId={new Map()}
            testStatusBySurfaceId={new Map()}
            onCommand={() => undefined}
          />
        ),
      },
    ],
  ]);
}

interface FuzzClient extends EngineClient {
  /** Feeds a synthetic event to every currently-subscribed listener, synchronously -- letting the fuzz
   * loop periodically drive `<AppShell>`'s own real `store.dispatch` -> debounced-redraw `setTimeout`
   * path. A round-1 critic found the original `noopClient` never called a listener at all, so that real
   * timer (`app-shell.tsx`'s own `REDRAW_WINDOW_MS` debounce) never fired once across all 10,000
   * iterations -- leaving the `process.on('unhandledRejection', ...)` machinery wired but with no real
   * async surface in the whole run to actually exercise it against. */
  emit(event: ForgeEvent): void;
}

function fuzzClient(): FuzzClient {
  const listeners = new Set<(event: ForgeEvent) => void>();
  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    onNotification: () => () => undefined,
    stop: () => undefined,
    emit(event) {
      for (const listener of listeners) listener(event);
    },
  };
}

const MODE: RenderMode = { color: true, ascii: false, linear: false, columns: 120, lines: 40 };

let unhandledRejections: unknown[] = [];
function onUnhandledRejection(reason: unknown): void {
  unhandledRejections.push(reason);
}

beforeEach(() => {
  unhandledRejections = [];
  process.on('unhandledRejection', onUnhandledRejection);
});

afterEach(() => {
  process.off('unhandledRejection', onUnhandledRejection);
});

const FUZZ_EVENT_TYPES: readonly ForgeEvent['type'][] = [
  'StepScheduled',
  'StepStarted',
  'StepSucceeded',
  'StepFailed',
  'LaneCreated',
  'LaneCommitted',
  'LaneReady',
  'UsageRecorded',
];

describe('tui fuzz: resize + key (04 §4.8)', () => {
  it('survives 10,000 randomised, seeded resize + key iterations against a real, fully-composed AppShell with zero crashes and zero unhandled rejections', async () => {
    const SEED = 0x5eed_1234;
    const ITERATIONS = 10_000;
    const rng = mulberry32(SEED);

    const caughtErrors: { readonly iteration: number; readonly error: unknown }[] = [];
    let iteration = 0;

    const client = fuzzClient();
    const { stdin, stdout, unmount } = render(
      <FuzzErrorBoundary
        onError={(error) => {
          caughtErrors.push({ iteration, error });
        }}
      >
        <AppShell
          client={client}
          screens={realScreens()}
          mode={MODE}
          productName="acme-billing"
          stageLabel="MVP (2/7 epics)"
          budgetCapUsd={25}
          elapsedMs={18 * 60_000}
          onQuit={() => undefined}
        />
      </FuzzErrorBoundary>,
    );
    await flush();

    /** A round-1 critic found that `stdin.write()`/`stdout.emit('resize')` calls left unwrapped can
     * throw synchronously all the way out of `useInput`'s own handler -- Ink's own event dispatch runs
     * *outside* React's render/commit cycle (a plain, synchronous `EventEmitter.emit` chain), so
     * `<FuzzErrorBoundary>` (a real React error boundary, only ever invoked for a render/commit-phase
     * throw) never sees it at all. Catching it explicitly here, at the one real call site that can
     * produce it, gives every class of throw this fuzzer can reach the identical "iteration N, seed S,
     * reproducible" diagnostic -- not just the render-phase ones the mutation-tested negative control
     * below exercises. */
    function dispatchOneAction(): void {
      try {
        if (rng() < 0.3) {
          // A resize event -- real, adversarial bounds: as narrow/short as 1, as wide/tall as 300/100.
          const columns = 1 + Math.floor(rng() * 300);
          const lines = 1 + Math.floor(rng() * 100);
          Object.defineProperty(stdout, 'columns', { configurable: true, get: () => columns });
          (stdout as unknown as { rows: number }).rows = lines;
          stdout.emit('resize');
        } else {
          stdin.write(pickFrom(rng, KEY_POOL));
        }
      } catch (error) {
        caughtErrors.push({ iteration, error });
      }
    }

    let seq = 0;
    try {
      for (iteration = 0; iteration < ITERATIONS; iteration += 1) {
        dispatchOneAction();
        // Every 7th iteration also drives a real event through `client` -- a round-1 critic found the
        // original harness's client never called a listener at all, so `<AppShell>`'s own real,
        // debounced `store.dispatch` -> `setTimeout(flush, REDRAW_WINDOW_MS)` redraw path (the one real
        // async surface in the whole component tree) never fired once across all 10,000 iterations,
        // leaving the `unhandledRejection` listener below with nothing real to actually catch a
        // rejection from. This interleaves real event delivery with the random resize/key chaos,
        // including realistic races against an in-flight debounce timer and against unmount.
        //
        // Wrapped in its own `try`/`catch`, same as `dispatchOneAction()` -- a round-2 critic found this
        // was the one remaining unwrapped synchronous-throw call site: `store.dispatch` (`store.ts`)
        // deliberately re-throws an `AggregateError` if any of its own listeners throws (by its own
        // design, for a real caller to handle), and `fuzzClient()`'s own `emit` has no per-listener
        // isolation the way the real `EngineClient.notify()` does -- so a future throwing reducer branch
        // or a throwing `<AppShell>`-internal store listener would otherwise propagate straight out of
        // this call, uncaught by either detection path, with none of the "iteration N, seed S" context.
        if (iteration % 7 === 0) {
          seq += 1;
          try {
            client.emit({
              v: 1,
              seq,
              ts: new Date(2026, 0, 1, 0, 0, seq).toISOString(),
              runId: 'run-fuzz',
              type: pickFrom(rng, FUZZ_EVENT_TYPES),
              stepId: 'step-1',
              laneId: 'lane-1',
              payload: { costUsd: rng() },
            });
          } catch (error) {
            caughtErrors.push({ iteration, error });
          }
        }
        if (iteration % 50 === 0) await flush();
        if (caughtErrors.length > 0) break; // fail fast once one is caught, keep the log short.
      }
      await flush();
    } finally {
      unmount();
    }

    if (caughtErrors.length > 0) {
      const first = caughtErrors[0];
      throw new Error(
        `tui fuzz: a real error was caught at iteration ${String(first?.iteration)} (seed ${String(SEED)}, reproducible) -- ${String(first?.error)}`,
      );
    }
    expect(caughtErrors).toEqual([]);
    // Real unhandled rejections surface asynchronously -- one more macrotask turn after the loop's own
    // last `flush()` so any still in flight have a chance to actually fire before this assertion runs.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(unhandledRejections).toEqual([]);
  }, 30_000);

  it('the mutation-tested negative control: a deliberately-reintroduced real bug (a screen that throws under a real, reachable narrow-terminal condition) is actually caught by the identical FuzzErrorBoundary wiring the main fuzz test relies on -- proving detection genuinely works, not merely that the main run never touched a broken path', async () => {
    function BrokenScreen({ mode }: ScreenProps): JSX.Element {
      // A real, reachable class of regression -- e.g. an un-guarded `columns - N` layout computation
      // going negative and indexing off the front of an array -- reintroduced here deliberately.
      if (mode.columns < 10) {
        throw new Error('BrokenScreen: mutation-tested negative control -- columns < 10');
      }
      return (
        <HomeScreen
          mode={mode}
          readModel={INITIAL_RUN_READ_MODEL}
          focusedPaneIndex={0}
          project={FIXED_PROJECT}
          health={FIXED_HEALTH}
          nextActionCandidates={[]}
          recentActivity={[]}
        />
      );
    }
    const screens = new Map<ScreenId, ScreenEntry>([
      [1, { label: 'Home', component: BrokenScreen }],
    ]);

    const caught: unknown[] = [];
    const { stdout } = render(
      <FuzzErrorBoundary
        onError={(error) => {
          caught.push(error);
        }}
      >
        <AppShell
          client={fuzzClient()}
          screens={screens}
          mode={MODE}
          productName="acme-billing"
          stageLabel="MVP (2/7 epics)"
          budgetCapUsd={25}
          elapsedMs={18 * 60_000}
          onQuit={() => undefined}
        />
      </FuzzErrorBoundary>,
    );
    await flush();
    expect(caught).toEqual([]); // not yet -- the initial mode (120 columns) does not trigger it.

    Object.defineProperty(stdout, 'columns', { configurable: true, get: () => 5 });
    (stdout as unknown as { rows: number }).rows = 40;
    stdout.emit('resize');
    await flush();

    expect(caught.length).toBeGreaterThan(0);
    expect(String(caught[0])).toContain('mutation-tested negative control');
  });

  it("a second mutation-tested negative control: a deliberately-reintroduced bug that throws from inside a real useInput handler -- not a render body -- is caught by dispatchOneAction's own try/catch, the path a round-1 critic found the render-only FuzzErrorBoundary alone cannot see at all", async () => {
    function BrokenKeyScreen(): JSX.Element {
      useInput((input) => {
        if (input === 'x') {
          throw new Error('BrokenKeyScreen: mutation-tested negative control -- "x" key handler');
        }
      });
      return <Text>broken key screen</Text>;
    }
    const screens = new Map<ScreenId, ScreenEntry>([
      [1, { label: 'Home', component: BrokenKeyScreen }],
    ]);

    const caughtErrors: { readonly iteration: number; readonly error: unknown }[] = [];
    let iteration = 0;
    const { stdin } = render(
      <FuzzErrorBoundary
        onError={(error) => {
          caughtErrors.push({ iteration, error });
        }}
      >
        <AppShell
          client={fuzzClient()}
          screens={screens}
          mode={MODE}
          productName="acme-billing"
          stageLabel="MVP (2/7 epics)"
          budgetCapUsd={25}
          elapsedMs={18 * 60_000}
          onQuit={() => undefined}
        />
      </FuzzErrorBoundary>,
    );
    await flush();
    expect(caughtErrors).toEqual([]); // not yet -- no "x" typed.

    // The identical `try`/`catch` shape `dispatchOneAction` uses in the main fuzz test above --
    // `stdin.write` is where a `useInput` handler's own throw actually surfaces, synchronously, never
    // through any React error boundary.
    try {
      iteration = 1;
      stdin.write('x');
    } catch (error) {
      caughtErrors.push({ iteration, error });
    }
    await flush();

    expect(caughtErrors.length).toBeGreaterThan(0);
    expect(String(caughtErrors[0]?.error)).toContain('mutation-tested negative control');
  });
});
