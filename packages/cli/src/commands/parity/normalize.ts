/**
 * The seven declarative normalisation rules (`13` F-TEST-9) plus the erase-everything guard, applied
 * to one text target (a stream, or a declared output file's text content) in the order a declaration
 * lists them — never a fixed canonical order. No code from a declaration runs: every rule below is a
 * pure, bounded text transform.
 *
 * `ignore-json-pointers` gets no definition beyond its name anywhere this piece's reading order
 * covers (`specs/13-frameworks-testing-and-debugging.md` F-TEST-9's own rule list, `process/plans/
 * PLAN-M16.md` P4's Mandate, `process/SPEC-QUESTIONS.md` Q294 Decision 4 and 7): the obvious reading
 * this module implements is RFC 6901 pointer resolution plus RFC 6902 "remove" semantics (delete an
 * object member, splice an array element), including the special case of the ROOT pointer `""`
 * erasing the whole value, which this module routes into the identical erase-everything guard a
 * `replace` rule or `strip-ansi` would trip — see `removeJsonPointer`'s own doc comment. A pointer
 * that does not resolve against a given observation (the field it names happens to be absent on this
 * side) is a silent no-op rather than a thrown error, so a declaration excusing a field that is not
 * always present does not become its own point of failure — this piece's own DECISION, reported
 * alongside the search above that found nothing more.
 *
 * @see specs/13-frameworks-testing-and-debugging.md F-TEST-9
 * @see process/plans/PLAN-M16.md P4
 */
import type { CanonicalValue } from './canonical-json.ts';
import { toCanonicalJson } from './canonical-json.ts';
import type { NormalizeRule, ProcessStream } from './declaration-types.ts';

/** `line-endings`: every CRLF, and every LONE CR (one not immediately followed by LF), becomes LF.
 *
 * Two passes, deliberately, not one `/\r/g` replace: collapsing CRLF to LF FIRST means every `\r`
 * still present afterward is, by definition, not followed by `\n` (the only CRLF pairs there were are
 * already gone), so the second pass's blanket `\r` -> `\n` is exactly "every lone CR" with no
 * double-counting. A single-pass `text.replace(/\r/g, '\n')` would instead turn one CRLF into TWO
 * line feeds (`\r` -> `\n`, leaving the original `\n` right after it), which is the exact bug the
 * piece brief calls out by name.
 */
export function applyLineEndings(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

/**
 * `strip-ansi`: removes every CSI escape sequence — ESC `[`, zero or more parameter bytes (0x30-0x3F),
 * zero or more intermediate bytes (0x20-0x2F), then one final byte — narrowed, as of a round-4
 * finding, to an explicit allowlist of the realistic, commonly-emitted final bytes, rather than the
 * full theoretical ECMA-48 final-byte range (0x40-0x7E, which is the entire Latin alphabet plus a few
 * punctuation marks).
 *
 * **Why narrowed: the full range silently erased a real, distinguishing byte on its own, with no
 * dangerous rule combination needed at all.** Two critics independently confirmed, directly against
 * this function with the full `[@-~]` range: `applyStripAnsi('status:\x1bAok'.replace('A','[A'))`
 * (written out, `'status:' + ESC + '[Aok'`) and the identical string with `'Z'` in place of `'A'` BOTH
 * returned `"status:ok"` — a genuine `'A'` vs `'Z'` immediately after a literal `ESC[` is erased
 * either way, because the old range treated ANY byte in 0x40-0x7E as a valid final byte, `'A'` and
 * `'Z'` both included. The erasure also scaled arbitrarily through the unbounded parameter-byte run:
 * `ESC[` + `'1'.repeat(500)` + `'Xtail'`, and the same with `'9'.repeat(3)`, both collapsed to
 * `'tail'`. This is realistic, not contrived: it is exactly what a buggy ANSI emitter produces
 * (concatenating `ESC[<n>` with following text and forgetting the terminator), or what shows up
 * whenever a raw ESC byte lands in content for any other reason. Neither the erase-everything guard
 * (the result here is non-empty) nor `replace-lint.ts`'s `CFG-512` restriction (which fires only at
 * two-or-more CO-SCOPED content-discarding rules; this needs only one occurrence of `strip-ansi`
 * alone, and `strip-ansi` is not even in that restriction's content-discarding set) catches this.
 *
 * **The fix: an explicit allowlist of final bytes, not the full theoretical range.** `m` (SGR —
 * colour/style, the dominant real-world case), `K` (erase in line — spinners/progress bars), `J`
 * (erase in display), `H` and `f` (cursor position), `A`/`B`/`C`/`D` (cursor movement). A final byte
 * outside this set is no longer recognised as CSI at all, and the whole `ESC[...` run — the ESC byte
 * included — is left as literal text, so the real distinguishing byte survives rather than being
 * silently consumed as part of an unrecognised "sequence." Re-run against both repros above: the
 * `'A'` case still strips (a real, allowed cursor-movement code), but the `'Z'` case no longer does
 * (`'Z'` is outside the allowlist), so the two inputs now produce DIFFERENT output, as they should;
 * the long-parameter-run case is untouched entirely, since neither `'X'` nor any digit is in the
 * allowlist, so no valid final byte exists anywhere in that run for the engine to find.
 *
 * **Narrowed, not eliminated — the residual surface is named, not hidden.** A real, ALLOWED CSI code
 * (`m`/`K`/`J`/`H`/`f`/`A`/`B`/`C`/`D`) can still coincide with literal content: if a declaration's
 * own observation happens to contain, say, a literal `'K'` immediately after a literal `ESC[<params>`
 * run at the same relative position on both the reference and the candidate side, that `'K'` is
 * still consumed as the (coincidentally real) final byte of a recognised CSI sequence and erased, exactly as any
 * genuine erase-in-line code would be. This is narrower than the prior gap by roughly 75 characters
 * (9 allowed finals vs. the full 0x40-0x7E range), not a proof the gap is closed to zero — recorded
 * here honestly rather than claimed as a complete fix.
 *
 * Built via `new RegExp` from a template that interpolates the ESC byte as a variable, rather than a
 * `/\x1b.../` regex literal with the control character written directly into the pattern: ESLint's
 * `no-control-regex` flags the latter (a raw control byte sitting in a regex literal is error-prone to
 * read and edit), and cannot see through the interpolation to flag this form.
 */
const ESCAPE = '\x1b';
/** The explicit final-byte allowlist — see {@link applyStripAnsi}'s own doc comment for the full
 * account of why this replaced the theoretical `[@-~]` range. */
const CSI_FINAL_BYTE_ALLOWLIST = 'mKJHfABCD';
const CSI_SEQUENCE = new RegExp(`${ESCAPE}\\[[0-?]*[ -/]*[${CSI_FINAL_BYTE_ALLOWLIST}]`, 'g');

export function applyStripAnsi(text: string): string {
  return text.replace(CSI_SEQUENCE, '');
}

/**
 * `trim-trailing-whitespace`: removes the spaces and tabs at the END of each line only. A line's
 * leading or interior whitespace is untouched.
 *
 * The lookahead (rather than splitting into lines first) makes this independent of which line-ending
 * style is present, which matters because `trim-trailing-whitespace` may run before OR after
 * `line-endings` depending on the declaration's own order: it finds a run of spaces/tabs immediately
 * followed by CRLF, a lone CR, LF, or the end of the text, and removes exactly that run, leaving the
 * terminator (if any) untouched.
 */
const TRAILING_WHITESPACE = /[ \t]+(?=\r\n|\r|\n|$)/g;

export function applyTrimTrailingWhitespace(text: string): string {
  return text.replace(TRAILING_WHITESPACE, '');
}

/**
 * `sort-lines`: orders lines by UTF-16 code unit — `Array.prototype.sort`'s own default comparator,
 * which is exactly that order and nothing locale-aware, so this needs no comparator of its own.
 *
 * Splits on LF only, deliberately never on a lone CR: whether a lone CR is itself a line boundary is
 * precisely what the `line-endings` rule decides, and `sort-lines` runs in the declaration's own
 * order relative to it, so splitting on CR here would silently pre-empt that ordering decision. A
 * trailing LF (common for command output) is preserved rather than sorted as its own empty final
 * "line": the text is split on its OWN trailing terminator first, the remaining body's lines are
 * sorted, and the terminator (if the input had one) is reattached — so `"b\na\n"` sorts to `"a\nb\n"`,
 * never `"\na\nb"` (treating the trailing terminator as an empty line that sorts first).
 */
export function applySortLines(text: string): string {
  if (text === '') return text;
  const hasTrailingNewline = text.endsWith('\n');
  const body = hasTrailingNewline ? text.slice(0, -1) : text;
  const lines = body === '' ? [] : body.split('\n');
  const sorted = [...lines].sort();
  return sorted.join('\n') + (hasTrailingNewline ? '\n' : '');
}

/** Why a declared rule could not be applied to this particular observation — plain data, never
 * thrown: {@link applyNormalizeRulesToText}'s caller decides what that means for the case's verdict
 * (`compare.ts`'s own job, since only it knows which surface and case this is). */
export interface NormalizeRuleFailure {
  readonly rule: NormalizeRule['rule'];
  readonly detail: string;
}

type TextRuleOutcome =
  { readonly ok: true; readonly text: string } | { readonly ok: false; readonly detail: string };

/**
 * `json-canonical`: parse the text as JSON, sort its keys recursively, re-serialise. An observation
 * that does not parse as JSON is a failure here, never silently passed through as unparsed text —
 * `13` F-TEST-9 is explicit that this is a DIFFERENT failure than an ordinary content `mismatch`,
 * since the declaration asked for JSON handling and did not get it.
 *
 * `detail` is deliberately generic ("does not parse as JSON"), never `JSON.parse`'s own thrown
 * message: V8's own `SyntaxError` text can echo a fragment of the offending input (for example
 * `Unexpected token b in JSON at position 0`), which would leak observed content into a failure
 * reason that a `--json` envelope or a `ParityEvidence` record might carry — exactly what `13`
 * F-TEST-9's information boundary forbids ("never what the text was"). This is a deliberate,
 * disclosed narrowing of `QUALITY-BAR.md` R2's usual "include the observed value" guidance: the
 * information boundary wins here.
 */
export function applyJsonCanonical(text: string): TextRuleOutcome {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    return { ok: false, detail: 'does not parse as JSON' };
  }
  // Sound: a string that `JSON.parse` accepts without throwing can only produce `null`, a boolean, a
  // finite number, a string, an array or a plain object — exactly `CanonicalValue`'s universe. JSON
  // text has no literal for `NaN`/`Infinity`, a function, a symbol or a bigint, so none can appear.
  return { ok: true, text: toCanonicalJson(parsed as CanonicalValue) };
}

const ROOT_REMOVED = Symbol('parity-json-pointer-root-removed');

function unescapePointerToken(token: string): string {
  return token.replace(/~1/g, '/').replace(/~0/g, '~');
}

function isArrayIndexToken(token: string): boolean {
  return /^(0|[1-9]\d*)$/.test(token);
}

/**
 * RFC 6902 "remove", applied at the RFC 6901 pointer `tokens` name, against `value`: deletes an
 * object member or splices an array element, leaving every untouched sibling the same reference (so a
 * caller can tell "nothing changed" from "something changed below" without a deep-equality check). A
 * pointer that does not resolve (the wrong container type, a missing key, an out-of-range index) is a
 * silent no-op, returning `value` unchanged — this module's own DECISION, see the file header.
 */
function removeAtPointer(value: unknown, tokens: readonly string[]): unknown {
  const [head, ...rest] = tokens;
  if (head === undefined) return value; // unreachable from `removeJsonPointer` (root is handled there)
  if (Array.isArray(value)) {
    if (!isArrayIndexToken(head)) return value;
    const index = Number(head);
    if (index >= value.length) return value;
    if (rest.length === 0) {
      const next = value.slice();
      next.splice(index, 1);
      return next;
    }
    const child = removeAtPointer(value[index], rest);
    if (child === value[index]) return value;
    const next = value.slice();
    next[index] = child;
    return next;
  }
  if (typeof value === 'object' && value !== null) {
    // Sound: `Array.isArray(value)` already returned above for an array, and the branch below this
    // one (`return value`) catches every primitive, so by construction `value` here is a non-null,
    // non-array `object` — and every caller of this module-private function only ever passes a value
    // that descends from `JSON.parse`'s own result (`removeJsonPointer`'s one exported entry point,
    // itself only reached from `applyIgnoreJsonPointers` after a successful `JSON.parse`), which can
    // never produce a `Date`, `Map`, `RegExp` or other exotic object RFC 6902 "remove" was not
    // written for — only a plain object, exactly `Record<string, unknown>`.
    const record = value as Readonly<Record<string, unknown>>;
    if (!Object.hasOwn(record, head)) return value;
    if (rest.length === 0) {
      const next = { ...record };
      Reflect.deleteProperty(next, head);
      return next;
    }
    const child = removeAtPointer(record[head], rest);
    if (child === record[head]) return value;
    return { ...record, [head]: child };
  }
  return value; // a scalar has no member `head` could ever name: the pointer does not resolve.
}

/**
 * Removes the value at one RFC 6901 JSON Pointer from `value`. The root pointer (`""`) removes the
 * whole value, represented by the private {@link ROOT_REMOVED} marker so a caller
 * ({@link applyIgnoreJsonPointers}) can route it into the erase-everything guard rather than crash
 * trying to re-serialise "no value at all" as JSON. A pointer that is non-empty but does not begin
 * with `/` is malformed RFC 6901 syntax and, consistent with a pointer that does not resolve, is a
 * silent no-op.
 *
 * @see specs/13-frameworks-testing-and-debugging.md F-TEST-9 (names `ignore-json-pointers` only, see
 * this module's own file header for the reading that fills the gap)
 */
export function removeJsonPointer(value: unknown, pointer: string): unknown {
  if (pointer === '') return ROOT_REMOVED;
  if (!pointer.startsWith('/')) return value;
  const tokens = pointer.slice(1).split('/').map(unescapePointerToken);
  return removeAtPointer(value, tokens);
}

/** Whether `pointer`'s own LAST segment names an array index — and if so, a key identifying its
 * parent array (every earlier token, as exact RFC 6901-unescaped strings, serialised via
 * `JSON.stringify` so two different token sequences can never collide onto the identical key: JSON's
 * own round-trip guarantee is what makes this safe, not a hand-picked separator character that some
 * real key might happen to contain). `undefined` for a pointer whose last segment names an object
 * member instead, or that does not resolve to an index shape at all. */
function arrayIndexTarget(
  pointer: string,
): { readonly parentKey: string; readonly index: number } | undefined {
  if (pointer === '' || !pointer.startsWith('/')) return undefined;
  const tokens = pointer.slice(1).split('/').map(unescapePointerToken);
  const last = tokens[tokens.length - 1];
  if (last === undefined || !isArrayIndexToken(last)) return undefined;
  return { parentKey: JSON.stringify(tokens.slice(0, -1)), index: Number(last) };
}

/**
 * Reorders `pointers` so that every GROUP of two-or-more pointers sharing the same parent array (via
 * {@link arrayIndexTarget}) is applied in DESCENDING index order among its own members — this
 * module's own round-6 fix for a real mistargeting bug: `removeAtPointer`'s own array removal
 * splices, which shifts every LATER index down by one, so applying `/list/0`, then `/list/1`, then
 * `/list/2` (the natural ascending order a declaration author would write) resolves each later
 * pointer against the ALREADY-SHIFTED array, not the original — `['A','B','C','D','E']` loses `'B'`
 * and `'D'` instead of `'A'`, `'B'` and `'C'`, a SILENT mistargeting (there is no error: the shifted
 * index still resolves to SOME element) that can mask a real regression on an unrelated array slot.
 * Confirmed independently before this fix existed: the three pointers above, applied in that written
 * order, left `['B','D']`; the identical three pointers written in descending order left the correct
 * `['D','E']`. Object-key pointers (name-addressed, never shifted by a sibling's removal) need no
 * reordering and are left in their own original relative position.
 *
 * Deliberately NOT a single stable sort with a "same parent: compare by index; otherwise: keep
 * original order" comparator: when a same-parent group is split by an unrelated pointer in the
 * original list (`[A(parent1,2), B(parent2,0), C(parent1,5)]`), such a comparator is intransitive —
 * it says A before B and B before C by original position, but C before A directly by the within-group
 * rule — which `Array.prototype.sort` does not promise any particular (or even stable) result for.
 * This instead walks the list once; the first time it reaches any not-yet-emitted group, it emits
 * that WHOLE group — wherever its other members sit in the original list — sorted descending, right
 * there, and skips every later occurrence of an already-emitted group. This is a total, well-defined
 * order for any input, with no comparator to get subtly wrong.
 *
 * Exported so `compare.ts`'s own `normalizeLibraryOrThrow` — the other call site that sequentially
 * applies one rule's `pointers` list, directly against `library`'s structured value rather than
 * through parsed JSON text — can apply the identical fix rather than a second copy of this reasoning.
 */
export function reorderPointersForSafeRemoval(pointers: readonly string[]): readonly string[] {
  const targets = pointers.map(arrayIndexTarget);
  const emittedGroups = new Set<string>();
  const result: string[] = [];
  pointers.forEach((pointer, index) => {
    const target = targets[index];
    if (target === undefined) {
      result.push(pointer);
      return;
    }
    if (emittedGroups.has(target.parentKey)) return; // this whole group already emitted
    emittedGroups.add(target.parentKey);
    const group = pointers
      .map((candidate, candidateIndex) => ({ candidate, target: targets[candidateIndex] }))
      .filter(
        (entry): entry is { candidate: string; target: { parentKey: string; index: number } } =>
          entry.target?.parentKey === target.parentKey,
      )
      .sort((a, b) => b.target.index - a.target.index) // descending: never resolve against a
      // sibling's already-shifted array.
      .map((entry) => entry.candidate);
    result.push(...group);
  });
  return result;
}

/**
 * `ignore-json-pointers`: parses `text` as JSON, removes the value at each named pointer — reordered
 * by {@link reorderPointersForSafeRemoval} first, so same-parent array-index pointers are applied
 * descending regardless of the order the declaration author wrote them in — and re-serialises in
 * canonical form. A pointer removing the whole document is routed to empty text, which the
 * erase-everything guard then judges exactly as it would any other rule. Shares `json-canonical`'s
 * own content-free failure `detail` for the identical information-boundary reason.
 */
export function applyIgnoreJsonPointers(
  text: string,
  pointers: readonly string[],
): TextRuleOutcome {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    return { ok: false, detail: 'does not parse as JSON' };
  }
  let working: unknown = parsed;
  for (const pointer of reorderPointersForSafeRemoval(pointers)) {
    working = working === ROOT_REMOVED ? working : removeJsonPointer(working, pointer);
  }
  if (working === ROOT_REMOVED) return { ok: true, text: '' };
  // Sound by the same reasoning as `applyJsonCanonical`: `working` descends from valid-JSON `parsed`
  // through only RFC 6902 "remove" steps, which can only narrow a value, never introduce one JSON
  // cannot represent.
  return { ok: true, text: toCanonicalJson(working as CanonicalValue) };
}

/**
 * `replace`: every match of `pattern` (compiled with the global flag, so every occurrence is
 * replaced, never just the first) is replaced with `replacement`, taken LITERALLY. `$1`-style
 * backreferences, `$&`, `` $` ``/`$'` and `` $<name> `` are NOT expanded: `13` F-TEST-9 calls the
 * replacement a "literal replacement string", which `String.prototype.replace` does not give for
 * free (it treats a `$`-prefixed token in a STRING replacement specially). Escaping every literal
 * `$` in `replacement` as `$$` first defeats that: `String.prototype.replace` then has nothing left
 * to interpret as a backreference, so exactly the characters the declaration wrote land in the
 * output, whatever they are.
 *
 * **Disclosed: no timeout of its own, by design.** `13` F-TEST-9 says a `replace` is "run under a
 * time limit, exceeding which makes the case `error`" — `replace-lint.ts`'s own static shape lint is
 * this piece's real defence, and that lint's own doc comment names a real, independently-reproduced
 * shape (flat adjacent unbounded groups, no nesting at all) that hangs the regex engine while passing
 * the lint cleanly. This function does not race a wall-clock timer against `String.prototype.replace`
 * itself: a synchronous regex match cannot be interrupted from within the SAME single-threaded
 * process without a worker thread and a hard `terminate()`, which is disproportionate machinery for
 * one rule inside a normalisation pipeline, and inventing a competing, partial timeout here would
 * give a false sense of safety without actually bounding the dangerous case. The real backstop has to
 * be an external, process/wall-clock-level timeout around the whole command that runs a case — see
 * `replace-lint.ts`'s own file header for exactly which future piece that belongs to.
 */
export function applyReplace(text: string, pattern: string, replacement: string): string {
  const literalReplacement = replacement.replace(/\$/g, '$$$$');
  return text.replace(new RegExp(pattern, 'g'), literalReplacement);
}

/** Which text target a `replace` rule's optional `stream`/`file` scope names — the generalisation
 * `applyNormalizeRulesToText` matches a rule's scope against, for whichever surface it is normalising
 * a target for (a `process`/`library` stream, or a `file` surface's declared output path). */
export interface NormalizeTargetScope {
  readonly stream?: ProcessStream;
  readonly file?: string;
}

/** The result of running every rule of a case's `normalize` list, in the declaration's own order,
 * over one text target. */
export type NormalizeTextOutcome =
  | { readonly ok: true; readonly text: string }
  | { readonly ok: false; readonly kind: 'rule-failed'; readonly failure: NormalizeRuleFailure }
  | { readonly ok: false; readonly kind: 'erased'; readonly rule: NormalizeRule['rule'] };

/**
 * Applies `rules` to `text`, in the exact order given (never a fixed canonical order — `13` F-TEST-9),
 * scoping a `replace` rule to `scope` when the rule names a `stream` or `file` and applying every
 * other rule unconditionally. After EVERY rule (not merely at the end) checks the erase-everything
 * guard: a rule that turns a non-empty working value into an empty one is refused on the spot, citing
 * that rule, which is what makes "erases everything but the last byte" and "erases the last byte too"
 * read differently (`13` F-TEST-9's normalisation bullet; `PLAN-M16.md` P4's own worked boundary).
 *
 * @see specs/13-frameworks-testing-and-debugging.md F-TEST-9
 */
export function applyNormalizeRulesToText(
  text: string,
  rules: readonly NormalizeRule[],
  scope: NormalizeTargetScope,
): NormalizeTextOutcome {
  let working = text;
  for (const rule of rules) {
    const before = working;
    switch (rule.rule) {
      case 'line-endings':
        working = applyLineEndings(working);
        break;
      case 'strip-ansi':
        working = applyStripAnsi(working);
        break;
      case 'trim-trailing-whitespace':
        working = applyTrimTrailingWhitespace(working);
        break;
      case 'sort-lines':
        working = applySortLines(working);
        break;
      case 'json-canonical': {
        const outcome = applyJsonCanonical(working);
        if (!outcome.ok) {
          return {
            ok: false,
            kind: 'rule-failed',
            failure: { rule: rule.rule, detail: outcome.detail },
          };
        }
        working = outcome.text;
        break;
      }
      case 'ignore-json-pointers': {
        const outcome = applyIgnoreJsonPointers(working, rule.pointers);
        if (!outcome.ok) {
          return {
            ok: false,
            kind: 'rule-failed',
            failure: { rule: rule.rule, detail: outcome.detail },
          };
        }
        working = outcome.text;
        break;
      }
      case 'replace': {
        const inScope =
          rule.file !== undefined
            ? rule.file === scope.file
            : rule.stream !== undefined
              ? rule.stream === scope.stream
              : true;
        if (inScope) {
          // A `replace` whose MATCH spans the whole non-empty input is refused identically to one
          // whose RESULT is empty (`13` F-TEST-9: "so is a replace whose match is the entire content
          // of a non-empty stream"; Q294 Decision 7: "a replace rule that leaves some text behind
          // while hiding everything that matters would make every candidate match"). A non-empty
          // REPLACEMENT defeats the generic post-rule `working.length === 0` check below, because the
          // result is non-empty even though every byte of `before` was consumed by the match — two
          // genuinely different inputs that both match in full would both become the identical
          // replacement text, which is exactly the erasure this guard exists to catch. Checked by
          // replacing with the EMPTY string first, independent of the declared (possibly non-empty)
          // `replacement`: if that alone would consume `before` down to nothing, the match covered
          // everything, regardless of what actually replaces it.
          if (before.length > 0 && applyReplace(before, rule.pattern, '') === '') {
            return { ok: false, kind: 'erased', rule: rule.rule };
          }
          working = applyReplace(working, rule.pattern, rule.replacement);
        }
        break;
      }
      default: {
        // Compiler-enforced exhaustiveness (round 6's own fix): assigning `rule` to an explicitly
        // `never`-typed binding makes `tsc` itself -- the one check `pnpm typecheck` runs, which this
        // piece's own methodology treats as authoritative -- refuse to compile this file the day an
        // 8th `NormalizeRule` variant is added to `declaration-types.ts` without a matching `case`
        // above. Confirmed directly before this fix: adding an unhandled variant and running the real
        // `tsc` command produced zero errors, because a `switch` with no `default` enforces nothing
        // at the type level on its own; only a separately-run ESLint rule
        // (`@typescript-eslint/switch-exhaustiveness-check`, itself per-line-suppressible) caught it.
        // Not reachable today — all seven real kinds are handled above — and if it is ever reached
        // despite that (an unsound cast past the type system), this throws rather than silently
        // falling through as a no-op, matching this whole piece's own "refuse outright, never a
        // silent pass" rule for anything unrecognised.
        const unhandledRuleKind: never = rule;
        throw new TypeError(`Unhandled NormalizeRule kind: ${JSON.stringify(unhandledRuleKind)}`);
      }
    }
    if (before.length > 0 && working.length === 0) {
      return { ok: false, kind: 'erased', rule: rule.rule };
    }
  }
  return { ok: true, text: working };
}

/**
 * The address of one observed tree, both as given (the exact path a case's command ran with as its
 * cwd) and resolved (`fs.realpath`) — mirrors `specs/22` M16 P3's own `observe-types.ts` `ObservedRoot`
 * by field name. Defined locally here, rather than imported, because P3 had not landed on this piece's
 * own branch when the root-path rewrite below was added; the shape is deliberately identical so that
 * reconciling the two at cherry-pick time is a type alias, never a rewrite.
 *
 * On the reference side `asGiven` and `real` are always equal (the lane-worktree helper already
 * resolves before constructing the path); only the candidate side can show a real difference (a
 * symlinked project root) — a fact P3's own builder verified by a real test, not assumed.
 */
export interface ObservedRoot {
  readonly asGiven: string;
  readonly real: string;
}

/** The fixed token every observed tree's root path, as given and as resolved, is rewritten to before
 * any declared rule runs (`13` F-TEST-9's Normalisation bullet: "the harness rewrites each observed
 * tree's root path, both as given and as its real path, to a fixed token, so where a tree happens to
 * live is not a behaviour difference"). The spec names no specific token text; this piece's own
 * DECISION is a string shaped unlike anything a real path or a declaration's own output would produce
 * by accident. */
export const ROOT_PATH_TOKEN = '<PARITY-ROOT>';

/**
 * Rewrites every occurrence of `root.asGiven` and `root.real` in `text` to {@link ROOT_PATH_TOKEN}.
 * Always on, unconditional, and run BEFORE any declared rule (`13` F-TEST-9) — this is not one of the
 * seven declared rules and is never listed in a declaration's own `normalize` array.
 *
 * Replaces the LONGER of the two candidate strings first (when they differ): a shorter path that
 * happens to be a substring of the longer one must not be allowed to partially consume a match that
 * was meant to be made against the full longer path first. Uses `split`/`join` rather than a
 * `RegExp`, deliberately: a real filesystem path routinely contains regex metacharacters (`.`, `(`,
 * `)`, `+`), and escaping every one of them to build a safe pattern is exactly the class of bug a
 * literal string operation has no occasion to introduce.
 *
 * **KNOWN GAP, DISCLOSED, NOT FIXED HERE, and more severe than either of this piece's other two
 * disclosed gaps (the replace-lint's uncaught ReDoS shapes, `replace-lint.ts`'s own header comment;
 * the POSIX-only arg-composing scheme, `compose-args.ts`'s own header comment) because neither of
 * those needs an adversarial declaration shape to trigger — this one fires on an ordinary
 * length-anchored `replace` rule with no malice or unusual shape involved at all.** This function
 * runs unconditionally, before any declared rule, and the two sides' root strings are essentially
 * never the same length (different checkout paths, a symlinked candidate root, different tmp-dir
 * naming). Substituting them for the fixed-length {@link ROOT_PATH_TOKEN} therefore shifts the
 * reference text and the candidate text by two DIFFERENT amounts. A later declared `replace` rule
 * that is anchored to the END of the string (`.{5}$`, `.*(.{N})$`, and similarly for any
 * `json-canonical`/`sort-lines` step whose own output length depends on the root-rewritten text) then
 * cuts at a correspondingly different OFFSET into the real, non-root content on each side — not
 * because the two sides' real content differs by that offset, but because the root substitution
 * upstream of it did not preserve length parity between the two sides.
 *
 * Confirmed live (independently re-verified by calling this function and
 * {@link applyNormalizeRulesToText} directly, not just hand-derived): root `{asGiven: '/r', real:
 * '/r'}` vs. root `{asGiven: '/candidateroot', real: '/candidateroot'}`, raw stdout `/r:XXPASS` vs.
 * `/candidateroot:XXFAIL` — a real, substantive pass-vs-fail difference in the two sides' actual
 * output, nothing to do with where either tree happens to live. This function alone already produces
 * `<PARITY-ROOT>:XXPASS` (20 chars) vs. `<PARITY-ROOT>:XXFAIL` (20 chars) — same length here only by
 * the coincidence of this example's chosen strings, not a general property. A single declared
 * `replace` rule, pattern `.{5}$`, replacement `''` (drop the last five characters), then yields
 * `<PARITY-ROOT>:X` on BOTH sides: identical text, verdict `match`, with the real PASS/FAIL
 * distinction silently erased. No `ignore-json-pointers` pointer, no `sort-lines`, no adversarial
 * declaration shape of any kind is needed — a single ordinary trailing-content-trimming `replace`
 * rule, the kind a declaration author would write for an unrelated reason (dropping a trailing
 * timestamp or PID), is sufficient.
 *
 * Deliberately NOT fixed in this round, or chased further this piece: a real fix needs either (a)
 * full provenance tracking through every subsequent rule so a later rule's cut point could be
 * reported in pre-rewrite coordinates (a materially bigger design than a token substitution), or (b)
 * a root-token strategy that is guaranteed length-invariant across both sides AND immune to
 * interacting with every other length-sensitive rule in the seven (not just `replace`) — neither of
 * which this piece's brief asks for, and either risks reopening the five already-closed rounds on
 * this exact file. Left as an open problem for whichever future piece owns this module's next
 * revision; nothing in this file's or this piece's own wording claims the root-path rewrite is safe
 * to compose with a length-anchored rule, and no test here asserts that combination behaves safely.
 */
export function rewriteRootPaths(text: string, root: ObservedRoot): string {
  const candidates = [root.asGiven, root.real]
    .filter((value): value is string => value !== '')
    .filter((value, index, array) => array.indexOf(value) === index)
    .sort((a, b) => b.length - a.length);
  let working = text;
  for (const candidate of candidates) {
    working = working.split(candidate).join(ROOT_PATH_TOKEN);
  }
  return working;
}
