/**
 * Both real dispatch paths against the fake adapter's strict mode (`PLAN-M13.md` P6, `SPEC-QUESTIONS.md` Q207): an agent step (`runAgentStep`) and an interaction-mode participant session
 * (`runParticipantSession`) must reach `startSession` with a request the strict check accepts: the user
 * prompt is not empty or a bare path, and the system prompt is `05` §5.3's nine blocks opening with the
 * operating contract. A refusal would reject `startSession`, fail the step, and land in
 * `adapter.strictViolations`; these tests fail on any of those.
 *
 * This is the guard the fake adapter never had: until strict mode, `buildSessionRequest` sending
 * `node.brief` (a path) with an empty system prompt passed every dispatch test in this package.
 */
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { execa } from 'execa';
import type { SessionRequest } from '@forge/adapter-kit';
import { FakePlatformAdapter, checkSessionRequestPrompt } from '@forge/testkit';
import { describe, expect, it } from 'vitest';

import { executeStep } from '../../src/dispatch/execute.ts';
import { dispatchAgentStep } from '../../src/interaction/dispatch-agent-step.ts';
import { toAgentId } from '../../src/plan/index.ts';
import { createTestContext, fixtureAgent, node } from './helpers.ts';

async function createTempRepo(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), `forge-dispatch-${prefix}-`));
  await execa('git', ['init', '--quiet', '-b', 'main'], { cwd: dir });
  await execa('git', ['commit', '--quiet', '--allow-empty', '-m', 'init'], { cwd: dir });
  return dir;
}

function recordingStrictAdapter(requests: SessionRequest[]): FakePlatformAdapter {
  // Strict is the default; spelled out so this file cannot be weakened by a default change unnoticed.
  const adapter = new FakePlatformAdapter({}, { strict: true });
  adapter.script(
    (request) => {
      requests.push(request);
      return true;
    },
    { text: ['done'], structured: { findings: [], checked: ['x'] } },
  );
  return adapter;
}

describe('dispatch against a strict fake adapter', () => {
  it('runAgentStep sends the nine compiled blocks and a real kickoff, never the brief path or an empty prompt', async () => {
    const projectRoot = await createTempRepo('strict-agent');
    const requests: SessionRequest[] = [];
    const adapter = recordingStrictAdapter(requests);
    const ctx = createTestContext({ projectRoot, adapter });

    const outcome = await executeStep(
      node({
        id: 'wf:implement',
        kind: 'agent',
        agent: toAgentId('engineer'),
        brief: 'briefs/implement.md',
      }),
      ctx,
    );

    expect(adapter.strictViolations).toEqual([]);
    expect(outcome.failure).toBeUndefined();
    expect(requests).toHaveLength(1);
    const [request] = requests;
    expect(request).toBeDefined();
    if (request === undefined) return;
    expect(checkSessionRequestPrompt(request)).toEqual([]);
    expect(request.prompt).not.toBe('briefs/implement.md');
    expect(request.systemPrompt.text).not.toBe('');
  });

  it('a participant session sends the nine compiled blocks too', async () => {
    const projectRoot = await createTempRepo('strict-participant');
    const requests: SessionRequest[] = [];
    const adapter = recordingStrictAdapter(requests);
    const ctx = createTestContext({ projectRoot, adapter });

    await dispatchAgentStep(
      node({
        id: 'wf:panel',
        kind: 'agent',
        agent: toAgentId('reviewer'),
        brief: 'Which database should we use?',
      }),
      fixtureAgent('reviewer'),
      ctx,
      'panel',
      { perspectives: ['cost'] },
    );

    expect(adapter.strictViolations).toEqual([]);
    // The perspective's own participant session was dispatched (not only the synthesis session).
    expect(requests.some((request) => request.stepId.endsWith(':panel:cost'))).toBe(true);
    for (const request of requests) expect(checkSessionRequestPrompt(request)).toEqual([]);
  });

  it('the pre-M13 request shape (brief path, empty system prompt) is refused and recorded', async () => {
    // What `buildSessionRequest` sent before P5. A revert of P5 makes the two tests above fail; this one
    // pins that the adapter itself refuses that exact shape (and records it).
    const projectRoot = await createTempRepo('strict-legacy');
    const adapter = new FakePlatformAdapter();
    adapter.script(() => true, { text: ['would have passed silently before strict mode'] });
    const ctx = createTestContext({ projectRoot, adapter });
    const legacyRequest = {
      runId: ctx.runId,
      stepId: 'wf:implement',
      cwd: projectRoot,
      systemPrompt: { mode: 'append' as const, text: '' },
      prompt: 'briefs/implement.md',
      model: 'forge-fake-model',
      tools: { read: true, write: true, exec: false as const, network: 'none' as const },
      permissionMode: 'accept-edits' as const,
      limits: {},
      env: {},
      abortSignal: new AbortController().signal,
    };
    await expect(adapter.startSession(legacyRequest)).rejects.toThrow(/strict mode/);
    expect(adapter.strictViolations).toHaveLength(1);
    expect(adapter.strictViolations[0]?.violations.join(' ')).toContain('bare file path');
    adapter.acknowledgeStrictViolations(1);
  });
});
