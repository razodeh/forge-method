/**
 * `validateParityDeclaration`/`parseParityDeclaration`/`loadParityDeclaration` — the strict loader for
 * `.forge/parity/<name>.parity.yaml` (`13` F-TEST-9), structurally mirroring
 * `parseGateDocument`/`validateGateDocument` (`packages/engine/src/gates/document.ts`): unknown keys
 * are errors, at every level, with a "did you mean" when one is a close edit of a known key
 * (`suggestKey`, `@forge/engine/gates`); a non-throwing validator returns every problem found, and a
 * throwing wrapper raises one `ForgeError` naming the first.
 *
 * **Two layers, deliberately.** {@link validateParityDeclaration} is synchronous and pure: every
 * check it makes is answerable from the parsed YAML alone (unknown keys, required fields, a `name`
 * equal to the file stem, calendar-date shape, `stability.runs` in range, an output/overlay path that
 * cannot be safe, an argument that cannot be safely composed, an `unobservable` entry naming a
 * surface the declaration does not have). It does **not** confirm a tag-shaped `reference.ref` is
 * actually accepted by `git check-ref-format` (that needs a subprocess — `reference-ref.ts`'s own
 * `isAcceptedTagName`) and does **not** vet a `run`/`setup`/composed line against a project tree (that
 * needs the filesystem — `vetStoredCommand`). Both of THOSE live in {@link loadParityDeclaration},
 * which is async for exactly those two reasons. `PLAN-M16.md` P2's own Mandate is explicit that the
 * digest and selection modules need neither, which is why the split exists: a caller that only wants
 * a typed `ParityDeclaration` to compute a digest from, or to build a capture-selection fixture,
 * never has to await a subprocess it does not need.
 *
 * **What is, and is not, an `invalid` cause checked here.** `13` F-TEST-9's Verdicts section lists
 * every load-time `invalid` cause; this loader checks all of them EXCEPT the three that need a real
 * git tree or the running candidate (a declared `file` output tracked in git, `oracle-changed`,
 * `nothing-compared`) — those are P7's, over a real repository this piece does not have. See this
 * piece's own report for the full list and the reasoning.
 *
 * @see specs/13-frameworks-testing-and-debugging.md F-TEST-9
 * @see process/plans/PLAN-M16.md P2
 * @see process/SPEC-QUESTIONS.md Q294 Decisions 5-8
 * @see packages/engine/src/gates/document.ts (the mirrored precedent)
 */
import path from 'node:path';

import { ForgeError } from '@forge/core/errors';
import { vetStoredCommand, type CommandRefusal } from '@forge/engine/dispatch';
import { suggestKey } from '@forge/engine/gates';
import * as YAML from 'yaml';

import { composeArgs } from './compose-args.ts';
import type {
  DeclaredOutput,
  NormalizeRule,
  OverlayInput,
  ParityCase,
  ParityDeclaration,
  SurfaceDeclaration,
  SurfaceKind,
  UnobservableEntry,
} from './declaration-types.ts';
import { isSurfaceKind, SURFACE_KINDS } from './declaration-types.ts';
import { isValidCalendarDate } from './expiry.ts';
import { unsafeDeclaredPathReason, unsafeOverlaySourceReason } from './paths.ts';
import { classifyReferenceRefFormat, classifyReferenceRefShape } from './reference-ref.ts';

const NAME_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const PARITY_FILE_SUFFIX = '.parity.yaml';
const DEFAULT_STABILITY_RUNS = 3;
const MIN_STABILITY_RUNS = 2;
const MAX_STABILITY_RUNS = 10;

/** A vet function with `vetStoredCommand`'s own signature — the loader's one seam for a test to
 * inject a fake that records exactly what it was asked to vet, never a mock of anything else. */
export type VetCommand = (command: string, root: string) => Promise<CommandRefusal | undefined>;

/** What kind of thing is wrong with a declaration: an unrecognised key (always with a "did you
 * mean" when one is close), a value that is present but malformed, or a `run`/`setup`/composed
 * line the engine's command vetting refused. */
export type ParityDeclarationProblemCode = 'unknown-key' | 'invalid-value' | 'command-refused';

/** One thing wrong with a declaration — plain data, never thrown, exactly as `GateDocumentProblem`
 * is: `forge parity check` prints a declaration's `invalid` reason from these, it does not catch an
 * exception to build one. */
export interface ParityDeclarationProblem {
  readonly code: ParityDeclarationProblemCode;
  readonly key: string;
  readonly message: string;
}

/** The result of validating or loading a declaration: both present only when there is no problem at
 * all, mirroring `GateDocumentResult`. */
export interface ParityDeclarationValidation {
  readonly declaration?: ParityDeclaration;
  readonly problems: readonly ParityDeclarationProblem[];
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonBlankString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

/** Narrows `list` from "every entry parsed, or `undefined` for one that did not" to "every entry
 * parsed" — a plain type guard rather than an `as X[]` cast at each of this file's several call
 * sites (`QUALITY-BAR.md` R1): TypeScript does not narrow an array's element type through
 * `Array.prototype.some`, so without this every one of them would need its own unexplained `as`. */
function allDefined<T>(list: readonly (T | undefined)[]): list is readonly T[] {
  return !list.some((entry) => entry === undefined);
}

function describeValue(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'a list';
  return typeof value === 'object' ? 'a mapping' : `a ${typeof value}`;
}

/** The file's declared name stem: `foo.parity.yaml` -> `foo`, matching `13` F-TEST-9's "`name`, the
 * file stem" (a path with any other extension falls back to `path.basename` without it, so a caller
 * that passes a bare name such as `"foo"` in a test still gets the stem `"foo"`). */
function fileStem(file: string): string {
  const base = path.basename(file);
  if (base.endsWith(PARITY_FILE_SUFFIX)) return base.slice(0, -PARITY_FILE_SUFFIX.length);
  return path.basename(file, path.extname(file));
}

class Collector {
  readonly problems: ParityDeclarationProblem[] = [];

  add(code: ParityDeclarationProblemCode, key: string, message: string): void {
    this.problems.push({ code, key, message });
  }

  /** Reports every key of `record` that is not in `known`, each with a "did you mean" when one is
   * close (`suggestKey`, the identical helper `parseGateDocument`'s own loader uses). */
  strictKeys(
    record: Readonly<Record<string, unknown>>,
    known: readonly string[],
    path: string,
  ): void {
    for (const key of Object.keys(record)) {
      if (known.includes(key)) continue;
      const at = path === '' ? key : `${path}.${key}`;
      const suggestion = suggestKey(key, known);
      this.add(
        'unknown-key',
        at,
        `unknown key "${key}"${suggestion === undefined ? '' : ` (did you mean "${suggestion}"?)`}; the keys here are ${known.map((name) => `"${name}"`).join(', ')}`,
      );
    }
  }
}

const REFERENCE_KEYS = ['ref'] as const;
const REVIEW_KEYS = ['by', 'basis', 'at'] as const;
const SURFACE_KEYS = ['run', 'setup', 'streams', 'network', 'stability', 'cases'] as const;
const STABILITY_KEYS = ['runs'] as const;
const CASE_KEYS = [
  'args',
  'inputs',
  'outputs',
  'normalize',
  'timeoutMs',
  'outputCapBytes',
  'expect',
] as const;
const INPUT_KEYS = ['from', 'to'] as const;
const OUTPUT_KEYS = ['path', 'mode'] as const;
const UNOBSERVABLE_KEYS = ['surface', 'reason', 'owner', 'expiry'] as const;
const NORMALIZE_RULE_NAMES = [
  'line-endings',
  'strip-ansi',
  'trim-trailing-whitespace',
  'sort-lines',
  'json-canonical',
  'ignore-json-pointers',
  'replace',
] as const;
const TOP_KEYS = ['name', 'reference', 'review', 'expires', 'surfaces', 'unobservable'] as const;

function readDate(raw: unknown, out: Collector, key: string, label: string): string | undefined {
  if (!isNonBlankString(raw)) {
    out.add(
      'invalid-value',
      key,
      `${label} must be a "YYYY-MM-DD" date, found ${describeValue(raw)}`,
    );
    return undefined;
  }
  if (!isValidCalendarDate(raw)) {
    out.add(
      'invalid-value',
      key,
      `${label} ("${raw}") is not a "YYYY-MM-DD" date that exists on the calendar`,
    );
    return undefined;
  }
  return raw;
}

function readReference(raw: unknown, out: Collector): { readonly ref: string } | undefined {
  if (!isRecord(raw)) {
    out.add('invalid-value', 'reference', `must be a mapping, found ${describeValue(raw)}`);
    return undefined;
  }
  out.strictKeys(raw, REFERENCE_KEYS, 'reference');
  const ref = raw['ref'];
  if (!isNonBlankString(ref)) {
    out.add(
      'invalid-value',
      'reference.ref',
      `must be a non-blank string, found ${describeValue(ref)}`,
    );
    return undefined;
  }
  const shape = classifyReferenceRefShape(ref);
  if (shape.kind === 'invalid') {
    out.add('invalid-value', 'reference.ref', shape.reason);
    return undefined;
  }
  // `shape.kind === 'maybe-tag'` is not re-checked against `git check-ref-format` here — that needs a
  // subprocess, which this synchronous pass does not run; `loadParityDeclaration` does it.
  return { ref };
}

function readReview(
  raw: unknown,
  out: Collector,
): { readonly by: string; readonly basis: string; readonly at: string } | undefined {
  if (raw === undefined) {
    out.add('invalid-value', 'review', 'is required (a declaration without a review is `invalid`)');
    return undefined;
  }
  if (!isRecord(raw)) {
    out.add('invalid-value', 'review', `must be a mapping, found ${describeValue(raw)}`);
    return undefined;
  }
  out.strictKeys(raw, REVIEW_KEYS, 'review');
  const by = raw['by'];
  const basis = raw['basis'];
  if (!isNonBlankString(by)) {
    out.add('invalid-value', 'review.by', `must be a non-blank string, found ${describeValue(by)}`);
  }
  if (!isNonBlankString(basis)) {
    out.add(
      'invalid-value',
      'review.basis',
      `must be a non-blank string, found ${describeValue(basis)}`,
    );
  }
  const at = readDate(raw['at'], out, 'review.at', 'review.at');
  if (!isNonBlankString(by) || !isNonBlankString(basis) || at === undefined) return undefined;
  return { by, basis, at };
}

/** A real type guard, rather than a bare `.includes()` check: `.includes()` returns a plain
 * `boolean`, which TypeScript cannot use to narrow `rule`'s type for the rest of
 * {@link readNormalizeRule} the way an `is` predicate can (`QUALITY-BAR.md` R1 — this is what lets
 * every later branch avoid its own `as` for the same value). */
function isNormalizeRuleName(value: unknown): value is (typeof NORMALIZE_RULE_NAMES)[number] {
  return typeof value === 'string' && (NORMALIZE_RULE_NAMES as readonly string[]).includes(value);
}

function readNormalizeRule(raw: unknown, out: Collector, at: string): NormalizeRule | undefined {
  if (!isRecord(raw)) {
    out.add('invalid-value', at, `must be a mapping, found ${describeValue(raw)}`);
    return undefined;
  }
  const rule = raw['rule'];
  if (!isNormalizeRuleName(rule)) {
    out.add(
      'invalid-value',
      `${at}.rule`,
      `must be one of ${NORMALIZE_RULE_NAMES.map((name) => `"${name}"`).join(', ')}, found ${describeValue(rule)}`,
    );
    return undefined;
  }
  if (rule === 'ignore-json-pointers') {
    out.strictKeys(raw, ['rule', 'pointers'], at);
    const pointers = raw['pointers'];
    if (!Array.isArray(pointers) || pointers.length === 0 || !pointers.every(isNonBlankString)) {
      out.add(
        'invalid-value',
        `${at}.pointers`,
        'must be a non-empty list of non-blank JSON pointers',
      );
      return undefined;
    }
    return { rule, pointers };
  }
  if (rule === 'replace') {
    out.strictKeys(raw, ['rule', 'pattern', 'replacement', 'stream', 'file'], at);
    const pattern = raw['pattern'];
    const replacement = raw['replacement'];
    if (!isNonBlankString(pattern)) {
      out.add(
        'invalid-value',
        `${at}.pattern`,
        `must be a non-blank string, found ${describeValue(pattern)}`,
      );
      return undefined;
    }
    try {
      // Constructed only to validate the pattern compiles; the catastrophic-backtracking LINT `13`
      // F-TEST-9 also asks for is PLAN-M16.md P4's own job (the comparison engine that actually
      // runs a `replace` under a time limit), not this pure loader's.
      new RegExp(pattern);
    } catch (cause) {
      out.add(
        'invalid-value',
        `${at}.pattern`,
        `is not a valid regular expression (${cause instanceof Error ? cause.message : 'unknown error'})`,
      );
      return undefined;
    }
    if (typeof replacement !== 'string') {
      out.add(
        'invalid-value',
        `${at}.replacement`,
        `must be a string, found ${describeValue(replacement)}`,
      );
      return undefined;
    }
    const stream = raw['stream'];
    if (stream !== undefined && stream !== 'stdout' && stream !== 'stderr') {
      out.add('invalid-value', `${at}.stream`, 'must be "stdout" or "stderr" when given');
      return undefined;
    }
    const file = raw['file'];
    if (file !== undefined && !isNonBlankString(file)) {
      out.add(
        'invalid-value',
        `${at}.file`,
        `must be a non-blank string when given, found ${describeValue(file)}`,
      );
      return undefined;
    }
    return {
      rule,
      pattern,
      replacement,
      ...(stream === undefined ? {} : { stream }),
      ...(file === undefined ? {} : { file }),
    };
  }
  out.strictKeys(raw, ['rule'], at);
  return { rule };
}

function readOverlayInput(raw: unknown, out: Collector, at: string): OverlayInput | undefined {
  if (!isRecord(raw)) {
    out.add('invalid-value', at, `must be a mapping, found ${describeValue(raw)}`);
    return undefined;
  }
  out.strictKeys(raw, INPUT_KEYS, at);
  const from = raw['from'];
  const to = raw['to'];
  if (!isNonBlankString(from)) {
    out.add(
      'invalid-value',
      `${at}.from`,
      `must be a non-blank string, found ${describeValue(from)}`,
    );
  } else {
    const reason = unsafeOverlaySourceReason(from);
    if (reason !== undefined) {
      out.add(
        'invalid-value',
        `${at}.from`,
        `"${from}" is unusable as an overlay source (${reason})`,
      );
    }
  }
  if (!isNonBlankString(to)) {
    out.add('invalid-value', `${at}.to`, `must be a non-blank string, found ${describeValue(to)}`);
  } else {
    const reason = unsafeDeclaredPathReason(to);
    if (reason !== undefined) {
      out.add(
        'invalid-value',
        `${at}.to`,
        `"${to}" is unusable as an overlay destination (${reason})`,
      );
    }
  }
  if (!isNonBlankString(from) || !isNonBlankString(to)) return undefined;
  if (unsafeOverlaySourceReason(from) !== undefined || unsafeDeclaredPathReason(to) !== undefined) {
    return undefined;
  }
  return { from, to };
}

function readDeclaredOutput(raw: unknown, out: Collector, at: string): DeclaredOutput | undefined {
  if (!isRecord(raw)) {
    out.add('invalid-value', at, `must be a mapping, found ${describeValue(raw)}`);
    return undefined;
  }
  out.strictKeys(raw, OUTPUT_KEYS, at);
  const outputPath = raw['path'];
  const modeRaw = raw['mode'];
  let problem = false;
  if (!isNonBlankString(outputPath)) {
    out.add(
      'invalid-value',
      `${at}.path`,
      `must be a non-blank string, found ${describeValue(outputPath)}`,
    );
    problem = true;
  } else {
    const reason = unsafeDeclaredPathReason(outputPath);
    if (reason !== undefined) {
      out.add(
        'invalid-value',
        `${at}.path`,
        `"${outputPath}" is unusable as a declared output path (${reason})`,
      );
      problem = true;
    }
  }
  // Declared with its own narrow type and assigned only from branches TypeScript can already prove
  // match it, rather than carrying `modeRaw`'s wide `unknown` into the final object literal (which,
  // under `exactOptionalPropertyTypes`, produced a bogus inferred property type instead of a clean
  // error — easier to avoid than to explain away with a cast).
  let mode: 'text' | 'bytes' | undefined;
  if (modeRaw === 'text' || modeRaw === 'bytes') {
    mode = modeRaw;
  } else if (modeRaw !== undefined) {
    out.add('invalid-value', `${at}.mode`, 'must be "text" or "bytes" when given');
    problem = true;
  }
  if (problem || !isNonBlankString(outputPath)) return undefined;
  return { path: outputPath, ...(mode === undefined ? {} : { mode }) };
}

function readExpect(raw: unknown, out: Collector, at: string): ParityCase['expect'] {
  if (raw === undefined) return undefined;
  if (raw === 'empty') return 'empty';
  if (typeof raw === 'number' && Number.isInteger(raw) && raw >= 0) return raw;
  out.add('invalid-value', at, 'must be a non-negative integer exit code or the literal "empty"');
  return undefined;
}

function readCase(raw: unknown, out: Collector, at: string): ParityCase | undefined {
  if (!isRecord(raw)) {
    out.add('invalid-value', at, `must be a mapping, found ${describeValue(raw)}`);
    return undefined;
  }
  out.strictKeys(raw, CASE_KEYS, at);
  let ok = true;

  const argsRaw = raw['args'];
  let args: readonly string[] | undefined;
  if (argsRaw !== undefined) {
    if (!Array.isArray(argsRaw) || !argsRaw.every((entry) => typeof entry === 'string')) {
      out.add('invalid-value', `${at}.args`, 'must be a list of strings when given');
      ok = false;
    } else {
      args = argsRaw;
    }
  }

  const inputsRaw = raw['inputs'];
  let inputs: readonly OverlayInput[] | undefined;
  if (inputsRaw !== undefined) {
    if (!Array.isArray(inputsRaw)) {
      out.add('invalid-value', `${at}.inputs`, 'must be a list when given');
      ok = false;
    } else {
      const read = inputsRaw.map((entry, index) =>
        readOverlayInput(entry, out, `${at}.inputs[${String(index)}]`),
      );
      if (allDefined(read)) inputs = read;
      else ok = false;
    }
  }

  const outputsRaw = raw['outputs'];
  let outputs: readonly DeclaredOutput[] | undefined;
  if (outputsRaw !== undefined) {
    if (!Array.isArray(outputsRaw)) {
      out.add('invalid-value', `${at}.outputs`, 'must be a list when given');
      ok = false;
    } else {
      const read = outputsRaw.map((entry, index) =>
        readDeclaredOutput(entry, out, `${at}.outputs[${String(index)}]`),
      );
      if (allDefined(read)) outputs = read;
      else ok = false;
    }
  }

  const normalizeRaw = raw['normalize'];
  let normalize: readonly NormalizeRule[] | undefined;
  if (normalizeRaw !== undefined) {
    if (!Array.isArray(normalizeRaw)) {
      out.add('invalid-value', `${at}.normalize`, 'must be a list when given');
      ok = false;
    } else {
      const read = normalizeRaw.map((entry, index) =>
        readNormalizeRule(entry, out, `${at}.normalize[${String(index)}]`),
      );
      if (allDefined(read)) normalize = read;
      else ok = false;
    }
  }

  const timeoutMsRaw = raw['timeoutMs'];
  let timeoutMs: number | undefined;
  if (timeoutMsRaw !== undefined) {
    if (typeof timeoutMsRaw !== 'number' || !Number.isInteger(timeoutMsRaw) || timeoutMsRaw <= 0) {
      out.add(
        'invalid-value',
        `${at}.timeoutMs`,
        'must be a positive integer (milliseconds) when given',
      );
      ok = false;
    } else {
      timeoutMs = timeoutMsRaw;
    }
  }

  const capRaw = raw['outputCapBytes'];
  let outputCapBytes: number | undefined;
  if (capRaw !== undefined) {
    if (typeof capRaw !== 'number' || !Number.isInteger(capRaw) || capRaw <= 0) {
      out.add(
        'invalid-value',
        `${at}.outputCapBytes`,
        'must be a positive integer (bytes) when given',
      );
      ok = false;
    } else {
      outputCapBytes = capRaw;
    }
  }

  const expectBefore = out.problems.length;
  const expect = readExpect(raw['expect'], out, `${at}.expect`);
  if (out.problems.length > expectBefore) ok = false;

  if (!ok) return undefined;
  return {
    ...(args === undefined ? {} : { args }),
    ...(inputs === undefined ? {} : { inputs }),
    ...(outputs === undefined ? {} : { outputs }),
    ...(normalize === undefined ? {} : { normalize }),
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
    ...(outputCapBytes === undefined ? {} : { outputCapBytes }),
    ...(expect === undefined ? {} : { expect }),
  };
}

function readStability(raw: unknown, out: Collector, at: string): { readonly runs: number } {
  if (raw === undefined) return { runs: DEFAULT_STABILITY_RUNS };
  if (!isRecord(raw)) {
    out.add('invalid-value', at, `must be a mapping, found ${describeValue(raw)}`);
    return { runs: DEFAULT_STABILITY_RUNS };
  }
  out.strictKeys(raw, STABILITY_KEYS, at);
  const runs = raw['runs'];
  if (
    typeof runs !== 'number' ||
    !Number.isInteger(runs) ||
    runs < MIN_STABILITY_RUNS ||
    runs > MAX_STABILITY_RUNS
  ) {
    out.add(
      'invalid-value',
      `${at}.runs`,
      `must be an integer from ${String(MIN_STABILITY_RUNS)} to ${String(MAX_STABILITY_RUNS)}, found ${describeValue(runs)}`,
    );
    return { runs: DEFAULT_STABILITY_RUNS };
  }
  return { runs };
}

function readSurface(
  raw: unknown,
  out: Collector,
  kind: SurfaceKind,
  at: string,
): SurfaceDeclaration | undefined {
  if (!isRecord(raw)) {
    out.add('invalid-value', at, `must be a mapping, found ${describeValue(raw)}`);
    return undefined;
  }
  out.strictKeys(raw, SURFACE_KEYS, at);
  let ok = true;

  const run = raw['run'];
  if (!isNonBlankString(run)) {
    out.add(
      'invalid-value',
      `${at}.run`,
      `must be a non-blank string, found ${describeValue(run)}`,
    );
    ok = false;
  }

  const setupRaw = raw['setup'];
  let setup: readonly string[] | undefined;
  if (setupRaw !== undefined) {
    if (!Array.isArray(setupRaw) || !setupRaw.every(isNonBlankString)) {
      out.add('invalid-value', `${at}.setup`, 'must be a list of non-blank strings when given');
      ok = false;
    } else {
      setup = setupRaw;
    }
  }

  const streamsRaw = raw['streams'];
  let streams: readonly ('stdout' | 'stderr')[] | undefined;
  if (streamsRaw !== undefined && kind !== 'process') {
    // `13` F-TEST-9 introduces `streams` immediately after describing the `process` surface's own
    // stdout/stderr/exit observation ("a surface that wants only some of the two streams lists them
    // with `streams`"); `file` and `http` have no stream to select at all, and `library`'s own
    // protocol is specifically "exactly one JSON object on stdout" with no optional-stderr angle
    // described anywhere, so there is nothing for `streams` to select there either — the identical
    // "this key belongs to one surface kind only" treatment `network` already gets below.
    out.add(
      'invalid-value',
      `${at}.streams`,
      `"streams" only applies to the "process" surface, not "${kind}"`,
    );
    ok = false;
  } else if (streamsRaw !== undefined) {
    if (
      !Array.isArray(streamsRaw) ||
      streamsRaw.length === 0 ||
      !streamsRaw.every((entry) => entry === 'stdout' || entry === 'stderr')
    ) {
      out.add(
        'invalid-value',
        `${at}.streams`,
        'must be a non-empty list of "stdout"/"stderr" when given',
      );
      ok = false;
    } else {
      streams = streamsRaw;
    }
  }

  const network = raw['network'];
  if (kind === 'http') {
    if (network !== 'loopback') {
      out.add(
        'invalid-value',
        `${at}.network`,
        'the "http" surface must declare "network: loopback" as its explicit opt-in',
      );
      ok = false;
    }
  } else if (network !== undefined) {
    out.add(
      'invalid-value',
      `${at}.network`,
      `"network" only applies to the "http" surface, not "${kind}"`,
    );
    ok = false;
  }

  const stability = readStability(raw['stability'], out, `${at}.stability`);

  const casesRaw = raw['cases'];
  let cases: readonly ParityCase[] | undefined;
  if (!Array.isArray(casesRaw) || casesRaw.length === 0) {
    out.add('invalid-value', `${at}.cases`, 'a surface must list at least one case');
    ok = false;
  } else {
    const read = casesRaw.map((entry, index) =>
      readCase(entry, out, `${at}.cases[${String(index)}]`),
    );
    if (allDefined(read)) cases = read;
    else ok = false;
  }

  if (!ok || !isNonBlankString(run) || cases === undefined) return undefined;
  // `kind === 'http'` was already required, above, to have produced `network === 'loopback'` (any
  // other value added a problem and set `ok = false`, which already returned); typed here so the
  // ternary below needs no cast to narrow the literal.
  const httpNetwork: 'loopback' | undefined = kind === 'http' ? 'loopback' : undefined;
  return {
    run,
    ...(setup === undefined ? {} : { setup }),
    ...(streams === undefined ? {} : { streams }),
    ...(httpNetwork === undefined ? {} : { network: httpNetwork }),
    stability,
    cases,
  };
}

function readUnobservableEntry(
  raw: unknown,
  out: Collector,
  at: string,
  declaredSurfaces: ReadonlySet<SurfaceKind>,
): UnobservableEntry | undefined {
  if (!isRecord(raw)) {
    out.add('invalid-value', at, `must be a mapping, found ${describeValue(raw)}`);
    return undefined;
  }
  out.strictKeys(raw, UNOBSERVABLE_KEYS, at);
  const surface = raw['surface'];
  let ok = true;
  if (!isSurfaceKind(surface)) {
    out.add(
      'invalid-value',
      `${at}.surface`,
      `must be one of ${SURFACE_KINDS.map((name) => `"${name}"`).join(', ')}, found ${describeValue(surface)}`,
    );
    ok = false;
  } else if (!declaredSurfaces.has(surface)) {
    out.add(
      'invalid-value',
      `${at}.surface`,
      `"${surface}" names no surface of this declaration (its "surfaces" block has no "${surface}" entry to excuse)`,
    );
    ok = false;
  }
  const reason = raw['reason'];
  const owner = raw['owner'];
  if (!isNonBlankString(reason)) {
    out.add(
      'invalid-value',
      `${at}.reason`,
      `must be a non-blank string, found ${describeValue(reason)}`,
    );
    ok = false;
  }
  if (!isNonBlankString(owner)) {
    out.add(
      'invalid-value',
      `${at}.owner`,
      `must be a non-blank string, found ${describeValue(owner)}`,
    );
    ok = false;
  }
  const expiry = readDate(raw['expiry'], out, `${at}.expiry`, `${at}.expiry`);
  if (
    !ok ||
    expiry === undefined ||
    !isSurfaceKind(surface) ||
    !isNonBlankString(reason) ||
    !isNonBlankString(owner)
  ) {
    return undefined;
  }
  return { surface, reason, owner, expiry };
}

/**
 * Validates a parsed parity declaration (`YAML.parse`'s own result, untrusted) structurally: every
 * check this function makes needs nothing beyond `raw` and `file`'s own name. Never throws. See this
 * module's own doc comment for exactly what is, and is not, checked here.
 */
export function validateParityDeclaration(raw: unknown, file: string): ParityDeclarationValidation {
  const out = new Collector();
  if (!isRecord(raw)) {
    out.add(
      'invalid-value',
      '(document)',
      `must be a mapping of declaration fields, found ${describeValue(raw)}`,
    );
    return { problems: out.problems };
  }
  out.strictKeys(raw, TOP_KEYS, '');

  const name = raw['name'];
  const expectedName = fileStem(file);
  if (!isNonBlankString(name) || !NAME_PATTERN.test(name)) {
    out.add(
      'invalid-value',
      'name',
      `must be a non-blank string matching ${NAME_PATTERN.source}, found ${describeValue(name)}`,
    );
  } else if (name !== expectedName) {
    out.add('invalid-value', 'name', `"${name}" must equal the file's own stem, "${expectedName}"`);
  }

  const reference = readReference(raw['reference'], out);
  const review = readReview(raw['review'], out);
  const expires = readDate(raw['expires'], out, 'expires', 'expires');

  const surfacesRaw = raw['surfaces'];
  const surfaces: Partial<Record<SurfaceKind, SurfaceDeclaration>> = {};
  if (surfacesRaw !== undefined) {
    if (!isRecord(surfacesRaw)) {
      out.add(
        'invalid-value',
        'surfaces',
        `must be a mapping, found ${describeValue(surfacesRaw)}`,
      );
    } else {
      out.strictKeys(surfacesRaw, SURFACE_KINDS, 'surfaces');
      for (const kind of SURFACE_KINDS) {
        const entry = surfacesRaw[kind];
        if (entry === undefined) continue;
        const surface = readSurface(entry, out, kind, `surfaces.${kind}`);
        if (surface !== undefined) surfaces[kind] = surface;
      }
    }
  }
  const declaredSurfaces = new Set<SurfaceKind>(
    SURFACE_KINDS.filter((kind) => surfaces[kind] !== undefined),
  );

  const unobservableRaw = raw['unobservable'];
  let unobservable: readonly UnobservableEntry[] = [];
  if (unobservableRaw !== undefined) {
    if (!Array.isArray(unobservableRaw)) {
      out.add('invalid-value', 'unobservable', 'must be a list when given');
    } else {
      const read = unobservableRaw.map((entry, index) =>
        readUnobservableEntry(entry, out, `unobservable[${String(index)}]`, declaredSurfaces),
      );
      if (allDefined(read)) unobservable = read;
    }
  }

  if (
    out.problems.length > 0 ||
    !isNonBlankString(name) ||
    reference === undefined ||
    review === undefined ||
    expires === undefined
  ) {
    return { problems: out.problems };
  }
  const declaration: ParityDeclaration = {
    name,
    reference,
    review,
    expires,
    surfaces,
    unobservable,
  };
  return { declaration, problems: out.problems };
}

/**
 * `validateParityDeclaration`, throwing `CFG-510` (naming `file` and the first offending key) when
 * the declaration has any structural problem — the identical "non-throwing validator plus a throwing
 * wrapper over its first problem" shape `parseGateDocument` gives `validateGateDocument`.
 *
 * Does not vet, and does not confirm a tag-shaped `reference.ref` against `git check-ref-format` —
 * see this module's own doc comment. Use {@link loadParityDeclaration} for the full check.
 */
export function parseParityDeclaration(raw: unknown, file: string): ParityDeclaration {
  return assertParityDeclarationValid(validateParityDeclaration(raw, file), file);
}

/** Throws `CFG-510` when `result` carries any problem (or no declaration); otherwise returns the
 * declaration. Shared by the sync and the async ("load") entry points so the "first problem becomes
 * one thrown error" logic is written once. */
export function assertParityDeclarationValid(
  result: ParityDeclarationValidation,
  file: string,
): ParityDeclaration {
  const first = result.problems[0];
  if (result.declaration === undefined || first !== undefined) {
    throw new ForgeError('CFG-510', {
      file,
      key: first?.key ?? '(document)',
      detail: first?.message ?? 'the declaration could not be read',
      more: Math.max(0, result.problems.length - 1),
    });
  }
  return result.declaration;
}

/** One surface/field location a vettable command line was found at, and the exact line composed for
 * it — the unit {@link vetParityDeclaration} loops over. */
interface VettableCommand {
  readonly key: string;
  readonly surface: SurfaceKind;
  readonly field: string;
  readonly command: string;
}

/** Every `run`, every `setup` entry, and every case's composed line, for a structurally valid
 * declaration — in a fixed, sorted order (`QUALITY-BAR.md` R10) so vetting order (and so a fake vet's
 * own recorded call order, in a test) never depends on object key enumeration. Arguments that cannot
 * be composed at all (`composeArgs` returning `{ invalid }`) are reported as problems directly here,
 * never handed to the vet — there is no line to vet. */
function collectVettableCommands(
  declaration: ParityDeclaration,
  out: Collector,
): readonly VettableCommand[] {
  const commands: VettableCommand[] = [];
  for (const kind of SURFACE_KINDS) {
    const surface = declaration.surfaces[kind];
    if (surface === undefined) continue;
    commands.push({
      key: `surfaces.${kind}.run`,
      surface: kind,
      field: 'run',
      command: surface.run,
    });
    (surface.setup ?? []).forEach((command, index) => {
      commands.push({
        key: `surfaces.${kind}.setup[${String(index)}]`,
        surface: kind,
        field: `setup[${String(index)}]`,
        command,
      });
    });
    surface.cases.forEach((parityCase, caseIndex) => {
      const composed = composeArgs(surface.run, parityCase.args ?? []);
      const key = `surfaces.${kind}.cases[${String(caseIndex)}].args`;
      if (typeof composed !== 'string') {
        out.add('invalid-value', key, composed.invalid);
        return;
      }
      if (composed === surface.run) return; // no arguments: already vetted as `surfaces.${kind}.run`.
      commands.push({
        key,
        surface: kind,
        field: `cases[${String(caseIndex)}].args`,
        command: composed,
      });
    });
  }
  return commands;
}

/**
 * Vets every `run`, every `setup` entry and every case's composed line of an already structurally
 * valid declaration, against `root` (the project's tree, as it is when the declaration loads — never
 * a scratch tree, which does not exist at load, `13` F-TEST-9's own observation bullet). Returns the
 * refusals as plain problems, never throws: a vet refusal is exactly as much "plain data for a
 * declaration's `invalid` reason" as a structural one.
 *
 * `vet` defaults to the engine's real `vetStoredCommand` and is the loader's one seam for a test to
 * inject a fake that records exactly what it was asked to vet.
 */
export async function vetParityDeclaration(
  declaration: ParityDeclaration,
  root: string,
  vet: VetCommand = vetStoredCommand,
): Promise<readonly ParityDeclarationProblem[]> {
  const out = new Collector();
  const commands = collectVettableCommands(declaration, out);
  for (const entry of commands) {
    const refusal = await vet(entry.command, root);
    if (refusal !== undefined) {
      out.add(
        'command-refused',
        entry.key,
        `surface "${entry.surface}"'s "${entry.field}" ("${entry.command}") is refused by the engine's command vetting (${refusal.reason}): ${refusal.detail}`,
      );
    }
  }
  return out.problems;
}

/**
 * The full, async parity-declaration load: structural validation, then (only once that finds no
 * problem) the `reference.ref` tag-name check and command vetting, both against `root`. Never
 * throws; use {@link assertParityDeclarationValid} over its result for a throwing call.
 */
export async function loadParityDeclaration(
  raw: unknown,
  file: string,
  root: string,
  vet: VetCommand = vetStoredCommand,
): Promise<ParityDeclarationValidation> {
  const structural = validateParityDeclaration(raw, file);
  if (structural.declaration === undefined) return structural;

  const problems: ParityDeclarationProblem[] = [...structural.problems];
  const refFormat = await classifyReferenceRefFormat(structural.declaration.reference.ref);
  if (refFormat.kind === 'invalid') {
    problems.push({ code: 'invalid-value', key: 'reference.ref', message: refFormat.reason });
  }
  problems.push(...(await vetParityDeclaration(structural.declaration, root, vet)));

  if (problems.length > 0) return { problems };
  return { declaration: structural.declaration, problems: [] };
}

/**
 * Parses raw YAML text into a declaration, catching a syntax error as a typed problem (naming the
 * file and the line `yaml` reports) rather than letting `YAML.parse`'s own exception escape — `13`
 * F-TEST-9's own loader requirement. Delegates everything else to {@link loadParityDeclaration}.
 */
export async function loadParityDeclarationText(
  yamlText: string,
  file: string,
  root: string,
  vet: VetCommand = vetStoredCommand,
): Promise<ParityDeclarationValidation> {
  let raw: unknown;
  try {
    raw = YAML.parse(yamlText);
  } catch (cause) {
    const withLinePos = cause as { readonly linePos?: readonly { readonly line: number }[] };
    const line = withLinePos.linePos?.[0]?.line;
    return {
      problems: [
        {
          code: 'invalid-value',
          key: '(document)',
          message: `not parseable YAML${line === undefined ? '' : ` at line ${String(line)}`} (${cause instanceof Error ? (cause.message.split('\n')[0] ?? cause.message) : 'unknown error'})`,
        },
      ],
    };
  }
  return loadParityDeclaration(raw, file, root, vet);
}
