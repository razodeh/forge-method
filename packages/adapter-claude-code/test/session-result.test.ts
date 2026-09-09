/**
 * `accumulateSessionResult` — wraps a transport's own raw `AsyncIterable<AdapterEvent>` into the
 * `AsyncGenerator<AdapterEvent, SessionResult>` shape `makeSessionHandle` needs.
 *
 * @see specs/07 §7.2
 * @see SPEC-QUESTIONS.md Q116
 * @see PLAN-M7.md P4
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { execa } from 'execa';
import { afterEach, describe, expect, it } from 'vitest';

import type { AdapterEvent, SessionResult } from '@forge/adapter-kit';

import { accumulateSessionResult } from '../src/session-result.ts';

async function* eventsOf(events: readonly AdapterEvent[]): AsyncGenerator<AdapterEvent> {
  for (const event of events) {
    await Promise.resolve();
    yield event;
  }
}

function stepClock(...values: readonly number[]): () => number {
  let index = 0;
  return () => {
    const value = values[index];
    index += 1;
    return value ?? values.at(-1) ?? 0;
  };
}

async function drain(
  generator: AsyncGenerator<AdapterEvent, unknown>,
): Promise<{ events: AdapterEvent[]; result: unknown }> {
  const events: AdapterEvent[] = [];
  let step = await generator.next();
  while (!step.done) {
    events.push(step.value);
    step = await generator.next();
  }
  return { events, result: step.value };
}

describe('accumulateSessionResult', () => {
  let scratchDirs: string[] = [];
  afterEach(async () => {
    for (const dir of scratchDirs) await rm(dir, { recursive: true, force: true });
    scratchDirs = [];
  });

  async function plainCwd(): Promise<string> {
    const dir = await mkdtemp(path.join(tmpdir(), 'forge-adapter-claude-code-session-result-'));
    scratchDirs.push(dir);
    return dir;
  }

  it('re-yields every event unchanged, in order', async () => {
    const cwd = await plainCwd();
    const input: AdapterEvent[] = [
      { type: 'session.started', sessionId: 's', model: 'm', tools: [], meta: {} },
      { type: 'text', text: 'hi', partial: false },
      { type: 'session.ended', reason: 'complete' },
    ];
    const { events } = await drain(
      accumulateSessionResult(eventsOf(input), { sessionId: 's', cwd, now: stepClock(0) }),
    );
    expect(events).toEqual(input);
  });

  it('accumulates only non-partial text into finalText, in arrival order', async () => {
    const cwd = await plainCwd();
    const input: AdapterEvent[] = [
      { type: 'text', text: 'partial chunk', partial: true },
      { type: 'text', text: 'Hello, ', partial: false },
      { type: 'text', text: 'world.', partial: false },
    ];
    const { result } = await drain(
      accumulateSessionResult(eventsOf(input), { sessionId: 's', cwd, now: stepClock(0) }),
    );
    expect((result as { finalText: string }).finalText).toBe('Hello, world.');
  });

  it('turns = toolCallCount + 1, and defaults to 1 with no tool.call events at all', async () => {
    const cwd = await plainCwd();
    const noToolResult = await drain(
      accumulateSessionResult(eventsOf([]), { sessionId: 's', cwd, now: stepClock(0) }),
    );
    expect((noToolResult.result as { usage: { turns: number } }).usage.turns).toBe(1);

    const twoToolInput: AdapterEvent[] = [
      { type: 'tool.call', id: '1', name: 'write_file' },
      { type: 'tool.call', id: '2', name: 'exec' },
    ];
    const twoToolResult = await drain(
      accumulateSessionResult(eventsOf(twoToolInput), { sessionId: 's', cwd, now: stepClock(0) }),
    );
    expect((twoToolResult.result as { usage: { turns: number } }).usage.turns).toBe(3);
  });

  it('usage event populates inputTokens/outputTokens/costUsd; costUsd is omitted entirely when never reported', async () => {
    const cwd = await plainCwd();
    const withCost = await drain(
      accumulateSessionResult(
        eventsOf([{ type: 'usage', inputTokens: 10, outputTokens: 5, costUsd: 0.02 }]),
        { sessionId: 's', cwd, now: stepClock(0) },
      ),
    );
    const withCostUsage = (withCost.result as { usage: SessionResult['usage'] }).usage;
    expect(withCostUsage.inputTokens).toBe(10);
    expect(withCostUsage.outputTokens).toBe(5);
    expect(withCostUsage.costUsd).toBe(0.02);

    const noUsageEvent = await drain(
      accumulateSessionResult(eventsOf([]), { sessionId: 's', cwd, now: stepClock(0) }),
    );
    const noUsage = (noUsageEvent.result as { usage: SessionResult['usage'] }).usage;
    expect(noUsage.inputTokens).toBe(0);
    expect(noUsage.outputTokens).toBe(0);
    expect('costUsd' in noUsage).toBe(false);
  });

  it('an error event sets ok:false and carries { code, message } into the result, without ending the accumulation early', async () => {
    const cwd = await plainCwd();
    const input: AdapterEvent[] = [
      { type: 'error', code: 'boom', message: 'it broke', retryable: false },
      { type: 'text', text: 'still counted', partial: false },
    ];
    const { result } = await drain(
      accumulateSessionResult(eventsOf(input), { sessionId: 's', cwd, now: stepClock(0) }),
    );
    const typed = result as {
      ok: boolean;
      error?: { code: string; message: string };
      finalText: string;
    };
    expect(typed.ok).toBe(false);
    expect(typed.error).toEqual({ code: 'boom', message: 'it broke' });
    expect(typed.finalText).toBe('still counted');
  });

  it('ok stays true and error is omitted entirely when no error event ever arrives', async () => {
    const cwd = await plainCwd();
    const { result } = await drain(
      accumulateSessionResult(eventsOf([]), { sessionId: 's', cwd, now: stepClock(0) }),
    );
    const typed = result as { ok: boolean; error?: unknown };
    expect(typed.ok).toBe(true);
    expect('error' in typed).toBe(false);
  });

  it("session.ended{reason:'aborted'} sets ok:false even with no preceding error event (a fresh critic round's own finding: both transports can synthesize this reason without ever yielding an explicit 'error' event)", async () => {
    const cwd = await plainCwd();
    const { result } = await drain(
      accumulateSessionResult(eventsOf([{ type: 'session.ended', reason: 'aborted' }]), {
        sessionId: 's',
        cwd,
        now: stepClock(0),
      }),
    );
    expect((result as { ok: boolean }).ok).toBe(false);
  });

  it("session.ended{reason:'error'} sets ok:false even with no preceding error event", async () => {
    const cwd = await plainCwd();
    const { result } = await drain(
      accumulateSessionResult(eventsOf([{ type: 'session.ended', reason: 'error' }]), {
        sessionId: 's',
        cwd,
        now: stepClock(0),
      }),
    );
    expect((result as { ok: boolean }).ok).toBe(false);
  });

  it("session.ended{reason:'limit'} leaves ok:true -- a respected resource limit is not a failure", async () => {
    const cwd = await plainCwd();
    const { result } = await drain(
      accumulateSessionResult(eventsOf([{ type: 'session.ended', reason: 'limit' }]), {
        sessionId: 's',
        cwd,
        now: stepClock(0),
      }),
    );
    expect((result as { ok: boolean }).ok).toBe(true);
  });

  it("session.ended{reason:'complete'} leaves ok:true", async () => {
    const cwd = await plainCwd();
    const { result } = await drain(
      accumulateSessionResult(eventsOf([{ type: 'session.ended', reason: 'complete' }]), {
        sessionId: 's',
        cwd,
        now: stepClock(0),
      }),
    );
    expect((result as { ok: boolean }).ok).toBe(true);
  });

  it('durationMs is now() at the end minus now() at the start, using the injected clock only', async () => {
    const cwd = await plainCwd();
    const { result } = await drain(
      accumulateSessionResult(eventsOf([]), { sessionId: 's', cwd, now: stepClock(1000, 1150) }),
    );
    expect((result as { durationMs: number }).durationMs).toBe(150);
  });

  it('passes sessionId through verbatim', async () => {
    const cwd = await plainCwd();
    const { result } = await drain(
      accumulateSessionResult(eventsOf([]), {
        sessionId: 'distinctive-id',
        cwd,
        now: stepClock(0),
      }),
    );
    expect((result as { sessionId: string }).sessionId).toBe('distinctive-id');
  });

  it('changedFiles reflects a real git status in cwd once the stream ends', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'forge-adapter-claude-code-session-result-git-'));
    scratchDirs.push(dir);
    await execa('git', ['init', '--quiet', '-b', 'main'], { cwd: dir });
    await execa('git', ['config', 'user.email', 'fixture@example.com'], { cwd: dir });
    await execa('git', ['config', 'user.name', 'Fixture'], { cwd: dir });
    await execa('git', ['commit', '--quiet', '--allow-empty', '-m', 'init'], { cwd: dir });
    await writeFile(path.join(dir, 'written.txt'), 'content\n', 'utf8');

    const { result } = await drain(
      accumulateSessionResult(eventsOf([]), { sessionId: 's', cwd: dir, now: stepClock(0) }),
    );
    expect((result as { changedFiles: readonly string[] }).changedFiles).toEqual(['written.txt']);
  });

  it('controlTokens reflects a real FORGE_* control token embedded in the accumulated finalText', async () => {
    const cwd = await plainCwd();
    const input: AdapterEvent[] = [
      { type: 'text', text: 'FORGE_CONFLICT: two agents touched the same file', partial: false },
    ];
    const { result } = await drain(
      accumulateSessionResult(eventsOf(input), { sessionId: 's', cwd, now: stepClock(0) }),
    );
    const typed = result as { controlTokens: readonly { token: string }[] };
    expect(typed.controlTokens).toEqual([
      { token: 'FORGE_CONFLICT', reason: 'two agents touched the same file' },
    ]);
  });

  it("07 §7.6's own C10 row: a real FORGE_ASK line in a non-partial text event is also live-emitted as its own real control AdapterEvent, alongside (not instead of) the original text event", async () => {
    const cwd = await plainCwd();
    const input: AdapterEvent[] = [
      { type: 'text', text: 'FORGE_ASK:which database?|Postgres,SQLite', partial: false },
    ];
    const { events } = await drain(
      accumulateSessionResult(eventsOf(input), { sessionId: 's', cwd, now: stepClock(0) }),
    );
    expect(events).toEqual([
      { type: 'text', text: 'FORGE_ASK:which database?|Postgres,SQLite', partial: false },
      {
        type: 'control',
        token: 'FORGE_ASK',
        payload: { question: 'which database?', options: ['Postgres', 'SQLite'] },
      },
    ]);
  });

  it('a control-token line inside a partial:true chunk is never live-emitted -- the same "only non-partial" guard finalText accumulation already uses', async () => {
    const cwd = await plainCwd();
    const input: AdapterEvent[] = [
      { type: 'text', text: 'FORGE_CONFLICT: partial only, never repeated', partial: true },
      { type: 'text', text: 'a real, unrelated final block', partial: false },
    ];
    const { events } = await drain(
      accumulateSessionResult(eventsOf(input), { sessionId: 's', cwd, now: stepClock(0) }),
    );
    expect(events.some((event) => event.type === 'control')).toBe(false);
  });

  it('multiple real control tokens across multiple non-partial text events are each live-emitted, in order, right after their own text event', async () => {
    const cwd = await plainCwd();
    const input: AdapterEvent[] = [
      { type: 'text', text: 'FORGE_HANDOFF: reviewer needs a second look', partial: false },
      { type: 'text', text: 'some plain narration with no token at all', partial: false },
      { type: 'text', text: 'FORGE_REQUEST_CHANGE: specs/07 the table is stale', partial: false },
    ];
    const { events } = await drain(
      accumulateSessionResult(eventsOf(input), { sessionId: 's', cwd, now: stepClock(0) }),
    );
    expect(events.map((event) => event.type)).toEqual([
      'text',
      'control',
      'text',
      'text',
      'control',
    ]);
    expect(events[1]).toEqual({
      type: 'control',
      token: 'FORGE_HANDOFF',
      payload: { role: 'reviewer', reason: 'needs a second look' },
    });
    expect(events[4]).toEqual({
      type: 'control',
      token: 'FORGE_REQUEST_CHANGE',
      payload: { target: 'specs/07', reason: 'the table is stale' },
    });
  });
});
