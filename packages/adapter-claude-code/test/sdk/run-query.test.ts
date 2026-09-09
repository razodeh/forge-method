/**
 * `runSdkQuery` — the actual `query()` call. The one part of this piece genuinely only provable
 * against the real SDK (mirrors `../cli/spawn.test.ts`'s own live-gating convention, P2).
 *
 * @see specs/07 §7.3
 * @see SPEC-QUESTIONS.md Q115
 * @see PLAN-M7.md P3
 */
import { describe, expect, it } from 'vitest';

import { probeAuthAvailability } from '../../src/auth.ts';
import { buildSdkOptions } from '../../src/sdk/build-options.ts';
import { claudeCodeAdapterConfigSchema } from '../../src/config.ts';
import { runSdkQuery } from '../../src/sdk/run-query.ts';
import type { SessionRequest } from '@forge/adapter-kit';
import type { Query } from '@anthropic-ai/claude-agent-sdk';

/** A minimal fake `Query` whose own async iterator rejects mid-stream, for deterministically proving
 * `runSdkQuery`'s own `try`/`catch` around the real query's iterator actually recovers rather than
 * letting the rejection escape uncaught. Only the members this test's own code path touches are
 * real; the rest is cast away, matching this package's own established `as unknown as SDKMessage`
 * fixture convention (P2/P3) for a type this large. */
function rejectingQuery(): Query {
  return {
    [Symbol.asyncIterator]: () => ({
      next: () =>
        Promise.reject(new Error('a real AbortError-shaped rejection from the SDK runtime')),
    }),
    interrupt: () => Promise.resolve(undefined),
  } as unknown as Query;
}

const liveEnv = process.env as Record<string, string>;
const isLive = liveEnv['FORGE_LIVE'] === '1';

describe('runSdkQuery', () => {
  it('an already-aborted abortSignal short-circuits immediately, reporting reason: aborted, without ever calling the real query()', async () => {
    const controller = new AbortController();
    controller.abort();
    const handle = runSdkQuery('irrelevant', {}, { abortSignal: controller.signal });
    const events = [];
    for await (const event of handle.events) events.push(event);
    expect(events).toEqual([{ type: 'session.ended', reason: 'aborted' }]);
    await handle.interrupt(); // never throws, even with nothing real running underneath.
  });

  it("a rejecting query() iterator (the SDK's own runtime failing mid-stream) is caught, not left to escape uncaught -- the stream still ends with a real session.ended (reason: error)", async () => {
    // A fresh critic round found the original draft had no try/catch around the query's own async
    // iterator at all -- unlike spawnClaudeCli's own execa-subprocess iteration (P2), which can only
    // ever resolve, the real SDK exports a real AbortError class and can plausibly reject its own
    // iterator rather than cleanly ending it. Proven deterministically here via the injectable
    // `queryFn` seam, with no live call and no cost.
    const handle = runSdkQuery('irrelevant', {}, { queryFn: rejectingQuery });
    const events = [];
    for await (const event of handle.events) events.push(event);
    expect(events).toEqual([{ type: 'session.ended', reason: 'error' }]);
  });

  it.skipIf(!isLive)(
    'against the real SDK (live, gated), a trivial real prompt produces a real event stream ending session.ended',
    async () => {
      const availability = await probeAuthAvailability(liveEnv);
      if (!availability.apiKey && !availability.subscription) return; // no real credential -- nothing to test live.

      const request: SessionRequest = {
        runId: 'run-live-p3',
        stepId: 'p3-run-query-smoke',
        cwd: process.cwd(),
        systemPrompt: { mode: 'append', text: '' },
        prompt: 'Say hello in exactly 3 words.',
        model: 'haiku',
        tools: { read: false, write: false, exec: false, network: 'none' },
        permissionMode: 'accept-edits',
        limits: {},
        env: {},
        abortSignal: new AbortController().signal,
      };
      const config = claudeCodeAdapterConfigSchema.parse({ bare: availability.apiKey });
      const options = buildSdkOptions(request, config);
      const handle = runSdkQuery(request.prompt, options);

      const events = [];
      for await (const event of handle.events) events.push(event);

      expect(events.some((event) => event.type === 'session.started')).toBe(true);
      expect(events.some((event) => event.type === 'text')).toBe(true);
      expect(events.at(-1)?.type).toBe('session.ended');
    },
    30_000,
  );
});
