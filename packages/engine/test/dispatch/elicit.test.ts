/**
 * The `elicit` step kind (`PLAN-M13.md` P20, `10` §10.1 "Ask the human structured questions; blocks", `18` §18.4
 * `ElicitationRequested`/`ElicitationAnswered`). Driven through `executeStep`, the one entry point every real run
 * uses, against a real event log; the human is a fake `AskPort`.
 *
 * What is pinned: each question is asked once, in order, and the exchange is recorded as the two events the spec
 * names; an answer is checked (blank, over the cap, not one of the listed choices) and cleaned (control bytes and
 * terminal escapes) before anything keeps it; a run that cannot ask fails the step naming the question and the
 * remedy, never defaults and never waits; an answered step is not asked again; a later `command` step reads an
 * answer as data from its environment and an answer that looks like shell code is never run.
 */
import { existsSync } from 'node:fs';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { execa } from 'execa';
import { readEvents } from '@forge/telemetry/events';
import { describe, expect, it } from 'vitest';

import {
  ANSWER_MAX_CHARS,
  commandStepEnvironment,
  readRecordedAnswers,
  sanitizeAnswer,
} from '../../src/dispatch/elicit.ts';
import { executeStep } from '../../src/dispatch/execute.ts';
import type { AskPort, AskRequest } from '../../src/dispatch/types.ts';
import { classifyFailure } from '../../src/failures/classify.ts';
import { createTestContext, node } from './helpers.ts';

// Built from code points: an invisible or control character written into this file would be invisible in review.
const ESC = String.fromCharCode(0x1b);
const BEL = String.fromCharCode(0x07);
const RLO = String.fromCodePoint(0x202e);
const ZWSP = String.fromCodePoint(0x200b);
const ZWJ = String.fromCodePoint(0x200d);
const FAMILY = `${String.fromCodePoint(0x1f468)}${ZWJ}${String.fromCodePoint(0x1f469)}`;

async function createTempRepo(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), `forge-elicit-${prefix}-`));
  await execa('git', ['init', '--quiet', '-b', 'main'], { cwd: dir });
  await execa('git', ['commit', '--quiet', '--allow-empty', '-m', 'init'], { cwd: dir });
  return dir;
}

/** A human who answers from a script and remembers what they were asked. */
function scriptedAsk(answers: Readonly<Record<string, string | undefined>>): {
  readonly port: AskPort;
  readonly asked: AskRequest[];
} {
  const asked: AskRequest[] = [];
  return {
    asked,
    port: {
      ask(request) {
        asked.push(request);
        return Promise.resolve(answers[request.question.name]);
      },
    },
  };
}

async function eventsOf(projectRoot: string, runId: string) {
  const events = [];
  for await (const event of readEvents(projectRoot, runId)) events.push(event);
  return events;
}

const IDEA = node({
  id: 'intake:elicit-idea',
  kind: 'elicit',
  questions: [
    { name: 'ideaSummary', prompt: 'What are we building?' },
    { name: 'greenfield', prompt: 'New or existing?', choices: ['greenfield', 'brownfield'] },
  ],
});

describe('an elicit step asks its questions and records the exchange', () => {
  it('asks each question once, in order, and succeeds with the answers kept for later steps', async () => {
    const projectRoot = await createTempRepo('happy');
    const { port, asked } = scriptedAsk({
      ideaSummary: 'A booking app for dentists',
      greenfield: 'greenfield',
    });
    const answers = new Map<string, Readonly<Record<string, string>>>();
    const ctx = createTestContext({ projectRoot, ask: port, answers });

    const outcome = await executeStep(IDEA, ctx);

    expect(outcome.status).toBe('succeeded');
    expect(asked.map((request) => [request.question.name, request.index, request.total])).toEqual([
      ['ideaSummary', 1, 2],
      ['greenfield', 2, 2],
    ]);
    expect(answers.get(IDEA.id)).toEqual({
      ideaSummary: 'A booking app for dentists',
      greenfield: 'greenfield',
    });
    const events = await eventsOf(projectRoot, ctx.runId);
    const types = events.map((event) => event.type);
    // The two `18` §18.4 event types, in order, between the step's own start and its success.
    expect(types.filter((type) => type.startsWith('Elicitation'))).toEqual([
      'ElicitationRequested',
      'ElicitationAnswered',
    ]);
    expect(types.indexOf('StepStarted')).toBeLessThan(types.indexOf('ElicitationRequested'));
    expect(types.indexOf('ElicitationAnswered')).toBeLessThan(types.indexOf('StepSucceeded'));
    const requested = events.find((event) => event.type === 'ElicitationRequested');
    expect(requested?.stepId).toBe(IDEA.id);
    expect(requested?.payload).toEqual({
      questions: [
        { name: 'ideaSummary', prompt: 'What are we building?' },
        {
          name: 'greenfield',
          prompt: 'New or existing?',
          choices: ['greenfield', 'brownfield'],
        },
      ],
    });
    const answered = events.find((event) => event.type === 'ElicitationAnswered');
    expect(answered?.payload).toEqual({
      answers: { ideaSummary: 'A booking app for dentists', greenfield: 'greenfield' },
    });
  });

  it('writes nothing outside the run record: no file appears in the project', async () => {
    const projectRoot = await createTempRepo('nofiles');
    const { port } = scriptedAsk({ ideaSummary: 'x', greenfield: 'brownfield' });
    await executeStep(IDEA, createTestContext({ projectRoot, ask: port }));
    const status = (await execa('git', ['status', '--porcelain'], { cwd: projectRoot })).stdout;
    // Only the run record (the event log under .forge/state) is new.
    expect(status.split('\n').filter((line) => line !== '' && !line.includes('.forge'))).toEqual(
      [],
    );
  });

  it('trims an answer and strips control bytes and terminal escapes, recording that it did', async () => {
    const projectRoot = await createTempRepo('sanitise');
    const { port } = scriptedAsk({
      ideaSummary: `  ${ESC}[31mred${ESC}[0m${BEL} idea${RLO}txt \r\n  `,
      greenfield: 'greenfield',
    });
    const answers = new Map<string, Readonly<Record<string, string>>>();
    const ctx = createTestContext({ projectRoot, ask: port, answers });

    const outcome = await executeStep(IDEA, ctx);

    expect(outcome.status).toBe('succeeded');
    // ESC and BEL and the bidi override are gone (the CSI text after ESC is ordinary characters and stays).
    expect(answers.get(IDEA.id)?.['ideaSummary']).toBe('[31mred[0m ideatxt');
    const answered = (await eventsOf(projectRoot, ctx.runId)).find(
      (event) => event.type === 'ElicitationAnswered',
    );
    expect((answered?.payload as { sanitized?: string[] }).sanitized).toEqual(['ideaSummary']);
  });

  it('keeps emoji presentation selectors and keycaps: a heart is still a heart', async () => {
    const projectRoot = await createTempRepo('emoji');
    const heart = `${String.fromCodePoint(0x2764)}${String.fromCodePoint(0xfe0f)}`;
    const keycap = `1${String.fromCodePoint(0xfe0f)}${String.fromCodePoint(0x20e3)}`;
    const { port } = scriptedAsk({ ideaSummary: `${heart} ${keycap}`, greenfield: 'greenfield' });
    const answers = new Map<string, Readonly<Record<string, string>>>();
    await executeStep(IDEA, createTestContext({ projectRoot, ask: port, answers }));
    expect(answers.get(IDEA.id)?.['ideaSummary']).toBe(`${heart} ${keycap}`);
  });

  it('keeps an answer with an emoji joiner and a line break intact', async () => {
    const projectRoot = await createTempRepo('unicode');
    const { port } = scriptedAsk({
      ideaSummary: `family ${FAMILY} app\nsecond line`,
      greenfield: 'greenfield',
    });
    const answers = new Map<string, Readonly<Record<string, string>>>();
    await executeStep(IDEA, createTestContext({ projectRoot, ask: port, answers }));
    expect(answers.get(IDEA.id)?.['ideaSummary']).toBe(`family ${FAMILY} app\nsecond line`);
  });

  it('sanitizeAnswer is pure: the same text gives the same result and counts what it removed', () => {
    expect(sanitizeAnswer(`a${String.fromCharCode(0)}b${ZWSP}c`)).toEqual({
      text: 'abc',
      stripped: 2,
    });
    expect(sanitizeAnswer('plain')).toEqual({ text: 'plain', stripped: 0 });
    // Line and paragraph separators, soft hyphen, Arabic letter mark, variation selectors and the invisible
    // formatting range are removed too.
    const invisible = [0x2028, 0x2029, 0x00ad, 0x061c, 0xfe0e, 0x206a, 0xe0100]
      .map((point) => String.fromCodePoint(point))
      .join('');
    expect(sanitizeAnswer(`a${invisible}b`)).toEqual({ text: 'ab', stripped: 7 });
    expect(sanitizeAnswer('a\r\nb\rc')).toEqual({ text: 'a\nb\nc', stripped: 0 });
  });
});

describe('an answer that breaks the question rules fails the step, naming the question (RUN-102)', () => {
  it.each([
    ['blank', { ideaSummary: '   ', greenfield: 'greenfield' }, 'ideaSummary', /blank/],
    [
      'not one of the choices',
      { ideaSummary: 'x', greenfield: 'maybe' },
      'greenfield',
      /greenfield, brownfield/,
    ],
    [
      'over the cap',
      { ideaSummary: 'x'.repeat(ANSWER_MAX_CHARS + 1), greenfield: 'greenfield' },
      'ideaSummary',
      /over the 4000 limit/,
    ],
  ])('%s', async (_label, given, question, reason) => {
    const projectRoot = await createTempRepo('refuse');
    const { port } = scriptedAsk(given);
    const answers = new Map<string, Readonly<Record<string, string>>>();
    const ctx = createTestContext({ projectRoot, ask: port, answers });

    const outcome = await executeStep(IDEA, ctx);

    expect(outcome.status).toBe('failed');
    expect(outcome.failure?.source).toBe('elicit');
    expect(outcome.failure?.code).toBe('RUN-102');
    expect(outcome.failure?.message).toContain(`question ${question} of step`);
    expect(outcome.failure?.message).toMatch(reason);
    // The remedy is part of what the run reports.
    expect(outcome.failure?.message).toContain('forge resume --answers');
    // Nothing partial is kept: not even the answers that were fine.
    expect(answers.size).toBe(0);
    const types = (await eventsOf(projectRoot, ctx.runId)).map((event) => event.type);
    expect(types).not.toContain('ElicitationAnswered');
    expect(types).toContain('StepFailed');
    expect(classifyFailure(outcome)).toBe('policy');
  });
});

describe('an answer that holds a credential is refused (RUN-102): it must not reach a prompt, the run record or a resume', () => {
  it.each([
    ['an AWS access key', 'prod key AKIAABCDEFGHIJKLMNOP'],
    ['a GitHub token', `token ghp_${'a1B2'.repeat(9)}`],
    ['a bearer token', 'Authorization: Bearer abcdefghijklmnopqrstuvwxyz0123456789'],
    ['a connection string with a password', 'use postgres://admin:S3cretPass@db.internal:5432/app'],
    ['the redaction marker itself', '[REDACTED]'],
  ])('%s', async (_label, secret) => {
    const projectRoot = await createTempRepo('secret');
    const { port } = scriptedAsk({ ideaSummary: secret, greenfield: 'greenfield' });
    const answers = new Map<string, Readonly<Record<string, string>>>();
    const ctx = createTestContext({ projectRoot, ask: port, answers });

    const outcome = await executeStep(IDEA, ctx);

    expect(outcome.failure?.code).toBe('RUN-102');
    expect(outcome.failure?.message).toContain('credential');
    expect(answers.size).toBe(0);
    // Nothing of it reached the event log either.
    const log = JSON.stringify(await eventsOf(projectRoot, ctx.runId));
    expect(log).not.toContain(secret);
  });
});

describe('a run that cannot ask fails the step; it never defaults and never waits (RUN-101)', () => {
  it('names the question and the --answers remedy when the port has no answer', async () => {
    const projectRoot = await createTempRepo('unanswerable');
    const { port, asked } = scriptedAsk({ ideaSummary: 'x' });
    const ctx = createTestContext({ projectRoot, ask: port });

    const outcome = await executeStep(IDEA, ctx);

    expect(outcome.status).toBe('failed');
    expect(outcome.failure?.code).toBe('RUN-101');
    expect(outcome.failure?.message).toContain('asks question greenfield');
    expect(outcome.failure?.message).toContain('--answers');
    // Both were put to the port, in order; the second had nothing.
    expect(asked.map((request) => request.question.name)).toEqual(['ideaSummary', 'greenfield']);
  });

  it('fails RUN-101 when the context has no way to ask at all', async () => {
    const projectRoot = await createTempRepo('noport');
    const outcome = await executeStep(IDEA, createTestContext({ projectRoot }));
    expect(outcome.status).toBe('failed');
    expect(outcome.failure?.code).toBe('RUN-101');
    expect(outcome.failure?.message).toContain('asks question ideaSummary');
  });

  it('turns a port that throws into the same typed failure, not a crashed run', async () => {
    const projectRoot = await createTempRepo('throwing');
    const port: AskPort = { ask: () => Promise.reject(new Error('stdin closed')) };
    const outcome = await executeStep(IDEA, createTestContext({ projectRoot, ask: port }));
    expect(outcome.status).toBe('failed');
    expect(outcome.failure?.code).toBe('RUN-101');
    expect(outcome.failure?.message).toContain('stdin closed');
  });
});

describe('replay: an answered step is not asked again', () => {
  it('a step whose answers are recorded succeeds without asking and without new elicitation events', async () => {
    const projectRoot = await createTempRepo('replay');
    const { port, asked } = scriptedAsk({});
    const answers = new Map<string, Readonly<Record<string, string>>>([
      [IDEA.id, { ideaSummary: 'kept', greenfield: 'greenfield' }],
    ]);
    const ctx = createTestContext({ projectRoot, ask: port, answers });

    const outcome = await executeStep(IDEA, ctx);

    expect(outcome.status).toBe('succeeded');
    expect(asked).toEqual([]);
    const types = (await eventsOf(projectRoot, ctx.runId)).map((event) => event.type);
    expect(types.filter((type) => type.startsWith('Elicitation'))).toEqual([]);
  });

  it('a record that lacks one of the step questions (the workflow gained a question) asks again', async () => {
    const projectRoot = await createTempRepo('partial');
    const { port, asked } = scriptedAsk({ ideaSummary: 'new', greenfield: 'brownfield' });
    const answers = new Map<string, Readonly<Record<string, string>>>([
      [IDEA.id, { ideaSummary: 'old' }],
    ]);
    const outcome = await executeStep(IDEA, createTestContext({ projectRoot, ask: port, answers }));
    expect(outcome.status).toBe('succeeded');
    expect(asked).toHaveLength(2);
  });

  it('a recorded answer that no longer passes the question (the workflow changed its choices) is asked again', async () => {
    const projectRoot = await createTempRepo('stale');
    const { port, asked } = scriptedAsk({ ideaSummary: 'new', greenfield: 'brownfield' });
    const answers = new Map<string, Readonly<Record<string, string>>>([
      [IDEA.id, { ideaSummary: 'old', greenfield: 'hybrid' }],
    ]);
    const outcome = await executeStep(IDEA, createTestContext({ projectRoot, ask: port, answers }));
    expect(outcome.status).toBe('succeeded');
    expect(asked).toHaveLength(2);
    expect(answers.get(IDEA.id)).toEqual({ ideaSummary: 'new', greenfield: 'brownfield' });
  });

  it('readRecordedAnswers does not replay an answer the log redacted: the step is asked again, not given a marker', async () => {
    const projectRoot = await createTempRepo('redacted');
    const ctx = createTestContext({ projectRoot });
    await ctx.telemetry.emit({
      type: 'ElicitationAnswered',
      stepId: 'wf:redacted',
      payload: { answers: { apiKey: '[REDACTED]', note: 'kept' } },
    });
    await ctx.telemetry.emit({
      type: 'ElicitationAnswered',
      stepId: 'wf:fine',
      payload: { answers: { note: 'kept' } },
    });
    const recorded = await readRecordedAnswers(projectRoot, ctx.runId);
    expect(recorded.has('wf:redacted')).toBe(false);
    expect(recorded.get('wf:fine')).toEqual({ note: 'kept' });
  });

  it('readRecordedAnswers rebuilds the answers from the event log, skipping a malformed payload', async () => {
    const projectRoot = await createTempRepo('recorded');
    const { port } = scriptedAsk({ ideaSummary: 'from the log', greenfield: 'greenfield' });
    const ctx = createTestContext({ projectRoot, ask: port });
    await executeStep(IDEA, ctx);
    await ctx.telemetry.emit({
      type: 'ElicitationAnswered',
      stepId: 'wf:broken',
      payload: { answers: 'not an object' },
    });

    const recorded = await readRecordedAnswers(projectRoot, ctx.runId);

    expect(recorded.get(IDEA.id)).toEqual({
      ideaSummary: 'from the log',
      greenfield: 'greenfield',
    });
    expect(recorded.has('wf:broken')).toBe(false);
  });
});

describe('two elicit steps sharing one port never interleave their questions', () => {
  it('the second step is not asked until the first has been answered', async () => {
    const projectRoot = await createTempRepo('serial');
    const log: string[] = [];
    const port: AskPort = {
      async ask(request) {
        log.push(`ask ${request.stepId}:${request.question.name}`);
        await new Promise((resolve) => setTimeout(resolve, 15));
        log.push(`answered ${request.stepId}:${request.question.name}`);
        return request.question.choices?.[0] ?? 'x';
      },
    };
    const other = node({
      id: 'intake:other',
      kind: 'elicit',
      questions: [{ name: 'other', prompt: 'Other?' }],
    });
    const ctx = createTestContext({ projectRoot, ask: port });
    await Promise.all([executeStep(IDEA, ctx), executeStep(other, ctx)]);
    // Every ask of the first step (both questions) finished before the other step's began.
    expect(log).toEqual([
      'ask intake:elicit-idea:ideaSummary',
      'answered intake:elicit-idea:ideaSummary',
      'ask intake:elicit-idea:greenfield',
      'answered intake:elicit-idea:greenfield',
      'ask intake:other:other',
      'answered intake:other:other',
    ]);
  });
});

describe('what a later step may read (answers are data)', () => {
  const graph = new Map(
    [
      IDEA,
      node({ id: 'intake:after', kind: 'command', run: 'true', dependsOn: [IDEA.id] }),
      node({ id: 'intake:beside', kind: 'command', run: 'true' }),
    ].map((step) => [step.id, step] as const),
  );
  const answers = new Map<string, Readonly<Record<string, string>>>([
    [IDEA.id, { ideaSummary: 'an idea', greenfield: 'greenfield' }],
  ]);

  it('a dependent command step gets FORGE_ANSWER_<name> and FORGE_PROJECT_ROOT on top of the launcher env', () => {
    const env = commandStepEnvironment(graph.get('intake:after')!, {
      answers,
      stepGraph: graph,
      projectRoot: '/the/project',
      commandEnv: { PATH: '/shim:/usr/bin' },
    });
    expect(env).toEqual({
      PATH: '/shim:/usr/bin',
      FORGE_PROJECT_ROOT: '/the/project',
      FORGE_ANSWER_ideaSummary: 'an idea',
      FORGE_ANSWER_greenfield: 'greenfield',
    });
  });

  it('a step that does not depend on the elicit step sees none of its answers', () => {
    const env = commandStepEnvironment(graph.get('intake:beside')!, {
      answers,
      stepGraph: graph,
      projectRoot: '/p',
      commandEnv: undefined,
    });
    expect(Object.keys(env)).toEqual(['FORGE_PROJECT_ROOT']);
  });

  it('an answer that looks like shell code reaches the command as text and is never run', async () => {
    const projectRoot = await createTempRepo('inject');
    const outDir = await mkdtemp(path.join(tmpdir(), 'forge-elicit-out-'));
    const proof = path.join(outDir, 'PWNED');
    const copy = path.join(outDir, 'copy');
    const hostile = `x'; touch ${proof}; echo '$(touch ${proof})\`touch ${proof}\``;
    const { port } = scriptedAsk({ ideaSummary: hostile, greenfield: 'greenfield' });
    const answers = new Map<string, Readonly<Record<string, string>>>();
    const ctx = createTestContext({ projectRoot, ask: port, answers });
    await executeStep(IDEA, ctx);
    const step = node({
      id: 'intake:echo',
      kind: 'command',
      laneAffinity: 'inline',
      dependsOn: [IDEA.id],
      // The shipped pattern: the answer is read from the environment, quoted, never spelled into the command text.
      run: `printf %s "$FORGE_ANSWER_ideaSummary" > ${copy}`,
    });

    const outcome = await executeStep(step, {
      ...ctx,
      stepGraph: new Map([
        [IDEA.id, IDEA],
        [step.id, step],
      ]),
    });

    expect(outcome.status).toBe('succeeded');
    expect(existsSync(proof)).toBe(false);
    expect(await readFile(copy, 'utf8')).toBe(hostile);
  });
});

describe('subworkflow is still refused, with a message that says so (RUN-039)', () => {
  it('names the kind and no longer tells the author to remove elicit steps', async () => {
    const projectRoot = await createTempRepo('subworkflow');
    let caught: unknown;
    try {
      await executeStep(
        node({ id: 'wf:deliver', kind: 'subworkflow', workflow: 'deliver-stage' }),
        createTestContext({ projectRoot }),
      );
    } catch (error) {
      caught = error;
    }
    expect((caught as { code?: string }).code).toBe('RUN-039');
    const remedy = (caught as { remedy?: string }).remedy ?? '';
    expect(remedy).toMatch(/subworkflow/);
    expect(remedy).toMatch(/elicit and session steps are supported/);
  });
});
