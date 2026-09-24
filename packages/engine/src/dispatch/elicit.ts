/**
 * `elicit` — `10` §10.1's "Ask the human structured questions; blocks", made runnable (`PLAN-M13.md` P20,
 * `SPEC-QUESTIONS.md` Q227; owner decision 2026-09-20).
 *
 * The step asks each of its questions through the injected `AskPort` (`types.ts`), checks the answer against the
 * question's own rules, records the exchange as the two events `18` §18.4 already names for it
 * (`ElicitationRequested`, `ElicitationAnswered`) and keeps the answers for the steps that come after it:
 *
 * - **Where an answer goes.** `ExecuteStepContext.answers` (step id -> question name -> text). A later `command`
 *   step reads it as `FORGE_ANSWER_<name>` in its environment (`commandStepEnvironment`): an environment variable is data
 *   however a script spells it, so a value like `$(rm -rf ~)` reaches a command as text and nothing else, with no
 *   quoting to get wrong. A later agent step sees it as data in block [4] of its prompt (`assemble.ts`, JSON-quoted
 *   one line per answer, the way run inputs are rendered). Nothing is written outside the run record.
 * - **Untrusted by construction.** An answer is user text. Control bytes, terminal escapes and bidirectional or
 *   invisible characters are stripped (`sanitizeAnswer`), an answer over `ANSWER_MAX_CHARS` is refused rather than
 *   cut (a truncated answer is a different answer), and a question with `choices` accepts only one of them.
 * - **Never a silent default, never a hang.** An answer the port cannot supply (`undefined`) fails the step
 *   `RUN-101` naming the question and the remedy; the engine never asks a port that has said it cannot.
 * - **Replay.** A step whose answers are already recorded (`ExecuteStepContext.answers`, seeded from the event log
 *   by `runEngine` and `resumeRun`) is not asked again and emits no new elicitation events (only the step's own
 *   start and success): the run's history stays what happened. A recorded answer is checked again against the
 *   question as the workflow now states it, and a step whose record no longer passes is asked again.
 * - **No secrets.** An answer that looks like a credential is refused (`RUN-102`): it would reach an agent's prompt
 *   and its record on disk, and the event log redacts it (so a resume could not read it back).
 * - **`show`.** (`PLAN-M14.md` P41) A question's `show: {type, subtype?}` names a register entry an earlier step
 *   produced; before asking, this step reads it from `ctx.integrationPath` (the identical tree the output check
 *   validates a produced register against) and hands its fields to the `AskPort` as `AskRequest.context`, so a human
 *   sees what the workflow author is asking them to confirm rather than having to go read a file by hand. Read only,
 *   never replayed (a step whose answers are already recorded reads no register at all); a lookup that finds nothing
 *   fails the step `RUN-105`, before `ElicitationRequested`, so the event never records "this was requested" for
 *   something that was never actually shown.
 *
 * @see specs/10 §10.1
 * @see specs/18 §18.4
 * @see PLAN-M13.md P20
 * @see PLAN-M14.md P41
 */
import { FORGE_RUN_ID, FORGE_STEP_ID } from '@forge/core';
import { ForgeError } from '@forge/core/errors';
import { readEvents } from '@forge/telemetry/events';

import { ELICIT_QUESTION_NAME } from '../workflow/schema.ts';
import { docRootsOf, readRegisterEntries } from './outputs.ts';
import { sanitizeResultText } from './result-record.ts';
import type { StepNode } from '../plan/index.ts';
import type { ElicitQuestion } from '../workflow/index.ts';
import type {
  ExecuteStepContext,
  AskPort,
  StepFailureInfo,
  StepOutcome,
  StepOutcomeDetail,
} from './types.ts';

/** The longest answer accepted, in UTF-16 code units (JavaScript `length`). A one-line or a paragraph answer fits; a
 * pasted document does not, and is refused rather than truncated. */
export const ANSWER_MAX_CHARS = 4000;

/** What `@forge/telemetry` writes in place of a value it redacts. */
const REDACTION_MARKER = '[REDACTED]';

/** The prefix of the environment variable a `command` step reads an answer from: `FORGE_ANSWER_<question name>`. */
export const ANSWER_ENV_PREFIX = 'FORGE_ANSWER_';

/** Code point ranges removed from an answer: C0 controls except tab and line feed, DEL and the C1 controls (a
 * terminal escape starts with one), the zero-width and bidirectional-override characters, the byte-order mark,
 * the interlinear annotation marks and the tag characters. Not ZWJ or ZWNJ (U+200D, U+200C), which emoji and
 * several scripts need. Numbers rather than a character class, so no invisible character sits in the source. */
const HOSTILE_RANGES: readonly (readonly [number, number])[] = [
  [0x00, 0x08],
  [0x0b, 0x1f],
  [0x7f, 0x9f],
  [0x00ad, 0x00ad],
  [0x061c, 0x061c],
  [0x180e, 0x180e],
  [0x200b, 0x200b],
  [0x200e, 0x200f],
  [0x2028, 0x202e],
  [0x2060, 0x206f],
  // U+FE0F (emoji presentation) stays: it is part of a heart, a keycap, a flag.
  [0xfe00, 0xfe0e],
  [0xfeff, 0xfeff],
  [0xfff9, 0xfffb],
  [0xe0000, 0xe007f],
  [0xe0100, 0xe01ef],
];

function isHostile(codePoint: number): boolean {
  return HOSTILE_RANGES.some(([low, high]) => codePoint >= low && codePoint <= high);
}

/** `raw` as safe text: line endings normalised to `\n`, hostile characters removed. `stripped` counts what was
 * removed, so a caller can record that an answer was altered. Pure. */
export function sanitizeAnswer(raw: string): { readonly text: string; readonly stripped: number } {
  let stripped = 0;
  let text = '';
  for (const character of raw.replace(/\r\n?/g, '\n')) {
    if (isHostile(character.codePointAt(0) ?? 0)) stripped += 1;
    else text += character;
  }
  return { text, stripped };
}

function detail(answered: readonly string[]): StepOutcomeDetail {
  return { kind: 'elicit', answered };
}

function failure(code: string, message: string, cause?: unknown): StepFailureInfo {
  return { source: 'elicit', code, message, ...(cause === undefined ? {} : { cause }) };
}

/** A `ForgeError`'s message with its remedy, the form a failed step reports (the run's failure record and
 * `forge resume` show `message` alone). */
function withRemedy(error: ForgeError): string {
  return `${error.message} ${error.remedy}`;
}

interface Checked {
  readonly value: string;
  readonly altered: boolean;
}

/** `scheme://user:password@host`: a connection string carries its secret in the authority. */
const CREDENTIAL_URL = /\b[a-z][a-z0-9+.-]*:\/\/[^\s/:@]+:[^\s/@]+@/i;

/** The answer as the engine keeps it, or the reason it is refused (`RUN-102`). The one definition: the step, a
 * replay of a recorded answer and the CLI's terminal prompt (which asks again on a refusal) all use it. */
export function checkElicitAnswer(question: ElicitQuestion, raw: string): Checked | string {
  return checkAnswer(question, raw);
}

function checkAnswer(question: ElicitQuestion, raw: string): Checked | string {
  const { text, stripped } = sanitizeAnswer(raw);
  const value = text.trim();
  if (value === '') return 'the answer is blank; say "none" or "unknown" if that is the answer';
  if (value.length > ANSWER_MAX_CHARS) {
    return `the answer is ${String(value.length)} characters, over the ${String(ANSWER_MAX_CHARS)} limit`;
  }
  const choices = question.choices;
  if (choices !== undefined && !choices.includes(value)) {
    return `it must be exactly one of: ${choices.join(', ')}`;
  }
  // Pattern-based, so a screen, not a guarantee (a password in prose passes; a hyphenated phrase that resembles a
  // key can be refused): the scan the run record applies to a session's answer plus a URL with a password in it. A
  // credential must not become a prompt line, an environment variable or a file under .forge/state, and the event
  // log would replace it with a marker, which a resume must not mistake for the answer.
  if (
    value === REDACTION_MARKER ||
    sanitizeResultText(value).redactions > 0 ||
    CREDENTIAL_URL.test(value)
  ) {
    return 'it looks like it contains a credential or secret, which FORGE never puts in a prompt or the run log: say where the secret is kept instead of giving it, or rephrase if it is not one';
  }
  return { value, altered: stripped > 0 };
}

/** Whether `recorded` answers every question and each answer still passes the question's rules (the workflow may
 * have changed its `choices` since the run asked). */
function coversEveryQuestion(
  recorded: Readonly<Record<string, string>>,
  questions: readonly ElicitQuestion[],
): boolean {
  return questions.every(
    (question) =>
      Object.hasOwn(recorded, question.name) &&
      typeof checkAnswer(question, recorded[question.name] ?? '') !== 'string',
  );
}

/** A register entry `readRegisterEntries` found, narrowed to the one shape `show` needs: a real `id` (an
 * entry with none cannot be shown -- treated as not found, `RUN-105`, just as an empty result is). */
interface ShownEntry {
  readonly id: string;
  readonly fields: Readonly<Record<string, unknown>>;
}

/** `entry.fields` (`PLAN-M14.md` P41) as terminal lines for a `show` question's own `AskRequest.context`:
 * one line per scalar field (`"key: value"`, `id` moved first so a person knows which entry this is
 * before reading the rest of it), one line per item of an array field (`"key: item"`), an absent, empty
 * or blank field contributing no line. Deterministic (the entry's own key order, `id` aside). Never
 * sanitised here: the entry is agent-produced, untrusted text, and the port that actually prints it
 * (`@forge/cli`'s own terminal `AskPort`) already sanitises every line before writing it -- the identical
 * raw-here/sanitised-at-the-port split `question.prompt`/`choices` already have. */
function renderEntryLines(fields: Readonly<Record<string, unknown>>): readonly string[] {
  const lines: string[] = [];
  const keys = ['id', ...Object.keys(fields).filter((key) => key !== 'id')];
  for (const key of keys) {
    if (!Object.hasOwn(fields, key)) continue;
    for (const item of Array.isArray(fields[key]) ? fields[key] : [fields[key]]) {
      if (item === undefined || item === null || item === '') continue;
      lines.push(`${key}: ${typeof item === 'string' ? item : JSON.stringify(item)}`);
    }
  }
  return lines;
}

/** One elicit step at a time per port: two independent `elicit` steps admitted in one tick would otherwise write
 * their prompts one after the other and take each other's answers from the one terminal. */
const portQueues = new WeakMap<AskPort, Promise<unknown>>();

/** Runs one `elicit` step. Failures are data (a failed `StepOutcome`), never thrown: a missing answer ends this step
 * with the remedy, and the run's failure record says which question and how to supply it. */
export function runElicitStep(node: StepNode, ctx: ExecuteStepContext): Promise<StepOutcome> {
  const port = ctx.ask;
  if (port === undefined) return runElicit(node, ctx);
  const turn = (portQueues.get(port) ?? Promise.resolve()).then(() => runElicit(node, ctx));
  portQueues.set(
    port,
    turn.catch(() => undefined),
  );
  return turn;
}

async function runElicit(node: StepNode, ctx: ExecuteStepContext): Promise<StepOutcome> {
  const startedAt = ctx.now();
  // Before `StepStarted`: a node with no questions (hand-built; the schema requires one) throws with no start event
  // left dangling.
  const questions = node.questions ?? [];
  if (questions.length === 0) {
    throw new ForgeError('RUN-039', {
      stepId: node.id,
      kind: 'elicit (missing its own questions field)',
    });
  }
  await ctx.telemetry.emit({ type: 'StepStarted', stepId: node.id });

  const recorded = ctx.answers?.get(node.id);
  if (recorded !== undefined && coversEveryQuestion(recorded, questions)) {
    return {
      stepId: node.id,
      status: 'succeeded',
      startedAt,
      finishedAt: ctx.now(),
      detail: detail(questions.map((question) => question.name)),
    };
  }

  const refuse = (
    code: 'RUN-101' | 'RUN-102' | 'RUN-105',
    question: string,
    reason: string,
  ): StepOutcome => {
    const error = new ForgeError(code, { stepId: node.id, question, reason });
    return {
      stepId: node.id,
      status: 'failed',
      startedAt,
      finishedAt: ctx.now(),
      detail: detail([]),
      failure: failure(code, withRemedy(error), error),
    };
  };

  const ask = ctx.ask;
  const first = questions[0];
  if (ask === undefined) {
    return refuse('RUN-101', first?.name ?? '', 'this run has no way to ask a question');
  }

  // `PLAN-M14.md` P41: resolve every question's `show` BEFORE anything is requested -- a lookup that
  // finds nothing fails the step RUN-105 right here, so `ElicitationRequested` never records "this was
  // requested" for a register entry that was, in fact, never actually shown.
  const shown = new Map<string, ShownEntry>();
  for (const question of questions) {
    const { show } = question;
    if (show === undefined) continue;
    const found = await readRegisterEntries(
      ctx.integrationPath,
      show.type,
      docRootsOf(ctx),
      show.subtype,
    );
    const withId = found.flatMap((entry) =>
      entry.id === undefined ? [] : [{ ...entry, id: entry.id }],
    );
    const entry = withId.at(-1);
    if (entry === undefined) {
      const subtypeText = show.subtype === undefined ? '' : ` (subtype ${show.subtype})`;
      return refuse(
        'RUN-105',
        question.name,
        `no ${show.type}${subtypeText} register entry was found on the integration branch for it to show`,
      );
    }
    shown.set(question.name, entry);
  }

  await ctx.telemetry.emit({
    type: 'ElicitationRequested',
    stepId: node.id,
    payload: {
      questions: questions.map((question) => {
        const entry = question.show === undefined ? undefined : shown.get(question.name);
        return {
          name: question.name,
          prompt: question.prompt,
          ...(question.choices === undefined ? {} : { choices: question.choices }),
          ...(question.show === undefined || entry === undefined
            ? {}
            : {
                shown: {
                  type: question.show.type,
                  ...(question.show.subtype === undefined
                    ? {}
                    : { subtype: question.show.subtype }),
                  id: entry.id,
                },
              }),
        };
      }),
    },
  });

  const answers: Record<string, string> = {};
  const altered: string[] = [];
  for (const [position, question] of questions.entries()) {
    let raw: string | undefined;
    const entry = shown.get(question.name);
    try {
      raw = await ask.ask({
        stepId: node.id,
        question: {
          name: question.name,
          prompt: question.prompt,
          ...(question.choices === undefined ? {} : { choices: question.choices }),
        },
        index: position + 1,
        total: questions.length,
        ...(entry === undefined ? {} : { context: renderEntryLines(entry.fields) }),
      });
    } catch (cause) {
      const reason = cause instanceof Error ? cause.message : String(cause);
      return refuse('RUN-101', question.name, `asking failed: ${reason}`);
    }
    if (raw === undefined) {
      return refuse(
        'RUN-101',
        question.name,
        'no answer was supplied for it (none in --answers, and no terminal to ask on or the input was closed)',
      );
    }
    const checked = checkAnswer(question, raw);
    if (typeof checked === 'string') return refuse('RUN-102', question.name, checked);
    answers[question.name] = checked.value;
    if (checked.altered) altered.push(question.name);
  }

  // Recorded before it is remembered: if the event cannot be written the run fails there (`RUN-038`) and a resume
  // asks again, rather than holding an answer the log does not have.
  await ctx.telemetry.emit({
    type: 'ElicitationAnswered',
    stepId: node.id,
    payload: { answers, ...(altered.length === 0 ? {} : { sanitized: altered }) },
  });
  ctx.answers?.set(node.id, answers);
  return {
    stepId: node.id,
    status: 'succeeded',
    startedAt,
    finishedAt: ctx.now(),
    detail: detail(questions.map((question) => question.name)),
  };
}

/** The steps `stepId` depends on, directly or through others, in plan order. Without a plan (a handler driven on
 * its own) every step is a candidate. */
function ancestorIds(
  stepId: string,
  graph: ReadonlyMap<string, StepNode> | undefined,
): ReadonlySet<string> | undefined {
  if (graph === undefined) return undefined;
  const seen = new Set<string>();
  const pending = [...(graph.get(stepId)?.dependsOn ?? [])];
  for (let id = pending.pop(); id !== undefined; id = pending.pop()) {
    if (seen.has(id)) continue;
    seen.add(id);
    pending.push(...(graph.get(id)?.dependsOn ?? []));
  }
  return seen;
}

/** What `node` may read of the run's answers: those of the `elicit` steps it depends on (a step that runs
 * beside or before an elicit must not see, or depend on, an answer that may not exist yet). Question names are
 * unique in a workflow (`duplicate-elicit-question`), so the result is a plain name -> text record. */
export function answersVisibleTo(
  node: StepNode,
  ctx: Pick<ExecuteStepContext, 'answers' | 'stepGraph'>,
): Readonly<Record<string, string>> {
  const store = ctx.answers;
  if (store === undefined || store.size === 0) return {};
  const ancestors = ancestorIds(node.id, ctx.stepGraph);
  const order = ctx.stepGraph === undefined ? [...store.keys()] : [...ctx.stepGraph.keys()];
  const visible: Record<string, string> = {};
  for (const stepId of order) {
    if (ancestors !== undefined && !ancestors.has(stepId)) continue;
    Object.assign(visible, store.get(stepId));
  }
  return visible;
}

/** `FORGE_ANSWER_<name>` for each answer `node` may read, plus `FORGE_PROJECT_ROOT`: the environment a `command`
 * step runs with on top of the launcher's (`ExecuteStepContext.commandEnv`). The project root is there because a
 * step runs in a lane or the integration worktree, and a command that must act on the project itself (recording
 * the level in `.forge/config.yaml`) names it with `forge -C "$FORGE_PROJECT_ROOT" ...`.
 *
 * Also stamps the FORGE run/step marker (`@forge/core/session-marker`, `PLAN-M14.md` P4,
 * `SPEC-QUESTIONS.md` Q232 decision 9): `FORGE_RUN_ID`/`FORGE_STEP_ID` from `ctx.runId`/`node.id`, set
 * here directly rather than trusted to already be in `ctx.commandEnv` -- `commandEnvFor` sets
 * `FORGE_RUN_ID` too (for every shell command a run spawns, gate and merge checks included), but the
 * launcher shim that builds `ctx.commandEnv` is best-effort (a disk-full/unwritable-temp-dir failure
 * degrades to a warning, `createLauncherShimOrWarn`), so a `command` step's own env must not depend on
 * it having succeeded. `[FORGE_RUN_ID]`/`[FORGE_STEP_ID]` are ordered after the `...ctx.commandEnv`
 * spread so this function's own, always-correct values win over anything (stale or otherwise) already
 * on it. */
export function commandStepEnvironment(
  node: StepNode,
  ctx: Pick<ExecuteStepContext, 'answers' | 'stepGraph' | 'projectRoot' | 'commandEnv' | 'runId'>,
): Readonly<Record<string, string>> {
  const env: Record<string, string> = {
    ...ctx.commandEnv,
    FORGE_PROJECT_ROOT: ctx.projectRoot,
    [FORGE_RUN_ID]: ctx.runId,
    [FORGE_STEP_ID]: node.id,
  };
  for (const [name, value] of Object.entries(answersVisibleTo(node, ctx))) {
    env[`${ANSWER_ENV_PREFIX}${name}`] = value;
  }
  return env;
}

/** The answers a run already recorded, read from its event log (`ElicitationAnswered`), for `runEngine` to seed
 * `ExecuteStepContext.answers` with on resume. A malformed payload is skipped, not fatal: an `elicit` step whose
 * answers cannot be read is simply asked again. */
export async function readRecordedAnswers(
  projectRoot: string,
  runId: string,
): Promise<Map<string, Readonly<Record<string, string>>>> {
  const found = new Map<string, Readonly<Record<string, string>>>();
  for await (const event of readEvents(projectRoot, runId)) {
    if (event.type !== 'ElicitationAnswered' || event.stepId === undefined) continue;
    const payload = event.payload;
    if (typeof payload !== 'object' || payload === null) continue;
    const answers: unknown = Reflect.get(payload, 'answers');
    if (typeof answers !== 'object' || answers === null || Array.isArray(answers)) continue;
    const record: Record<string, string> = {};
    let intact = true;
    for (const [name, value] of Object.entries(answers)) {
      if (
        typeof value !== 'string' ||
        value === REDACTION_MARKER ||
        !ELICIT_QUESTION_NAME.test(name)
      ) {
        intact = false;
      } else record[name] = value;
    }
    // The log redacts a value that looks like a secret or sits under a secret-shaped key. What it kept is not what
    // the human said, so the step is asked again rather than replayed with a marker for an answer.
    if (intact) found.set(event.stepId, record);
  }
  return found;
}
