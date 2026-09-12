/**
 * `forge session <type> ... / list|show|resume|export` — `16` §16.6. Real dispatch to
 * `@forge/engine/interaction`'s own `runSessionStep`, against a real `FakePlatformAdapter` and a real
 * temp git repository (matching this package's own established test convention, `panel.test.ts`).
 *
 * @see specs/16 §16.6
 * @see PLAN-M10.md P13
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { FakePlatformAdapter } from '@forge/testkit';
import { SESSION_TYPES } from '@forge/schemas';
import { afterEach, describe, expect, it } from 'vitest';

import {
  isSessionType,
  sessionExport,
  sessionList,
  sessionResume,
  sessionShow,
  startSession,
  SESSIONS_ROOT,
  type SessionCommandDeps,
  type SessionType,
  type StartSessionOptions,
} from '../../../src/commands/loop/session.ts';
import { cleanupAll, createTestProject } from './helpers.ts';

afterEach(cleanupAll);

function sessionDeps(project: Awaited<ReturnType<typeof createTestProject>>): SessionCommandDeps {
  const adapter = new FakePlatformAdapter();
  adapter.script(() => true, { text: ['I have a real objection: this risks a regression.'] });
  return {
    paths: project.paths,
    projectRoot: project.dir,
    config: project.config,
    adapter,
    checksRoot: 'docs/forge/checks',
  };
}

/** The one type-specific flag each real `16` §16.6 worked command needs to state a real one-sentence
 * question -- see `resolveBrief` (`session.ts`) for the exact rule this mirrors. */
const OPTIONS_BY_TYPE: Readonly<Record<SessionType, StartSessionOptions>> = {
  brainstorm: { question: 'How do we cut time-to-first-invoice?' },
  'design-review': { target: 'ADR-0011' },
  tradeoff: { question: 'Postgres or Mongo?', options: ['postgres', 'mongo'] },
  premortem: { scope: 'stage:mvp' },
  retro: { stage: 'mvp' },
  'war-room': { defect: 'DEF-014' },
  estimation: { question: 'How should we size the onboarding epic?' },
  standup: { question: 'What is blocking the active lanes?' },
  'discovery-interview': { question: 'What does the user actually need from onboarding?' },
  'story-refinement': { question: 'Turn "faster onboarding" into ready stories.' },
};

describe('isSessionType', () => {
  it('accepts exactly the real, closed ten-value 16 §16.2 table', () => {
    for (const type of SESSION_TYPES) {
      expect(isSessionType(type)).toBe(true);
    }
    expect(isSessionType('brainstorm-ish')).toBe(false);
  });
});

describe('startSession', () => {
  it.each(SESSION_TYPES)(
    'invokes a real %s session and produces a real, persisted record',
    async (type) => {
      const project = await createTestProject();
      const deps = sessionDeps(project);

      const result = await startSession(deps, type, OPTIONS_BY_TYPE[type]);

      expect(result.record).toBeDefined();
      const record = result.record;
      if (record === undefined) throw new Error('expected a real record');
      expect(record.sessionType).toBe(type);
      expect(record.type).toBe('SessionRecord');
      // A real file landed on disk at the real working path `runSessionStep` itself writes to --
      // proving this is not merely an in-memory return value.
      const onDisk = await readSessionFile(project.dir, `${record.id}.md`);
      expect(onDisk).toContain('## Frame');
    },
  );

  it('throws USR-002 when design-review is invoked with neither --target nor --question', async () => {
    const project = await createTestProject();
    const error = await startSession(sessionDeps(project), 'design-review', {}).catch(
      (caught: unknown) => caught,
    );
    expect(error).toMatchObject({ code: 'USR-002' });
    expect((error as { details?: { flag?: string } }).details?.flag).toBe('--target');
  });

  it('throws USR-002 when premortem is invoked with no --scope/--question', async () => {
    const project = await createTestProject();
    await expect(startSession(sessionDeps(project), 'premortem', {})).rejects.toMatchObject({
      code: 'USR-002',
    });
  });

  it('--question always wins outright over a type-specific flag when both are given', async () => {
    const project = await createTestProject();
    const result = await startSession(sessionDeps(project), 'design-review', {
      target: 'ADR-0011',
      question: 'Is the new caching layer safe to ship?',
    });
    expect(result.record?.question).toBe('Is the new caching layer safe to ship?');
  });

  it('tradeoff folds --options into the framed question', async () => {
    const project = await createTestProject();
    const result = await startSession(sessionDeps(project), 'tradeoff', {
      question: 'Postgres or Mongo?',
      options: ['postgres', 'mongo'],
    });
    expect(result.record?.question).toContain('postgres');
    expect(result.record?.question).toContain('mongo');
  });

  it('--roles overrides the real per-type participant roster', async () => {
    const project = await createTestProject();
    const result = await startSession(sessionDeps(project), 'brainstorm', {
      question: 'Should we adopt GraphQL?',
      roles: ['sre', 'diagnostician'],
    });
    expect(result.record?.participants).toContain('sre');
    expect(result.record?.participants).toContain('diagnostician');
    expect(result.record?.participants).not.toContain('pm');
  });

  it('throws RUN-068 for a value not in the real closed session-type union', async () => {
    const project = await createTestProject();
    // A deliberately hostile, non-`SessionType` input, proving the runtime guard (`isSessionType`)
    // fires even past the type system -- `unknown` first, never `any`, so this stays a real, narrow
    // exemption rather than disabling type-checking for the whole call.
    const hostileType = 'not-a-real-type' as unknown as SessionType;
    await expect(
      startSession(sessionDeps(project), hostileType, { question: 'x' }),
    ).rejects.toMatchObject({ code: 'RUN-068' });
  });
});

describe('sessionList / sessionShow', () => {
  it('lists every real, persisted session, and show reads one back in full', async () => {
    const project = await createTestProject();
    const deps = sessionDeps(project);
    const first = await startSession(deps, 'brainstorm', OPTIONS_BY_TYPE.brainstorm);
    const second = await startSession(deps, 'retro', OPTIONS_BY_TYPE.retro);

    const summaries = await sessionList(deps);
    const ids = summaries.map((s) => s.id);
    expect(ids).toContain(first.record?.id);
    expect(ids).toContain(second.record?.id);

    const shown = await sessionShow(deps, first.record?.id ?? '');
    expect(shown.record.id).toBe(first.record?.id);
    expect(shown.body).toContain('## Decisions');
  });

  it('sessionShow throws RUN-070 for an id with no real session record', async () => {
    const project = await createTestProject();
    await expect(sessionShow(sessionDeps(project), 'SESSION-999')).rejects.toMatchObject({
      code: 'RUN-070',
    });
  });

  it('sessionList returns an empty list when no session has ever run', async () => {
    const project = await createTestProject();
    expect(await sessionList(sessionDeps(project))).toEqual([]);
  });
});

describe('sessionResume', () => {
  it('throws RUN-071 when the record is not truncated', async () => {
    const project = await createTestProject();
    const deps = sessionDeps(project);
    const result = await startSession(deps, 'brainstorm', OPTIONS_BY_TYPE.brainstorm);
    expect(result.record?.status).not.toBe('truncated');
    await expect(sessionResume(deps, result.record?.id ?? '')).rejects.toMatchObject({
      code: 'RUN-071',
    });
  });

  it('throws RUN-070 for an id with no real session record at all', async () => {
    const project = await createTestProject();
    await expect(sessionResume(sessionDeps(project), 'SESSION-999')).rejects.toMatchObject({
      code: 'RUN-070',
    });
  });

  it('throws RUN-074 for a real, truncated record with no state sidecar at all', async () => {
    const project = await createTestProject();
    const deps = sessionDeps(project);
    // A real, hand-authored truncated record with no sidecar state -- the honest "predates this piece,
    // or lost its sidecar" case `loadSessionState`'s own doc comment names.
    await writeTruncatedFixture(project.dir, 'SESSION-042');
    await expect(sessionResume(deps, 'SESSION-042')).rejects.toMatchObject({ code: 'RUN-074' });
  });

  it('throws RUN-073 (not RUN-070) for a real file whose front matter is corrupted', async () => {
    const project = await createTestProject();
    const deps = sessionDeps(project);
    const dir = path.join(project.dir, SESSIONS_ROOT);
    await mkdir(dir, { recursive: true });
    await writeFile(
      path.join(dir, 'SESSION-042.md'),
      '---\nnot: [valid, yaml: broken\n---\nbody\n',
    );
    await expect(sessionShow(deps, 'SESSION-042')).rejects.toMatchObject({ code: 'RUN-073' });
  });

  it('throws RUN-072 when the truncated record already has a real decision recorded (DECIDE already ran)', async () => {
    const project = await createTestProject();
    const deps = sessionDeps(project);
    await writeTruncatedFixture(project.dir, 'SESSION-042');
    // A real sidecar state whose own DECIDE phase already ran -- `resumeFrom.decisions.length > 0`,
    // the exact shape `runSessionStep`'s own new resume guard refuses outright rather than risking a
    // second, divergent decision on top of the first.
    const decidedState = {
      phase: 'RECORD',
      sessionType: 'brainstorm',
      participants: [{ role: 'pm' }, { role: 'human' }],
      technique: [],
      ideas: [{ id: 'IDEA-1', text: 'an idea', proposedBy: 'pm' }],
      clusters: [{ id: 'CLUSTER-1', label: 'x', ideaIds: ['IDEA-1'] }],
      objections: [],
      decisions: [{ id: 'D-1', decision: 'Ship it', owner: 'pm', artifactRef: 'KB-0001' }],
      nonDecisions: [],
      actions: [],
      truncated: true,
      framing: {
        question: 'A fixture question',
        constraintsApplied: [],
        outOfScope: [],
        goodOutcomeLooksLike: 'A real decision.',
      },
      startedAt: '2026-01-01T00:00:00.000Z',
    };
    await mkdir(path.join(project.dir, SESSIONS_ROOT, '.state'), { recursive: true });
    await writeFile(
      path.join(project.dir, SESSIONS_ROOT, '.state', 'SESSION-042.json'),
      JSON.stringify(decidedState),
    );
    await expect(sessionResume(deps, 'SESSION-042')).rejects.toMatchObject({ code: 'RUN-072' });
  });

  it('picks up a real, truncated session from its own last recorded phase, not FRAME again', async () => {
    const project = await createTestProject();
    const deps = sessionDeps(project);

    // Run a real session to completion first, then hand-truncate its own already-real, on-disk record
    // (flipping only `status`) so `sessionResume` has a real sidecar `SessionState` (with real
    // clusters already in it, written by the very first run) to read back — proving the CLI's own
    // wiring (find file -> load sidecar -> call runSessionStep with resumeFrom), not re-proving
    // `runSessionStep`'s own internal phase-skip logic a second time (already covered directly in
    // `packages/engine/test/interaction/session.test.ts`).
    const first = await startSession(deps, 'brainstorm', OPTIONS_BY_TYPE.brainstorm);
    const id = first.record?.id;
    if (id === undefined) throw new Error('expected a real record id');
    // This project has no real `modules/` agent roster, so DECIDE never resolves a real owner and the
    // record ends up `inconclusive` rather than `complete` — irrelevant to this test, which only needs
    // a real sidecar `SessionState` with real clusters already in it (CONVERGE ran regardless).
    expect(first.record?.status).not.toBe('truncated');

    await markRecordTruncated(project.dir, id);

    const resumed = await sessionResume(deps, id);
    expect(resumed.record).toBeDefined();
    expect(resumed.record?.question).toBe(first.record?.question);
  });
});

describe('sessionExport', () => {
  it('writes the real, canonical docs/forge/sessions/SESSION-{id}-{slug}.md file', async () => {
    const project = await createTestProject();
    const deps = sessionDeps(project);
    const result = await startSession(deps, 'brainstorm', OPTIONS_BY_TYPE.brainstorm);
    const id = result.record?.id;
    if (id === undefined) throw new Error('expected a real record id');

    const exported = await sessionExport(deps, id);
    expect(exported.path).toMatch(new RegExp(`^${SESSIONS_ROOT}/${id}-[a-z0-9-]+\\.md$`));
    const text = await readSessionFile(project.dir, path.basename(exported.path));
    expect(text).toContain(`id: ${id}`);
    expect(text).toContain('## Decisions');
  });

  it('throws RUN-070 for an id with no real session record', async () => {
    const project = await createTestProject();
    await expect(sessionExport(sessionDeps(project), 'SESSION-999')).rejects.toMatchObject({
      code: 'RUN-070',
    });
  });
});

async function readSessionFile(projectDir: string, fileName: string): Promise<string> {
  const { readFile } = await import('node:fs/promises');
  return readFile(path.join(projectDir, SESSIONS_ROOT, fileName), 'utf8');
}

/** A real, hand-authored `SESSION-###.md` with no sidecar `.state/` file at all -- simulating a record
 * predating this piece's own sidecar mechanism. */
async function writeTruncatedFixture(projectDir: string, id: string): Promise<void> {
  const dir = path.join(projectDir, SESSIONS_ROOT);
  await mkdir(dir, { recursive: true });
  const text = `---
id: ${id}
type: SessionRecord
schemaVersion: 1
title: Fixture truncated session
status: truncated
created: 2026-01-01
updated: 2026-01-01
revision: 1
author: facilitator
changelog: []
sessionType: brainstorm
technique: []
question: A fixture question
constraints_applied: []
participants: [ pm, human ]
started: 2026-01-01T00:00:00.000Z
ended: 2026-01-01T00:05:00.000Z
cost_usd: 0
truncated_bound: wall-clock
---

## Frame
A fixture question

## Diverge
(no ideas)

## Converge
(no clusters or objections)

## Decisions
(none)

## Non-decisions
(none)

## Actions
(none)
`;
  await writeFile(path.join(dir, `${id}.md`), text);
}

/** Flips a real, already-persisted `SESSION-###.md`'s own `status` field to `truncated` in place --
 * the sidecar `.state/{id}.json` (written unconditionally alongside the record by `runSessionStep`,
 * `@forge/engine/interaction/session.ts`) is left completely untouched, exactly matching the real
 * shape a genuine bound-triggered truncation leaves behind (a real record marked `truncated`, plus its
 * own real, already-progressed `SessionState` sidecar). */
async function markRecordTruncated(projectDir: string, id: string): Promise<void> {
  const target = path.join(projectDir, SESSIONS_ROOT, `${id}.md`);
  const { readFile } = await import('node:fs/promises');
  const text = await readFile(target, 'utf8');
  const patched = text.replace(/^status: .*$/m, 'status: truncated');
  await writeFile(target, patched);
}
