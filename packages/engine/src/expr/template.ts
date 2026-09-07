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

function resolvePlaceholder(template: string, placeholder: string, context: ExpressionContext): string {
  const parsed = parseExpression(placeholder);
  if (!parsed.success) {
    throw new ForgeError('CFG-014', { template, placeholder, parseError: parsed.error.message });
  }
  const value = evaluate(parsed.expr, context);
  if (!isSubstitutable(value)) {
    throw new ForgeError('CFG-015', { template, placeholder });
  }
  return String(value);
}

export function resolveTemplate(template: string, context: ExpressionContext): string {
  let result = '';
  let i = 0;

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
        throw new ForgeError('CFG-014', { template, placeholder, parseError: 'Missing closing "}}".' });
      }
      result += resolvePlaceholder(template, placeholder, context);
      continue;
    }
    result += char;
    i += 1;
  }

  return result;
}
