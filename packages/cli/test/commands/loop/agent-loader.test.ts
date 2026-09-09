/**
 * `loadProjectAgent` — real, materialized `.forge/agents/<id>.yaml` content read back.
 *
 * @see specs/05 §5.3
 */
import { writeFile } from 'node:fs/promises';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { loadProjectAgent } from '../../../src/commands/loop/agent-loader.ts';
import { AGENTS_ROOT, cleanupAll, createTestProject } from './helpers.ts';

afterEach(cleanupAll);

describe('loadProjectAgent', () => {
  it('reads a real, schema-valid agent definition back from its own materialized file', async () => {
    const project = await createTestProject();
    const agent = await loadProjectAgent(project.paths, AGENTS_ROOT, 'reviewer');
    expect(agent.id).toBe('reviewer');
    expect(agent.name).toBe('Code Reviewer');
  });

  it('throws RUN-056 for an agent id with no real materialized file', async () => {
    const project = await createTestProject();
    await expect(
      loadProjectAgent(project.paths, AGENTS_ROOT, 'no-such-agent'),
    ).rejects.toMatchObject({
      code: 'RUN-056',
    });
  });

  it('throws RUN-056 for a real file that fails real schema validation', async () => {
    const project = await createTestProject();
    await writeFile(
      path.join(project.dir, AGENTS_ROOT, 'broken.yaml'),
      'id: broken\nname: Broken Agent\n', // missing every other required field
    );
    await expect(loadProjectAgent(project.paths, AGENTS_ROOT, 'broken')).rejects.toMatchObject({
      code: 'RUN-056',
    });
  });
});
