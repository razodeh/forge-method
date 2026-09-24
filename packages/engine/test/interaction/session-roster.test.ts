/**
 * Where a session step finds its roster: the project's resolved agents in `.forge/agents/`, the directory
 * `forge init` writes and dispatch reads -- never a `<project>/modules/` source tree, which a real project
 * does not have (`PLAN-M13.md` P27, `SPEC-QUESTIONS.md` Q215, Q207 gap 6b).
 *
 * @see specs/16 §16.3 (DECIDE: the decision owner, per `decisions_owned`, rules)
 * @see specs/05 §5.3
 */
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import nodePath from 'node:path';

import { execa } from 'execa';
import type { AbsolutePath } from '@forge/core';
import { ProjectPaths, readTextFile, writeFileAtomic } from '@forge/core/fs';
import { DEFAULT_CONFIG } from '@forge/schemas/config';
import { FakePlatformAdapter } from '@forge/testkit';
import type { PlatformAdapter, SessionRequest } from '@forge/adapter-kit';
import { describe, expect, it } from 'vitest';

import {
  createPromptAssemblyContext,
  listProjectAgents,
} from '../../src/dispatch/assembly-context.ts';
import { executeStep } from '../../src/dispatch/execute.ts';
import { runSessionStep, SESSIONS_DIR } from '../../src/interaction/session.ts';
import { createTestContext, node } from '../dispatch/helpers.ts';

async function readSessionFile(root: string, fileName: string): Promise<string> {
  return readTextFile(new ProjectPaths(root).resolveWithin(`${SESSIONS_DIR}/${fileName}`));
}

async function tempRepo(): Promise<string> {
  const dir = await mkdtemp(nodePath.join(tmpdir(), 'forge-session-roster-'));
  await execa('git', ['init', '--quiet', '-b', 'main'], { cwd: dir });
  await execa('git', ['commit', '--quiet', '--allow-empty', '-m', 'init'], { cwd: dir });
  return dir;
}

function agentYaml(id: string, decisionsOwned: readonly string[]): string {
  return `
id: ${id}
name: ${id} agent
version: 1.0.0
tier: core
mandate: Owns ${id} things.
decisions_owned: ${decisionsOwned.length === 0 ? '[]' : `\n${decisionsOwned.map((d) => `  - ${d}`).join('\n')}`}
persona:
  voice: precise
  stance: prefers boring, reversible choices
  disagreement_style: names the specific assumption being challenged
inputs:
  required: []
outputs:
  - type: ArchitectureSpec
    schema: architecture-spec.schema.json
    path: docs/forge/kb/architecture/architecture-spec.md
kb_write:
  - architecture/**
tools:
  read: true
  write: true
  network: false
  git_commit: lane
  deploy: false
model:
  tier: balanced
  thinking: medium
limits:
  max_turns: 10
  wall_clock_ms: 600000
  max_cost_usd: 5
parallel_safety:
  file_ownership: []
  exclusive: false
gates:
  produces_evidence_for: []
  may_approve: []
prompt:
  system: prompts/${id}.system.md
`;
}

async function writeAgent(root: string, dir: string, file: string, text: string): Promise<void> {
  await writeFileAtomic(new ProjectPaths(root).resolveWithin(`${dir}/${file}`), text);
}

/** `PLAN-M14.md` P29: `.forge/techniques/<id>.technique.yaml`, the flat, materialised layout
 * `loadTechniqueFromDir` reads. */
async function writeTechnique(root: string, id: string, yaml: string): Promise<void> {
  await writeFileAtomic(
    new ProjectPaths(root).resolveWithin(`.forge/techniques/${id}.technique.yaml`),
    yaml,
  );
}

function techniqueYaml(id: string): string {
  return `id: ${id}\nname: ${id}\nbestFor: Contested decisions\nphases: [converge]\nprompt: Steel-man the opposing side before your own.\n`;
}

function recording(adapter: FakePlatformAdapter): {
  readonly wrapped: PlatformAdapter;
  readonly stepIds: string[];
} {
  const stepIds: string[] = [];
  return {
    stepIds,
    wrapped: {
      id: adapter.id,
      displayName: adapter.displayName,
      capabilities: () => adapter.capabilities(),
      preflight: () => adapter.preflight(),
      listModels: () => adapter.listModels(),
      startSession: (req: SessionRequest) => {
        stepIds.push(req.stepId);
        return adapter.startSession(req);
      },
      resumeSession: (sessionId, req) => adapter.resumeSession(sessionId, req),
    },
  };
}

/** The deciding session's own system prompt: DECIDE dispatches the resolved owner (`session.ts`), so its role
 * block carries that agent's mandate. Recorded by wrapping the adapter. */
function promptsOf(adapter: FakePlatformAdapter): {
  readonly wrapped: PlatformAdapter;
  readonly decide: () => string;
} {
  const seen: SessionRequest[] = [];
  return {
    wrapped: {
      id: adapter.id,
      displayName: adapter.displayName,
      capabilities: () => adapter.capabilities(),
      preflight: () => adapter.preflight(),
      listModels: () => adapter.listModels(),
      startSession: (req: SessionRequest) => {
        seen.push(req);
        return adapter.startSession(req);
      },
      resumeSession: (sessionId, req) => adapter.resumeSession(sessionId, req),
    },
    decide: () =>
      seen
        .filter((req) => req.stepId.split(':').includes('decide'))
        .map((req) => `${req.systemPrompt.text}\n${req.prompt}`)
        .join('\n'),
  };
}

const SESSION = node({
  id: 'wf:roster-brainstorm',
  kind: 'session',
  sessionType: 'brainstorm',
  brief: 'Which onboarding flow ships first',
});

const TRADEOFF = node({
  id: 'wf:roster-tradeoff',
  kind: 'session',
  sessionType: 'tradeoff',
  brief: 'Postgres or Mongo for the new service',
});

describe('the technique library is .forge/techniques (P29)', () => {
  it('a project with .forge/techniques/steel-man-debate.technique.yaml and NO modules/ runs tradeoff CONVERGE in debate mode', async () => {
    const root = await tempRepo();
    await writeAgent(root, '.forge/agents', 'architect.yaml', agentYaml('architect', ['a.b']));
    await writeTechnique(root, 'steel-man-debate', techniqueYaml('steel-man-debate'));
    const { wrapped, stepIds } = recording(new FakePlatformAdapter());

    const result = await runSessionStep(
      TRADEOFF,
      createTestContext({ projectRoot: root, adapter: wrapped }),
    );

    // Debate mode dispatches round 1 unconditionally (`dispatchDebate`), regardless of how the debate
    // itself later resolves -- the real, structural proof CONVERGE actually ran as `debate`, not panel.
    expect(stepIds.some((id) => id.includes('proposer:round-1'))).toBe(true);
    expect(stepIds.some((id) => id.includes('critic:round-1'))).toBe(true);
    // No degrade happened: nothing to disclose.
    expect(result.outcome.notes).toBeUndefined();
  });

  it('without the file, CONVERGE runs as ordinary panel mode, with a visible note in the outcome and the record', async () => {
    const root = await tempRepo();
    await writeAgent(root, '.forge/agents', 'architect.yaml', agentYaml('architect', ['a.b']));
    // No .forge/techniques/ at all.
    const { wrapped, stepIds } = recording(new FakePlatformAdapter());

    const result = await runSessionStep(
      TRADEOFF,
      createTestContext({ projectRoot: root, adapter: wrapped }),
    );

    expect(stepIds.some((id) => id.includes('proposer:round-1'))).toBe(false);
    expect(stepIds.some((id) => id.includes('critic:round-1'))).toBe(false);
    expect(result.outcome.notes).toBeDefined();
    expect(result.outcome.notes?.some((note) => note.includes('steel-man-debate'))).toBe(true);
    // The identical note also lands in the persisted record's own `## Converge` body.
    if (result.record === undefined) throw new Error('expected a real record');
    const onDisk = await readSessionFile(root, `${result.record.id}.md`);
    expect(onDisk).toContain('steel-man-debate');
    expect(onDisk).toContain('note:');
  });

  it('a malformed technique file fails the step with RUN-065 naming the path, instead of silently degrading', async () => {
    const root = await tempRepo();
    await writeAgent(root, '.forge/agents', 'architect.yaml', agentYaml('architect', ['a.b']));
    await writeTechnique(root, 'steel-man-debate', 'just a string, not a mapping\n');

    const outcome = await executeStep(
      TRADEOFF,
      createTestContext({ projectRoot: root, adapter: new FakePlatformAdapter() }),
    );

    expect(outcome.status).toBe('failed');
    expect(outcome.failure?.code).toBe('RUN-065');
    expect(outcome.failure?.source).toBe('prompt');
    expect(outcome.failure?.message).toContain('steel-man-debate.technique.yaml');
  });
});

describe('the session roster is .forge/agents', () => {
  it('a project with .forge/agents and NO modules/ directory reaches DECIDE with the agent that owns the decision', async () => {
    const root = await tempRepo();
    await writeAgent(root, '.forge/agents', 'architect.yaml', agentYaml('architect', ['a.b']));
    const { wrapped, stepIds } = recording(new FakePlatformAdapter());

    const result = await runSessionStep(
      SESSION,
      createTestContext({ projectRoot: root, adapter: wrapped }),
    );

    expect(result.outcome.status).toBe('succeeded');
    expect(result.record?.status).toBe('complete');
    // DECIDE was dispatched to a real agent, not routed to the human.
    expect(stepIds.some((id) => id.split(':').includes('decide'))).toBe(true);
  });

  it('who may decide is decisions_owned: an agent that owns nothing is skipped, the next one that owns something rules', async () => {
    const root = await tempRepo();
    // `pm` sits before `architect` in a brainstorm roster but owns no decision.
    await writeAgent(root, '.forge/agents', 'pm.yaml', agentYaml('pm', []));
    await writeAgent(root, '.forge/agents', 'architect.yaml', agentYaml('architect', ['a.b']));
    const { wrapped, stepIds } = recording(new FakePlatformAdapter());

    const result = await runSessionStep(
      SESSION,
      createTestContext({ projectRoot: root, adapter: wrapped }),
    );

    expect(result.record?.status).toBe('complete');
    expect(stepIds.some((id) => id.split(':').includes('decide'))).toBe(true);
  });

  it('the agent that rules is the first participant whose decisions_owned is non-empty, not merely any agent in the roster', async () => {
    const root = await tempRepo();
    // `pm` (first in a brainstorm) and `ux` (last) own nothing; `analyst` and `architect` both own something.
    await writeAgent(root, '.forge/agents', 'pm.yaml', agentYaml('pm', []));
    await writeAgent(root, '.forge/agents', 'analyst.yaml', agentYaml('analyst', ['x.y']));
    await writeAgent(root, '.forge/agents', 'architect.yaml', agentYaml('architect', ['a.b']));
    await writeAgent(root, '.forge/agents', 'ux.yaml', agentYaml('ux', []));
    const { wrapped, decide } = promptsOf(new FakePlatformAdapter());

    await runSessionStep(SESSION, createTestContext({ projectRoot: root, adapter: wrapped }));

    // Brainstorm's roster order is pm, analyst, architect, ux: `analyst` is the first that owns a decision.
    const deciding = decide();
    expect(deciding).toContain('You are analyst agent, the resolved decision owner');
    expect(deciding).not.toContain('architect agent, the resolved decision owner');
  });

  it('topic matching: the owner is whichever participant\'s own decisions_owned topic the framed question actually names, even out of roster order ("which storage gives us consistency for the order model?" -> data-architect, data.consistency named)', async () => {
    const root = await tempRepo();
    await writeAgent(
      root,
      '.forge/agents',
      'architect.yaml',
      agentYaml('architect', ['architecture.decomposition']),
    );
    await writeAgent(
      root,
      '.forge/agents',
      'data-architect.yaml',
      agentYaml('data-architect', ['data.consistency']),
    );
    const { wrapped, decide } = promptsOf(new FakePlatformAdapter());
    const questionNode = node({
      id: 'wf:roster-topic-match',
      kind: 'session',
      sessionType: 'brainstorm',
      brief: 'Which storage gives us consistency for the order model?',
    });

    await runSessionStep(
      questionNode,
      createTestContext({ projectRoot: root, adapter: wrapped }),
      undefined,
      ['architect', 'data-architect'],
    );

    const deciding = decide();
    expect(deciding).toContain('You are data-architect agent, the resolved decision owner');
    expect(deciding).not.toContain('You are architect agent, the resolved decision owner');
    expect(deciding).toContain('names your own "data.consistency" topic directly');
  });

  it('topic matching: no candidate\'s own topic is lexically named ("decompose" != "decomposition") -- falls back to the first participant with any topic ("how should we decompose the interfaces?" -> architect, no match -> first with any topic)', async () => {
    const root = await tempRepo();
    await writeAgent(
      root,
      '.forge/agents',
      'architect.yaml',
      agentYaml('architect', ['architecture.decomposition']),
    );
    await writeAgent(
      root,
      '.forge/agents',
      'data-architect.yaml',
      agentYaml('data-architect', ['data.consistency']),
    );
    const { wrapped, decide } = promptsOf(new FakePlatformAdapter());
    const questionNode = node({
      id: 'wf:roster-no-topic-match',
      kind: 'session',
      sessionType: 'brainstorm',
      brief: 'How should we decompose the interfaces?',
    });

    await runSessionStep(
      questionNode,
      createTestContext({ projectRoot: root, adapter: wrapped }),
      undefined,
      ['architect', 'data-architect'],
    );

    const deciding = decide();
    expect(deciding).toContain('You are architect agent, the resolved decision owner');
    expect(deciding).not.toContain('You are data-architect agent, the resolved decision owner');
    // The fallback path never claims the question named anything of the owner's own topics.
    expect(deciding).not.toContain('names your own');
  });

  it('topic matching: a TIE for the top score (two different candidates each match one topic) also falls back to the first participant with any topic, never an arbitrary pick between the tied candidates', async () => {
    const root = await tempRepo();
    // `ux` is first in roster order and owns something, but its own topic does not match at all; both
    // `data-architect` and `ops-architect` match the question equally (one topic each, on the shared
    // word "consistency") -- a real tie for the top score, not a clear winner.
    await writeAgent(root, '.forge/agents', 'ux.yaml', agentYaml('ux', ['ux.flow']));
    await writeAgent(
      root,
      '.forge/agents',
      'data-architect.yaml',
      agentYaml('data-architect', ['data.consistency']),
    );
    await writeAgent(
      root,
      '.forge/agents',
      'ops-architect.yaml',
      agentYaml('ops-architect', ['ops.consistency']),
    );
    const { wrapped, decide } = promptsOf(new FakePlatformAdapter());
    const questionNode = node({
      id: 'wf:roster-topic-tie',
      kind: 'session',
      sessionType: 'brainstorm',
      brief: 'Which service needs consistency?',
    });

    await runSessionStep(
      questionNode,
      createTestContext({ projectRoot: root, adapter: wrapped }),
      undefined,
      ['ux', 'data-architect', 'ops-architect'],
    );

    const deciding = decide();
    // The tie between data-architect and ops-architect resolves to the fallback rule (first-with-any),
    // not to either tied matcher -- `ux`, even though its own topic never matched the question at all.
    expect(deciding).toContain('You are ux agent, the resolved decision owner');
    expect(deciding).not.toContain('You are data-architect agent, the resolved decision owner');
    expect(deciding).not.toContain('You are ops-architect agent, the resolved decision owner');
    expect(deciding).not.toContain('names your own');
  });

  it('a roster where nobody owns a decision falls back to the human, exactly as a project with no roster does', async () => {
    const root = await tempRepo();
    await writeAgent(root, '.forge/agents', 'pm.yaml', agentYaml('pm', []));
    const { wrapped, stepIds } = recording(new FakePlatformAdapter());

    const result = await runSessionStep(
      SESSION,
      createTestContext({ projectRoot: root, adapter: wrapped }),
    );

    expect(result.record?.status).toBe('inconclusive');
    expect(stepIds.some((id) => id.split(':').includes('decide'))).toBe(false);
  });

  it('a modules/ source tree is NOT a roster: agents there do not decide when .forge/agents lacks them', async () => {
    const root = await tempRepo();
    await writeAgent(
      root,
      'modules/some-module/agents',
      'architect.agent.yaml',
      agentYaml('architect', ['a.b']),
    );
    const { wrapped, stepIds } = recording(new FakePlatformAdapter());

    const result = await runSessionStep(
      SESSION,
      createTestContext({ projectRoot: root, adapter: wrapped }),
    );

    expect(result.record?.status).toBe('inconclusive');
    expect(stepIds.some((id) => id.split(':').includes('decide'))).toBe(false);
  });

  it('a roster file that does not load fails the step with RUN-056 instead of being skipped (a dropped owner would hand the decision to the next agent)', async () => {
    const root = await tempRepo();
    await writeAgent(root, '.forge/agents', 'architect.yaml', agentYaml('architect', ['a.b']));
    await writeAgent(root, '.forge/agents', 'broken.yaml', 'id: broken\nname: [unclosed');
    const { wrapped, stepIds } = recording(new FakePlatformAdapter());

    const outcome = await executeStep(
      SESSION,
      createTestContext({ projectRoot: root, adapter: wrapped }),
    );

    expect(outcome.status).toBe('failed');
    expect(outcome.failure?.code).toBe('RUN-056');
    expect(outcome.failure?.source).toBe('prompt');
    expect(stepIds).toEqual([]);
  });

  it('a file whose id disagrees with its name fails the same way (it must not lend its decisions to another id)', async () => {
    const root = await tempRepo();
    await writeAgent(root, '.forge/agents', 'architect.yaml', agentYaml('impostor', ['a.b']));

    const outcome = await executeStep(
      SESSION,
      createTestContext({ projectRoot: root, adapter: new FakePlatformAdapter() }),
    );

    expect(outcome.status).toBe('failed');
    expect(outcome.failure?.code).toBe('RUN-056');
  });
});

describe('the roster is the directory dispatch reads', () => {
  it('a roster path that is a file, and a .yaml name that is not an agent id, each fail loudly instead of reading as an empty roster', async () => {
    const asFile = await tempRepo();
    await writeAgent(asFile, '.forge', 'agents', 'not a directory');
    await expect(
      listProjectAgents(new ProjectPaths(asFile), '.forge/agents'),
    ).rejects.toMatchObject({ code: 'RUN-034' });
    const outcome = await executeStep(
      SESSION,
      createTestContext({ projectRoot: asFile, adapter: new FakePlatformAdapter() }),
    );
    // The fixture assembly reads the same directory, so the step fails rather than routing to the human.
    expect(outcome.status).toBe('failed');

    // A directory that happens to end in `.yaml` is not an agent file (`forge agent list` skips it too).
    const withDir = await tempRepo();
    await writeAgent(withDir, '.forge/agents/backup.yaml', 'note.txt', 'not an agent');
    await writeAgent(withDir, '.forge/agents', 'pm.yaml', agentYaml('pm', []));
    expect(
      (await listProjectAgents(new ProjectPaths(withDir), '.forge/agents')).map(
        (agent) => agent.id,
      ),
    ).toEqual(['pm']);

    const oddName = await tempRepo();
    await writeAgent(oddName, '.forge/agents', 'Product Owner.yaml', agentYaml('po', ['a.b']));
    await expect(
      listProjectAgents(new ProjectPaths(oddName), '.forge/agents'),
    ).rejects.toMatchObject({ code: 'RUN-056' });
  });

  it('production listAgents and loadAgent see the same agents (one directory, one reader)', async () => {
    const root = await tempRepo();
    await writeAgent(root, '.forge/agents', 'architect.yaml', agentYaml('architect', ['a.b']));
    await writeAgent(root, '.forge/agents', 'pm.yaml', agentYaml('pm', []));
    const assembly = createPromptAssemblyContext({
      paths: new ProjectPaths(root),
      integrationPath: root,
      agentsRoot: '.forge/agents',
      config: DEFAULT_CONFIG,
      templatesPackageRoot: root as AbsolutePath,
    });

    const listed = await assembly.listAgents();

    expect(listed.map((agent) => agent.id)).toEqual(['architect', 'pm']);
    for (const agent of listed) expect(await assembly.loadAgent(agent.id)).toEqual(agent);
    // ...and a file the loader refuses is refused by the roster too.
    await writeAgent(root, '.forge/agents', 'impostor.yaml', agentYaml('somebody-else', []));
    await expect(assembly.listAgents()).rejects.toMatchObject({ code: 'RUN-056' });
  });
});

describe('listProjectAgents', () => {
  it('lists .yaml agents sorted by name, ignoring other files, and is empty for an absent directory', async () => {
    const root = await tempRepo();
    const paths = new ProjectPaths(root);
    expect(await listProjectAgents(paths, '.forge/agents')).toEqual([]);
    await writeAgent(root, '.forge/agents', 'zeta.yaml', agentYaml('zeta', []));
    await writeAgent(root, '.forge/agents', 'alpha.yaml', agentYaml('alpha', []));
    await writeAgent(root, '.forge/agents', 'README.md', '# not an agent');
    expect((await listProjectAgents(paths, '.forge/agents')).map((agent) => agent.id)).toEqual([
      'alpha',
      'zeta',
    ]);
  });
});
