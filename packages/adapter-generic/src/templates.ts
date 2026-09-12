/**
 * Template resolution shared by `invoke.args`/`invoke.when` (`07` §7.5's own bare `{{name}}` template
 * vocabulary, resolved against a `SessionRequest`) and `events.map[].emit` (a separate, dot-prefixed
 * `{{.field}}` vocabulary, resolved against one matched raw NDJSON line) — two different namespaces the
 * worked example itself distinguishes by the leading dot, never mixed here.
 *
 * @see specs/07 §7.5
 * @see PLAN-M11.md P7
 */
import type { SessionRequest } from '@forge/adapter-kit';

/** `07` §7.5's own worked example: `{{promptFile}}`, `{{cwd}}`, `{{model}}`, `{{limits.maxTurns}}`, and
 * `result.finalTextFrom: file:{{outFile}}`'s own `{{outFile}}`. Extended, generically, to the whole of
 * `SessionRequest`'s own scalar-ish fields a config author might reasonably want to reference — not just
 * the four the worked example happens to use in `invoke.args`. `tools.exec` is deliberately left out of
 * this plain-value tree (it is `readonly string[] | false`, not a template-friendly scalar) — an author
 * wanting to react to it uses `when` truthiness against `tools.write`/`tools.read`/`tools.network`
 * instead, exactly as the worked example itself only ever branches on `tools.write`.
 *
 * `outFile` is `GenericAdapter`'s own reserved per-session scratch path (mirroring `promptFile`'s
 * identical origin — see `adapter.ts`'s `startSession`), not a real `SessionRequest` field — folded into
 * this same tree (rather than a second, ad hoc substitution mechanism) so `{{outFile}}` resolves
 * identically whether it appears in `invoke.args` (letting a config author tell their own binary where
 * to write it, e.g. `["--out", "{{outFile}}"]`) or in `result.finalTextFrom: file:{{outFile}}` — a real
 * critic finding (round 1): the two used to be handled by two different, inconsistent mechanisms, and
 * `invoke.args` had no way to reference `{{outFile}}` at all, making the third `finalTextFrom` form
 * non-functional for any config that needed to tell its own binary where to write. */
export interface InvokeTemplateVars {
  readonly promptFile: string | undefined;
  readonly outFile: string | undefined;
  readonly cwd: string;
  readonly model: string;
  readonly permissionMode: string;
  readonly tools: {
    readonly read: boolean;
    readonly write: boolean;
    readonly network: string;
  };
  readonly limits: {
    readonly maxTurns: number | undefined;
    readonly wallClockMs: number | undefined;
    readonly maxCostUsd: number | undefined;
  };
}

export function buildInvokeTemplateVars(
  req: SessionRequest,
  promptFile: string | undefined,
  outFile: string | undefined,
): InvokeTemplateVars {
  return {
    promptFile,
    outFile,
    cwd: req.cwd,
    model: req.model,
    permissionMode: req.permissionMode,
    tools: {
      read: req.tools.read,
      write: req.tools.write,
      network: req.tools.network,
    },
    limits: {
      maxTurns: req.limits.maxTurns,
      wallClockMs: req.limits.wallClockMs,
      maxCostUsd: req.limits.maxCostUsd,
    },
  };
}

/** Resolves a dot path (`"limits.maxTurns"`) against a plain nested object tree. `undefined` for any
 * missing/unindexable segment, never a thrown `TypeError` — a config author's own typo in a template or
 * `when.if` expression should degrade to "resolves to nothing," matched consistently by both call sites
 * below, not crash session construction. */
function resolveDotPath(root: unknown, dotPath: string): unknown {
  let current: unknown = root;
  for (const segment of dotPath.split('.')) {
    if (typeof current !== 'object' || current === null) return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

const BARE_TEMPLATE_PATTERN = /\{\{\s*([\w.]+)\s*\}\}/g;

/** Resolves every `{{path}}` token in `template` against `vars` (`InvokeTemplateVars`, treated as a
 * plain object tree) — always string substitution, since every real consumer (`invoke.args`/
 * `invoke.when[].args`) is itself one argv string. A path that resolves to `undefined` substitutes the
 * empty string, matching this project's own "a missing value degrades rather than crashes" convention
 * (`resolveDotPath`'s own doc comment) — an author who references a field that can genuinely be absent
 * (`{{limits.maxTurns}}` when no `maxTurns` limit is set) gets an empty argv token, not a literal
 * `"undefined"` string a real external binary would have to specially recognise. */
/** Stringifies a resolved template value for embedding inside a larger string. `value` is `unknown` --
 * a config author's own dot path could in principle resolve to a nested object (`InvokeTemplateVars`'s
 * own `tools`/`limits` sub-trees, or an arbitrary field of a matched NDJSON line) -- `JSON.stringify`
 * is used for anything that is not already a string/number/boolean/bigint, rather than a bare
 * `String(value)`, which would silently degrade a real object to the useless `"[object Object]"`. */
function stringifyTemplateValue(value: unknown): string {
  if (value === undefined) return '';
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    typeof value === 'bigint'
  ) {
    return String(value);
  }
  try {
    return JSON.stringify(value);
  } catch {
    return '';
  }
}

export function resolveInvokeTemplate(template: string, vars: InvokeTemplateVars): string {
  return template.replace(BARE_TEMPLATE_PATTERN, (_match, path: string) =>
    stringifyTemplateValue(resolveDotPath(vars, path)),
  );
}

/**
 * `07` §7.5's own two worked `when.if` shapes: `"tools.write == false"` (equality against a literal)
 * and `"limits.maxTurns"` (bare truthiness). Both are supported generically: an expression containing
 * `==` splits into a dot path and a literal (parsed as `true`/`false`, a number, or a quoted/bare
 * string); anything else is a bare dot path, true when its resolved value is neither `undefined`,
 * `null`, `false`, `0`, nor `''` — JavaScript's own ordinary truthiness, the least surprising reading
 * for a config author with no access to a richer expression grammar.
 */
export function evaluateWhenCondition(expression: string, vars: InvokeTemplateVars): boolean {
  const equalityIndex = expression.indexOf('==');
  if (equalityIndex === -1) {
    return Boolean(resolveDotPath(vars, expression.trim()));
  }
  const path = expression.slice(0, equalityIndex).trim();
  const literalText = expression.slice(equalityIndex + 2).trim();
  const actual = resolveDotPath(vars, path);
  const literal = parseWhenLiteral(literalText);
  return actual === literal;
}

function parseWhenLiteral(text: string): unknown {
  if (text === 'true') return true;
  if (text === 'false') return false;
  if (text === 'null') return null;
  const asNumber = Number(text);
  if (text !== '' && !Number.isNaN(asNumber)) return asNumber;
  const quoted = /^(['"])(.*)\1$/.exec(text);
  return quoted !== null ? quoted[2] : text;
}

/** `07` §7.5's own `invoke.args`+conditional `when` mechanism, resolved into the final argv this
 * session's own child process is spawned with: every base `args` entry templated, followed by every
 * `when` entry whose `if` evaluates true, each of *its* `args` templated the same way, in declaration
 * order. */
export function buildInvokeArgs(
  config: {
    readonly args: readonly string[];
    readonly when?:
      readonly { readonly if: string; readonly args: readonly string[] }[] | undefined;
  },
  vars: InvokeTemplateVars,
): readonly string[] {
  const resolved = config.args.map((arg) => resolveInvokeTemplate(arg, vars));
  for (const rule of config.when ?? []) {
    if (evaluateWhenCondition(rule.if, vars)) {
      resolved.push(...rule.args.map((arg) => resolveInvokeTemplate(arg, vars)));
    }
  }
  return resolved;
}

/** `events.map[].emit`'s own dot-prefixed vocabulary (`{{.content}}`, `{{.tool}}`, `{{.args}}`):
 * refers to a field of the one matched raw NDJSON line object, never `InvokeTemplateVars`. A template
 * value that is *exactly* one whole-string token (`"{{.args}}"`, nothing else around it) resolves to
 * the raw matched value with its own real type preserved (an object for `tool.call.input`, a number for
 * `usage.inputTokens`, a boolean) — `AdapterEvent`'s own fields are not all strings, and a naive
 * always-stringify implementation would make `usage.inputTokens` a `"3"` string instead of `3`, failing
 * `normalizeAdapterEvent`'s own strict schema. A template value embedded inside a larger string
 * interpolates via `String(...)`, the only sensible behaviour for a partial-string template. A plain,
 * non-template value (a literal `"complete"`, a literal `false`) passes through completely unresolved,
 * for the `emit` fields the worked example itself hardcodes (`reason: "complete"`). */
export function resolveEmitValue(
  value: unknown,
  rawLine: Readonly<Record<string, unknown>>,
): unknown {
  if (typeof value !== 'string') return value;
  const wholeTokenMatch = /^\{\{\s*\.([\w.]+)\s*\}\}$/.exec(value);
  if (wholeTokenMatch !== null) {
    return resolveDotPath(rawLine, wholeTokenMatch[1] ?? '');
  }
  const dotTemplatePattern = /\{\{\s*\.([\w.]+)\s*\}\}/g;
  if (!dotTemplatePattern.test(value)) return value;
  return value.replace(dotTemplatePattern, (_match, path: string) =>
    stringifyTemplateValue(resolveDotPath(rawLine, path)),
  );
}

/** Resolves every field of `emit` (`Record<string, unknown>`) against `rawLine`, via
 * `resolveEmitValue`, producing the raw candidate object `normalizeAdapterEvent` validates next. */
export function resolveEmitTemplate(
  emit: Readonly<Record<string, unknown>>,
  rawLine: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const resolved: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(emit)) {
    resolved[key] = resolveEmitValue(value, rawLine);
  }
  return resolved;
}
