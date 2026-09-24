/**
 * The CLI's answer to an `elicit` step's question (`PLAN-M13.md` P20, `10` §10.1, owner decision 2026-09-20): the
 * `AskPort` `@forge/engine` asks through, built from what the command line said.
 *
 * - `--answers <file>` (`readAnswersFile`): a JSON or YAML object of question name to answer. It is the
 *   non-interactive route, and how a test or a script drives `intake`. A question with an answer here is never put to
 *   anyone.
 * - A terminal (`interactive`): a question without a file answer is written as one sanitised prompt line and read from
 *   the next line of input. A blank line, or one that is not among the question's `choices`, is asked again (three
 *   tries, then the last line goes back and the engine refuses it, `RUN-102`); a closed input ends the asking.
 * - Neither: the answer is `undefined` and the remedy is printed once. The port never waits on a stream that is not a
 *   terminal, so a run in CI with no `--answers` fails at the question instead of hanging.
 *
 * Input is read through one persistent `line` listener feeding a queue, not one `once('line')` per question: lines
 * that arrive together (a paste) would otherwise be dropped between two listeners.
 *
 * @see specs/10 §10.1
 * @see PLAN-M13.md P20
 */
import { open, stat } from 'node:fs/promises';
import { createInterface, type Interface } from 'node:readline';

import { ForgeError } from '@forge/core';
import { checkElicitAnswer, type AskPort, type AskRequest } from '@forge/engine/dispatch';
import { parseWorkflow, type Workflow, type WorkflowStep } from '@forge/engine/workflow';
import * as YAML from 'yaml';

import { sanitizeRefusalText } from './vcs-refusal.ts';

/** A larger answers file is a mistake (a wrong file, not a set of answers): refused unread. Answers themselves are
 * capped at 4000 characters each by the engine. */
export const ANSWERS_FILE_MAX_BYTES = 256 * 1024;

/** How many times one question is put to a terminal before the last line is handed back to be refused. */
const MAX_ATTEMPTS = 3;

function refuseFile(file: string, reason: string, cause?: unknown): ForgeError {
  return new ForgeError(
    'RUN-103',
    { path: sanitizeRefusalText(file), reason },
    cause === undefined ? undefined : { cause },
  );
}

/** Reads `--answers <file>`: one JSON or YAML object whose keys are question names and whose values are TEXT (a
 * number or boolean is refused: YAML would change `007` to 7, so the author must quote it). Returns a prototype-less
 * record, so a key such as `__proto__` is only an answer name.
 *
 * @throws {ForgeError} `RUN-103` when the file is not a regular file, cannot be read, is over `ANSWERS_FILE_MAX_BYTES`,
 * is not one object, or holds a value that is not a string. */
export async function readAnswersFile(file: string): Promise<Readonly<Record<string, string>>> {
  let text: string;
  try {
    // A regular file only (a FIFO or `/dev/stdin` reports no size and would block; a device never ends), and read
    // through a bounded buffer, not by trusting `stat` (a file may grow between the two).
    if (!(await stat(file)).isFile()) throw new Error('not a regular file');
    const handle = await open(file, 'r');
    try {
      const buffer = Buffer.alloc(ANSWERS_FILE_MAX_BYTES + 1);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      if (bytesRead > ANSWERS_FILE_MAX_BYTES) {
        throw refuseFile(file, `it is over the ${String(ANSWERS_FILE_MAX_BYTES)} byte limit`);
      }
      text = buffer.subarray(0, bytesRead).toString('utf8');
    } finally {
      await handle.close();
    }
  } catch (cause) {
    if (cause instanceof ForgeError) throw cause;
    throw refuseFile(file, 'it cannot be read (does it exist, and is it a regular file?)', cause);
  }
  let parsed: unknown;
  try {
    parsed = YAML.parse(text);
  } catch (cause) {
    throw refuseFile(file, 'it is neither valid JSON nor valid YAML', cause);
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw refuseFile(
      file,
      'it must hold one object of question name to answer (it is empty or another shape)',
    );
  }
  // `Object.create(null)` is a `Record<string, string>` with no prototype: every key set below is a string.
  const answers: Record<string, string> = Object.create(null) as Record<string, string>;
  for (const [name, value] of Object.entries(parsed)) {
    // Text only: YAML would turn an unquoted `007` into 7 and `1.10` into 1.1, changing the answer without a word.
    if (typeof value === 'string') answers[name] = value;
    else {
      throw refuseFile(
        file,
        `the answer to "${sanitizeRefusalText(name)}" must be text (quote a number or true/false to keep its spelling), not a list, an object or null`,
      );
    }
  }
  return answers;
}

function collectQuestionNames(steps: readonly WorkflowStep[], into: Set<string>): void {
  for (const step of steps) {
    if (step.kind === 'elicit') for (const question of step.questions) into.add(question.name);
    else if (step.kind === 'parallel' || step.kind === 'sequence')
      collectQuestionNames(step.steps, into);
    else if (step.kind === 'fanout') collectQuestionNames([step.step], into);
  }
}

/** The names in `answers` that no `elicit` question of `workflow` asks: a misspelt key would otherwise be ignored and
 * its question left unanswered. Sorted. */
export function unmatchedAnswerNames(
  workflow: Workflow,
  answers: Readonly<Record<string, string>>,
): readonly string[] {
  const asked = new Set<string>();
  collectQuestionNames(workflow.steps, asked);
  return Object.keys(answers)
    .filter((name) => !asked.has(name))
    .sort();
}

/** One warning per answer name in `answers` that no `elicit` question of the workflow in `workflowSource` asks. A
 * workflow that does not parse warns of nothing here: the run's own refusal says why. */
export function unmatchedAnswerWarnings(
  workflowSource: string,
  answers: Readonly<Record<string, string>>,
): readonly string[] {
  const parsed = parseWorkflow(workflowSource);
  if (!parsed.success) return [];
  return unmatchedAnswerNames(parsed.workflow, answers).map(
    (name) =>
      `--answers has an answer for "${sanitizeRefusalText(name)}", which no question of workflow ${sanitizeRefusalText(parsed.workflow.id)} asks, so it is ignored (a misspelt name leaves its question unanswered).`,
  );
}

export interface AskPortOptions {
  /** Answers from `--answers`, by question name. */
  readonly answers?: Readonly<Record<string, string>> | undefined;
  /** Whether a person is at the terminal: stdin and stderr are TTYs. Only then is a prompt written or input read. */
  readonly interactive: boolean;
  readonly input?: NodeJS.ReadableStream | undefined;
  /** Where prompts go: stderr in the CLI, so `--json` output on stdout stays one document. */
  readonly output?: NodeJS.WritableStream | undefined;
  /** Where the "no answer" remedy goes when nobody can be asked. */
  readonly warn?: ((message: string) => void) | undefined;
}

/** The `AskPort` a run asks through, plus `close` for the input it may have opened. Built by `createAskPort`. */
export interface CliAskPort extends AskPort {
  /** Stops reading input, so the process can exit. Idempotent. */
  close(): void;
}

/** Lines from a stream, in order, however they arrive; `undefined` once the stream has ended. */
class LineQueue {
  private readonly lines: string[] = [];
  private readonly waiters: ((line: string | undefined) => void)[] = [];
  private ended = false;
  /** How many buffered lines belong to the question that was just answered (typed or pasted while it was pending). */
  private keep = 0;
  private readonly reader: Interface;

  constructor(input: NodeJS.ReadableStream, output: NodeJS.WritableStream) {
    this.reader = createInterface({ input, output, terminal: false });
    this.reader.on('line', (line) => {
      const waiter = this.waiters.shift();
      if (waiter === undefined) this.lines.push(line);
      else waiter(line);
    });
    this.reader.on('close', () => {
      this.ended = true;
      for (const waiter of this.waiters.splice(0)) waiter(undefined);
    });
  }

  next(): Promise<string | undefined> {
    const line = this.lines.shift();
    if (line !== undefined) return Promise.resolve(line);
    if (this.ended) return Promise.resolve(undefined);
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  /** Called when a question starts: lines typed while NOTHING was asked (an Enter pressed during a long agent step)
   * are not answers to it and are dropped; lines that arrived while the previous question was pending are kept. */
  beginQuestion(): void {
    this.lines.length = Math.min(this.lines.length, this.keep);
  }

  /** Called when a question is answered: whatever is buffered now arrived during it, and may answer the next. */
  endQuestion(): void {
    this.keep = this.lines.length;
  }

  close(): void {
    this.reader.close();
  }
}

/** The prompt line for one question: where it is, what it asks, and what may be answered. One line, whatever the
 * workflow's text holds. */
function promptLine(request: AskRequest): string {
  const { question } = request;
  const position = `${request.stepId} ${String(request.index)}/${String(request.total)}`;
  const choices =
    question.choices === undefined
      ? ''
      : ` [${question.choices.map((choice) => sanitizeRefusalText(choice)).join(', ')}]`;
  return `[${sanitizeRefusalText(position)}] ${sanitizeRefusalText(question.prompt)}${choices}\n> `;
}

/** `request.context` (`PLAN-M14.md` P41, `question.show`), printed one sanitised line at a time before
 * `promptLine`: the register entry an earlier step produced, for a human to read before answering. Each
 * line is untrusted, agent-produced text sanitised exactly as `promptLine` already sanitises the
 * workflow's own `prompt`/`choices` (`sanitizeRefusalText`: no escape, bare CR, or newline can repaint
 * the terminal or fake extra lines). `''` for a request with no context (nothing is written). */
function contextLines(request: AskRequest): string {
  return (request.context ?? []).map((line) => `${sanitizeRefusalText(line)}\n`).join('');
}

/** Why the step would refuse `line` (`RUN-102`), or `undefined` when it would take it: the engine's own check
 * (`checkElicitAnswer`), so a line the port accepts is one the step accepts and a warning is never wrong. */
function refusalOf(request: AskRequest, line: string): string | undefined {
  const checked = checkElicitAnswer(request.question, line);
  return typeof checked === 'string' ? checked : undefined;
}

/** Builds the port `runWorkflow`/`resumeWorkflow` hand the engine: file answers first, then the terminal when there
 * is one, else `undefined` and the remedy on `warn`. Terminal questions are asked one at a time (the engine
 * serialises elicit steps per port), and input typed while nothing was asked is not taken for an answer. */
export function createAskPort(options: AskPortOptions): CliAskPort {
  const answers = options.answers ?? {};
  const output = options.output ?? process.stderr;
  let queue: LineQueue | undefined;
  let warned = false;

  const askTerminal = async (request: AskRequest): Promise<string | undefined> => {
    queue ??= new LineQueue(options.input ?? process.stdin, output);
    queue.beginQuestion();
    // Printed once, before the first prompt -- not repeated on a retry after a refused answer, which
    // would otherwise reprint a whole register entry for the sake of one bad line.
    output.write(contextLines(request));
    let last: string | undefined;
    try {
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
        output.write(promptLine(request));
        last = await queue.next();
        if (last === undefined) return undefined;
        const refusal = refusalOf(request, last);
        if (refusal === undefined) return last;
        output.write(`${sanitizeRefusalText(`Not accepted: ${refusal}`)}.\n`);
      }
      return last;
    } finally {
      queue.endQuestion();
    }
  };

  return {
    async ask(request) {
      // `hasOwn`: a question may be named `constructor` or `toString`, which are not answers.
      if (Object.hasOwn(answers, request.question.name)) {
        const given = answers[request.question.name];
        // The engine refuses an answer that breaks the question's rules (`RUN-102`) and the failure is in the run's
        // log; say why here too, where the person who wrote the file is looking.
        const refusal = given === undefined ? undefined : refusalOf(request, given);
        if (refusal !== undefined) {
          options.warn?.(
            `forge: the answer to "${sanitizeRefusalText(request.question.name)}" in --answers is refused: ${sanitizeRefusalText(refusal)}, so the step will refuse it.`,
          );
        }
        return given;
      }
      if (options.interactive) return askTerminal(request);
      if (!warned) {
        warned = true;
        options.warn?.(
          `forge: no answer for question "${sanitizeRefusalText(request.question.name)}" (step ${sanitizeRefusalText(request.stepId)}) and this is not a terminal. ` +
            'Supply the answers in a file kept outside the project (an untracked file inside it makes the next run refuse): `forge run <workflow> --answers /tmp/answers.json` (or `forge resume --answers /tmp/answers.json`), an object of question name to answer.',
        );
      }
      return undefined;
    },
    close() {
      queue?.close();
      queue = undefined;
    },
  };
}
