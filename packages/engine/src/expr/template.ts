/**
 * `resolveTemplate` — `10` §10.1's own worked example (`"forge/integration/{{stageId}}"`,
 * `"{{item.id}}"`) substitution, built on `parseExpression`/`evaluate`. Reused verbatim by fanout
 * expansion (P10) and stub-agent brief resolution (`SPEC-QUESTIONS.md` Q62 part 2, wired in at P15).
 *
 * Unlike `parseWorkflow`/`validateStructure`/`validateWorkflow` (`@forge/engine/workflow`'s own
 * discriminated-result convention, for a design-time validation pass that wants to collect every issue
 * at once), this throws a real `ForgeError`: `resolveTemplate` runs at *execution* time, substituting
 * directly into what becomes a real git branch name, file path, or shell argument downstream — silently
 * producing the literal text `"undefined"`/`"null"`/`"[object Object]"` for an unresolved or non-
 * primitive placeholder result would be a real correctness hazard there, not a design-time issue worth
 * collecting alongside others. `engine ← core` is a real, available edge (unlike `@forge/vcs`/
 * `@forge/telemetry`'s own `VcsError`/`TelemetryError`, `SPEC-QUESTIONS.md` Q62), so this uses the real,
 * registered `ForgeError` codes `CFG-014`/`CFG-015` rather than inventing a local error type this
 * package has no structural need for.
 *
 * Placeholder extraction is a single-pass, hand-written scanner — not the single top-level regex
 * (`/\{\{(.*?)\}\}/g`) an earlier version of this file used — for three real, confirmed problems that
 * regex had, all closed by the same rewrite: (1) it was genuinely quadratic on adversarial input
 * (measured directly: doubling a `'{{'.repeat(n)`-shaped input consistently ~4×'d the run time, textbook
 * O(n²) — plausible from a corrupted template or KB content interpolated into a brief, on what is
 * documented above to be a live run's own critical path); (2) a placeholder missing its closing `}}` was
 * silently left as literal, unchanged text (`.replace` simply never matches when there is nothing to
 * match) — exactly the "silent literal text ships downstream" hazard this whole function exists to
 * prevent, for what is probably the single most likely authoring typo for this feature; (3) a `}}`
 * appearing inside a placeholder's own string literal (`{{"a}}b" == "a}}b"}}`, a perfectly valid,
 * sandboxed expression) truncated the regex's own non-greedy capture at the wrong `}}`, misreporting a
 * valid expression as a syntax error. The scanner below tracks quote state exactly the way `lex.ts`'s own
 * string-literal scanner does, so a `}}` inside a quoted string is never mistaken for the closing
 * delimiter, and an unclosed `{{...` becomes a real `CFG-014`, not silent passthrough.
 *
 * @see specs/10 §10.1
 * @see PLAN-M5.md P9
 */
import { ForgeError } from '@forge/core/errors';

import { evaluate } from './evaluate.ts';
import { parseExpression } from './parse.ts';
import type { ExpressionContext } from './types.ts';

/** Only these three primitive shapes are ever substituted directly — `undefined` (an unresolved path),
 * `null`, and any object or array a `path` expression resolved to would otherwise stringify to
 * `"undefined"`/`"null"`/`"[object Object]"` via a bare `String(value)`, a silent, misleading
 * substitution into what becomes real, executable-or-addressable text downstream. */
function isSubstitutable(value: unknown): value is string | number | boolean {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
}

/** Which quotes the literal text of a template has open at some point: where a substituted value lands decides how it
 * must be escaped. */
export type ShellQuoteContext = 'none' | 'single' | 'double';

/** Optional second argument of `resolveTemplate`. `escapeValue` is applied to every substituted value, with the
 * quote context the placeholder sits in; absent, values are substituted as they are (a branch name, a path, a brief).
 * `compile.ts` passes `shellQuoteValue` for a `command` step's `run`, the only place a substituted value becomes
 * shell text (`PLAN-M13.md` P28). */
export interface ResolveTemplateOptions {
  readonly escapeValue?: (value: string, quoteContext: ShellQuoteContext) => string;
}

/** `value` as one shell word for the quote context it is substituted into, so it can only ever be data: a run input
 * or a story field holding `$(...)`, backticks, `;`, `&&`, a newline, quotes or spaces stays text. Unquoted, a plain
 * token (letters, digits and `_@%+=:,./-`) is left as it is, so every shipped command keeps its exact text; anything
 * else is wrapped in single quotes. Inside single quotes only `'` can end the quote, inside double quotes only
 * `\`, `"`, `$` and a backtick mean anything, so a value substituted into a template that already quotes its
 * placeholder (`'{{x}}'`, `"{{x}}"`) is escaped for that quote rather than wrapped in a second one. Pure. */
export function shellQuoteValue(value: string, quoteContext: ShellQuoteContext): string {
  if (quoteContext === 'single') return value.replaceAll("'", "'\\''");
  if (quoteContext === 'double') return value.replace(/[\\"$`]/g, '\\$&');
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(value)) return value;
  return `'${value.replaceAll("'", "'\\''")}'`;
}

/** Where the literal text of a template has got to, as a POSIX shell reads it. `unsafe` is set (and stays set) by a
 * construct whose contents this scanner does not model: command substitution (`$(`, a backtick), a here-document
 * (`<<`), ANSI-C quoting (`$'`), `${`, or a comment (`#` starting a word). A value substituted after one cannot be
 * shown to be data, so it is refused instead of guessed at (`CFG-015`). */
interface QuoteState {
  quote: ShellQuoteContext;
  escaped: boolean;
  unsafe: boolean;
  /** Inside a `#` comment: nothing in it is shell text, and it ends at the newline (a value substituted here would
   * be swallowed, which is a wrong command, not an injection, so it is refused too). */
  comment: boolean;
  prev: string;
}

/** The state after one more literal character of the template: a backslash escapes the next character outside single
 * quotes, `'` and `"` open and close their quotes. */
function advanceQuoteState(state: QuoteState, char: string): void {
  const previous = state.prev;
  state.prev = char;
  if (state.comment) {
    if (char === '\n') state.comment = false;
    return;
  }
  if (state.escaped) {
    state.escaped = false;
    return;
  }
  if (state.quote === 'single') {
    if (char === "'") state.quote = 'none';
    return;
  }
  if (char === '`' || (previous === '$' && (char === '(' || char === '{'))) state.unsafe = true;
  if (char === '\\') {
    state.escaped = true;
    return;
  }
  if (state.quote === 'double') {
    if (char === '"') state.quote = 'none';
    return;
  }
  if (char === '<' && previous === '<') state.unsafe = true;
  if (char === '#' && (previous === '' || /[\s;&|(]/.test(previous))) state.comment = true;
  if (char === "'") {
    if (previous === '$') state.unsafe = true;
    state.quote = 'single';
  } else if (char === '"') state.quote = 'double';
}

function resolvePlaceholder(
  template: string,
  placeholder: string,
  context: ExpressionContext,
  escape: ((value: string) => string) | undefined,
): string {
  const parsed = parseExpression(placeholder);
  if (!parsed.success) {
    throw new ForgeError('CFG-014', { template, placeholder, parseError: parsed.error.message });
  }
  const value = evaluate(parsed.expr, context);
  if (!isSubstitutable(value)) {
    throw new ForgeError('CFG-015', { template, placeholder });
  }
  const text = String(value);
  // A NUL cannot be part of a shell word: the word would silently end there.
  if (escape !== undefined && text.includes('\0')) {
    throw new ForgeError('CFG-015', { template, placeholder });
  }
  return escape === undefined ? text : escape(text);
}

export function resolveTemplate(
  template: string,
  context: ExpressionContext,
  options: ResolveTemplateOptions = {},
): string {
  let result = '';
  let i = 0;
  const quoteState: QuoteState = {
    quote: 'none',
    escaped: false,
    unsafe: false,
    comment: false,
    prev: '',
  };

  while (i < template.length) {
    const char = template[i];
    // A noUncheckedIndexedAccess artifact, not a real runtime possibility: the enclosing `while` guard
    // already proves `i < template.length` here, the same "runtime guard over cast" choice `lex.ts`'s
    // own top-of-loop check documents for the identical shape.
    if (char === undefined) break;
    if (char === '{' && template[i + 1] === '{') {
      i += 2;
      let inner = '';
      let quote: string | undefined;
      let closed = false;
      while (i < template.length) {
        const next = template[i];
        // Same noUncheckedIndexedAccess artifact as the outer loop's own top-of-loop check above: the
        // enclosing `while` guard already proves `i < template.length` here.
        if (next === undefined) break;
        if (quote !== undefined) {
          inner += next;
          if (next === quote) quote = undefined;
          i += 1;
          continue;
        }
        if (next === '"' || next === "'") {
          quote = next;
          inner += next;
          i += 1;
          continue;
        }
        if (next === '}' && template[i + 1] === '}') {
          i += 2;
          closed = true;
          break;
        }
        inner += next;
        i += 1;
      }
      const placeholder = inner.trim();
      if (!closed) {
        throw new ForgeError('CFG-014', {
          template,
          placeholder,
          parseError: 'Missing closing "}}".',
        });
      }
      const escapeValue = options.escapeValue;
      // After `$(`, a backtick, `<<`, `$'`, `${`, inside a comment, right after a literal backslash (it would consume
      // the first character the quoting adds) or a literal `$`, a value cannot be shown to be data (`QuoteState`).
      if (
        escapeValue !== undefined &&
        (quoteState.unsafe || quoteState.comment || quoteState.escaped || quoteState.prev === '$')
      ) {
        throw new ForgeError('CFG-015', { template, placeholder });
      }
      result += resolvePlaceholder(
        template,
        placeholder,
        context,
        escapeValue === undefined ? undefined : (text) => escapeValue(text, quoteState.quote),
      );
      quoteState.prev = 'x'; // a substituted value is data, whatever it ends with
      continue;
    }
    result += char;
    if (options.escapeValue !== undefined) advanceQuoteState(quoteState, char);
    i += 1;
  }

  return result;
}
