/**
 * `forge panel <question> --roles architect,security,sre` — real dispatch to
 * `@forge/engine/interaction`'s own `dispatchAgentStep(..., 'panel', ...)`, framed by the first named
 * role's own real, materialized agent definition.
 *
 * @see specs/03 §3.2.6
 */
import { rm } from 'node:fs/promises';
import path from 'node:path';

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
});
