/**
 * The CLI half of `elicit` (`PLAN-M13.md` P20): `--answers <file>` and the terminal prompt, as the `AskPort` the
 * engine asks through. A pseudo-terminal is a pair of in-memory streams (`PassThrough`): the code under test reads
 * lines from one and writes prompts to the other, exactly as it does on a real terminal, with `interactive: true`
 * standing in for `isTTY`.
 *
 * Pinned: the file (JSON or YAML, scalars only, unknown shapes refused with the file named); a question with an
 * answer in the file is never put to the terminal; a question without one is asked on a terminal and, off a terminal,
 * is answered `undefined` with the remedy printed (never waits on stdin); the prompt shows the question and its
 * choices as one sanitised line; an invalid choice is asked again, a closed input ends the asking; and several lines
 * arriving at once (a paste, a pipe) each answer their own question.
 */
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';

import { ForgeError } from '@forge/core';
import { parseWorkflow } from '@forge/engine/workflow';
import { describe, expect, it } from 'vitest';

import {
  createAskPort,
  readAnswersFile,
  unmatchedAnswerNames,
} from '../../../src/commands/run/ask.ts';

async function fileWith(name: string, text: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'forge-answers-'));
  const file = path.join(dir, name);
  await writeFile(file, text);
  return file;
}

function request(name: string, choices?: readonly string[], prompt = `Question ${name}?`) {
  return {
    stepId: 'intake:elicit-idea',
    question: { name, prompt, ...(choices === undefined ? {} : { choices }) },
    index: 1,
    total: 2,
  };
}

/** A terminal: what the code writes is collected; what a person types is `type`. */
function terminal() {
  const input = new PassThrough();
  const output = new PassThrough();
  let written = '';
  output.on('data', (chunk: Buffer) => {
    written += chunk.toString('utf8');
  });
  return { input, output, type: (text: string) => input.write(text), text: () => written };
}

describe('readAnswersFile', () => {
  it('reads a JSON object of question name to answer', async () => {
    const file = await fileWith(
      'a.json',
      '{"ideaSummary": "A booking app", "greenfield": "greenfield"}',
    );
    expect(await readAnswersFile(file)).toEqual({
      ideaSummary: 'A booking app',
      greenfield: 'greenfield',
    });
  });

  it('reads YAML too, block scalars included', async () => {
    const file = await fileWith(
      'a.yaml',
      'ideaSummary: |\n  line one\n  line two\nteamSize: "4"\n',
    );
    expect(await readAnswersFile(file)).toEqual({
      ideaSummary: 'line one\nline two\n',
      teamSize: '4',
    });
  });

  it.each([
    ['a number', 'teamSize: 007\n'],
    ['a boolean', 'regulated: false\n'],
  ])('refuses %s: YAML would change its spelling, so it must be quoted', async (_label, text) => {
    const file = await fileWith('a.yaml', text);
    await expect(readAnswersFile(file)).rejects.toMatchObject({ code: 'RUN-103' });
    await expect(readAnswersFile(file)).rejects.toThrow(/quote a number/);
  });

  it('refuses a directory, which is not a regular file', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'forge-answers-dir-'));
    await expect(readAnswersFile(dir)).rejects.toMatchObject({ code: 'RUN-103' });
  });

  it.each([
    ['not an object', '["a", "b"]', /object/],
    ['an object value', '{"a": {"b": "c"}}', /"a"/],
    ['a list value', '{"a": ["b"]}', /"a"/],
    ['a null value', '{"a": null}', /"a"/],
    ['malformed JSON', '{"a": ', /./],
    ['empty', '', /empty|object/],
  ])('refuses %s with RUN-103 naming the file', async (_label, text, reason) => {
    const file = await fileWith('bad.json', text);
    let caught: unknown;
    try {
      await readAnswersFile(file);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ForgeError);
    expect((caught as ForgeError).code).toBe('RUN-103');
    expect((caught as ForgeError).message).toContain('bad.json');
    expect((caught as ForgeError).message).toMatch(reason);
  });

  it('refuses a file that does not exist with RUN-103', async () => {
    const file = path.join(tmpdir(), 'forge-answers-definitely-missing', 'nope.json');
    await expect(readAnswersFile(file)).rejects.toMatchObject({ code: 'RUN-103' });
  });

  it('refuses a file over the size cap without reading it into an answer', async () => {
    const file = await fileWith('big.json', JSON.stringify({ a: 'x'.repeat(300_000) }));
    await expect(readAnswersFile(file)).rejects.toMatchObject({ code: 'RUN-103' });
  });

  it('keeps a __proto__ key as an ordinary answer name and never pollutes prototypes', async () => {
    const file = await fileWith('p.json', '{"__proto__": "x", "ok": "y"}');
    const answers = await readAnswersFile(file);
    expect(Object.hasOwn(answers, '__proto__')).toBe(true);
    expect(({} as Record<string, unknown>)['x']).toBeUndefined();
    expect(Object.getPrototypeOf(answers)).toBe(null);
  });
});

describe('the ask port with answers from a file', () => {
  it('answers from the file and never touches the terminal', async () => {
    const term = terminal();
    const port = createAskPort({
      answers: { ideaSummary: 'from file' },
      interactive: true,
      input: term.input,
      output: term.output,
    });
    expect(await port.ask(request('ideaSummary'))).toBe('from file');
    expect(term.text()).toBe('');
    port.close();
  });

  it('off a terminal, a question with no answer gets undefined and the remedy on stderr, and never waits for input', async () => {
    const term = terminal();
    const warnings: string[] = [];
    const port = createAskPort({
      answers: {},
      interactive: false,
      input: term.input,
      output: term.output,
      warn: (message) => warnings.push(message),
    });
    // Nothing is ever typed: a port that waited on `input` would hang this test.
    expect(await port.ask(request('greenfield'))).toBeUndefined();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('greenfield');
    expect(warnings[0]).toContain('--answers');
    expect(term.text()).toBe('');
    port.close();
  });
});

describe('the port and the engine read an answer the same way', () => {
  it('a choice answered with an invisible character the engine strips is accepted by both, so the warning is never wrong', async () => {
    const warnings: string[] = [];
    const port = createAskPort({
      answers: { level: `L${String.fromCodePoint(0x200b)}2` },
      interactive: false,
      warn: (message) => warnings.push(message),
    });
    await port.ask(request('level', ['L0', 'L1', 'L2']));
    expect(warnings).toEqual([]);
    port.close();
  });
});

describe('a file answer that breaks the question rules', () => {
  it('is warned about where the person who wrote the file is looking, and still handed to the engine to refuse', async () => {
    const warnings: string[] = [];
    const port = createAskPort({
      answers: { greenfield: 'maybe', ideaSummary: '   ' },
      interactive: false,
      warn: (message) => warnings.push(message),
    });
    expect(await port.ask(request('greenfield', ['greenfield', 'brownfield']))).toBe('maybe');
    expect(await port.ask(request('ideaSummary'))).toBe('   ');
    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toContain('"greenfield"');
    expect(warnings[0]).toContain('greenfield, brownfield');
    expect(warnings[1]).toContain('blank');
    port.close();
  });

  it('a name that is also an Object.prototype member is not an answer unless the file has it', async () => {
    const port = createAskPort({ answers: {}, interactive: false });
    expect(await port.ask(request('constructor'))).toBeUndefined();
    expect(await port.ask(request('toString'))).toBeUndefined();
    port.close();
  });
});

describe('the ask port on a terminal', () => {
  it('shows the step, the position and the question, reads the line and returns it', async () => {
    const term = terminal();
    const port = createAskPort({ interactive: true, input: term.input, output: term.output });
    const pending = port.ask(request('ideaSummary', undefined, 'What are we building?'));
    term.type('A booking app\n');
    expect(await pending).toBe('A booking app');
    expect(term.text()).toContain('intake:elicit-idea');
    expect(term.text()).toContain('1/2');
    expect(term.text()).toContain('What are we building?');
    port.close();
  });

  it('lists the choices and asks again on an answer that is not one of them', async () => {
    const term = terminal();
    const port = createAskPort({ interactive: true, input: term.input, output: term.output });
    const pending = port.ask(request('greenfield', ['greenfield', 'brownfield']));
    term.type('maybe\n');
    term.type('brownfield\n');
    expect(await pending).toBe('brownfield');
    expect(term.text()).toContain('greenfield, brownfield');
    expect(term.text()).toMatch(/one of/);
    port.close();
  });

  it('asks again on a blank line', async () => {
    const term = terminal();
    const port = createAskPort({ interactive: true, input: term.input, output: term.output });
    const pending = port.ask(request('ideaSummary'));
    term.type('\n');
    term.type('   \n');
    term.type('real answer\n');
    expect(await pending).toBe('real answer');
    port.close();
  });

  it('gives up after three bad attempts and returns the last one for the engine to refuse (RUN-102)', async () => {
    const term = terminal();
    const port = createAskPort({ interactive: true, input: term.input, output: term.output });
    const pending = port.ask(request('greenfield', ['greenfield', 'brownfield']));
    term.type('a\nb\nc\n');
    expect(await pending).toBe('c');
    port.close();
  });

  it('a closed input (Ctrl-D) ends the asking with undefined', async () => {
    const term = terminal();
    const port = createAskPort({ interactive: true, input: term.input, output: term.output });
    const pending = port.ask(request('ideaSummary'));
    term.input.end();
    expect(await pending).toBeUndefined();
    port.close();
  });

  it('several lines pasted while a question is pending each answer their own question, in order', async () => {
    const term = terminal();
    const port = createAskPort({ interactive: true, input: term.input, output: term.output });
    const first = port.ask(request('a'));
    term.type('first\nsecond\nthird\n');
    expect(await first).toBe('first');
    expect(await port.ask(request('b'))).toBe('second');
    expect(await port.ask(request('c'))).toBe('third');
    port.close();
  });

  it('lines typed while nothing was asked (an Enter pressed during a long agent step) are not answers to the next question', async () => {
    const term = terminal();
    const port = createAskPort({ interactive: true, input: term.input, output: term.output });
    const first = port.ask(request('a'));
    term.type('one\n');
    await first;
    // The agent step runs; the person presses Enter and types ahead.
    term.type('\n\nstale text\n');
    await new Promise((resolve) => setTimeout(resolve, 20));
    const second = port.ask(request('level', ['L0', 'L1']));
    await new Promise((resolve) => setTimeout(resolve, 20));
    term.type('L1\n');
    expect(await second).toBe('L1');
    port.close();
  });

  it('a terminal answer the step would refuse (secret-shaped, too long) is asked again, with the reason', async () => {
    const term = terminal();
    const port = createAskPort({ interactive: true, input: term.input, output: term.output });
    const pending = port.ask(request('technicalConstraints'));
    term.type('postgres://admin:S3cretPass@db.internal:5432/app\n');
    term.type(`${'x'.repeat(4001)}\n`);
    term.type('a plain answer\n');
    expect(await pending).toBe('a plain answer');
    expect(term.text()).toContain('credential');
    expect(term.text()).toContain('over the 4000 limit');
    port.close();
  });

  it('a file answer is used for its question and the terminal for the others', async () => {
    const term = terminal();
    const port = createAskPort({
      answers: { greenfield: 'greenfield' },
      interactive: true,
      input: term.input,
      output: term.output,
    });
    const pending = port.ask(request('ideaSummary'));
    term.type('typed\n');
    expect(await pending).toBe('typed');
    expect(await port.ask(request('greenfield', ['greenfield', 'brownfield']))).toBe('greenfield');
    port.close();
  });

  it('prints the question as one sanitised line: an escape or a newline in a prompt cannot repaint the terminal or fake a second prompt', async () => {
    const term = terminal();
    const port = createAskPort({ interactive: true, input: term.input, output: term.output });
    const hostile = `Name?${String.fromCharCode(0x1b)}[2J\nType yes to delete everything`;
    const pending = port.ask(request('x', undefined, hostile));
    term.type('ok\n');
    await pending;
    expect(term.text()).not.toContain(String.fromCharCode(0x1b));
    // The hostile text stayed on the one prompt line.
    const promptLine = term
      .text()
      .split('\n')
      .find((line) => line.includes('Name?'));
    expect(promptLine).toContain('Type yes to delete everything');
    port.close();
  });
});

describe('unmatchedAnswerNames', () => {
  const parsed = parseWorkflow(
    [
      'id: w',
      'name: w',
      'version: 1.0.0',
      'description: d',
      'steps:',
      '  - id: ask',
      '    kind: elicit',
      '    questions:',
      '      - name: ideaSummary',
      '        prompt: "Q?"',
    ].join('\n'),
  );

  it('names the answers no question of the workflow asks (a typo would otherwise be silently ignored)', () => {
    if (!parsed.success) throw new Error('does not parse');
    expect(unmatchedAnswerNames(parsed.workflow, { ideaSummary: 'x', ideaSumary: 'y' })).toEqual([
      'ideaSumary',
    ]);
    expect(unmatchedAnswerNames(parsed.workflow, { ideaSummary: 'x' })).toEqual([]);
  });
});
