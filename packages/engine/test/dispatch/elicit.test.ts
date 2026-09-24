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
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
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

/** A `reports/handoffs.md` register (`18` §18.7): no wrapper schema exists for `HandoffRecord`
 * (`SPEC-QUESTIONS.md` Q23), so this builds the front matter by hand rather than through a schema. */
function handoffsRegister(
  entries: readonly {
    readonly id: string;
    readonly step: string;
    readonly delivered: readonly string[];
  }[],
): string {
  return [
    '---',
    'type: HandoffRecord',
    'handoffs:',
    ...entries.flatMap((entry) => [
      `  - id: ${entry.id}`,
      '    from: test-architect',
      '    to: sdet',
      `    step: ${entry.step}`,
      "    timestamp: '2026-01-15T10:00:00Z'",
      `    delivered: [${entry.delivered.map((item) => `'${item}'`).join(', ')}]`,
      '    open_questions: []',
      '    assumptions: []',
      '    constraints_for_receiver: []',
      '    acceptance_for_receiver: []',
    ]),
    '---',
    '',
  ].join('\n');
}

/** Writes `docs/forge/reports/handoffs.md` under `root` (`readRegisterEntries`'s own default docRoots). */
async function writeHandoffs(
  root: string,
  entries: readonly {
    readonly id: string;
    readonly step: string;
    readonly delivered: readonly string[];
  }[],
): Promise<void> {
  const dir = path.join(root, 'docs/forge/reports');
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'handoffs.md'), handoffsRegister(entries));
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

describe('`show`: an elicit question can show a register entry an earlier step produced (PLAN-M14.md P41)', () => {
  const CONFIRM = node({
    id: 'intake:confirm-level',
    kind: 'elicit',
    questions: [
      {
        name: 'levelConfirmed',
        prompt: 'Which level?',
        choices: ['L0', 'L1', 'L2'],
        show: { type: 'HandoffRecord', subtype: 'level-proposal' },
      },
    ],
  });

  it('resolves the last matching entry, hands its fields to the port as context, and records shown.id', async () => {
    const projectRoot = await createTempRepo('show-found');
    await writeHandoffs(projectRoot, [
      { id: 'HO-0001', step: 'capture-constraints', delivered: ['subtype: constraints-captured'] },
      {
        id: 'HO-0002',
        step: 'propose-level',
        delivered: ['subtype: level-proposal', 'L2: a new capability'],
      },
    ]);
    const { port, asked } = scriptedAsk({ levelConfirmed: 'L2' });
    const ctx = createTestContext({ projectRoot, ask: port });

    const outcome = await executeStep(CONFIRM, ctx);

    expect(outcome.status).toBe('succeeded');
    expect(asked).toHaveLength(1);
    const context = asked[0]?.context ?? [];
    expect(context.some((line) => line.includes('HO-0002'))).toBe(true);
    expect(context.some((line) => line.includes('L2: a new capability'))).toBe(true);
    // Only the LAST matching (level-proposal) entry is shown, not the earlier, non-matching one.
    expect(context.some((line) => line.includes('HO-0001'))).toBe(false);
    expect(context.some((line) => line.includes('constraints-captured'))).toBe(false);

    const requested = (await eventsOf(projectRoot, ctx.runId)).find(
      (event) => event.type === 'ElicitationRequested',
    );
    const payload = requested?.payload as { questions?: readonly unknown[] } | undefined;
    expect(payload?.questions).toEqual([
      {
        name: 'levelConfirmed',
        prompt: 'Which level?',
        choices: ['L0', 'L1', 'L2'],
        shown: { type: 'HandoffRecord', subtype: 'level-proposal', id: 'HO-0002' },
      },
    ]);
  });

  it('with TWO entries that both match the subtype (a re-proposed level), the later one wins -- proves the "last" tie-break, not merely "the only match" (critic round 1)', async () => {
    const projectRoot = await createTempRepo('show-two-matching');
    await writeHandoffs(projectRoot, [
      {
        id: 'HO-0001',
        step: 'propose-level',
        delivered: ['subtype: level-proposal', 'L1: first pass'],
      },
      {
        id: 'HO-0002',
        step: 'propose-level',
        delivered: ['subtype: level-proposal', 'L2: revised after new input'],
      },
    ]);
    const { port, asked } = scriptedAsk({ levelConfirmed: 'L2' });
    const ctx = createTestContext({ projectRoot, ask: port });

    const outcome = await executeStep(CONFIRM, ctx);

    expect(outcome.status).toBe('succeeded');
    const context = asked[0]?.context ?? [];
    expect(context.some((line) => line.includes('HO-0002'))).toBe(true);
    expect(context.some((line) => line.includes('revised after new input'))).toBe(true);
    // The EARLIER matching entry (HO-0001, "first pass") is not shown at all.
    expect(context.some((line) => line.includes('HO-0001'))).toBe(false);
    expect(context.some((line) => line.includes('first pass'))).toBe(false);
  });

  it('no matching entry fails the step RUN-105, before ElicitationRequested, and the port is never asked', async () => {
    const projectRoot = await createTempRepo('show-missing');
    await writeHandoffs(projectRoot, [
      { id: 'HO-0001', step: 'capture-constraints', delivered: ['subtype: constraints-captured'] },
    ]);
    const { port, asked } = scriptedAsk({ levelConfirmed: 'L2' });
    const ctx = createTestContext({ projectRoot, ask: port });

    const outcome = await executeStep(CONFIRM, ctx);

    expect(outcome.status).toBe('failed');
    expect(outcome.failure?.code).toBe('RUN-105');
    expect(outcome.failure?.message).toContain('levelConfirmed');
    expect(asked).toEqual([]);
    const types = (await eventsOf(projectRoot, ctx.runId)).map((event) => event.type);
    expect(types).not.toContain('ElicitationRequested');
    expect(types).toContain('StepFailed');
  });

  it('an entry that exists only in the project root, not the integration tree, fails RUN-105', async () => {
    const projectRoot = await createTempRepo('show-root-only');
    const integrationPath = await createTempRepo('show-integration');
    // Written under the PROJECT root only -- `runElicit` reads `ctx.integrationPath`, a separate tree here.
    await writeHandoffs(projectRoot, [
      { id: 'HO-0002', step: 'propose-level', delivered: ['subtype: level-proposal'] },
    ]);
    const { port, asked } = scriptedAsk({ levelConfirmed: 'L2' });
    const ctx = createTestContext({ projectRoot, integrationPath, ask: port });

    const outcome = await executeStep(CONFIRM, ctx);

    expect(outcome.status).toBe('failed');
    expect(outcome.failure?.code).toBe('RUN-105');
    expect(asked).toEqual([]);
  });

  it('a replayed step reads nothing: no register file exists at all, yet the step still succeeds', async () => {
    const projectRoot = await createTempRepo('show-replay');
    const { port, asked } = scriptedAsk({});
    const answers = new Map<string, Readonly<Record<string, string>>>([
      [CONFIRM.id, { levelConfirmed: 'L2' }],
    ]);
    const ctx = createTestContext({ projectRoot, ask: port, answers });

    const outcome = await executeStep(CONFIRM, ctx);

    expect(outcome.status).toBe('succeeded');
    expect(asked).toEqual([]);
    const types = (await eventsOf(projectRoot, ctx.runId)).map((event) => event.type);
    expect(types.filter((type) => type.startsWith('Elicitation'))).toEqual([]);
  });

  it('a `show.type` that is not a register at run time (defense in depth beyond compile-time validation) also fails RUN-105', async () => {
    const projectRoot = await createTempRepo('show-not-register');
    const notARegister = node({
      id: 'wf:ask',
      kind: 'elicit',
      questions: [
        {
          name: 'x',
          prompt: 'x?',
          // A hand-built node bypassing validateStructure/compilePlan entirely -- the identical "driven
          // on its own" path every other RUN-039/RUN-101 test in this file already exercises.
          show: { type: 'Epic' },
        },
      ],
    });
    const { port, asked } = scriptedAsk({ x: 'y' });
    const ctx = createTestContext({ projectRoot, ask: port });

    const outcome = await executeStep(notARegister, ctx);

    expect(outcome.status).toBe('failed');
    expect(outcome.failure?.code).toBe('RUN-105');
    expect(asked).toEqual([]);
  });

  it('a configured reports root holding a glob-special character is read as a literal path, not corrupted by outputGlob-style escaping', async () => {
    const projectRoot = await createTempRepo('show-special-root');
    // `(`, `)` and `!` are all real, legal directory-name characters and all glob metacharacters --
    // outputGlob would escape them for minimatch; reading must not go through that escaping at all.
    const reportsRoot = 'docs (v2)!/reports';
    await mkdir(path.join(projectRoot, reportsRoot), { recursive: true });
    await writeFile(
      path.join(projectRoot, reportsRoot, 'handoffs.md'),
      handoffsRegister([
        { id: 'HO-0002', step: 'propose-level', delivered: ['subtype: level-proposal'] },
      ]),
    );
    const { port, asked } = scriptedAsk({ levelConfirmed: 'L2' });
    const ctx = createTestContext({
      projectRoot,
      ask: port,
      docRoots: {
        kb: 'docs/kb',
        specs: 'docs/specs',
        plans: 'docs/plans',
        sessions: 'docs/sessions',
        reports: reportsRoot,
      },
    });

    const outcome = await executeStep(CONFIRM, ctx);

    expect(outcome.status).toBe('succeeded');
    expect(asked[0]?.context?.some((line) => line.includes('HO-0002'))).toBe(true);
  });

  it('a configured reports root outside the project tree fails RUN-105 as data, never an uncaught throw (CFG-003)', async () => {
    const projectRoot = await createTempRepo('show-escaping-root');
    const { port, asked } = scriptedAsk({ levelConfirmed: 'L2' });
    const ctx = createTestContext({
      projectRoot,
      ask: port,
      docRoots: {
        kb: 'docs/kb',
        specs: 'docs/specs',
        plans: 'docs/plans',
        sessions: 'docs/sessions',
        // Climbs outside the project root entirely -- ProjectPaths.resolveWithin throws CFG-003 for this,
        // and readRegisterEntries must treat that as "nothing found," not let it propagate uncaught.
        reports: '../outside-the-project',
      },
    });

    const outcome = await executeStep(CONFIRM, ctx);

    expect(outcome.status).toBe('failed');
    expect(outcome.failure?.code).toBe('RUN-105');
    expect(asked).toEqual([]);
    const types = (await eventsOf(projectRoot, ctx.runId)).map((event) => event.type);
    expect(types).toContain('StepFailed');
  });

  it('an oversized field is clipped to a bounded line, not printed in full (critic round 1)', async () => {
    const projectRoot = await createTempRepo('show-long-line');
    const huge = `L2: ${'x'.repeat(1000)}`;
    await writeHandoffs(projectRoot, [
      { id: 'HO-0002', step: 'propose-level', delivered: ['subtype: level-proposal', huge] },
    ]);
    const { port, asked } = scriptedAsk({ levelConfirmed: 'L2' });
    const ctx = createTestContext({ projectRoot, ask: port });

    const outcome = await executeStep(CONFIRM, ctx);

    expect(outcome.status).toBe('succeeded');
    const context = asked[0]?.context ?? [];
    expect(context.every((line) => line.length <= 720)).toBe(true);
    expect(context.some((line) => line.includes('... (truncated)'))).toBe(true);
  });

  it('a very long array field is capped in total lines, with a final "and N more" marker, not an unbounded flood (critic round 1)', async () => {
    const projectRoot = await createTempRepo('show-many-lines');
    const many = Array.from({ length: 80 }, (_, index) => `note ${String(index)}`);
    await writeHandoffs(projectRoot, [
      { id: 'HO-0002', step: 'propose-level', delivered: ['subtype: level-proposal', ...many] },
    ]);
    const { port, asked } = scriptedAsk({ levelConfirmed: 'L2' });
    const ctx = createTestContext({ projectRoot, ask: port });

    const outcome = await executeStep(CONFIRM, ctx);

    expect(outcome.status).toBe('succeeded');
    const context = asked[0]?.context ?? [];
    expect(context.length).toBeLessThanOrEqual(51);
    expect(context.at(-1)).toContain('more field(s) (truncated)');
  });

  it('a question with no `show` at all carries no context and records no `shown`', async () => {
    const projectRoot = await createTempRepo('show-none');
    const { port, asked } = scriptedAsk({ ideaSummary: 'x', greenfield: 'greenfield' });
    const ctx = createTestContext({ projectRoot, ask: port });

    await executeStep(IDEA, ctx);

    expect(asked.every((request) => request.context === undefined)).toBe(true);
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

  it('a dependent command step gets FORGE_ANSWER_<name>, FORGE_PROJECT_ROOT and the FORGE run/step marker on top of the launcher env', () => {
    const env = commandStepEnvironment(graph.get('intake:after')!, {
      answers,
      stepGraph: graph,
      projectRoot: '/the/project',
      commandEnv: { PATH: '/shim:/usr/bin' },
      runId: 'run-elicit-env',
    });
    expect(env).toEqual({
      PATH: '/shim:/usr/bin',
      FORGE_PROJECT_ROOT: '/the/project',
      FORGE_RUN_ID: 'run-elicit-env',
      FORGE_STEP_ID: 'intake:after',
      FORGE_ANSWER_ideaSummary: 'an idea',
      FORGE_ANSWER_greenfield: 'greenfield',
    });
  });

  it('a step that does not depend on the elicit step sees none of its answers, but still gets the FORGE run/step marker', () => {
    const env = commandStepEnvironment(graph.get('intake:beside')!, {
      answers,
      stepGraph: graph,
      projectRoot: '/p',
      commandEnv: undefined,
      runId: 'run-elicit-env',
    });
    expect(Object.keys(env).sort()).toEqual([
      'FORGE_PROJECT_ROOT',
      'FORGE_RUN_ID',
      'FORGE_STEP_ID',
    ]);
  });

  it('carries the marker even when the launcher shim failed (commandEnv undefined) -- not merely inherited from it', () => {
    const env = commandStepEnvironment(graph.get('intake:beside')!, {
      answers,
      stepGraph: graph,
      projectRoot: '/p',
      commandEnv: undefined,
      runId: 'run-no-shim',
    });
    expect(env['FORGE_RUN_ID']).toBe('run-no-shim');
    expect(env['FORGE_STEP_ID']).toBe('intake:beside');
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
