/**
 * `readProjectAgent` (`@forge/engine/dispatch`) is now the one real reader every CLI-side agent load
 * goes through -- `loadProjectAgent` (this package's own former, `.forge/agents`-only duplicate: no
 * id-vs-file check, every I/O error folded into `RUN-056`) is deleted (`PLAN-M14.md` P32). This file
 * proves the swap actually reached every real caller: `agent show`, `forge review` and `forge panel`
 * each now refuse an id/file mismatch, and each propagates a genuine, non-missing-file I/O failure
 * UNWRAPPED, exactly as `readProjectAgent`'s own doc comment promises -- neither of which
 * `loadProjectAgent` ever did.
 *
 * @see specs/05 §5.3
 * @see specs/16 §16.3 step 4
 */
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { execa } from 'execa';
import { FakePlatformAdapter } from '@forge/testkit';
import { afterEach, describe, expect, it } from 'vitest';

import { agentShow } from '../../../src/commands/agent.ts';
import { panelQuestion, type PanelDeps } from '../../../src/commands/loop/panel.ts';
import { reviewChange, type ReviewDeps } from '../../../src/commands/loop/review.ts';
import { agentYaml, AGENTS_ROOT, CHECKS_ROOT, cleanupAll, createTestProject } from './helpers.ts';

afterEach(cleanupAll);

async function repoRoot(): Promise<string> {
  const { stdout } = await execa('git', ['rev-parse', '--show-toplevel']);
  return stdout.trim();
}

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

function reviewDeps(project: Awaited<ReturnType<typeof createTestProject>>): ReviewDeps {
  const adapter = new FakePlatformAdapter();
  adapter.script(() => true, {
    text: ['looks fine'],
    structured: { findings: [], checked: ['x'] },
  });
  return {
    paths: project.paths,
    projectRoot: project.dir,
    config: project.config,
    adapter,
    checksRoot: CHECKS_ROOT,
    agentsRoot: AGENTS_ROOT,
  };
}

describe('an id/file mismatch is refused (RUN-056), never silently lent to the file name', () => {
  it('agent show refuses when the file declares a different id than its own name', async () => {
    const project = await createTestProject();
    await writeFile(
      path.join(project.dir, AGENTS_ROOT, 'architect.yaml'),
      agentYaml('impostor', 'Impostor'),
    );
    await expect(
      agentShow({ paths: project.paths, agentsRoot: AGENTS_ROOT }, 'architect'),
    ).rejects.toMatchObject({ code: 'RUN-056' });
  });

  it('forge review refuses the same way when reviewer.yaml declares a different id', async () => {
    const project = await createTestProject();
    await writeFile(
      path.join(project.dir, AGENTS_ROOT, 'reviewer.yaml'),
      agentYaml('impostor', 'Impostor'),
    );
    await expect(reviewChange(reviewDeps(project))).rejects.toMatchObject({ code: 'RUN-056' });
  });

  it("forge panel refuses the same way when the first named role's own file declares a different id", async () => {
    const project = await createTestProject();
    await writeFile(
      path.join(project.dir, AGENTS_ROOT, 'architect.yaml'),
      agentYaml('impostor', 'Impostor'),
    );
    await expect(
      panelQuestion(panelDeps(project), 'question', ['architect', 'security']),
    ).rejects.toMatchObject({ code: 'RUN-056' });
  });
});

describe('a genuine, non-missing-file I/O failure propagates UNWRAPPED, never folded into RUN-056', () => {
  it('agent show propagates RUN-034 (EISDIR) instead of misreporting a missing agent', async () => {
    const project = await createTestProject();
    await rm(path.join(project.dir, AGENTS_ROOT, 'architect.yaml'));
    await mkdir(path.join(project.dir, AGENTS_ROOT, 'architect.yaml'), { recursive: true });
    await expect(
      agentShow({ paths: project.paths, agentsRoot: AGENTS_ROOT }, 'architect'),
    ).rejects.toMatchObject({ code: 'RUN-034' });
  });

  it('forge review propagates RUN-034 the same way', async () => {
    const project = await createTestProject();
    await rm(path.join(project.dir, AGENTS_ROOT, 'reviewer.yaml'));
    await mkdir(path.join(project.dir, AGENTS_ROOT, 'reviewer.yaml'), { recursive: true });
    await expect(reviewChange(reviewDeps(project))).rejects.toMatchObject({ code: 'RUN-034' });
  });

  it('forge panel propagates RUN-034 the same way', async () => {
    const project = await createTestProject();
    await rm(path.join(project.dir, AGENTS_ROOT, 'architect.yaml'));
    await mkdir(path.join(project.dir, AGENTS_ROOT, 'architect.yaml'), { recursive: true });
    await expect(
      panelQuestion(panelDeps(project), 'question', ['architect', 'security']),
    ).rejects.toMatchObject({ code: 'RUN-034' });
  });
});

describe('packages/cli/src no longer defines loadProjectAgent (readProjectAgent is the one reader, PLAN-M14.md P32)', () => {
  it('git grep finds no loadProjectAgent under packages/cli/src', async () => {
    const root = await repoRoot();
    const result = await execa(
      'git',
      // `-w`: a whole-word match, so a future, genuinely unrelated identifier that merely CONTAINS this
      // substring (e.g. a hypothetical `loadProjectAgentCache`) is not mistaken for a regression here.
      ['grep', '-w', '-l', 'loadProjectAgent', '--', 'packages/cli/src'],
      { cwd: root, reject: false },
    );
    expect(result.stdout.trim()).toBe('');
  });
});
