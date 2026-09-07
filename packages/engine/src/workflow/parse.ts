/**
 * `parseWorkflow` — YAML syntax, via the `yaml` package's own CST (`02` §2.1's own "source-position
 * retention"), then structural shape, via `schema.ts`'s zod schema. Never throws: every problem, from a
 * genuine YAML syntax error to a missing required field deep in a `fanout` step, becomes a `ParseIssue`
 * in the same returned list — `types.ts`'s own doc comment on `ParseResult` has the fuller reasoning for
 * why this is a discriminated result, not a thrown error.
 *
 * @see specs/02 §2.1
 * @see specs/10 §10.1
 * @see PLAN-M5.md P8
 */
import { LineCounter, parseDocument, type Document, type YAMLError } from 'yaml';
import type { ZodIssue } from 'zod';

import { workflowSchema } from './schema.ts';
import type { ParseIssue, ParseResult } from './types.ts';

/** A YAML CST node (the shape `Document.getIn(path, true)` returns) carries `.range: [number, number,
 * number]` — start offset, end-of-value offset, end-including-trailing-whitespace offset. Narrowed by
 * hand rather than imported from `yaml`'s own `Node` type: the value returned by `getIn` is typed
 * `unknown` (this project parses in `yaml`'s default *strict* mode), and the alternative — importing
 * every concrete node class just to build a type-only union to check `instanceof` against — buys
 * nothing a plain structural check on the one field this function actually reads doesn't already give. */
function hasRange(value: unknown): value is { readonly range: readonly [number, number, number] } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'range' in value &&
    Array.isArray(value.range)
  );
}

/** Resolves `path` (a zod issue's own `.path`, e.g. `['steps', 2, 'agent']`) to a source position in
 * `doc`'s original text, or `undefined` if none is resolvable. Two real reasons a path can fail to
 * resolve, both expected rather than exceptional: `path` names a field that is entirely *missing* from
 * the document (a "required" violation has no source text of its own to point to — only its *parent*
 * does, and this function deliberately does not fall back to the parent, which would attribute the
 * error to the wrong line); or `path` walks through a value that turned out not to be a mapping/sequence
 * at all (a scalar given where an object was expected has no children for a deeper path segment to
 * resolve against). Both cases are `doc.getIn` returning `undefined`, confirmed empirically (an
 * out-of-bounds array index, a negative index, and indexing into a scalar were all tried) never
 * throwing — no `try`/`catch` here, unlike `zodIssueToParseIssue`'s own handling of `YAMLError`'s
 * genuinely-optional `linePos`, which the `yaml` package's own source confirms can really be absent. */
function resolvePosition(
  doc: Document,
  lineCounter: LineCounter,
  path: readonly (string | number)[],
): { readonly line: number; readonly column: number } | undefined {
  const node: unknown = doc.getIn(path, true);
  if (!hasRange(node)) return undefined;
  const { line, col } = lineCounter.linePos(node.range[0]);
  return { line, column: col };
}

/** Exported so the "no `linePos` at all" branch is directly testable: `YAMLError.linePos` is optional
 * by the `yaml` package's own type, and its own source (`errors.js`: `if (error.pos[0] === -1) return`)
 * confirms this is a real, reachable shape, not a hypothetical one — but no YAML text this project's own
 * tests could construct actually triggers it (every syntax error and warning tried always resolves a
 * real position), making the branch otherwise unreachable through this module's real behaviour, the
 * same situation `@forge/vcs`'s and `@forge/telemetry`'s own identically-shaped `errorCode`/
 * `errorMessage` helpers are in. */
export function yamlErrorToParseIssue(error: YAMLError): ParseIssue {
  const pos = error.linePos?.[0];
  return pos === undefined ? { message: error.message } : { message: error.message, line: pos.line, column: pos.col };
}

function zodIssueToParseIssue(doc: Document, lineCounter: LineCounter, issue: ZodIssue): ParseIssue {
  const position = resolvePosition(doc, lineCounter, issue.path);
  const message = `${issue.path.join('.') || '(root)'}: ${issue.message}`;
  return position === undefined ? { message } : { message, ...position };
}

/** Exported so the `RangeError`-recovery branch is directly testable (via a mocked `workflowSchema.
 * safeParse`, since `safeParse` is confirmed an own, spy-able property on the schema instance, not just
 * inherited from a shared prototype): `workflowSchema`'s own recursion (through `fanout`/`parallel`/
 * `sequence`'s `z.lazy` cycle) is confirmed empirically, by calling it directly on a deeply nested plain
 * object, to throw a raw `RangeError` past several hundred levels of nesting — `.safeParse` is named
 * specifically to never throw, but zod cannot catch a `RangeError` raised mid-recursion any more than
 * this function's own callers could. Confirmed separately, and repeatedly, that no *real* YAML text this
 * project's own tests could construct (block- or flow-style, with or without the extra per-node fields a
 * real workflow step schema carries, up to ~1200 nesting levels tried) ever reaches this branch through
 * `parseWorkflow`'s own real entry point: `yaml`'s own composer consistently hits *its own*, lower stack
 * limit first for this specific schema's shape, and reports a clean, positioned issue instead — making
 * this branch unreachable through this module's real behaviour, the same situation `yamlErrorToParseIssue`
 * above is in. Handling it here regardless closes the gap unconditionally rather than resting on that
 * empirical margin holding forever, upholding `parseWorkflow`'s own "never throws" contract either way. */
export function parseValueAgainstSchema(doc: Document, lineCounter: LineCounter, value: unknown): ParseResult {
  let result: ReturnType<typeof workflowSchema.safeParse>;
  try {
    result = workflowSchema.safeParse(value);
  } catch (cause) {
    if (!(cause instanceof RangeError)) throw cause;
    return {
      success: false,
      issues: [{ message: `Workflow document nests too deeply to validate: ${cause.message}` }],
    };
  }
  if (result.success) {
    return { success: true, workflow: result.data };
  }
  return {
    success: false,
    issues: result.error.issues.map((issue) => zodIssueToParseIssue(doc, lineCounter, issue)),
  };
}

export function parseWorkflow(yamlText: string): ParseResult {
  const lineCounter = new LineCounter();
  // `merge: true`: `10` §10.1's own worked example is fairly repetitive across its five `agent`/
  // `fanout` steps, and plain anchors/aliases (`&x`/`*x`) alone let a step be *referenced* but not
  // *templated with overrides* — confirmed empirically that without this option, a `<<: *anchor` merge
  // key is left completely unresolved (surfacing as a literal `"<<"` key in the parsed value), which
  // then fails with a confusing "invalid discriminator" error with no hint the real cause is an
  // unsupported YAML feature, not a malformed workflow.
  const doc = parseDocument(yamlText, { lineCounter, merge: true });

  // Both `errors` and `warnings` are folded into the same failure list: a duplicate top-level key (a
  // YAML *warning*, not an error, by default) silently overwrites data in a way a workflow author would
  // never intend — exactly the ambiguity this piece exists to catch, not wave through as advisory.
  const syntaxIssues = [...doc.errors, ...doc.warnings];
  if (syntaxIssues.length > 0) {
    return { success: false, issues: syntaxIssues.map(yamlErrorToParseIssue) };
  }

  return parseValueAgainstSchema(doc, lineCounter, doc.toJSON());
}
