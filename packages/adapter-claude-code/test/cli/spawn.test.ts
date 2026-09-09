/**
 * `spawnClaudeCli` — the actual `execa`-backed process spawn. The one part of this piece genuinely
 * only provable against a real `claude` binary (this milestone's own plan says so explicitly) --
 * gated behind `FORGE_LIVE=1` plus a real credential probe, the same convention `P9` formalises for
 * the whole conformance suite; this file uses a small, local equivalent for just this one piece.
 *
 * @see specs/07 §7.3
 * @see SPEC-QUESTIONS.md Q114
 * @see PLAN-M7.md P2
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { probeAuthAvailability } from '../../src/auth.ts';
import { buildCliArgs } from '../../src/cli/build-args.ts';
import { claudeCodeAdapterConfigSchema } from '../../src/config.ts';
import { spawnClaudeCli } from '../../src/cli/spawn.ts';
import type { SessionRequest } from '@forge/adapter-kit';

const liveEnv = process.env as Record<string, string>;
const isLive = liveEnv['FORGE_LIVE'] === '1';

describe('spawnClaudeCli', () => {
  let scratchDirs: string[] = [];
  afterEach(async () => {
    for (const dir of scratchDirs) await rm(dir, { recursive: true, force: true });
    scratchDirs = [];
  });

  it('when claude is not reachable on PATH at all, the stream still ends with a real session.ended (reason: error), never throws', async () => {
    // Not gated behind FORGE_LIVE: a real spawn failure, no network call, no cost -- the same
    // PATH-isolation fixture `version.test.ts`/`process.test.ts` already use, extended here to prove
    // spawnClaudeCli's own synthesised session.ended (not just realClaudeCliRunner's plain exitCode)
    // covers this failure path too, not only the happy one.
    const emptyPathDir = await mkdtemp(
      path.join(tmpdir(), 'forge-adapter-claude-code-spawn-empty-path-'),
    );
    scratchDirs.push(emptyPathDir);
    const cwd = await mkdtemp(path.join(tmpdir(), 'forge-adapter-claude-code-spawn-cwd-'));
    scratchDirs.push(cwd);

    const handle = spawnClaudeCli(['--version'], { cwd, env: { PATH: emptyPathDir } });
    const events = [];
    for await (const event of handle.events) events.push(event);

    expect(events).toEqual([{ type: 'session.ended', reason: 'error' }]);
    expect(await handle.exitCode).toBe(-1);
  });

  it('an already-aborted abortSignal short-circuits before ever spawning, reporting reason: aborted immediately', async () => {
    // A fresh critic round found an earlier draft only set the internal `stopped` flag from the
    // exposed `stop()` closure, missing this equally real, documented path: a caller that cancels
    // purely via the same `abortSignal` it already passed in (a first-class SessionRequest field,
    // never separately calling `.stop()`) still genuinely intended to abort, and deserves the
    // identical 'aborted' reason, not 'error'. Fixing the naive version of this (passing the
    // already-aborted signal straight through to execa's own `cancelSignal`) surfaced a second, more
    // serious bug this very test caught by actually hanging when first written: execa hangs
    // indefinitely on an already-aborted `cancelSignal` rather than failing fast. The real fix
    // short-circuits before `execa` is ever called at all -- proven here with no `cwd`/`PATH` needed,
    // since nothing is ever actually spawned.
    const controller = new AbortController();
    controller.abort();
    const handle = spawnClaudeCli(['--version'], {
      cwd: '/tmp',
      env: {},
      abortSignal: controller.signal,
    });
    const events = [];
    for await (const event of handle.events) events.push(event);

    expect(events).toEqual([{ type: 'session.ended', reason: 'aborted' }]);
    expect(await handle.exitCode).toBe(-1);
  });

  it.skipIf(!isLive)(
    'against the real, installed claude binary (live, gated), a trivial real prompt produces a real event stream ending session.ended',
    async () => {
      const availability = await probeAuthAvailability(liveEnv);
      if (!availability.apiKey && !availability.subscription) return; // no real credential -- nothing to test live.

      const cwd = await mkdtemp(path.join(tmpdir(), 'forge-adapter-claude-code-spawn-live-'));
      scratchDirs.push(cwd);
      const config = claudeCodeAdapterConfigSchema.parse({ bare: availability.apiKey });
      const request: SessionRequest = {
        runId: 'run-live-p2',
        stepId: 'p2-spawn-smoke',
        cwd,
        systemPrompt: { mode: 'append', text: '' },
        prompt: 'Say hello in exactly 3 words.',
        model: 'haiku',
        tools: { read: false, write: false, exec: false, network: 'none' },
        permissionMode: 'accept-edits',
        limits: {},
        env: {},
        abortSignal: new AbortController().signal,
      };
      const args = buildCliArgs(request, config);
      const env: Record<string, string> = { PATH: liveEnv['PATH'] ?? '' };
      if (availability.apiKey && liveEnv['ANTHROPIC_API_KEY'] !== undefined) {
        env['ANTHROPIC_API_KEY'] = liveEnv['ANTHROPIC_API_KEY'];
      }
      const handle = spawnClaudeCli(args, { cwd, env });

      const events = [];
      for await (const event of handle.events) events.push(event);

      expect(events.some((event) => event.type === 'session.started')).toBe(true);
      expect(events.some((event) => event.type === 'text')).toBe(true);
      expect(events.at(-1)?.type).toBe('session.ended');
      expect(await handle.exitCode).toBe(0);
    },
    30_000,
  );
});
