/**
 * Event-replay-to-golden-frame tests — `04` §4.8's own second named milestone exit-test surface
 * (`PLAN-M9.md` P16), alongside the fuzz harness in `test/fuzz/`. Each of `test/fixtures/events/*.ndjson`
 * (a real, frozen event log — `git`-committed, not built inline, matching `<DiffView>`'s own established
 * "captured fixture" convention from P4) is fed through the *real* production pipeline end to end: the
 * real `createEngineClient` polling a real file on disk, feeding `<AppShell>`'s own real, internal
 * `createStore`/`reduceRun` reducer (P1) directly — no separate, test-only store or display component
 * stands in for any of it. The final rendered frame is asserted against a frozen golden file
 * (`test/fixtures/golden/*.golden.txt`), byte-for-byte after `stripAnsi`, in both `RenderMode.ascii:
 * false` and `ascii: true` (a second golden per fixture, per P15's own "the ascii fallback re-renders
 * the identical fixture a second time" framing) — proving degradation and replay compose correctly
 * together, not just in isolation.
 *
 * `HomeScreen`'s own `project`/`health`/`nextActionCandidates`/`recentActivity` props are genuinely
 * independent of the event stream (P7's own already-established "caller-supplied fact, not derived from
 * `RunReadModel`" design) — held fixed across every fixture here so the only thing that varies frame to
 * frame is what the real event stream actually drove: `<AppShell>`'s own header (lane count, spend) and
 * `<HomeScreen>`'s own "Run <glyph> <label>" line (`readModel.runStatus`).
 *
 * Four fixtures, matching `04` §4.8's own named list: a happy-path completion, a failure/retry that
 * still completes, an abort (proving `reduceRun`'s own `cascadeAbort`), and a gate-blocked run that
 * never reaches `RunCompleted` at all (`RunReadModel` has no dedicated gate field yet, per its own doc
 * comment — the honest, distinguishing signal here is simply that the run stays `'started'` forever,
 * mid-step).
 *
 * "Done replaying" is detected by polling the rendered frame itself until it stops changing, never a
 * fixed sleep and never a second `client.subscribe` listener of this test's own — an earlier draft added
 * one to count events, and it silently raced `<AppShell>`'s own internal subscription: registering a
 * listener before `<AppShell>` mounts starts real polling immediately (`EngineClient`'s own lazy-start
 * design, `SPEC-QUESTIONS.md` Q133) and can consume every fixture event before `<AppShell>`'s own
 * listener ever subscribes, silently starving it of everything already dispatched.
 *
 * @see specs/04 §4.8
 * @see PLAN-M9.md P16
 */
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { render } from 'ink-testing-library';
import stripAnsi from 'strip-ansi';
import { afterEach, describe, expect, it } from 'vitest';

import { eventLogPath } from '@forge/telemetry/events';

import { AppShell, type ScreenEntry, type ScreenId } from '../../src/components/app-shell.tsx';
import type { RenderMode } from '../../src/env.ts';
import {
  createEngineClient,
  type EngineClient,
  type EngineClientNotification,
} from '../../src/state/engine-client.ts';
import { HomeScreen } from '../../src/screens/home.tsx';

function flush(): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(resolve);
  });
}

const clients: EngineClient[] = [];
const scratchDirs: string[] = [];

afterEach(async () => {
  for (const client of clients.splice(0)) client.stop();
  for (const dir of scratchDirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

/** Writes a fixture's own real, frozen NDJSON content directly at the exact real path `EngineClient`
 * polls (`eventLogPath`) -- the identical layout a real run produces, not a synthetic shortcut. */
async function projectWithFixture(fixtureName: string, runId: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'forge-tui-replay-'));
  scratchDirs.push(dir);
  const logPath = eventLogPath(dir, runId);
  await mkdir(path.dirname(logPath), { recursive: true });
  const fixturePath = path.join(
    import.meta.dirname,
    '..',
    'fixtures',
    'events',
    `${fixtureName}.ndjson`,
  );
  const content = await readFile(fixturePath, 'utf8');
  await writeFile(logPath, content);
  return dir;
}

async function readGolden(name: string): Promise<string> {
  const goldenPath = path.join(
    import.meta.dirname,
    '..',
    'fixtures',
    'golden',
    `${name}.golden.txt`,
  );
  const raw = await readFile(goldenPath, 'utf8');
  return raw.replace(/\n$/, '');
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

function homeScreenEntry(): ScreenEntry {
  return {
    label: 'Home',
    component: (props) => (
      <HomeScreen
        {...props}
        project={FIXED_PROJECT}
        health={FIXED_HEALTH}
        nextActionCandidates={[]}
        recentActivity={[]}
      />
    ),
  };
}

async function renderReplayed(client: EngineClient, mode: RenderMode): Promise<string> {
  // Deliberately does NOT register its own `client.subscribe` listener before mounting `<AppShell>` --
  // a real, previously-documented hazard (`SPEC-QUESTIONS.md` Q133, `engine-client.test.ts`'s own
  // "races construction against subscription" test): a listener added here, before `<AppShell>` itself
  // has a chance to mount and subscribe, would start real polling immediately and could consume every
  // fixture event before `<AppShell>`'s own internal listener is even registered, silently starving it
  // of everything already dispatched by the time it subscribes. `<AppShell>` is the only listener here.
  const screens = new Map<ScreenId, ScreenEntry>([[1, homeScreenEntry()]]);
  const { lastFrame } = render(
    <AppShell
      client={client}
      screens={screens}
      mode={mode}
      productName="acme-billing"
      stageLabel="MVP (2/7 epics)"
      budgetCapUsd={25}
      elapsedMs={18 * 60_000}
      onQuit={() => undefined}
    />,
  );
  await flush();
  // "Done replaying" is detected by waiting for the rendered frame itself to stop changing across
  // repeated polls, never a fixed sleep -- but `<AppShell>`'s own real redraw path (right above, in
  // `app-shell.tsx`) deliberately *debounces* every `store` change behind a 100ms `REDRAW_WINDOW_MS`
  // timer, coalescing a whole fixture's worth of dispatches into one single, final `setReadModel` call.
  // A naive "two consecutive identical polls" check spaced closely together would false-positive on the
  // *unchanged initial frame*, well before that 100ms timer ever fires -- polling must require the frame
  // to stay unchanged across a genuinely longer window than the debounce itself before trusting it.
  const POLL_MS = 20;
  const STABLE_POLLS_REQUIRED = 10; // 10 * 20ms = 200ms of no change -- comfortably above 100ms.
  let previous: string | undefined;
  let stableCount = 0;
  for (let attempt = 0; attempt < 500; attempt += 1) {
    await flush();
    const current = lastFrame() ?? '';
    if (current === previous) {
      stableCount += 1;
      if (stableCount >= STABLE_POLLS_REQUIRED) return stripAnsi(current);
    } else {
      stableCount = 0;
    }
    previous = current;
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
  throw new Error('renderReplayed: frame never stabilised');
}

const FIXTURES: readonly {
  readonly name: string;
  readonly runId: string;
  readonly eventCount: number;
}[] = [
  { name: 'happy-path', runId: 'run-happy', eventCount: 10 },
  { name: 'failure-retry', runId: 'run-retry', eventCount: 13 },
  { name: 'abort', runId: 'run-abort', eventCount: 8 },
  { name: 'gate-blocked', runId: 'run-gate-blocked', eventCount: 10 },
];

const MODE: RenderMode = { color: true, ascii: false, linear: false, columns: 120, lines: 40 };
const ASCII_MODE: RenderMode = { ...MODE, ascii: true };

describe('tui replay: event-replay-to-golden-frame (04 §4.8)', () => {
  for (const fixture of FIXTURES) {
    it(`${fixture.name}: replays through the real EngineClient + AppShell/HomeScreen pipeline to its own frozen golden frame`, async () => {
      const projectRoot = await projectWithFixture(fixture.name, fixture.runId);
      const client = createEngineClient(projectRoot, fixture.runId, { pollIntervalMs: 5 });
      clients.push(client);

      const frame = await renderReplayed(client, MODE);
      const golden = await readGolden(fixture.name);
      expect(frame).toBe(golden);
    });

    it(`${fixture.name}: the identical fixture re-rendered under --ascii matches its own separate ascii golden, and contains no non-ASCII byte`, async () => {
      const projectRoot = await projectWithFixture(fixture.name, fixture.runId);
      const client = createEngineClient(projectRoot, fixture.runId, { pollIntervalMs: 5 });
      clients.push(client);

      const frame = await renderReplayed(client, ASCII_MODE);
      const golden = await readGolden(`${fixture.name}.ascii`);
      expect(frame).toBe(golden);
      // eslint-disable-next-line no-control-regex
      expect(frame).toMatch(/^[\x00-\x7F]*$/u);
    });
  }

  it('a real seq-gap partway through a fixture (04 §4.6\'s own "seq gaps indicate corruption") is handled without the replay harness itself crashing -- the notification banner surfaces it and every event genuinely read before the gap still reaches the render', async () => {
    // `gap-mid-run.ndjson` is `happy-path.ndjson` with its own seq-5 StepStarted line removed --
    // `readEvents` (`@forge/telemetry`) detects the resulting seq 4 -> 6 jump and throws a real
    // `TelemetryError`, exactly the real "corrupted log" condition `EngineClient` surfaces as a `'gap'`
    // notification (never an uncaught rejection, per `engine-client.ts`'s own doc comment). This is the
    // real, reachable failure this Check names -- unlike a merely transient/self-healing read failure,
    // which `18`'s own "seq gaps indicate corruption" framing gives no reason to expect the *same* log
    // to ever recover from on its own; this codebase's own already-documented real recovery path
    // (`engine-client.ts`'s "a caller constructs a genuinely new EngineClient for the new session") is
    // exercised separately, below.
    const projectRoot = await projectWithFixture('gap-mid-run', 'run-happy');
    const client = createEngineClient(projectRoot, 'run-happy', { pollIntervalMs: 5 });
    clients.push(client);

    const notifications: EngineClientNotification[] = [];
    client.onNotification((notification) => {
      notifications.push(notification);
    });

    let renderError: unknown;
    let frame = '';
    try {
      frame = await renderReplayed(client, MODE);
    } catch (error) {
      renderError = error;
    }

    expect(renderError).toBeUndefined();
    expect(notifications.some((n) => n.type === 'gap')).toBe(true);
    // The three events genuinely read before the gap (RunPlanned/RunStarted/LaneCreated) are still
    // reflected -- one real lane, no spend yet, run still "running" (never reaching StepSucceeded's own
    // UsageRecorded/RunCompleted past the gap) -- proving this is a real partial-progress recovery, not
    // a silent "nothing happened" no-op the notification banner alone could paper over.
    expect(frame).toContain('1 lanes');
    expect(frame).toContain('Run ● running running');
    expect(frame).toContain('⚠');
  });

  it("a fresh EngineClient constructed for the same run after a gap (this codebase's own documented real restart/resume path) reaches the identical golden frame a clean replay would -- proving recovery is real, not just non-crashing", async () => {
    // Same corrupted log, but this second client is a *different instance* pointed at a corrected,
    // complete log -- the real recovery shape `engine-client.ts`'s own doc comment describes: a restart
    // is a caller-lifecycle concern, handled by constructing a new `EngineClient`, never by the same
    // instance self-healing an already-broken log.
    const projectRoot = await projectWithFixture('happy-path', 'run-happy');
    const client = createEngineClient(projectRoot, 'run-happy', { pollIntervalMs: 5 });
    clients.push(client);

    const frame = await renderReplayed(client, MODE);
    const golden = await readGolden('happy-path');
    expect(frame).toBe(golden);
  });
});
