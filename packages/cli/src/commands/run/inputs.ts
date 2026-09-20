/**
 * `forge run <workflow> --input <name>=<value>` (`03` §3.2.4, `PLAN-M13.md` P21): parsing and typing of a run's
 * inputs. Pure: no file is read here, so every refusal is testable from strings alone.
 *
 * A workflow declares the values a run must be given as `inputs:` (`10` §10.1: `name`, `type`, `required`) and
 * reads them as bare placeholders (`{{stageId}}`, `{{ownerRole}}`, `{{defectId}}`), which resolve at the top of the
 * expression context. So a supplied input lands at the context root, under its own name, and nowhere else.
 *
 * @see specs/03 §3.2.4
 * @see specs/10 §10.1
 */
import { ForgeError } from '@forge/core/errors';

import { sanitizeRefusalText } from './vcs-refusal.ts';

/** A `RUN-088` refusal. Everything in it can quote what the user typed or a Story says, so it is stripped of
 * newlines, carriage returns, bidi controls and terminal escapes first (a value could otherwise forge a second line
 * of output). */
export function inputRefusal(input: string, reason: string): ForgeError<'RUN-088'> {
  return new ForgeError('RUN-088', {
    input: sanitizeRefusalText(input),
    reason: sanitizeRefusalText(reason),
  });
}

/** The fixed helper roots of the expression language (`10` §10.1). An input named one of these would replace the
 * object the language itself reads (`stage.stories`, `vars.x`), so it is refused; the prototype names are
 * refused because an input name becomes an own property of a plain object. */
export const RESERVED_INPUT_NAMES: ReadonlySet<string> = new Set([
  'item',
  'stage',
  'run',
  'config',
  'kb',
  'failures',
  'vars',
  '__proto__',
  'constructor',
  'prototype',
]);

const INPUT_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Splits the repeatable `--input <pair>` flag out of a command's arguments. The very next token is always the
 * value, whatever it looks like (the same rule `parseCommandFlags` applies to every value flag), so a value
 * starting with `--` is a malformed pair, reported as one, not a second flag. */
export function extractInputFlags(args: readonly string[]): {
  readonly inputs: readonly string[];
  readonly rest: readonly string[];
} {
  const inputs: string[] = [];
  const rest: string[] = [];
  for (let i = 0; i < args.length; i += 1) {
    const token = args[i];
    if (token === undefined) break;
    if (token !== '--input') {
      rest.push(token);
      continue;
    }
    const value = args[i + 1];
    if (value === undefined) {
      throw inputRefusal('--input', 'the flag needs a value of the form name=value');
    }
    inputs.push(value);
    i += 1;
  }
  return { inputs, rest };
}

/** Parses `name=value` pairs (the value may itself contain `=`). A repeated name is accepted when it repeats
 * the same value and refused when it contradicts itself. Values are kept as the text the user typed: typing
 * against the workflow's declared input types happens in `coerceInput`. */
export function parseInputPairs(pairs: readonly string[]): ReadonlyMap<string, string> {
  const parsed = new Map<string, string>();
  for (const pair of pairs) {
    const at = pair.indexOf('=');
    if (at <= 0) {
      throw inputRefusal(
        pair,
        at === 0 ? 'the name before "=" is empty' : 'it has no "=" between name and value',
      );
    }
    const name = pair.slice(0, at);
    const value = pair.slice(at + 1);
    if (!INPUT_NAME.test(name)) {
      throw inputRefusal(
        pair,
        `${JSON.stringify(name)} is not a plain identifier (letters, digits and underscores, not starting with a digit)`,
      );
    }
    if (RESERVED_INPUT_NAMES.has(name)) {
      throw inputRefusal(
        pair,
        `${JSON.stringify(name)} is reserved by the expression language and cannot be a run input`,
      );
    }
    if (value.trim() === '') {
      throw inputRefusal(pair, 'the value is empty');
    }
    const earlier = parsed.get(name);
    if (earlier !== undefined && earlier !== value) {
      throw inputRefusal(
        pair,
        `${name} is already ${JSON.stringify(earlier)}; an input takes one value`,
      );
    }
    parsed.set(name, value);
  }
  return parsed;
}

/** Types a value by the workflow's declared input type. `string` (and any type this does not recognise, which
 * is how a workflow author's own vocabulary stays usable) keeps the text; `number` and `integer` accept only a
 * plain decimal literal; `boolean` accepts only `true` or `false`. Anything else is refused, not guessed at. */
export function coerceInput(name: string, raw: string, declaredType: string | undefined): unknown {
  const type = declaredType?.trim().toLowerCase();
  if (type === 'number' || type === 'integer') {
    const pattern = type === 'integer' ? /^-?\d+$/ : /^-?\d+(\.\d+)?$/;
    if (!pattern.test(raw)) {
      throw inputRefusal(
        `${name}=${raw}`,
        `${name} is declared ${type}, and ${JSON.stringify(raw)} is not a ${type === 'integer' ? 'whole number' : 'plain decimal number'}`,
      );
    }
    const value = Number(raw);
    if (type === 'integer' && !Number.isSafeInteger(value)) {
      throw inputRefusal(
        `${name}=${raw}`,
        `${name} is declared integer, and ${JSON.stringify(raw)} is outside the range a whole number is exact in`,
      );
    }
    return value;
  }
  if (type === 'boolean') {
    if (raw !== 'true' && raw !== 'false') {
      throw inputRefusal(
        `${name}=${raw}`,
        `${name} is declared boolean, so its value is "true" or "false"`,
      );
    }
    return raw === 'true';
  }
  return raw;
}

const NOT_AN_INPUT: ReadonlySet<string> = new Set(['true', 'false', 'null', 'length', 'not', 'in']);

/** Every string scalar in a parsed value (never a key, never a YAML comment: a comment is not part of the
 * parsed document, so a placeholder mentioned in one is not something the workflow reads). */
function collectStrings(value: unknown, into: string[]): void {
  if (typeof value === 'string') into.push(value);
  else if (Array.isArray(value))
    for (const entry of value as readonly unknown[]) collectStrings(entry, into);
  else if (typeof value === 'object' && value !== null) {
    for (const entry of Object.values(value)) collectStrings(entry, into);
  }
}

function rootsOf(strings: readonly string[]): ReadonlySet<string> {
  const names = new Set<string>();
  for (const text of strings) {
    for (const placeholder of text.matchAll(/\{\{(.*?)\}\}/g)) {
      const body = (placeholder[1] ?? '').replace(/"[^"]*"|'[^']*'/g, ' ');
      for (const match of body.matchAll(/(?<![\w.])([A-Za-z_][A-Za-z0-9_]*)/g)) {
        const name = match[1];
        if (name === undefined) continue;
        if (RESERVED_INPUT_NAMES.has(name) || NOT_AN_INPUT.has(name)) continue;
        names.add(name);
      }
    }
  }
  return names;
}

/** The names a parsed workflow reads at the root of its expression context (`{{stageId}}`, `{{ownerRole}}`...),
 * found in the string values of the parsed document (each path's first segment: `{{a.b}}` reads `a`; quoted
 * strings and the language's keywords are skipped). Only used to name what is missing when a workflow does not
 * compile, and to tell an input nothing reads: the helper roots (`item`, `stage`, `run`, `vars`...) are not
 * inputs and are left out. Sorted, so a message is the same every time. */
export function referencedRunInputs(workflow: unknown): readonly string[] {
  const strings: string[] = [];
  collectStrings(workflow, strings);
  return [...rootsOf(strings)].sort();
}

/** Whether any string of the parsed workflow reads `{{run.<...>}}` (a value a run supplies from a Story). */
export function readsRunValues(workflow: unknown): boolean {
  const strings: string[] = [];
  collectStrings(workflow, strings);
  return strings.some((text) => /\{\{\s*run\./.test(text));
}

/** Every `command` step's `run:` string anywhere in a parsed workflow (steps, groups, fanout bodies, `onComplete`,
 * `onFailure.escalations[].do`): the walk is over the whole document, so a step in a place nobody thought of is
 * still found. */
function collectShellStrings(value: unknown, into: string[]): void {
  if (Array.isArray(value)) {
    for (const entry of value as readonly unknown[]) collectShellStrings(entry, into);
  } else if (typeof value === 'object' && value !== null) {
    const record = value as Readonly<Record<string, unknown>>;
    if (record['kind'] === 'command' && typeof record['run'] === 'string') into.push(record['run']);
    for (const entry of Object.values(record)) collectShellStrings(entry, into);
  }
}

export interface ShellFacing {
  /** Run inputs (root names) whose values can end up inside a shell command line. */
  readonly inputs: ReadonlySet<string>;
  /** Whether `--stage` / `--epic` / `--story` can: through `{{stage}}`, `{{vars.epic}}`, `{{vars.story}}`. */
  readonly stage: boolean;
  readonly epic: boolean;
  readonly story: boolean;
}

/** What reaches a shell: the values a `command` step's `run:` reads directly, and those the workflow's `vars:` are
 * built from (`vars.integration_branch` is `forge/integration/{{stageId}}`, then read by `run:`). Command steps run
 * through a shell, so these are the ones that need `assertShellSafe`. A `vars:` entry counts only when a command
 * reads it (`{{vars.<name>}}`), so a var only an agent reads does not restrict free text. */
export function shellFacingInputs(workflow: unknown): ShellFacing {
  const record: Readonly<Record<string, unknown>> =
    typeof workflow === 'object' && workflow !== null
      ? (workflow as Readonly<Record<string, unknown>>)
      : {};
  const runs: string[] = [];
  collectShellStrings(record, runs);
  const varsBlock =
    typeof record['vars'] === 'object' && record['vars'] !== null
      ? (record['vars'] as Readonly<Record<string, unknown>>)
      : {};
  // Vars a command reads, and (to a fixpoint) the vars those vars read: `a: '{{vars.b}}'`, `b: 'x-{{goal}}'`.
  const reachedVars = new Set<string>();
  const texts = [...runs];
  const follow = (text: string): void => {
    for (const match of text.matchAll(/\{\{\s*vars\.([A-Za-z_][A-Za-z0-9_]*)/g)) {
      const name = match[1];
      if (name === undefined || reachedVars.has(name)) continue;
      reachedVars.add(name);
      const template = varsBlock[name];
      if (typeof template === 'string') {
        texts.push(template);
        follow(template);
      }
    }
  };
  for (const run of runs) follow(run);
  const reads = (root: string): boolean =>
    texts.some((text) => new RegExp(`\\{\\{\\s*${root}(?![\\w])`).test(text));
  return {
    inputs: rootsOf(texts),
    stage: reads('stage'),
    epic: reads('vars\\.epic'),
    story: reads('vars\\.story'),
  };
}

/** A value bound for a shell command line may only be a plain token: letters, digits and `. _ - / : @ + ,`, and it
 * may not start with `-` (an option). Anything else (`x; rm -rf ~`, `$(cmd)`, a space) would let a run input
 * chain another command (`20` "The exec allowlist": metacharacters that chain to another command are refused for agents; a run input gets the same care). */
export function assertShellSafe(name: string, value: string, workflowId: string): void {
  if (/^[A-Za-z0-9_@+:,./][A-Za-z0-9_@+:,./-]*$/.test(value)) return;
  throw inputRefusal(
    `${name}=${value}`,
    `workflow ${workflowId} puts ${name} into a shell command, so its value may only use letters, digits and . _ - / : @ + , and may not start with "-"`,
  );
}
