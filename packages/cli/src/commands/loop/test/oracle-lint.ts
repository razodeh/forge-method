/**
 * `runOracleLint` — F-TEST-2's own banned oracle patterns, as a real, deterministic **source-text
 * scanner** over a project's own test files. Deliberately not a new ESLint plugin package: every
 * pattern below is overwhelmingly syntactic, and a lightweight, directly-unit-testable scanner is
 * proportionate scaffolding where a full AST-walking plugin package would not be
 * (`SPEC-QUESTIONS.md` has the fuller trade-off record).
 *
 * Implements four of F-TEST-2's five banned patterns:
 * - `toBeDefined()`/`toBeTruthy()` with no real, stronger assertion anywhere in the same test.
 * - A bare `try { … } catch { }` with no real statement in the catch body.
 * - An unconditional `expect(true).toBe(true)` (or `.toEqual`/`.toBeTruthy`).
 * - A snapshot assertion (`.toMatchSnapshot()`/`.toMatchInlineSnapshot()`) with no
 *   `approved-by:`-shaped comment anywhere in the same test.
 *
 * The fifth — "asserting on a value read from the same code path that produced it" — is
 * deliberately **not** attempted: telling "the test independently recomputed the expected value"
 * apart from "the test reused the implementation's own output" is undecidable from source text
 * alone without real dataflow analysis. A known, permanent gap, not a stub — recorded in
 * `SPEC-QUESTIONS.md`.
 *
 * A fresh critic round adversarially fuzzed the first draft's scanner directly (not just read it)
 * and found it silently mis-scanned several ordinary, non-exotic real-world shapes: Vitest's own
 * documented `test('name', ({ expect }) => { ... })` test-context-destructuring form, a test body
 * containing an ordinary regex literal with an odd brace count (`/\}/`),  and two separate
 * weak-only `expect()` calls in one test with no strong assertion at all. Every one of those is
 * fixed below, each with its own doc comment at the fix site.
 *
 * @see specs/13 §13.1 F-TEST-2
 * @see PLAN-M8.md P5
 */
import { listDirEntriesSorted, readTextFile, type ProjectPaths } from '@forge/core/fs';

/** One of F-TEST-2's own banned patterns, as this scanner can actually detect it. */
export type OracleLintPattern =
  'weak-assertion' | 'empty-catch' | 'tautological-assertion' | 'unapproved-snapshot';

/** One real problem `runOracleLint` found in one real test. */
export interface OracleLintViolation {
  readonly file: string;
  readonly line: number;
  readonly pattern: OracleLintPattern;
  readonly testName: string;
  readonly message: string;
}

/** `runOracleLint`'s own return value. `problems`, when non-empty, names every real reason the
 * scan could not fully complete (a directory or file this process could not read for a reason
 * other than "does not exist") — the identical "a scan that could not verify everything must never
 * silently read as a clean pass" principle `run.ts`'s own `TestRunResult.problems` already
 * establishes for `forge test run`'s own default rule; a fresh critic round found the first draft
 * had no such field at all, silently swallowing every real I/O failure into an empty, "nothing
 * wrong here" result. */
export interface OracleLintResult {
  readonly errors: number;
  readonly violations: readonly OracleLintViolation[];
  readonly problems?: readonly string[];
}

const SKIPPED_DIRECTORIES = new Set([
  'node_modules',
  '.git',
  '.forge',
  'dist',
  'build',
  'coverage',
]);
const TEST_FILE_SUFFIXES = [
  '.test.js',
  '.test.jsx',
  '.test.ts',
  '.test.tsx',
  '.spec.js',
  '.spec.ts',
];

function isTestFile(name: string): boolean {
  return (
    TEST_FILE_SUFFIXES.some((suffix) => name.endsWith(suffix)) ||
    (name.startsWith('test_') && name.endsWith('.py')) ||
    name.endsWith('_test.py')
  );
}

/** `code` on the real `ForgeError.cause` Node ever attaches — `listDirEntriesSorted`/`readTextFile`
 * both wrap every failure as `RUN-034` (`@forge/core/fs`'s own convention), so the real, distinct
 * Node error code lives one level down. `ENOENT` (this directory/file genuinely does not exist) is
 * the one ordinary, expected case a project walk must tolerate silently; anything else (a
 * permission error, a real I/O failure) is a genuine problem this function's own caller needs to
 * know about, not something to swallow into "found nothing here." */
function isRealErrnoCode(error: unknown, code: string): boolean {
  if (!(error instanceof Error)) return false;
  const cause = error.cause;
  return (
    cause instanceof Error && 'code' in cause && (cause as NodeJS.ErrnoException).code === code
  );
}

async function discoverTestFiles(
  paths: ProjectPaths,
  problems: string[],
  relativeDir = '',
): Promise<readonly string[]> {
  const dirRelPath = relativeDir === '' ? '.' : relativeDir;
  let entries;
  try {
    entries = await listDirEntriesSorted(paths.resolveWithin(dirRelPath));
  } catch (error) {
    if (isRealErrnoCode(error, 'ENOENT')) return [];
    problems.push(
      `could not list ${dirRelPath}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return [];
  }
  const files: string[] = [];
  for (const entry of entries) {
    const childRel = relativeDir === '' ? entry.name : `${relativeDir}/${entry.name}`;
    if (entry.isDirectory) {
      if (SKIPPED_DIRECTORIES.has(entry.name)) continue;
      files.push(...(await discoverTestFiles(paths, problems, childRel)));
    } else if (isTestFile(entry.name)) {
      files.push(childRel);
    }
  }
  return files;
}

// --- a deliberately minimal source scanner, not a real parser ---------------------------------

const REGEX_CONTEXT_CHARS = new Set([
  '(',
  '[',
  '{',
  ',',
  ';',
  ':',
  '=',
  '!',
  '&',
  '|',
  '?',
  '+',
  '-',
  '*',
  '%',
  '^',
  '~',
  '<',
  '>',
]);

/** The classic, well-known heuristic every hand-rolled JS lexer uses for the real `/` ambiguity
 * (division vs. a regex literal's own start) — a real parser resolves this from the grammar
 * position; this scanner instead looks at the nearest preceding non-whitespace character, which is
 * a division operand (an identifier, a number, `)`, or `]`) far more often than a regex-literal
 * context does the opposite. A fresh critic round found the first draft had no regex-literal
 * awareness at all: an ordinary `expect(x).toMatch(/\}/)` — ordinary brace-escaping test code, not
 * an exotic construction — decremented brace depth on the lone `}` inside the regex and truncated
 * the scanned test body right there, hiding whatever assertion came after it. */
function looksLikeRegexStart(source: string, slashIndex: number): boolean {
  let j = slashIndex - 1;
  while (j >= 0 && /\s/.test(source[j] ?? '')) j -= 1;
  if (j < 0) return true;
  const ch = source[j] ?? '';
  return REGEX_CONTEXT_CHARS.has(ch);
}

function skipRegexLiteral(source: string, start: number): number {
  let i = start + 1;
  let inCharClass = false;
  while (i < source.length) {
    const ch = source[i];
    if (ch === '\\') {
      i += 2;
      continue;
    }
    if (ch === '\n') return i; // a real regex literal never spans a newline; bail out defensively.
    if (ch === '[') inCharClass = true;
    else if (ch === ']') inCharClass = false;
    else if (ch === '/' && !inCharClass) {
      i += 1;
      while (i < source.length && /[a-z]/i.test(source[i] ?? '')) i += 1; // flags
      return i;
    }
    i += 1;
  }
  return i;
}

function skipStringLiteral(source: string, start: number, quote: string): number {
  let i = start + 1;
  while (i < source.length) {
    if (source[i] === '\\') {
      i += 2;
      continue;
    }
    if (source[i] === quote) return i + 1;
    i += 1;
  }
  return i;
}

/** Finds the index of the closing `open`/`close` delimiter matching the one at `openIndex`,
 * skipping over string/template-literal content, line and block comments, and regex literals so a
 * character inside any of those never miscounts depth. Sufficient for finding one real block's own
 * extent (a test body, an `expect(...)` call's own argument list) — not a general parser. */
function findMatchingDelimiter(
  source: string,
  openIndex: number,
  open: string,
  close: string,
): number {
  let depth = 0;
  let i = openIndex;
  while (i < source.length) {
    const ch = source[i];
    if (ch === open) {
      depth += 1;
    } else if (ch === close) {
      depth -= 1;
      if (depth === 0) return i;
    } else if (ch === '"' || ch === "'" || ch === '`') {
      i = skipStringLiteral(source, i, ch);
      continue;
    } else if (ch === '/' && source[i + 1] === '/') {
      const nextNewline = source.indexOf('\n', i);
      i = nextNewline === -1 ? source.length : nextNewline;
      continue;
    } else if (ch === '/' && source[i + 1] === '*') {
      const end = source.indexOf('*/', i + 2);
      i = end === -1 ? source.length : end + 2;
      continue;
    } else if (ch === '/' && looksLikeRegexStart(source, i)) {
      i = skipRegexLiteral(source, i);
      continue;
    }
    i += 1;
  }
  return -1;
}

function findMatchingBrace(source: string, openIndex: number): number {
  return findMatchingDelimiter(source, openIndex, '{', '}');
}

function findMatchingParen(source: string, openIndex: number): number {
  return findMatchingDelimiter(source, openIndex, '(', ')');
}

interface TestBlock {
  readonly name: string;
  readonly line: number;
  readonly body: string;
}

const TEST_DECL = /\b(?:it|test)(?:\.(?:skip|only|todo))?\s*\(\s*(['"`])((?:\\.|(?!\1)[^\\])*)\1/g;
/** The callback's own real body starts right after `=>` (an arrow function — the overwhelming
 * majority of real test code) or right after the closing `)` of a plain `function (...)` parameter
 * list. A fresh critic round found the first draft took "the next `{` at all" as the body start,
 * which — for Vitest's own documented `test('name', ({ expect }) => { ... })` test-context-
 * destructuring form — finds the *parameter* destructuring's own `{ expect }`, not the real
 * function body, silently scanning three words instead of the whole real test. */
const CALLBACK_BODY_OPEN = /=>\s*\{/;

function findCallbackBodyStart(source: string, fromIndex: number): number {
  const arrowMatch = CALLBACK_BODY_OPEN.exec(source.slice(fromIndex));
  if (arrowMatch !== null) return fromIndex + arrowMatch.index + arrowMatch[0].length - 1;
  // No arrow at all (a plain `function (...) { ... }` callback, or malformed input) — the first
  // real `{` from here is the best remaining signal.
  return source.indexOf('{', fromIndex);
}

function discoverTestBlocks(source: string): readonly TestBlock[] {
  const blocks: TestBlock[] = [];
  TEST_DECL.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = TEST_DECL.exec(source)) !== null) {
    const name = match[2] ?? '';
    const braceStart = findCallbackBodyStart(source, TEST_DECL.lastIndex);
    if (braceStart === -1) continue;
    const braceEnd = findMatchingBrace(source, braceStart);
    if (braceEnd === -1) continue;
    const line = source.slice(0, match.index).split('\n').length;
    blocks.push({ name, line, body: source.slice(braceStart + 1, braceEnd) });
  }
  return blocks;
}

// --- the four real pattern detectors ------------------------------------------------------------

const EXPECT_CALL = /expect\s*\(/g;
const WEAK_ASSERTION_METHOD = /^\s*\.\s*(?:toBeDefined|toBeTruthy)\s*\(\s*\)/;

/** F-TEST-2 bans `toBeDefined()`/`toBeTruthy()` as the test's *only* assertion — not merely "the
 * first `expect()` call happens to be weak while a second one somewhere is strong." A fresh critic
 * round found the first draft's "exactly one `expect(` call total" heuristic let two *separate*,
 * both-weak `expect()` calls through clean (no strong assertion anywhere, which is exactly what
 * F-TEST-2 bans) — fixed by checking every real `expect(...)` call's own immediately-chained method
 * individually, via `findMatchingParen` for each call's own real argument extent, rather than
 * counting occurrences and hoping there is only one. */
function detectWeakAssertion(body: string): boolean {
  EXPECT_CALL.lastIndex = 0;
  let match: RegExpExecArray | null;
  let sawAssertion = false;
  while ((match = EXPECT_CALL.exec(body)) !== null) {
    const openParen = match.index + match[0].length - 1;
    const closeParen = findMatchingParen(body, openParen);
    if (closeParen === -1) continue;
    sawAssertion = true;
    const afterCall = body.slice(closeParen + 1);
    if (!WEAK_ASSERTION_METHOD.test(afterCall)) return false; // a real, stronger assertion exists.
  }
  return sawAssertion;
}

const CATCH_DECL = /\bcatch\s*(?:\([^)]*\))?\s*\{/g;

function stripComments(text: string): string {
  return text.replaceAll(/\/\/.*$/gm, '').replaceAll(/\/\*[^]*?\*\//g, '');
}

function detectEmptyCatch(body: string): boolean {
  CATCH_DECL.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = CATCH_DECL.exec(body)) !== null) {
    const braceStart = match.index + match[0].length - 1;
    const braceEnd = findMatchingBrace(body, braceStart);
    if (braceEnd === -1) continue;
    const catchBody = body.slice(braceStart + 1, braceEnd);
    if (stripComments(catchBody).trim() === '') return true;
  }
  return false;
}

const TAUTOLOGICAL_ASSERTION =
  /expect\s*\(\s*true\s*\)\s*\.\s*(?:toBe|toEqual|toBeTruthy)\s*\(\s*(?:true\s*)?\)/;

function detectTautologicalAssertion(body: string): boolean {
  return TAUTOLOGICAL_ASSERTION.test(body);
}

const SNAPSHOT_CALL = /\.\s*toMatchSnapshot\s*\(|\.\s*toMatchInlineSnapshot\s*\(/;
const APPROVAL_HEADER = /approved-by:/i;

function detectUnapprovedSnapshot(body: string): boolean {
  return SNAPSHOT_CALL.test(body) && !APPROVAL_HEADER.test(body);
}

function violationsForBlock(file: string, block: TestBlock): readonly OracleLintViolation[] {
  const violations: OracleLintViolation[] = [];
  if (detectWeakAssertion(block.body)) {
    violations.push({
      file,
      line: block.line,
      pattern: 'weak-assertion',
      testName: block.name,
      message: `${block.name}: toBeDefined()/toBeTruthy() with no stronger assertion anywhere — F-TEST-2 forbids asserting the code did what the code does.`,
    });
  }
  if (detectEmptyCatch(block.body)) {
    violations.push({
      file,
      line: block.line,
      pattern: 'empty-catch',
      testName: block.name,
      message: `${block.name}: an empty catch block swallows a real failure silently.`,
    });
  }
  if (detectTautologicalAssertion(block.body)) {
    violations.push({
      file,
      line: block.line,
      pattern: 'tautological-assertion',
      testName: block.name,
      message: `${block.name}: expect(true).toBe(true) is an unconditional, always-passing assertion.`,
    });
  }
  if (detectUnapprovedSnapshot(block.body)) {
    violations.push({
      file,
      line: block.line,
      pattern: 'unapproved-snapshot',
      testName: block.name,
      message: `${block.name}: a snapshot assertion with no "approved-by:" header — a snapshot is a golden file only if someone decided it was correct.`,
    });
  }
  return violations;
}

async function readTextFileRelative(
  paths: ProjectPaths,
  relative: string,
  problems: string[],
): Promise<string | undefined> {
  try {
    return await readTextFile(paths.resolveWithin(relative));
  } catch (error) {
    problems.push(
      `could not read ${relative}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return undefined;
  }
}

/** `09` §9.5/F-TEST-2's own oracle-lint check, over every real test file under `paths`' own root.
 * Never throws for an ordinary real-world failure (a file this process cannot read, a directory
 * that no longer exists mid-walk): each becomes a real `problems` entry, never a silent `errors: 0`
 * that would read as "every test file was scanned and found clean." */
export async function runOracleLint(paths: ProjectPaths): Promise<OracleLintResult> {
  const problems: string[] = [];
  const files = await discoverTestFiles(paths, problems);
  const violations: OracleLintViolation[] = [];
  for (const file of files) {
    const source = await readTextFileRelative(paths, file, problems);
    if (source === undefined) continue;
    for (const block of discoverTestBlocks(source)) {
      violations.push(...violationsForBlock(file, block));
    }
  }
  return problems.length > 0
    ? { errors: violations.length, violations, problems }
    : { errors: violations.length, violations };
}
