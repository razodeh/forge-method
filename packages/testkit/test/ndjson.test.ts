/**
 * `replayFromNdjson` — against a real recorded stream, reproduces the identical event sequence
 * (byte-identical after JSON round-trip) — determinism (R10) for replay specifically, not just live
 * scripting. `PLAN-M4.md` P5's own Checks section, verbatim.
 *
 * @see specs/07 §7.2
 * @see SPEC-QUESTIONS.md Q61 points 7-8
 * @see PLAN-M4.md P5
 */
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { replayFromNdjson } from '../src/ndjson.ts';

async function createScratchDir(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), 'forge-testkit-ndjson-'));
}

const RECORDED_EVENTS = [
  {
    type: 'session.started',
    sessionId: 'recorded-1',
    model: 'some-real-model',
    tools: ['bash'],
    meta: {},
  },
  { type: 'text', text: 'Hello ', partial: true },
  { type: 'text', text: 'Hello world.', partial: false },
  { type: 'tool.call', id: 'call-1', name: 'read_file', input: { path: 'a.txt' } },
  { type: 'tool.result', id: 'call-1', ok: true, summary: 'read a.txt' },
  { type: 'file.changed', path: 'a.txt', change: 'modified' },
  { type: 'usage', inputTokens: 42, outputTokens: 17, costUsd: 0.002 },
  { type: 'session.ended', reason: 'complete' },
];

async function writeNdjson(dir: string, events: readonly unknown[]): Promise<string> {
  const filePath = path.join(dir, 'recording.ndjson');
  await writeFile(filePath, events.map((event) => JSON.stringify(event)).join('\n') + '\n', 'utf8');
  return filePath;
}

describe('replayFromNdjson', () => {
  it('reproduces the recorded event sequence byte-identically after a JSON round-trip', async () => {
    const dir = await createScratchDir();
    const filePath = await writeNdjson(dir, RECORDED_EVENTS);

    const handle = replayFromNdjson(filePath);
    const replayed = [];
    for await (const event of handle.events) replayed.push(event);

    expect(replayed).toEqual(RECORDED_EVENTS);
    // Genuinely byte-identical after a round trip, not just deep-equal via vitest's own comparison.
    expect(replayed.map((event) => JSON.stringify(event))).toEqual(
      RECORDED_EVENTS.map((event) => JSON.stringify(event)),
    );
  });

  it('derives a reasonable SessionResult from the replayed events', async () => {
    const dir = await createScratchDir();
    const filePath = await writeNdjson(dir, RECORDED_EVENTS);

    const handle = replayFromNdjson(filePath);
    const result = await handle.result();

    expect(result.ok).toBe(true);
    expect(result.finalText).toBe('Hello world.');
    expect(result.usage.inputTokens).toBe(42);
    expect(result.usage.outputTokens).toBe(17);
    expect(result.usage.costUsd).toBe(0.002);
    expect(result.changedFiles).toEqual(['a.txt']);
  });

  it('replaying the same file twice produces the identical sequence both times (deterministic, R10)', async () => {
    const dir = await createScratchDir();
    const filePath = await writeNdjson(dir, RECORDED_EVENTS);

    const first = [];
    for await (const event of replayFromNdjson(filePath).events) first.push(event);
    const second = [];
    for await (const event of replayFromNdjson(filePath).events) second.push(event);

    expect(first).toEqual(second);
  });

  it('derives ok:false and a populated error when the recording contains an error event', async () => {
    const dir = await createScratchDir();
    const filePath = await writeNdjson(dir, [
      { type: 'session.started', sessionId: 'recorded-2', model: 'm', tools: [], meta: {} },
      { type: 'error', code: 'BOOM', message: 'it broke', retryable: false },
      { type: 'session.ended', reason: 'error' },
    ]);

    const result = await replayFromNdjson(filePath).result();
    expect(result.ok).toBe(false);
    expect(result.error).toEqual({ code: 'BOOM', message: 'it broke' });
  });

  it('throws a clear, actionable error for a line that is not valid JSON', async () => {
    const dir = await createScratchDir();
    const filePath = path.join(dir, 'broken.ndjson');
    await writeFile(filePath, 'not json at all\n', 'utf8');

    const handle = replayFromNdjson(filePath);
    await expect(
      (async () => {
        const collected = [];
        for await (const event of handle.events) collected.push(event);
      })(),
    ).rejects.toThrow(/not valid JSON/);
  });

  it('throws a clear, actionable error for a line that does not normalise to a real AdapterEvent', async () => {
    const dir = await createScratchDir();
    const filePath = await writeNdjson(dir, [{ type: 'not-a-real-event-type' }]);

    const handle = replayFromNdjson(filePath);
    await expect(
      (async () => {
        const collected = [];
        for await (const event of handle.events) collected.push(event);
      })(),
    ).rejects.toThrow(/does not normalise/);
  });
});
