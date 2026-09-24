/**
 * `forge panel <question> --roles architect,security,sre` — real dispatch to
 * `@forge/engine/interaction`'s own `dispatchAgentStep(..., 'panel', ...)`, framed by the first named
 * role's own real, materialized agent definition.
 *
 * @see specs/03 §3.2.6
 */
import { rm } from 'node:fs/promises';
import path from 'node:path';

import type { PlatformAdapter, SessionRequest } from '@forge/adapter-kit/types';
import { FakePlatformAdapter } from '@forge/testkit';
import { afterEach, describe, expect, it } from 'vitest';

import { panelQuestion, type PanelDeps } from '../../../src/commands/loop/panel.ts';
import { AGENTS_ROOT, CHECKS_ROOT, cleanupAll, createTestProject } from './helpers.ts';

afterEach(cleanupAll);

function panelDeps(project: Awaited<ReturnType<typeof createTestProject>>): PanelDeps {
  const adapter = new FakePlatformAdapter();
  adapter.script(() => true, { text: ['a real independent answer'] });
  return {
    paths: project.paths,
    projectRoot: project.dir,
    config: project.config,
    adapter,
    checksRoot: CHECKS_ROOT,
    agentsRoot: AGENTS_ROOT,
  };
}

/** The identical fixture `panelDeps` builds, but with every real `startSession` request also recorded,
 * for assertions that inspect the request itself (`request.limits`, `PLAN-M14.md` P32) rather than only
 * the outcome. */
function recordingPanelDeps(project: Awaited<ReturnType<typeof createTestProject>>): {
  readonly deps: PanelDeps;
  readonly requests: readonly SessionRequest[];
} {
  const adapter = new FakePlatformAdapter();
  adapter.script(() => true, { text: ['a real independent answer'] });
  const requests: SessionRequest[] = [];
  const wrapped: PlatformAdapter = {
    id: adapter.id,
    displayName: adapter.displayName,
    capabilities: () => adapter.capabilities(),
    preflight: () => adapter.preflight(),
    listModels: () => adapter.listModels(),
    startSession: (req: SessionRequest) => {
      requests.push(req);
      return adapter.startSession(req);
    },
    resumeSession: (sessionId, req) => adapter.resumeSession(sessionId, req),
  };
  return {
    deps: {
      paths: project.paths,
      projectRoot: project.dir,
      config: project.config,
      adapter: wrapped,
      checksRoot: CHECKS_ROOT,
      agentsRoot: AGENTS_ROOT,
    },
    requests,
  };
}

describe('panelQuestion', () => {
  it('drives one real independent session per role, then a real reconciling synthesis', async () => {
    const project = await createTestProject();
    const outcome = await panelQuestion(panelDeps(project), 'should we use Postgres or Mongo?', [
      'architect',
      'security',
    ]);
    // `dispatchPanel`'s own real shape: one participant per named role, plus the outcome itself is a
    // real, separate reconciling session over all of them (confirmed directly against
    // `dispatch-agent-step.ts`'s own `dispatchPanel`).
    expect(outcome.participants).toHaveLength(2);
    expect(outcome.participants?.map((p) => p.role)).toEqual(['panel:architect', 'panel:security']);
    expect(outcome.outcome.status).toBe('succeeded');
  });

  it('throws USR-002 when --roles names no real roles at all', async () => {
    const project = await createTestProject();
    await expect(panelQuestion(panelDeps(project), 'question', [])).rejects.toMatchObject({
      code: 'USR-002',
    });
  });

  it('throws RUN-056 when the first named role has no real materialized agent', async () => {
    const project = await createTestProject();
    await rm(path.join(project.dir, AGENTS_ROOT, 'architect.yaml'));
    await expect(
      panelQuestion(panelDeps(project), 'question', ['architect', 'security']),
    ).rejects.toMatchObject({ code: 'RUN-056' });
  });

  it("every real session (both perspectives and the reconciling synthesis) requests the primary role's own declared limits, never a fixed AD_HOC_LIMITS (PLAN-M14.md P32)", async () => {
    const project = await createTestProject();
    const { deps, requests } = recordingPanelDeps(project);

    await panelQuestion(deps, 'should we use Postgres or Mongo?', ['architect', 'security']);

    expect(requests.length).toBe(3); // 2 perspectives + 1 reconciling synthesis
    // The fixture architect (`loop/helpers.ts`'s own `agentYaml`) declares max_turns: 10, distinct from
    // the old fixed AD_HOC_LIMITS' own max_turns: 20 -- a regression back to the fixed constant fails.
    for (const request of requests) {
      expect(request.limits).toEqual({ maxTurns: 10, wallClockMs: 600_000, maxCostUsd: 2 });
    }
  });
});
