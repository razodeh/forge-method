/**
 * Strict-prompt checks for `FakePlatformAdapter` (`PLAN-M13.md` P6, `SPEC-QUESTIONS.md` Q207).
 *
 * For twelve milestones the fake adapter never read `SessionRequest.prompt`/`systemPrompt`, so a real
 * agent step dispatched with a raw path (`briefs/x.md`) and an empty system prompt kept every test
 * green. These checks are what the fake now applies to every session it is asked to start: a request
 * whose prompt could not steer a real agent is a failed session, not a passing one.
 *
 * Package boundary: `@forge/testkit` may import only `adapter-kit` and `schemas`
 * (`tools/eslint-plugin-forge-boundaries/src/graph.mjs`), so it cannot import `@forge/agents`'
 * `OPERATING_CONTRACT`. The contract is therefore checked two ways: the caller may hand the full text
 * in (`StrictPromptOptions.operatingContract`, used by the repository-level test), and otherwise a
 * structural marker is checked (`DEFAULT_OPERATING_CONTRACT_MARKER`, the first sentence of `05` §5.5
 * point 1, plus the eleven numbered points). `test/agent-prompts-all-workflows.test.ts` (repository root)
 * fails if this file's marker or point count drifts from `OPERATING_CONTRACT`, and every real prompt it
 * dispatches must pass the nine-heading check, so a renamed block fails there too.
 *
 * @see specs/05 §5.3
 * @see specs/05 §5.5
 */
import type { SessionRequest } from '@forge/adapter-kit/types';

/** `05` §5.3's nine block names, in order — what `compilePrompt` renders as `## [n] <name>`. */
export const STRICT_BLOCK_NAMES: readonly string[] = [
  'FORGE operating contract',
  'Role block',
  'Project context pack',
  'Step brief',
  'Output contract',
  'Constraints',
  'Definition of done',
  'Skills',
  'House style + appended guidance',
];

/** The first sentence of `OPERATING_CONTRACT` (`05` §5.5 point 1): block [1] must open with it. */
export const DEFAULT_OPERATING_CONTRACT_MARKER =
  '1. You are operating inside FORGE, an engineering process.';

/** How many numbered points `05` §5.5's operating contract has. Checked structurally when the full text is
 * not supplied; `test/agent-prompts-all-workflows.test.ts` fails if `OPERATING_CONTRACT` stops having
 * exactly this many. */
export const OPERATING_CONTRACT_POINT_COUNT = 11;

export interface StrictPromptOptions {
  /** The full operating-contract text block [1] must contain verbatim (non-empty). When omitted, block [1]
   * must open with `DEFAULT_OPERATING_CONTRACT_MARKER` and carry all eleven numbered points instead. */
  readonly operatingContract?: string;
}

/** Refuses options that would silently weaken a check: an empty contract text is contained in every
 * string, so it would turn the verbatim check into a no-op. */
export function assertValidStrictOptions(options: StrictPromptOptions): void {
  if (options.operatingContract?.trim() === '') {
    throw new Error(
      '@forge/testkit strict mode: operatingContract must be non-empty; omit it to check the ' +
        'default structural marker instead.',
    );
  }
}

const BLOCK_HEADING = /^## \[(\d+)\] (.*)$/gm;
const CONTRACT_POINT = /^(\d+)\. +\S/gm;
const HAS_TEXT = /[\p{L}\p{N}]/u;
const HAS_PATH_SEPARATOR = /[\\/]/;
const FILE_EXTENSION = /\.[A-Za-z0-9]{1,8}$/;
/** Characters that render as nothing: `\s` does not cover zero-width and format characters, the braille
 * blank or the Hangul fillers, so `trim()` alone would call a prompt made of them non-empty. */
const INVISIBLE = /[\p{Cf}\u2800\u3164\u115F\u1160]/gu;
/** What a stringified nothing looks like when a variable was unset or an object was interpolated. */
const PLACEHOLDER_LITERALS: ReadonlySet<string> = new Set([
  'undefined',
  'null',
  'nan',
  '[object object]',
]);

function visible(text: string): string {
  return text.replace(INVISIBLE, '');
}

/** True for a token that names a file rather than being a word: it has a path separator or ends in a file
 * extension (`briefs/x`, `x.md`, `brief.html`). */
function isPathToken(token: string): boolean {
  return HAS_PATH_SEPARATOR.test(token) || FILE_EXTENSION.test(token);
}

/** True when `text` is nothing but file path(s): one whitespace-separated token or several, each path-like
 * (`briefs/x.md`, `briefs/a.md briefs/b.md`). What `node.brief` looked like when it was sent as the whole
 * prompt. Prose that merely mentions a path is not path-shaped. */
export function isPathShaped(text: string): boolean {
  const tokens = text
    .trim()
    .split(/\s+/)
    .filter((token) => token !== '');
  return tokens.length > 0 && tokens.every(isPathToken);
}

/** Every reason `prompt` (a user turn: a `SessionRequest.prompt` or `ResumeRequest.prompt`) could not
 * steer a real agent. Empty when it is acceptable. A user turn is a sentence, not a token: fewer than two
 * words is refused (`"x"`, `"."`, `"undefined"`). */
export function checkUserPrompt(prompt: unknown): readonly string[] {
  if (typeof prompt !== 'string') return [`the user prompt is not a string (${typeof prompt})`];
  const text = visible(prompt).trim();
  if (text === '') return ['the user prompt is empty'];
  if (isPathShaped(prompt)) {
    return [`the user prompt is a bare file path (${JSON.stringify(prompt.trim())}), not text`];
  }
  // Words, not punctuation: `". ."` and `"- -"` are two tokens and no text.
  const words = text.split(/\s+/).filter((token) => HAS_TEXT.test(token));
  if (words.length === 0) {
    return [`the user prompt has no words (${JSON.stringify(text)})`];
  }
  if (
    PLACEHOLDER_LITERALS.has(text.toLowerCase()) ||
    words.every((word) => PLACEHOLDER_LITERALS.has(word.toLowerCase()))
  ) {
    return [`the user prompt is only the placeholder ${JSON.stringify(text)}, not text`];
  }
  if (words.length < 2) {
    return [`the user prompt is a single word (${JSON.stringify(text)}), not text`];
  }
  return [];
}

/** The step id of a request that may be malformed, for an error message: never throws. */
export function stepIdOf(request: unknown): string {
  const id = readField(request, 'stepId');
  return typeof id === 'string' && id !== '' ? id : '(unknown step)';
}

/** The `prompt` of a resume request that may be malformed. */
export function promptOf(request: unknown): unknown {
  return readField(request, 'prompt');
}

function readField(value: unknown, key: string): unknown {
  if (typeof value !== 'object' || value === null || !(key in value)) return undefined;
  return (value as Record<string, unknown>)[key];
}

/** Every reason `request` could not steer a real agent: a bad user prompt, or a system prompt that is not
 * `05` §5.3's nine blocks (empty, path, a preamble before block [1], missing/forged/duplicated/
 * out-of-order headings, an empty block, a block [4] that is only a path) or whose block [1] is not the
 * operating contract. Empty when it is acceptable. */
export function checkSessionRequestPrompt(
  request: Pick<SessionRequest, 'prompt' | 'systemPrompt'>,
  options: StrictPromptOptions = {},
): readonly string[] {
  assertValidStrictOptions(options);
  // Read through `unknown`: a malformed request (a missing `systemPrompt`, a non-string field) must come
  // back as a violation, not as a TypeError thrown out of a non-async `startSession`.
  const raw: unknown = request;
  const violations: string[] = [...checkUserPrompt(readField(raw, 'prompt'))];
  const system = readField(readField(raw, 'systemPrompt'), 'text');
  if (typeof system !== 'string') {
    violations.push(`the system prompt is not a string (${typeof system})`);
    return violations;
  }
  if (visible(system).trim() === '') {
    violations.push('the system prompt is empty (the nine compiled blocks were never sent)');
    return violations;
  }
  if (isPathShaped(system)) {
    violations.push(
      `the system prompt is a bare file path (${JSON.stringify(system.trim())}), not text`,
    );
    return violations;
  }

  const headings = [...system.matchAll(BLOCK_HEADING)].map((match) => ({
    index: Number(match[1]),
    name: match[2] ?? '',
    start: match.index,
    end: match.index + match[0].length,
  }));
  const expected = STRICT_BLOCK_NAMES.map((name, i) => `[${String(i + 1)}] ${name}`);
  const actual = headings.map((heading) => `[${String(heading.index)}] ${heading.name}`);
  if (actual.length !== expected.length || actual.some((heading, i) => heading !== expected[i])) {
    violations.push(
      `the system prompt does not carry the nine block headings in order (expected ` +
        `${expected.join(', ')}; found ${actual.length === 0 ? 'none' : actual.join(', ')})`,
    );
  }
  if (!system.trimStart().startsWith('## [1] ')) {
    violations.push('the system prompt does not begin with block [1] (text precedes the headings)');
  }

  // A block's body is what sits between its heading and the next heading (or the end).
  const bodies = headings.map((heading, i) =>
    system.slice(heading.end, headings[i + 1]?.start ?? system.length),
  );
  bodies.forEach((body, i) => {
    const text = visible(body).trim();
    if (text === '') {
      violations.push(`block [${String(i + 1)}] is empty`);
    } else if (!HAS_TEXT.test(text) || PLACEHOLDER_LITERALS.has(text.toLowerCase())) {
      violations.push(`block [${String(i + 1)}] has no text (${JSON.stringify(text)})`);
    }
  });
  // Block [4] is the step brief. A brief that was never resolved leaves its path where the text belongs,
  // possibly followed by more sections (declared inputs, role-specific guidance): its first paragraph
  // being nothing but a path is the tell.
  const stepBrief = bodies[3];
  const briefHead =
    visible(stepBrief ?? '')
      .trim()
      .split(/\n\s*\n/)[0] ?? '';
  if (actual[3] === expected[3] && briefHead !== '' && isPathShaped(briefHead)) {
    violations.push(
      `block [4] (the step brief) opens with a bare file path (${JSON.stringify(briefHead.trim())}), not brief text`,
    );
  }

  const blockOne = headings[0]?.index === 1 ? bodies[0] : undefined;
  if (blockOne === undefined) {
    violations.push('the system prompt has no block [1], so it lacks the operating contract');
  } else if (options.operatingContract !== undefined) {
    if (!blockOne.includes(options.operatingContract)) {
      violations.push('block [1] does not contain the operating contract verbatim');
    }
  } else if (!blockOne.trimStart().startsWith(DEFAULT_OPERATING_CONTRACT_MARKER)) {
    violations.push(
      `block [1] does not open with the operating contract (${JSON.stringify(DEFAULT_OPERATING_CONTRACT_MARKER)})`,
    );
  } else {
    const points = new Set([...blockOne.matchAll(CONTRACT_POINT)].map((match) => Number(match[1])));
    const missing = Array.from({ length: OPERATING_CONTRACT_POINT_COUNT }, (_, i) => i + 1).filter(
      (point) => !points.has(point),
    );
    if (missing.length > 0) {
      violations.push(
        `block [1] is a truncated operating contract (numbered points ${missing.join(', ')} missing or empty)`,
      );
    }
  }
  return violations;
}

/** Thrown (as a rejected `startSession`/`resumeSession`) by a strict `FakePlatformAdapter` for a request
 * whose prompt is unusable. A dedicated class so a test can tell it apart from any injected or scripted
 * failure, and so its message names every violation. */
export class StrictPromptViolationError extends Error {
  /** Stable identifier, like the fake adapter's other failures (`INJECTED_FAILURE`, `UNKNOWN_MODEL`). */
  readonly code = 'STRICT_PROMPT_VIOLATION';
  readonly violations: readonly string[];
  readonly stepId: string;

  constructor(stepId: string, violations: readonly string[]) {
    super(
      `@forge/testkit strict mode: step "${stepId}" was dispatched with an unusable prompt: ` +
        `${violations.join('; ')}. A real agent would receive this as its whole instruction. ` +
        'Assemble the prompt with the engine (assembleAgentSession) instead of hand-building the ' +
        'request, or, for a test that deliberately drives the adapter with a hand-built request, ' +
        'construct it with { strict: false } and say why.',
    );
    this.name = 'StrictPromptViolationError';
    this.violations = violations;
    this.stepId = stepId;
  }
}

/** A minimal system prompt that passes strict mode: the nine headings in order, block [1] opening with
 * the operating-contract marker, every other block a one-line placeholder. For a test that drives the
 * adapter with a hand-built `SessionRequest` to exercise something other than prompt assembly (grant
 * enforcement, resume) and would rather keep strict mode on than switch it off. It is *not* what the
 * engine sends; a test of dispatch must use the engine's real assembly. */
export function strictFixtureSystemPrompt(): string {
  const contract = Array.from({ length: OPERATING_CONTRACT_POINT_COUNT }, (_, i) =>
    i === 0
      ? `${DEFAULT_OPERATING_CONTRACT_MARKER} (test fixture, not the real contract text)`
      : `${String(i + 1)}. (test fixture contract point)`,
  ).join('\n');
  return STRICT_BLOCK_NAMES.map((name, i) => {
    const body = i === 0 ? contract : `(test fixture: ${name})`;
    return `## [${String(i + 1)}] ${name}\n\n${body}`;
  }).join('\n\n');
}
