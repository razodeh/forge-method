/**
 * The agent session's final text is kept in the run record (`PLAN-M13.md` P12, `Q208` finding 5):
 * `.forge/state/runs/<runId>/steps/<slug>/result.md`, written before the step is marked complete, sanitised
 * and capped, and referenced from the event log by relative path and size, never inlined.
 *
 * @see specs/05 §5.3
 * @see specs/18 §18.2, §18.4
 * @see specs/20 §20.5
 */
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { execa } from 'execa';
import { FakePlatformAdapter } from '@forge/testkit';
import { ProjectPaths } from '@forge/core/fs';
import { readEvents } from '@forge/telemetry/events';
import type { ForgeEvent } from '@forge/telemetry/events';
import { slugifyStepId } from '@forge/vcs';
import { afterEach, describe, expect, it } from 'vitest';

import { executeStep } from '../../src/dispatch/execute.ts';
import {
  MAX_RESULT_BYTES,
  sanitizeResultText,
  writeResultRecord,
} from '../../src/dispatch/result-record.ts';
import { toAgentId } from '../../src/plan/index.ts';
import { createTestContext, node } from './helpers.ts';

const cleanup: string[] = [];
afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function tempRepo(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), `forge-result-${prefix}-`));
  cleanup.push(dir);
  await execa('git', ['init', '--quiet', '-b', 'main'], { cwd: dir });
  await execa('git', ['commit', '--quiet', '--allow-empty', '-m', 'init'], { cwd: dir });
  return dir;
}

async function log(projectRoot: string, runId: string): Promise<ForgeEvent[]> {
  const all: ForgeEvent[] = [];
  for await (const event of readEvents(projectRoot, runId)) all.push(event);
  return all;
}

const stepDir = (projectRoot: string, runId: string, stepId: string): string =>
  path.join(projectRoot, '.forge', 'state', 'runs', runId, 'steps', slugifyStepId(stepId));

describe('sanitizeResultText', () => {
  it('strips terminal escape sequences and control bytes but keeps newlines and tabs', () => {
    const hostile =
      'ok\x1B[31mred\x1B[0m\x1B]0;title\x07 tab\there\nline2\x00\x08\x7F\x9B\u0085end';
    const { text } = sanitizeResultText(hostile);
    expect(text).toBe('okred tab\there\nline2end');
  });

  it('strips Unicode bidirectional overrides, which can make the stored text read differently from what it says', () => {
    expect(sanitizeResultText('a\u202Eb\u2066c\u2069d').text).toBe('abcd');
  });

  it('redacts secret shapes the event log also redacts, counting them', () => {
    const key = 'AKIAA1B2C3D4E5F6G7H8';
    const token = `ghp_${'a'.repeat(36)}`;
    const { text, redactions } = sanitizeResultText(`use ${key} then ${token} and ${key} again`);
    expect(text).toBe('use [REDACTED] then [REDACTED] and [REDACTED] again');
    expect(redactions).toBe(3);
  });

  it('redacts a whole PEM private key block, not only its header line', () => {
    const pem =
      '-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEAsecretbody\nmorebody\n-----END RSA PRIVATE KEY-----';
    const out = sanitizeResultText(`key:\n${pem}\nafter`);
    expect(out.text).toBe('key:\n[REDACTED]\nafter');
    expect(sanitizeResultText('-----BEGIN ENCRYPTED PRIVATE KEY-----\nabcdef').text).toBe(
      '[REDACTED]',
    );
  });

  it('redacts Anthropic-style, OpenAI-style, GitHub fine-grained and JWT tokens', () => {
    const tokens = [
      `sk-ant-api03-${'A'.repeat(30)}`,
      `sk-${'b'.repeat(40)}`,
      `github_pat_${'c'.repeat(30)}`,
      `gho_${'d'.repeat(36)}`,
      `eyJ${'e'.repeat(12)}.${'f'.repeat(12)}.${'g'.repeat(12)}`,
    ];
    for (const token of tokens) {
      expect(sanitizeResultText(`x ${token} y`).text).toBe('x [REDACTED] y');
    }
  });

  it('strips a bare carriage return (a line-overwriting terminal trick) but keeps the rest of the text', () => {
    expect(sanitizeResultText('good\rEVIL\nnext').text).toBe('goodEVIL\nnext');
  });

  it('stays linear on hostile input: repeated token prefixes with no terminator finish quickly', () => {
    const shapes = [
      'eyJ'.repeat(200_000),
      'sk-ant-'.repeat(100_000),
      'gho_'.repeat(150_000),
      '-----BEGIN PRIVATE KEY-----'.repeat(20_000),
      'Bearer '.repeat(100_000),
      '\x1B]0;'.repeat(100_000),
      'AKIA'.repeat(150_000),
    ];
    for (const shape of shapes) {
      const started = performance.now();
      sanitizeResultText(shape);
      expect(performance.now() - started).toBeLessThan(1500);
    }
  });

  it('bounds the text it examines: an answer far beyond the cap is cut, counted and marked', () => {
    const out = sanitizeResultText('x'.repeat(MAX_RESULT_BYTES * 6));
    expect(out.truncated).toBe(true);
    expect(out.omittedBytes).toBe(MAX_RESULT_BYTES * 5);
    expect(out.text).toContain('[truncated:');
  });

  it('still redacts a JWT that stands on its own', () => {
    const jwt = `eyJ${'a'.repeat(20)}.${'b'.repeat(20)}.${'c'.repeat(20)}`;
    expect(sanitizeResultText(`token ${jwt} end`).text).toBe('token [REDACTED] end');
  });

  it('keeps CRLF line endings and left-to-right/right-to-left marks; only a bare CR goes', () => {
    expect(sanitizeResultText('a\r\nb\u200Ec\u200Fd').text).toBe('a\r\nb\u200Ec\u200Fd');
  });

  it('keeps ZWJ, ZWNJ and legitimate Persian and emoji text intact', () => {
    const text =
      '\u{1F468}\u200D\u{1F469}\u200D\u{1F467} \u0645\u06CC\u200C\u062E\u0648\u0627\u0647\u0645';
    expect(sanitizeResultText(text).text).toBe(text);
    expect(sanitizeResultText(text).stripped).toBe(0);
  });

  it('strips the remaining invisible-text channels and counts what it removed', () => {
    const out = sanitizeResultText('a\u2060b\u2064c\u061Cd\u180Ee\u{E0100}f\u200Bg');
    expect(out.text).toBe('abcdefg');
    expect(out.stripped).toBe(6);
  });

  it('strips an ST-terminated OSC sequence without eating the rest of the answer', () => {
    expect(sanitizeResultText('before \x1B]0;title\x1B\\ AFTER stays').text).toBe(
      'before  AFTER stays',
    );
    // Unterminated: only the rest of that line goes, never the following lines.
    expect(sanitizeResultText('a \x1B]0;never ends\nline two\nline three').text).toBe(
      'a \nline two\nline three',
    );
  });

  it('strips invisible format characters, Unicode tag characters and lone surrogates', () => {
    expect(sanitizeResultText('a\u200Bb\uFEFFc\u2028d\u{E0041}e\uD800f').text).toBe('abcdef');
    // ZWJ/ZWNJ are legitimate text (emoji sequences, Persian, Indic scripts) and stay.
    expect(sanitizeResultText('\u{1F468}\u200D\u{1F469} a\u200Cb').text).toBe(
      '\u{1F468}\u200D\u{1F469} a\u200Cb',
    );
    expect(sanitizeResultText('ok \u{1F600} ok').text).toBe('ok \u{1F600} ok');
  });

  it('leaves ordinary text untouched and unmarked', () => {
    const out = sanitizeResultText('# Retro\n\n- went well: tests\n');
    expect(out).toEqual({
      text: '# Retro\n\n- went well: tests\n',
      redactions: 0,
      stripped: 0,
      truncated: false,
      omittedBytes: 0,
    });
  });

  it('caps at the byte limit with a marker naming what was omitted', () => {
    const out = sanitizeResultText('a'.repeat(100), 40);
    expect(out.truncated).toBe(true);
    expect(out.omittedBytes).toBe(60);
    expect(out.text.startsWith('a'.repeat(40))).toBe(true);
    expect(out.text).toContain('[truncated: 60 bytes omitted');
  });

  it('cuts on a character boundary: never leaves half of a multi-byte character', () => {
    // 4-byte characters; a 10-byte cap lands in the middle of the third one.
    const out = sanitizeResultText('\u{1F600}'.repeat(10), 10);
    expect(out.truncated).toBe(true);
    expect(out.text).not.toContain('�');
    expect(out.text.startsWith('\u{1F600}\u{1F600}\n')).toBe(true);
  });

  it('applies the cap after sanitising: stripped bytes do not count against it', () => {
    const out = sanitizeResultText(`${'\x1B[0m'.repeat(1000)}short`, 40);
    expect(out.truncated).toBe(false);
    expect(out.text).toBe('short');
  });

  it('the default cap is 256 KiB', () => {
    expect(MAX_RESULT_BYTES).toBe(256 * 1024);
    const out = sanitizeResultText('x'.repeat(MAX_RESULT_BYTES + 1));
    expect(out.truncated).toBe(true);
  });
});

describe('writeResultRecord', () => {
  it('writes result.md under the step directory and returns a relative reference with its size', async () => {
    const root = await tempRepo('write');
    const ref = await writeResultRecord(
      new ProjectPaths(root),
      'run-1',
      'wf-step-abc123',
      '# Answer\n',
    );
    expect(ref).toEqual({
      path: 'steps/wf-step-abc123/result.md',
      bytes: 9,
      truncated: false,
      redactions: 0,
      stripped: 0,
    });
    expect(
      await readFile(
        path.join(root, '.forge/state/runs/run-1/steps/wf-step-abc123/result.md'),
        'utf8',
      ),
    ).toBe('# Answer\n');
  });

  it("removes the previous attempt's result.md when the new session said nothing: nothing points at it", async () => {
    const root = await tempRepo('stale');
    const paths = new ProjectPaths(root);
    await writeResultRecord(paths, 'run-1', 'wf-step', 'first answer');
    const file = path.join(root, '.forge/state/runs/run-1/steps/wf-step/result.md');
    expect(await readFile(file, 'utf8')).toBe('first answer\n');
    expect(await writeResultRecord(paths, 'run-1', 'wf-step', '')).toBeUndefined();
    await expect(stat(file)).rejects.toThrow();
  });

  it('writes nothing for a session that produced no text: an empty file would read as an answer', async () => {
    const root = await tempRepo('empty');
    expect(
      await writeResultRecord(new ProjectPaths(root), 'run-1', 'wf-step', '  \n '),
    ).toBeUndefined();
    await expect(stat(path.join(root, '.forge/state/runs/run-1'))).rejects.toThrow();
  });
});

describe('an agent step keeps its answer', () => {
  it('records the final text beside prompt.md, with a reference (not the text) in SessionEnded, before StepSucceeded', async () => {
    const projectRoot = await tempRepo('step');
    const adapter = new FakePlatformAdapter();
    adapter.script(() => true, { text: ['The retrospective: ship smaller.'] });
    const ctx = createTestContext({ projectRoot, adapter, runId: 'run-keep' });
    const outcome = await executeStep(
      node({ id: 'wf:retro', kind: 'agent', agent: toAgentId('em'), brief: 'run the retro' }),
      ctx,
    );
    expect(outcome.status).toBe('succeeded');

    const dir = stepDir(projectRoot, 'run-keep', 'wf:retro');
    expect(await readFile(path.join(dir, 'result.md'), 'utf8')).toBe(
      'The retrospective: ship smaller.\n',
    );
    // Same directory as the prompt record P5 writes.
    expect((await stat(path.join(dir, 'prompt.md'))).isFile()).toBe(true);

    const events = await log(projectRoot, 'run-keep');
    const ended = events.find((e) => e.type === 'SessionEnded');
    expect(ended?.payload).toEqual({
      ok: true,
      result: {
        path: `steps/${slugifyStepId('wf:retro')}/result.md`,
        bytes: 33,
        truncated: false,
        redactions: 0,
        stripped: 0,
      },
    });
    // Never inlined: the text appears nowhere in the append-only log.
    const raw = await readFile(
      path.join(projectRoot, '.forge/state/runs/run-keep/events.ndjson'),
      'utf8',
    );
    expect(raw).not.toContain('ship smaller');
    // Durable before the step is marked complete.
    expect(events.findIndex((e) => e.type === 'SessionEnded')).toBeLessThan(
      events.findIndex((e) => e.type === 'StepSucceeded'),
    );
  });

  it('keeps the text of a session that ended in failure too: what it said is the best clue to why', async () => {
    const projectRoot = await tempRepo('failed');
    const adapter = new FakePlatformAdapter();
    adapter.script(() => true, { text: ['I could not finish because X.'], endReason: 'error' });
    const ctx = createTestContext({ projectRoot, adapter, runId: 'run-fail' });
    const outcome = await executeStep(
      node({ id: 'wf:retro', kind: 'agent', agent: toAgentId('em'), brief: 'run the retro' }),
      ctx,
    );
    expect(outcome.status).toBe('failed');
    expect(
      await readFile(path.join(stepDir(projectRoot, 'run-fail', 'wf:retro'), 'result.md'), 'utf8'),
    ).toContain('I could not finish because X.');
  });

  it('strips hostile bytes and redacts secrets before anything reaches disk', async () => {
    const projectRoot = await tempRepo('hostile');
    const adapter = new FakePlatformAdapter();
    adapter.script(() => true, {
      text: [`done\x1B[2J token ghp_${'z'.repeat(36)} ok`],
    });
    const ctx = createTestContext({ projectRoot, adapter, runId: 'run-hostile' });
    await executeStep(
      node({ id: 'wf:retro', kind: 'agent', agent: toAgentId('em'), brief: 'run the retro' }),
      ctx,
    );
    const stored = await readFile(
      path.join(stepDir(projectRoot, 'run-hostile', 'wf:retro'), 'result.md'),
      'utf8',
    );
    expect(stored).toBe('done token [REDACTED] ok\n');
    const ended = (await log(projectRoot, 'run-hostile')).find((e) => e.type === 'SessionEnded');
    expect(ended?.payload).toMatchObject({ result: { redactions: 1 } });
  });

  it('caps a huge answer and says so in both the file and the reference', async () => {
    const projectRoot = await tempRepo('huge');
    const adapter = new FakePlatformAdapter();
    adapter.script(() => true, { text: ['y'.repeat(MAX_RESULT_BYTES + 5000)] });
    const ctx = createTestContext({ projectRoot, adapter, runId: 'run-huge' });
    await executeStep(
      node({ id: 'wf:retro', kind: 'agent', agent: toAgentId('em'), brief: 'run the retro' }),
      ctx,
    );
    const stored = await readFile(
      path.join(stepDir(projectRoot, 'run-huge', 'wf:retro'), 'result.md'),
      'utf8',
    );
    expect(Buffer.byteLength(stored)).toBeLessThan(MAX_RESULT_BYTES + 400);
    expect(stored).toContain('[truncated: 5000 bytes omitted');
    const ended = (await log(projectRoot, 'run-huge')).find((e) => e.type === 'SessionEnded');
    expect(ended?.payload).toMatchObject({ result: { truncated: true } });
  });

  it("an adapter crash in a later attempt removes the earlier attempt's result.md rather than leaving it as this one's", async () => {
    const projectRoot = await tempRepo('crash-after');
    const adapter = new FakePlatformAdapter();
    const ctx = createTestContext({ projectRoot, adapter, runId: 'run-crash' });
    const dir = stepDir(projectRoot, 'run-crash', 'wf:retro');
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, 'result.md'), 'answer from the first attempt\n');
    adapter.startSession = () => {
      throw new Error('adapter died');
    };
    const outcome = await executeStep(
      node({ id: 'wf:retro', kind: 'agent', agent: toAgentId('em'), brief: 'run the retro' }),
      ctx,
    );
    expect(outcome.status).toBe('failed');
    await expect(stat(path.join(dir, 'result.md'))).rejects.toThrow();
  });

  it('fails the step, visibly, when the answer cannot be recorded: it is never silently dropped', async () => {
    const projectRoot = await tempRepo('unwritable');
    const adapter = new FakePlatformAdapter();
    adapter.script(() => true, { text: ['an answer'] });
    // A directory where `result.md` must go: prompt.md and context.json still write, only the result cannot.
    await mkdir(path.join(stepDir(projectRoot, 'run-unwritable', 'wf:retro'), 'result.md'), {
      recursive: true,
    });
    const ctx = createTestContext({ projectRoot, adapter, runId: 'run-unwritable' });
    const outcome = await executeStep(
      node({ id: 'wf:retro', kind: 'agent', agent: toAgentId('em'), brief: 'run the retro' }),
      ctx,
    );
    expect(outcome.status).toBe('failed');
    expect(outcome.failure?.message).toContain('Could not record the session result');
    // A coded failure, not a bare message: the underlying file-system refusal keeps its registered code.
    expect(outcome.failure?.code).toBe('RUN-034');
  });
});
