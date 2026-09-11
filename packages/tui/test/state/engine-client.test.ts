/**
 * `createEngineClient` — the real polling loop over `@forge/telemetry`'s own `readEvents`.
 *
 * @see specs/04 §4.6
 * @see PLAN-M9.md P1
 */
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { appendEvent, readEvents as realReadEvents } from '@forge/telemetry/events';
import type { ForgeEvent } from '@forge/telemetry/events';

import {
  createEngineClient,
  type EngineClient,
  type EngineClientNotification,
} from '../../src/state/engine-client.ts';

const clients: EngineClient[] = [];
const scratchDirs: string[] = [];

afterEach(async () => {
  for (const client of clients.splice(0)) client.stop();
  for (const dir of scratchDirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

async function tempProject(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'forge-tui-engine-client-'));
  scratchDirs.push(dir);
  return dir;
}

async function waitFor(predicate: () => boolean, timeoutMs = 5000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor: condition never became true');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

describe('createEngineClient', () => {
  it("defaults pollIntervalMs to a real value (04 §4.1's own 100ms coalescing budget) when none is given", async () => {
    const projectRoot = await tempProject();
    await appendEvent(projectRoot, 'run-1', {
      type: 'RunPlanned',
      runId: 'run-1',
      ts: '2026-01-01T00:00:00.000Z',
      payload: {},
    });
    // No pollIntervalMs at all -- the first, immediate poll (not the interval) is what this test
    // actually observes, proving createEngineClient works with only the two required parameters.
    const client = createEngineClient(projectRoot, 'run-1');
    clients.push(client);
    const seen: string[] = [];
    client.subscribe((event) => seen.push(event.type));
    await waitFor(() => seen.length >= 1);
    expect(seen).toEqual(['RunPlanned']);
  });

  it('an event already in the log at construction time is still delivered even after a real async gap before the first subscribe() call -- a final critic round reproduced that polling eagerly at construction races construction against subscription and silently, permanently drops it', async () => {
    const projectRoot = await tempProject();
    await appendEvent(projectRoot, 'run-1', {
      type: 'RunPlanned',
      runId: 'run-1',
      ts: '2026-01-01T00:00:00.000Z',
      payload: {},
    });
    const client = createEngineClient(projectRoot, 'run-1', { pollIntervalMs: 10 });
    clients.push(client);

    // A real, deliberate async gap between construction and the first subscribe() -- an entirely
    // ordinary "subscribe from inside a useEffect" shape, not a hostile or even unusual one.
    await new Promise((resolve) => setTimeout(resolve, 50));

    const seen: string[] = [];
    client.subscribe((event) => seen.push(event.type));
    await waitFor(() => seen.length >= 1);
    expect(seen).toEqual(['RunPlanned']);
  });

  it('never overlaps two concurrent reads -- a slow readEvents still in flight when the next tick fires is not entered a second time', async () => {
    const projectRoot = await tempProject();
    let concurrentCalls = 0;
    let maxConcurrentCalls = 0;
    // Deliberately yields zero events, the real "still reading, nothing new yet" shape this test
    // exists to hold open for a controlled duration.
    // eslint-disable-next-line require-yield
    async function* slowReadEvents(): AsyncGenerator<ForgeEvent> {
      concurrentCalls += 1;
      maxConcurrentCalls = Math.max(maxConcurrentCalls, concurrentCalls);
      await new Promise((resolve) => setTimeout(resolve, 40));
      concurrentCalls -= 1;
    }
    const client = createEngineClient(projectRoot, 'run-1', {
      pollIntervalMs: 5,
      readEvents: slowReadEvents,
    });
    clients.push(client);
    // Polling only starts on the first real subscription -- subscribing to something is required to
    // ever trigger a read at all now.
    const seen: unknown[] = [];
    client.subscribe((event) => {
      seen.push(event);
    });

    // Several real ticks (5ms apart) elapse while one real read (40ms) is still in flight.
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(maxConcurrentCalls).toBe(1);
  });

  it('a thrown, non-Error value (a real possibility from an arbitrary readEvents implementation) still produces a real "gap" notification, via String(error)', async () => {
    const projectRoot = await tempProject();
    // Yields zero events before throwing, the real "the reader itself is what fails" shape this test
    // exists to cover.
    // eslint-disable-next-line require-yield
    async function* throwingReadEvents(): AsyncGenerator<ForgeEvent> {
      await Promise.resolve();
      // Deliberately a non-Error value: a real possibility from an arbitrary injected readEvents
      // implementation, and exactly the case createEngineClient's own String(error) fallback exists
      // to cover.
      // eslint-disable-next-line @typescript-eslint/only-throw-error
      throw 'a plain string failure';
    }
    const client = createEngineClient(projectRoot, 'run-1', {
      pollIntervalMs: 5,
      readEvents: throwingReadEvents,
    });
    clients.push(client);
    const notifications: string[] = [];
    client.onNotification((n) => {
      if (n.type === 'gap') notifications.push(n.message);
    });
    await waitFor(() => notifications.length >= 1);
    expect(notifications[0]).toBe('a plain string failure');
  });

  it('dispatches real, already-written events on its first poll without waiting a full interval', async () => {
    const projectRoot = await tempProject();
    await appendEvent(projectRoot, 'run-1', {
      type: 'RunPlanned',
      runId: 'run-1',
      ts: '2026-01-01T00:00:00.000Z',
      payload: { planRef: 'wf' },
    });

    const client = createEngineClient(projectRoot, 'run-1', { pollIntervalMs: 10_000 });
    clients.push(client);
    const seen: ForgeEvent[] = [];
    client.subscribe((event) => seen.push(event));

    await waitFor(() => seen.length >= 1);
    expect(seen[0]?.type).toBe('RunPlanned');
  });

  it('dispatches events in real seq order as the log grows across multiple poll cycles', async () => {
    const projectRoot = await tempProject();
    const client = createEngineClient(projectRoot, 'run-1', { pollIntervalMs: 10 });
    clients.push(client);
    const seen: string[] = [];
    client.subscribe((event) => seen.push(event.type));

    await appendEvent(projectRoot, 'run-1', {
      type: 'RunPlanned',
      runId: 'run-1',
      ts: '2026-01-01T00:00:00.000Z',
      payload: {},
    });
    await waitFor(() => seen.includes('RunPlanned'));

    await appendEvent(projectRoot, 'run-1', {
      type: 'RunStarted',
      runId: 'run-1',
      ts: '2026-01-01T00:00:01.000Z',
      payload: {},
    });
    await waitFor(() => seen.includes('RunStarted'));

    expect(seen).toEqual(['RunPlanned', 'RunStarted']);
  });

  it('never re-dispatches an event already forwarded, even across many poll cycles', async () => {
    const projectRoot = await tempProject();
    await appendEvent(projectRoot, 'run-1', {
      type: 'RunPlanned',
      runId: 'run-1',
      ts: '2026-01-01T00:00:00.000Z',
      payload: {},
    });
    const client = createEngineClient(projectRoot, 'run-1', { pollIntervalMs: 5 });
    clients.push(client);
    const seen: string[] = [];
    client.subscribe((event) => seen.push(event.type));

    await waitFor(() => seen.length >= 1);
    // Let several more real poll cycles elapse -- the file has not changed, so nothing new should ever
    // be dispatched a second time.
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(seen).toEqual(['RunPlanned']);
  });

  it('a run with no event log yet dispatches nothing and raises no notification -- a legitimate state, not corruption', async () => {
    const projectRoot = await tempProject();
    const client = createEngineClient(projectRoot, 'run-never-started', { pollIntervalMs: 5 });
    clients.push(client);
    const seen: ForgeEvent[] = [];
    const notifications: string[] = [];
    client.subscribe((event) => seen.push(event));
    client.onNotification((n) => notifications.push(n.type));

    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(seen).toEqual([]);
    expect(notifications).toEqual([]);
  });

  it('a real seq gap in the event log surfaces as a "gap" notification, never an uncaught rejection, and the client keeps polling', async () => {
    const projectRoot = await tempProject();
    const runDir = path.join(projectRoot, '.forge', 'state', 'runs', 'run-1');
    await mkdir(runDir, { recursive: true });
    // A hand-written, deliberately seq-gapped log: seq 1 then seq 3, skipping 2 -- appendEvent itself
    // would never produce this; only real corruption does, which is exactly what this test simulates.
    const line1 = JSON.stringify({
      v: 1,
      seq: 1,
      ts: '2026-01-01T00:00:00.000Z',
      runId: 'run-1',
      type: 'RunPlanned',
      payload: {},
    });
    const line2 = JSON.stringify({
      v: 1,
      seq: 3,
      ts: '2026-01-01T00:00:01.000Z',
      runId: 'run-1',
      type: 'RunStarted',
      payload: {},
    });
    await writeFile(path.join(runDir, 'events.ndjson'), `${line1}\n${line2}\n`, 'utf8');

    const client = createEngineClient(projectRoot, 'run-1', { pollIntervalMs: 5 });
    clients.push(client);
    const seen: string[] = [];
    const notifications: string[] = [];
    client.subscribe((event) => seen.push(event.type));
    client.onNotification((n) => notifications.push(n.type));

    await waitFor(() => notifications.length >= 1);
    // The one event before the gap still gets dispatched -- a real, partial recovery, not silence.
    expect(seen).toEqual(['RunPlanned']);
    expect(notifications[0]).toBe('gap');

    // Still polling afterwards (proven by fixing the log and observing real recovery, not merely by
    // counting repeated identical notifications -- see the dedup test below for why a second
    // notification for the *same* unchanged failure is deliberately never fired). A real, additional
    // third event, not merely a byte-identical-length correction of the second -- this is what a real
    // recovery actually looks like (appendEvent only ever grows the log), and it also gives the file a
    // genuinely different real byte size, the one signal the engine client's own size-based
    // short-circuit (this file's own top doc comment) checks before re-reading at all.
    const fixedLine2 = JSON.stringify({ ...JSON.parse(line2), seq: 2 });
    const line3 = JSON.stringify({
      v: 1,
      seq: 3,
      ts: '2026-01-01T00:00:02.000Z',
      runId: 'run-1',
      type: 'RunCompleted',
      payload: {},
    });
    await writeFile(
      path.join(runDir, 'events.ndjson'),
      `${line1}\n${fixedLine2}\n${line3}\n`,
      'utf8',
    );
    await waitFor(() => seen.includes('RunCompleted'));
  });

  it("a persistently, identically broken log is notified once, not on every poll cycle forever -- a fresh critic round's own found notification-flood risk", async () => {
    const projectRoot = await tempProject();
    const runDir = path.join(projectRoot, '.forge', 'state', 'runs', 'run-1');
    await mkdir(runDir, { recursive: true });
    const line1 = JSON.stringify({
      v: 1,
      seq: 1,
      ts: '2026-01-01T00:00:00.000Z',
      runId: 'run-1',
      type: 'RunPlanned',
      payload: {},
    });
    const line2 = JSON.stringify({
      v: 1,
      seq: 3,
      ts: '2026-01-01T00:00:01.000Z',
      runId: 'run-1',
      type: 'RunStarted',
      payload: {},
    });
    await writeFile(path.join(runDir, 'events.ndjson'), `${line1}\n${line2}\n`, 'utf8');

    const client = createEngineClient(projectRoot, 'run-1', { pollIntervalMs: 5 });
    clients.push(client);
    const notifications: string[] = [];
    client.onNotification((n) => notifications.push(n.type));

    await waitFor(() => notifications.length >= 1);
    // Many more real poll cycles elapse against the identical, still-broken file -- never re-notified.
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(notifications).toEqual(['gap']);
  });

  it("a real TelemetryError's own typed code is threaded through onto the notification, not discarded behind a bare message string", async () => {
    const projectRoot = await tempProject();
    const runDir = path.join(projectRoot, '.forge', 'state', 'runs', 'run-1');
    await mkdir(runDir, { recursive: true });
    const line1 = JSON.stringify({
      v: 1,
      seq: 1,
      ts: '2026-01-01T00:00:00.000Z',
      runId: 'run-1',
      type: 'RunPlanned',
      payload: {},
    });
    const line3 = JSON.stringify({
      v: 1,
      seq: 3,
      ts: '2026-01-01T00:00:01.000Z',
      runId: 'run-1',
      type: 'RunStarted',
      payload: {},
    });
    await writeFile(path.join(runDir, 'events.ndjson'), `${line1}\n${line3}\n`, 'utf8');

    const client = createEngineClient(projectRoot, 'run-1', { pollIntervalMs: 5 });
    clients.push(client);
    const notifications: { readonly type: string; readonly code?: string }[] = [];
    client.onNotification((n) => notifications.push(n));
    await waitFor(() => notifications.length >= 1);
    expect(notifications[0]?.code).toBe('TELEMETRY-EVENT-LOG-SEQ-GAP');
  });

  it('a subscriber that throws is reported as a distinct "listener-error" notification, never mislabeled as a telemetry "gap" -- and delivery to every other listener continues', async () => {
    const projectRoot = await tempProject();
    const client = createEngineClient(projectRoot, 'run-1', { pollIntervalMs: 5 });
    clients.push(client);
    const notifications: { readonly type: string; readonly message?: string }[] = [];
    const seenByOther: string[] = [];
    client.onNotification((n) => notifications.push(n));
    client.subscribe(() => {
      throw new Error('a real bug in a reducer, nothing to do with telemetry staleness');
    });
    client.subscribe((event) => seenByOther.push(event.type));

    await appendEvent(projectRoot, 'run-1', {
      type: 'RunPlanned',
      runId: 'run-1',
      ts: '2026-01-01T00:00:00.000Z',
      payload: {},
    });
    await waitFor(() => notifications.length >= 1);
    expect(notifications[0]).toEqual({
      type: 'listener-error',
      message: 'a real bug in a reducer, nothing to do with telemetry staleness',
    });
    // The listener registered *after* the throwing one still received the real event -- one bad
    // listener never silently drops delivery to the others.
    expect(seenByOther).toEqual(['RunPlanned']);
  });

  it('a subscriber that throws a non-Error value is still reported via String(error), the identical fallback the real read-failure path uses', async () => {
    const projectRoot = await tempProject();
    const client = createEngineClient(projectRoot, 'run-1', { pollIntervalMs: 5 });
    clients.push(client);
    const notifications: { readonly type: string; readonly message?: string }[] = [];
    client.onNotification((n) => notifications.push(n));
    client.subscribe(() => {
      // Deliberately a non-Error value, the real case createEngineClient's own per-listener
      // String(error) fallback covers.
      // eslint-disable-next-line @typescript-eslint/only-throw-error
      throw 'a plain string listener failure';
    });

    await appendEvent(projectRoot, 'run-1', {
      type: 'RunPlanned',
      runId: 'run-1',
      ts: '2026-01-01T00:00:00.000Z',
      payload: {},
    });
    await waitFor(() => notifications.length >= 1);
    expect(notifications[0]).toEqual({
      type: 'listener-error',
      message: 'a plain string listener failure',
    });
  });

  it('stop() cancels an in-flight, still-resolving read -- no event is delivered to any listener once stopped, even one already underway', async () => {
    const projectRoot = await tempProject();
    // Yields the one real event only after a real, deliberate delay, the exact "a slow read is still
    // in flight at the moment of a logical shutdown" shape this test exists to cover.
    async function* slowThenYieldsOneEvent(): AsyncGenerator<ForgeEvent> {
      await new Promise((resolve) => setTimeout(resolve, 40));
      yield {
        v: 1,
        seq: 1,
        ts: '2026-01-01T00:00:00.000Z',
        runId: 'run-1',
        type: 'RunPlanned',
        payload: {},
      };
    }
    const client = createEngineClient(projectRoot, 'run-1', {
      pollIntervalMs: 10_000,
      readEvents: slowThenYieldsOneEvent,
    });
    const seen: string[] = [];
    client.subscribe((event) => seen.push(event.type));

    // Stops well before the 40ms slow read resolves -- the read is already in flight underneath.
    await new Promise((resolve) => setTimeout(resolve, 10));
    client.stop();
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(seen).toEqual([]);
  });

  it('the unsubscribe function returned by subscribe() stops further event delivery to that listener only', async () => {
    const projectRoot = await tempProject();
    const client = createEngineClient(projectRoot, 'run-1', { pollIntervalMs: 5 });
    clients.push(client);
    const seenA: string[] = [];
    const seenB: string[] = [];
    const unsubscribeA = client.subscribe((event) => seenA.push(event.type));
    client.subscribe((event) => seenB.push(event.type));

    await appendEvent(projectRoot, 'run-1', {
      type: 'RunPlanned',
      runId: 'run-1',
      ts: '2026-01-01T00:00:00.000Z',
      payload: {},
    });
    await waitFor(() => seenA.length >= 1 && seenB.length >= 1);
    unsubscribeA();

    await appendEvent(projectRoot, 'run-1', {
      type: 'RunStarted',
      runId: 'run-1',
      ts: '2026-01-01T00:00:01.000Z',
      payload: {},
    });
    await waitFor(() => seenB.length >= 2);
    expect(seenA).toEqual(['RunPlanned']);
    expect(seenB).toEqual(['RunPlanned', 'RunStarted']);
  });

  it('the unsubscribe function returned by onNotification stops further gap notifications to that listener only', async () => {
    const projectRoot = await tempProject();
    const runDir = path.join(projectRoot, '.forge', 'state', 'runs', 'run-1');
    await mkdir(runDir, { recursive: true });
    const gappedLine = JSON.stringify({
      v: 1,
      seq: 2,
      ts: '2026-01-01T00:00:00.000Z',
      runId: 'run-1',
      type: 'RunStarted',
      payload: {},
    });
    await writeFile(path.join(runDir, 'events.ndjson'), `${gappedLine}\n`, 'utf8');

    const client = createEngineClient(projectRoot, 'run-1', { pollIntervalMs: 5 });
    clients.push(client);
    const notificationsA: string[] = [];
    const notificationsB: string[] = [];
    const unsubscribeA = client.onNotification((n) => notificationsA.push(n.type));
    client.onNotification((n) => notificationsB.push(n.type));

    await waitFor(() => notificationsA.length >= 1 && notificationsB.length >= 1);
    unsubscribeA();
    // A second, genuinely *different* gap (a different seq value, hence a different message) proves
    // the still-subscribed listener keeps receiving real, fresh notifications after the unsubscribe --
    // the identical, already-notified failure is deliberately never re-fired (the dedup test above),
    // so a second real distinct failure is what this test uses to prove continued delivery.
    // A genuinely different first line (seq 30, not 2) -- a different real gap message ("expected 1,
    // found 30" rather than "found 2"), never deduped against the first failure, and (a two-digit seq
    // versus one digit) a genuinely different real byte size too, the one signal the size-based
    // short-circuit checks before re-reading at all.
    await writeFile(
      path.join(runDir, 'events.ndjson'),
      `${JSON.stringify({ ...JSON.parse(gappedLine), seq: 30 })}\n`,
      'utf8',
    );
    const countBBefore = notificationsB.length;
    await waitFor(() => notificationsB.length > countBBefore);
    expect(notificationsA).toEqual(['gap']);
  });

  it('stop() halts polling -- no further dispatch happens even after a new event is appended', async () => {
    const projectRoot = await tempProject();
    const client = createEngineClient(projectRoot, 'run-1', { pollIntervalMs: 5 });
    const seen: string[] = [];
    client.subscribe((event) => seen.push(event.type));
    client.stop();

    await appendEvent(projectRoot, 'run-1', {
      type: 'RunPlanned',
      runId: 'run-1',
      ts: '2026-01-01T00:00:00.000Z',
      payload: {},
    });
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(seen).toEqual([]);
  });

  it('stop() is a safe no-op on a client that was never subscribed to at all -- polling never started, so there is no timer to clear', async () => {
    const projectRoot = await tempProject();
    const client = createEngineClient(projectRoot, 'run-1', { pollIntervalMs: 5 });
    expect(() => {
      client.stop();
    }).not.toThrow();
  });

  it('polling pauses once the last real listener unsubscribes, and correctly resumes on a later resubscribe -- a real, later critic round found unsubscribing the only listener never paused polling, silently and permanently losing any event appended during that real "nobody is listening" window', async () => {
    const projectRoot = await tempProject();
    const client = createEngineClient(projectRoot, 'run-1', { pollIntervalMs: 5 });
    clients.push(client);
    const firstSeen: string[] = [];
    const unsubscribe = client.subscribe((event) => firstSeen.push(event.type));

    await appendEvent(projectRoot, 'run-1', {
      type: 'RunPlanned',
      runId: 'run-1',
      ts: '2026-01-01T00:00:00.000Z',
      payload: {},
    });
    await waitFor(() => firstSeen.includes('RunPlanned'));

    // Unsubscribe the only listener -- polling pauses, real or not.
    unsubscribe();
    await appendEvent(projectRoot, 'run-1', {
      type: 'RunStarted',
      runId: 'run-1',
      ts: '2026-01-01T00:00:01.000Z',
      payload: {},
    });
    // Several real poll intervals elapse while nobody is subscribed at all.
    await new Promise((resolve) => setTimeout(resolve, 40));

    // A later resubscribe (a real tab-switch/remount shape) genuinely resumes polling and still
    // receives the event that was appended while nobody was listening -- not silently lost.
    const secondSeen: string[] = [];
    client.subscribe((event) => secondSeen.push(event.type));
    await waitFor(() => secondSeen.includes('RunStarted'));
  });

  it('once stopped, a later subscribe() never resurrects a real interval -- stop() means permanently done, not merely paused', async () => {
    const projectRoot = await tempProject();
    const client = createEngineClient(projectRoot, 'run-1', { pollIntervalMs: 5 });
    const beforeStop: string[] = [];
    const unsubscribe = client.subscribe((event) => beforeStop.push(event.type));
    await appendEvent(projectRoot, 'run-1', {
      type: 'RunPlanned',
      runId: 'run-1',
      ts: '2026-01-01T00:00:00.000Z',
      payload: {},
    });
    await waitFor(() => beforeStop.includes('RunPlanned'));
    unsubscribe();
    client.stop();

    const afterStop: string[] = [];
    client.subscribe((event) => afterStop.push(event.type));
    await appendEvent(projectRoot, 'run-1', {
      type: 'RunStarted',
      runId: 'run-1',
      ts: '2026-01-01T00:00:01.000Z',
      payload: {},
    });
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(afterStop).toEqual([]);
  });

  it('an onNotification listener that itself throws is silently dropped -- it never crashes the poll loop, never becomes an unhandled rejection, and never stops any other notification listener', async () => {
    const projectRoot = await tempProject();
    const runDir = path.join(projectRoot, '.forge', 'state', 'runs', 'run-1');
    await mkdir(runDir, { recursive: true });
    const gappedLine = JSON.stringify({
      v: 1,
      seq: 2,
      ts: '2026-01-01T00:00:00.000Z',
      runId: 'run-1',
      type: 'RunStarted',
      payload: {},
    });
    await writeFile(path.join(runDir, 'events.ndjson'), `${gappedLine}\n`, 'utf8');

    const rejections: unknown[] = [];
    const onUnhandledRejection = (reason: unknown): void => {
      rejections.push(reason);
    };
    process.on('unhandledRejection', onUnhandledRejection);
    try {
      const client = createEngineClient(projectRoot, 'run-1', { pollIntervalMs: 5 });
      clients.push(client);
      const notificationsB: string[] = [];
      client.onNotification(() => {
        throw new Error('a real bug in a toast renderer, nothing to do with telemetry');
      });
      client.onNotification((n) => notificationsB.push(n.type));

      await waitFor(() => notificationsB.length >= 1);
      expect(notificationsB).toEqual(['gap']);
      // A real macrotask tick so a real unhandled rejection (if one occurred) would have already
      // surfaced to the process-level listener above.
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(rejections).toEqual([]);
    } finally {
      process.off('unhandledRejection', onUnhandledRejection);
    }
  });

  it('a subscriber that throws AND a notification listener that throws (reporting that same subscriber error) together never produce a fabricated "gap" -- the notification listener\'s own bug stays isolated too', async () => {
    const projectRoot = await tempProject();
    const client = createEngineClient(projectRoot, 'run-1', { pollIntervalMs: 5 });
    clients.push(client);
    const notificationTypes: string[] = [];
    client.onNotification(() => {
      throw new Error('the notification listener itself has a bug');
    });
    client.onNotification((n) => notificationTypes.push(n.type));
    client.subscribe(() => {
      throw new Error('a real bug in a reducer');
    });

    await appendEvent(projectRoot, 'run-1', {
      type: 'RunPlanned',
      runId: 'run-1',
      ts: '2026-01-01T00:00:00.000Z',
      payload: {},
    });
    await waitFor(() => notificationTypes.length >= 1);
    // Never 'gap' -- a subscriber bug is always reported as 'listener-error', regardless of whether a
    // separate, unrelated onNotification listener also happens to be broken.
    expect(notificationTypes).toEqual(['listener-error']);
  });

  it('a persistently broken log that stops growing is notified once and then never re-read at all -- the size short-circuit applies to the broken path too, not only the healthy/idle one', async () => {
    const projectRoot = await tempProject();
    let readCount = 0;
    async function* countingThrowingReadEvents(
      root: string,
      run: string,
    ): AsyncGenerator<ForgeEvent> {
      readCount += 1;
      yield* realReadEvents(root, run);
    }
    const runDir = path.join(projectRoot, '.forge', 'state', 'runs', 'run-1');
    await mkdir(runDir, { recursive: true });
    const gappedLine = JSON.stringify({
      v: 1,
      seq: 2,
      ts: '2026-01-01T00:00:00.000Z',
      runId: 'run-1',
      type: 'RunStarted',
      payload: {},
    });
    await writeFile(path.join(runDir, 'events.ndjson'), `${gappedLine}\n`, 'utf8');

    const client = createEngineClient(projectRoot, 'run-1', {
      pollIntervalMs: 5,
      readEvents: countingThrowingReadEvents,
    });
    clients.push(client);
    const notifications: string[] = [];
    client.onNotification((n) => notifications.push(n.type));
    await waitFor(() => notifications.length >= 1);

    const readCountAfterFirstNotification = readCount;
    // Many more real poll cycles elapse against the identical, still-broken, unchanging file.
    await new Promise((resolve) => setTimeout(resolve, 60));
    // The real read is attempted at most once more after the first notification (the one poll that was
    // already in flight or queued when the size-check state settled) -- never once per tick forever.
    expect(readCount).toBeLessThanOrEqual(readCountAfterFirstNotification + 1);
  });

  it("a real TelemetryError's own remedy is threaded through onto the notification too, not just its code", async () => {
    const projectRoot = await tempProject();
    const runDir = path.join(projectRoot, '.forge', 'state', 'runs', 'run-1');
    await mkdir(runDir, { recursive: true });
    const gappedLine = JSON.stringify({
      v: 1,
      seq: 2,
      ts: '2026-01-01T00:00:00.000Z',
      runId: 'run-1',
      type: 'RunStarted',
      payload: {},
    });
    await writeFile(path.join(runDir, 'events.ndjson'), `${gappedLine}\n`, 'utf8');

    const client = createEngineClient(projectRoot, 'run-1', { pollIntervalMs: 5 });
    clients.push(client);
    const notifications: EngineClientNotification[] = [];
    client.onNotification((n) => notifications.push(n));
    await waitFor(() => notifications.length >= 1);
    const first = notifications[0];
    if (first?.type !== 'gap') throw new Error('expected a gap notification');
    expect(first.remedy).toBe(
      'The event log may be corrupted or truncated. Run `forge doctor` to investigate.',
    );
  });
});
