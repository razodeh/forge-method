/**
 * The catastrophic-backtracking LINT `13` F-TEST-9 asks for on every `replace` rule's pattern —
 * conservative pattern-SHAPE detection, never a timing proof (`PLAN-M16.md` P4's own "discloses"
 * line). `declaration.ts`'s own `readNormalizeRule` already compiles a `replace` pattern with
 * `new RegExp` to catch a syntax error, and says explicitly in its own comment that THIS lint is
 * "`PLAN-M16.md` P4's own job... not this pure loader's" — so this module gives P4 its own
 * declaration-level check, run once per declaration (never per case, since the same pattern text
 * reads the same way on every run), rather than editing P2's already-landed loader against its own
 * stated intent.
 *
 * **What the lint catches, and what it does not.** It flags a parenthesised GROUP that is itself
 * quantified two-or-more-times-with-a-variable-count (`*`, `+`, or `{m,}`/`{m,n}` with `n > m`) and
 * whose own content contains, at any nesting depth, another atom (a group, a character class, a
 * shorthand class such as `\d`/`\w`/`\s`, or a literal/`.`) quantified the identical way — the
 * textbook "nested quantifier" shape (`(a+)+`, `([a-z]+)*`, `(\d*)+`, …) that makes a backtracking
 * engine's worst case exponential. It does NOT verify that the inner and outer quantified sets
 * actually overlap (so it flags some patterns, such as `([a-z]+[0-9]+)+`, that are merely slow rather
 * than exponential), and it does NOT catch overlapping-alternation shapes with no nested quantifier
 * at all (`(a|a)+`) — both disclosed gaps, deliberately on the over-inclusive side of "conservative."
 *
 * **A third catastrophic-backtracking shape this lint cannot see at all, with no nested quantifier
 * anywhere, and no mitigation currently wired for it.** `(a*)(a*)(a*)...(a*)b` (20 flat, ADJACENT —
 * never nested — unbounded groups, then a literal that cannot match) genuinely hangs the regex
 * engine on a short, unremarkable-looking input: independently reproduced on this host (`^(a*){20}b$`
 * expanded to 20 distinct groups, run via `new RegExp(...).test('a'.repeat(33))`) by running it as a
 * detached synchronous call with an external watchdog — the process became fully unresponsive,
 * including its own `setTimeout` callback, which never fired because the single-threaded match never
 * yielded the event loop back; the only way to end it was an external kill, exactly like the
 * `(a+)+` shape this lint DOES catch, just reached by a different route (splitting the run among many
 * adjacent unbounded groups instead of nesting one inside another). Deliberately NOT chased here: a
 * static shape lint that tries to catch every exponential-worst-case regex shape never terminates as
 * a project (this lint's own first disclosed-gaps paragraph already names two more shapes it misses
 * on purpose), and this piece's brief is explicit that the lint is "conservative pattern-shape
 * detection, not a timing proof" — widening it to flat-adjacent quantifiers would still leave
 * N-ary alternation, backreferences and a dozen other known ReDoS families uncaught, for an
 * open-ended cost. This compounds with an already-disclosed, separate gap: nothing in this piece, or
 * in anything that calls it as of this report, wires a wall-clock or process-level timeout around a
 * `replace` rule's actual execution (`normalize.ts`'s own `applyReplace` has no timeout of its own by
 * design — see that module's doc comment) — so a pattern that slips past this lint, by this shape or
 * any other the lint does not cover, has NO layer anywhere today that would stop it once a real
 * `forge parity capture`/`check` run reaches it. The only generally-sound mitigation for the open
 * set of shapes a static lint cannot enumerate is an EXTERNAL wall-clock timeout around the WHOLE
 * command that runs a case (the confined-command runner's own per-case `timeoutMs`, already used for
 * the command itself, is the natural home for it) — which belongs to whichever future piece wires the
 * real `forge parity capture`/`check` call path (P6/P7), not to this lint.
 *
 * **A second, distinct structural lint lives here too** (below `isPathologicalReplacePattern`'s own
 * definitions): {@link assertNoConflictingContentDiscardingRules} refuses a case whose `normalize`
 * list lets two or more CONTENT-DISCARDING rules (`replace`, `sort-lines`,
 * `trim-trailing-whitespace`) apply to the same effective scope — a round-3 finding, after a round-2
 * fix for the single-`replace`-rule whole-match case turned out not to generalise to a CHAIN of
 * rules each individually safe. See that function's own doc comment for the full account and why a
 * conservative structural restriction, not a cleverer detection heuristic, is the fix.
 *
 * @see specs/13-frameworks-testing-and-debugging.md F-TEST-9
 * @see process/plans/PLAN-M16.md P4
 */
import { ForgeError, isForgeError, type ForgeErrorCode } from '@forge/core/errors';

import type { NormalizeRule, ParityDeclaration, SurfaceKind } from './declaration-types.ts';
import { SURFACE_KINDS } from './declaration-types.ts';

/** One atom of a one-level tokenisation of a regex source: a group's own `groupContent` is its raw,
 * un-recursed text between the parens; a character class, an escape, `.`, or a literal has none. */
interface RegexAtom {
  readonly quantifier?: string;
  readonly groupContent?: string;
}

/** Whether `quantifier` can repeat its atom two or more times with a variable count: `*`, `+`, or a
 * `{m,}`/`{m,n}` range with `n > m`. A fixed count (`{3}`), `?` (0-or-1), and "no quantifier" are all
 * excluded — none of them can, by itself, add the extra backtracking choice a NESTED one needs to
 * blow up (`QUALITY-BAR.md`'s own "conservative, not a proof" standard still rules out flagging every
 * quantifier, which would make the lint useless by crying wolf on linear-time patterns). */
function isVariableQuantifier(quantifier: string | undefined): boolean {
  if (quantifier === undefined) return false;
  if (quantifier === '*' || quantifier === '+') return true;
  const range = /^\{(\d+)(,(\d*))?\}$/.exec(quantifier);
  if (range === null) return false;
  const [, min, hasComma, max] = range;
  if (hasComma === undefined) return false; // "{n}": exact, not variable
  return max === '' || Number(max) > Number(min);
}

/** Scans past one `[...]` character class starting at `source[open]` (which must be `[`), honouring
 * `\]` escapes inside, and returns the index just past its closing `]`. Shared between the top-level
 * tokeniser and the group-boundary scanner below, which both have to skip a class without being
 * confused by a `)` or `(` written inside one. */
function skipCharacterClass(source: string, open: number): number {
  let i = open + 1;
  while (i < source.length && source[i] !== ']') {
    i += source[i] === '\\' ? 2 : 1;
  }
  return i + 1;
}

/** Finds the index just past the `)` that matches the `(` at `source[open]`, skipping escapes and
 * character classes along the way so a `)` or `(` written inside either is never mistaken for a real
 * group boundary. Returns `source.length` for an unterminated group, which a pattern that already
 * compiled via `new RegExp` (every caller's own precondition) never produces. */
function findGroupEnd(source: string, open: number): number {
  let depth = 1;
  let i = open + 1;
  while (i < source.length && depth > 0) {
    const char = source[i];
    if (char === '\\') {
      i += 2;
      continue;
    }
    if (char === '[') {
      i = skipCharacterClass(source, i);
      continue;
    }
    if (char === '(') depth += 1;
    else if (char === ')') depth -= 1;
    i += 1;
  }
  return i;
}

/**
 * Tokenises `source` ONE level deep: a run of atoms, each either a parenthesised group (its content
 * carried un-recursed, for a caller to descend into only if it needs to), a character class, an
 * escape sequence, `.`, or an ordinary literal character — each paired with the quantifier
 * immediately following it, if any. A lazy marker (`a+?`) is consumed and discarded: it changes which
 * match a backtracking engine prefers, never how many ways it can split the repeated text, which is
 * all this shape lint cares about.
 */
function tokenizeOneLevel(source: string): readonly RegexAtom[] {
  const atoms: RegexAtom[] = [];
  let i = 0;
  while (i < source.length) {
    const char = source[i];
    let groupContent: string | undefined;
    if (char === '\\') {
      i += 2;
    } else if (char === '[') {
      i = skipCharacterClass(source, i);
    } else if (char === '(') {
      const end = findGroupEnd(source, i);
      groupContent = source.slice(i + 1, end - 1);
      i = end;
    } else {
      i += 1;
    }
    let quantifier: string | undefined;
    const rest = source.slice(i);
    const braceQuantifier = /^\{\d+(,\d*)?\}/.exec(rest);
    if (braceQuantifier !== null) {
      quantifier = braceQuantifier[0];
      i += quantifier.length;
    } else if (rest.startsWith('*') || rest.startsWith('+') || rest.startsWith('?')) {
      quantifier = rest.charAt(0);
      i += 1;
    }
    if (quantifier !== undefined && source.charAt(i) === '?') i += 1; // lazy marker, discarded
    atoms.push({
      ...(quantifier === undefined ? {} : { quantifier }),
      ...(groupContent === undefined ? {} : { groupContent }),
    });
  }
  return atoms;
}

/**
 * How many parenthesis levels {@link isPathologicalReplacePattern} and
 * {@link hasVariableQuantifiedAtomAnywhere} will descend before giving up and refusing the pattern
 * outright, rather than keep recursing. A function whose entire job is protecting the harness from a
 * dangerous declaration must never itself crash on one: an adversarial (or merely careless) pattern
 * nested thousands of parentheses deep — `'('.repeat(20000) + 'a' + ')'.repeat(20000)`, for one —
 * recurses once per level and exhausts the call stack with a bare, uncaught `RangeError` long before
 * any real answer is possible. 50 is far beyond any nesting depth a reviewed, hand-written `replace`
 * pattern plausibly needs (the normal shapes this lint exists for, `(a+)+` and its kin, nest 1-3
 * levels deep), so a pattern that reaches the cap is already far outside what review could have
 * meaningfully checked, and refusing it is the safe default — never a crash, and never a silent pass
 * on a pattern no one actually read closely enough to trust.
 */
const MAX_NESTING_DEPTH = 50;

/** Whether `source` contains a variably-quantified atom anywhere — at this level, or nested inside
 * any group at any depth. Used to ask "does this GROUP's own content hide a repeatable unit" without
 * caring whether that unit is wrapped in further groups of its own. `depth` is this call's own
 * nesting level, bounded by {@link MAX_NESTING_DEPTH} — see that constant's own doc comment. */
function hasVariableQuantifiedAtomAnywhere(source: string, depth = 0): boolean {
  if (depth > MAX_NESTING_DEPTH) return true;
  return tokenizeOneLevel(source).some(
    (atom) =>
      isVariableQuantifier(atom.quantifier) ||
      (atom.groupContent !== undefined &&
        hasVariableQuantifiedAtomAnywhere(atom.groupContent, depth + 1)),
  );
}

/**
 * The lint itself: true when `pattern` contains a variably-quantified GROUP whose own content
 * contains another variably-quantified atom at any depth — see this module's own file header for
 * exactly which shapes that is, and is not.
 *
 * Checked at EVERY nesting depth, not only the pattern's own top level: the vulnerable shape is a
 * quantified group whose content hides another quantified atom, wherever in the pattern that pair
 * sits — `x(y(a+)+)z` is exactly as vulnerable as `(a+)+` alone, even though the pair here is wrapped
 * by an unquantified outer group (and a literal `x`/`z`) that is not itself part of the problem.
 *
 * `depth` (this call's own nesting level) is bounded by {@link MAX_NESTING_DEPTH}, so a pathologically
 * deep pattern is refused outright rather than recursed into until the stack overflows — see that
 * constant's own doc comment. The optional parameter keeps the exported signature backward
 * compatible: every real caller passes only `pattern`, and `depth` defaults to the top level.
 */
export function isPathologicalReplacePattern(pattern: string, depth = 0): boolean {
  if (depth > MAX_NESTING_DEPTH) return true;
  return tokenizeOneLevel(pattern).some((atom) => {
    if (atom.groupContent === undefined) return false;
    if (
      isVariableQuantifier(atom.quantifier) &&
      hasVariableQuantifiedAtomAnywhere(atom.groupContent, depth + 1)
    ) {
      return true;
    }
    // This group itself is not the outer half of a pathological pair (either it is not quantified,
    // or its content has no quantified atom immediately inside it) — but the pair this lint looks
    // for might still be buried deeper inside its content, under further wrapping this group's own
    // quantifier (or lack of one) has no bearing on.
    return isPathologicalReplacePattern(atom.groupContent, depth + 1);
  });
}

/** One `replace` rule's pattern, located within a declaration — the unit
 * {@link lintParityDeclarationReplacePatterns} reports a problem against. `key` follows
 * `declaration.ts`'s own dotted-path convention (`surfaces.<kind>.cases[<i>].normalize[<j>].pattern`)
 * so a problem reads the identical shape a structural loader problem does. */
export interface ReplacePatternLocation {
  readonly key: string;
  readonly pattern: string;
}

/** Every `replace` rule's pattern in `declaration`, in a fixed, sorted order (surface kind, then case
 * index, then rule index — `QUALITY-BAR.md` R10: never dependent on object-key enumeration order). */
export function collectReplacePatterns(
  declaration: ParityDeclaration,
): readonly ReplacePatternLocation[] {
  const locations: ReplacePatternLocation[] = [];
  for (const kind of SURFACE_KINDS) {
    const surface = declaration.surfaces[kind];
    if (surface === undefined) continue;
    surface.cases.forEach((parityCase, caseIndex) => {
      (parityCase.normalize ?? []).forEach((rule, ruleIndex) => {
        if (rule.rule !== 'replace') return;
        locations.push({
          key: `surfaces.${kind}.cases[${String(caseIndex)}].normalize[${String(ruleIndex)}].pattern`,
          pattern: rule.pattern,
        });
      });
    });
  }
  return locations;
}

/** One `replace` pattern the lint refuses — plain data, never thrown (mirrors `declaration.ts`'s own
 * "a problem is data, not a throw" discipline). */
export interface ReplaceLintProblem {
  readonly key: string;
  readonly pattern: string;
  readonly detail: string;
}

/**
 * Lints every `replace` rule's pattern in `declaration`. Never throws; see
 * {@link assertParityDeclarationPatternsSafe} for a throwing wrapper over the first problem.
 */
export function lintParityDeclarationReplacePatterns(
  declaration: ParityDeclaration,
): readonly ReplaceLintProblem[] {
  return collectReplacePatterns(declaration)
    .filter((location) => isPathologicalReplacePattern(location.pattern))
    .map((location) => ({
      key: location.key,
      pattern: location.pattern,
      detail:
        'has a nested-quantifier shape that can backtrack catastrophically (a quantified group ' +
        'containing another quantified atom)',
    }));
}

/**
 * Throws `CFG-511` naming the first pathological `replace` pattern {@link
 * lintParityDeclarationReplacePatterns} finds, or returns normally when there is none. Intended to
 * run once a declaration has loaded structurally (mirroring a load-time check in spirit, without
 * editing `declaration.ts` against its own documented decision to leave this lint to P4 — see this
 * module's own file header).
 */
export function assertParityDeclarationPatternsSafe(declaration: ParityDeclaration): void {
  const problems = lintParityDeclarationReplacePatterns(declaration);
  const first = problems[0];
  if (first === undefined) return;
  throw new ForgeError('CFG-511', {
    file: `.forge/parity/${declaration.name}.parity.yaml`,
    key: first.key,
    detail: `pattern ${JSON.stringify(first.pattern)} ${first.detail}`,
    more: problems.length - 1,
  });
}

/**
 * The three rules a chain of which can compound to erase genuinely different observations down to
 * the identical bytes, even though each one individually leaves the erase-everything guard satisfied
 * (round 2 closed the single-`replace`-rule whole-match case; it does not generalise to a CHAIN).
 *
 * Two independently reproduced repros forced this, and a third approach — generalising round 2's own
 * "replace with the empty string and check if that alone would be empty" technique across the whole
 * pipeline — was checked and found NOT to work: zeroing a rule's replacement changes the TEXT LENGTH
 * going into the next rule, which can change what a length-anchored pattern after it matches (repro A
 * below depends on exactly this: a real, non-empty replacement's own length re-inflates the text in a
 * way a zeroed one does not, so "replace with empty" is not a safe lower bound once a second rule's
 * own match depends on the first rule's real output length). There is no simple patch; the fix below
 * is a conservative, declaration-shape restriction instead, decidable with no data at all.
 *
 * - **Repro A** (the primitive, `normalize.ts`'s `applyNormalizeRulesToText` directly): rules
 *   `[{rule:'replace', pattern:'^.{4}', replacement:'PPPP'}, {rule:'replace', pattern:'.{4}$',
 *   replacement:'QQQQ'}]`. `'hello'`, `'world'` and `'zebra'` — three different 5-character strings —
 *   ALL become `'PQQQQ'`. Neither rule alone trips anything: rule 1 leaves `'o'`/`'d'`/`'a'`
 *   (1 byte) after replacing the first 4 characters with `'PPPP'`; rule 2 then leaves only the single
 *   leading `'P'` after replacing the last 4 characters of THAT result with `'QQQQ'` — each
 *   individually at the explicitly-accepted "erases everything but one byte" boundary, but chained,
 *   zero bytes of real input survive.
 * - **Repro B** (through `decideCaseVerdict` itself): rules `[{rule:'sort-lines'},
 *   {rule:'replace', pattern:'\\n.*$', replacement:'X'}]` on `"ERROR: disk full\nAAA_STATUS_OK"` vs
 *   `"ERROR: timeout!!\nAAA_STATUS_OK"` — genuinely different diagnostic lines — both reduce to
 *   `"AAA_STATUS_OKX"`. `sort-lines` makes the POSITION of the variable line content-independent
 *   (`"AAA_STATUS_OK"` always sorts first, alphabetically, ahead of any `"ERROR: ..."` line); the
 *   `replace` rule then discards "everything from the first newline on", which after sorting is
 *   always the variable line, whatever it said.
 * - **Repro C** (round 6, the identical shape by JSON key name instead of line content):
 *   `[{rule:'json-canonical'}, {rule:'replace', pattern:',"[^"]*":"[^"]*"\\}$', replacement:'}'}]` on
 *   `{"errorMsg":"disk full","aaaStatusOk":"OK"}` vs `{"errorMsg":"timeout!!!","aaaStatusOk":"OK"}` —
 *   genuinely different error messages — both reduce to `{"aaaStatusOk":"OK"}`. `json-canonical`
 *   sorts object keys alphabetically, which makes the POSITION (here, "which key is last") of the
 *   variable field name-independent rather than line-independent: `"errorMsg"` always sorts after
 *   `"aaaStatusOk"`, so it is always the key the `replace` rule's trailing-pair pattern strips,
 *   whatever its value said. The identical "a canonicalising/reordering rule turns `replace`'s own
 *   content-dependent match into a POSITION the input's real content no longer controls" mechanism
 *   as Repro B, with `json-canonical`'s key sort standing in for `sort-lines`'s line sort.
 *
 * All three were independently reproduced again here (not merely taken on report) before this
 * function reached its current form, by hand-simulating `normalize.ts`'s own then-current guard
 * logic (and, for Repro C, a plain recursive canonical-JSON serialiser) against the exact rule lists
 * and inputs above.
 *
 * **The restriction.** `line-endings` and `strip-ansi` are "structural": each discards content only
 * by a fixed, structurally-delimited criterion (a CRLF sequence, a real — now narrowly allow-listed,
 * see `applyStripAnsi`'s own doc comment — ANSI escape) that never depends on where in the input, or
 * under what name, the matched content sits relative to anything else being compared. They may be
 * freely combined with each other and with ONE rule from the second class.
 *
 * This is NOT an unconditional property of each rule, only of the set as narrowed — and ROUND 6
 * widened this set for exactly that reason, moving `json-canonical` and `ignore-json-pointers` INTO
 * the content-discarding bucket below (they were originally classified "structural" here; Repro C is
 * why that was wrong). A round-4 finding separately showed `strip-ansi`'s OWN prior, unbounded
 * final-byte range was itself an opaque, content-arbitrary match in disguise (`[@-~]`, the full
 * theoretical ECMA-48 range, let ANY byte in that range stand in for a real CSI final byte, so a
 * literal `'Z'` immediately after `ESC[` was erased exactly as a real code would be) — a claim this
 * comment, in an earlier revision, incorrectly stated as always true of every rule in this bucket.
 * `strip-ansi` is safe to call "structural" only because `applyStripAnsi` itself narrows its
 * final-byte range to a small, explicit allowlist of the realistic, commonly-emitted codes
 * (`normalize.ts`'s own doc comment on that function has the full
 * account) — a property of THAT function's own current implementation, not a property this
 * classification can assume holds for an arbitrary future rule placed in this bucket without the
 * identical scrutiny.
 *
 * `replace`, `sort-lines`, `trim-trailing-whitespace`, `json-canonical` and `ignore-json-pointers`
 * are "content-discarding": each can make a LATER rule's own effective target depend on the input's
 * actual content, or its own canonical form, in a way that compounds (`replace`'s own match extent
 * is content-dependent; `sort-lines` makes line position content-dependent; `json-canonical` makes
 * KEY position content-dependent-on-name instead — Repro C above — which is the identical hazard by
 * a different route; `ignore-json-pointers` removes a declaration-author-NAMED path, which sounds
 * safe in isolation, but a `replace` applied after it still sees whatever STRUCTURE survives the
 * removal, so pairing it with a position- or shape-sensitive rule is not provably safer than
 * `sort-lines` was, and this piece is no longer willing to assume "names a fixed path" is enough on
 * its own after Repro C showed "sorts by a fixed criterion" was not; `trim-trailing-whitespace`
 * removes a content-dependent amount of trailing whitespace, which could, in principle, shift a
 * later length-anchored rule the same way repro A's own length mismatch does — not proven
 * exploitable on its own, included anyway since restricting it costs little). Two or more
 * content-discarding rules are refused when they would ever apply to the SAME effective scope: an
 * unscoped rule's scope is "every target", so two unscoped content-discarding rules always collide;
 * an explicitly `stream`/`file`-scoped one collides only with another rule naming the identical
 * scope, OR with an unscoped one (which reaches it too).
 *
 * **A known, deliberate, accepted conservative cost: `sort-lines` + `trim-trailing-whitespace`
 * together is refused too, even though a round-4 critic proved this SPECIFIC pair is harmless.**
 * `trim-trailing-whitespace` only ever removes a per-line trailing whitespace run; `sort-lines` only
 * ever permutes whole lines; composing them in either order can never discard non-whitespace content
 * or lose/merge a line, so this one pair could, in principle, be carved out safely. It is NOT carved
 * out: this piece has now had three straight rounds where a confident, specific fix (the single-rule
 * whole-match guard; this very content-discarding classification) turned out to have a real gap a
 * fresh critic found, and a hand-written exception for one pair is exactly the kind of new,
 * easy-to-get-wrong surface that pattern has already punished twice. The cost is small — an author
 * wanting both splits into two cases, or picks one — and accepting it is cheaper than trusting a
 * fourth clever carve-out. Left refused on purpose; this is not an oversight.
 *
 * **The `library` surface needs no special case, confirmed rather than assumed — re-confirmed after
 * round 6 widened the set.** `compare.ts`'s own `normalizeLibraryOrThrow` applies ONLY
 * `ignore-json-pointers` to a `library` case's result — EVERY other rule, now including
 * `json-canonical` (round 6's own addition) alongside `replace`/`sort-lines`/
 * `trim-trailing-whitespace`, is already a complete no-op there (re-checked by reading that function
 * again for this round: it `continue`s past any rule whose `rule` is not `'ignore-json-pointers'`).
 * So even after widening, at most ONE content-discarding rule (`ignore-json-pointers` itself) can
 * ever actually do anything on a `library` case — two of them can never actually compound, since the
 * other four members of the now-five-strong set have nothing there to discard in the first place.
 * This function still does not skip `library` cases: it remains simpler and more consistent
 * (matching `collectReplacePatterns`'s own surface-agnostic walk) to apply the identical structural
 * check everywhere, and doing so here is never harmful — no legitimate declaration needs two
 * content-discarding rules on a surface where at most one of them does anything, so refusing that
 * combination costs nothing real and catches a confused declaration (one that copied rules from a
 * `process` case without noticing they are inert here).
 */
const CONTENT_DISCARDING_RULES: ReadonlySet<NormalizeRule['rule']> = new Set([
  'replace',
  'sort-lines',
  'trim-trailing-whitespace',
  'json-canonical',
  'ignore-json-pointers',
]);

/**
 * The two content-discarding PAIRS `specs/22` M17 P14 proves safe, each with its own proof (the
 * identical reasoning `SPEC-QUESTIONS.md` Q298 Decision 3 already worked out for M16 P4, now acted
 * on instead of accepted as an over-restriction) — a case naming EXACTLY one of these two pairs, and
 * no third content-discarding rule, is no longer refused by {@link hasConflictingContentDiscardingRules}.
 *
 * **Proof, `sort-lines` + `trim-trailing-whitespace`.** `applyTrimTrailingWhitespace` only ever
 * removes a per-line run of spaces/tabs immediately before a line terminator or the text's own end
 * (`normalize.ts`'s own regex, `/[ \t]+(?=\r\n|\r|\n|$)/g`); it can never touch a non-whitespace
 * byte, never merge two lines into one, and never introduce a new line boundary. `applySortLines`
 * only ever permutes whole lines, by their own (unchanged) content, never inspecting or depending on
 * what trimming already did or will do to any line's trailing whitespace. Composed in EITHER order,
 * the pair can therefore only ever (a) remove trailing whitespace and (b) reorder lines by their
 * (post- or pre-trim) content — neither operation can make one line's own sort position depend on a
 * DIFFERENT line's content (the hazard every other pairing in this set shares, `CONTENT_DISCARDING_
 * RULES`'s own doc comment), because trimming is purely local to one line and sorting depends only on
 * each line's own bytes. Two inputs that differ in any non-whitespace byte therefore still differ
 * after either order of this pair — confirmed directly (not merely argued) by
 * {@link PROVEN_SAFE_PAIR_PROOFS}'s own fixture in this module's test file, which composes the pair
 * both ways over inputs designed to look like the exact shape the OTHER five pairings exploit, and
 * shows none of them collapse.
 *
 * **Proof, `json-canonical` + `ignore-json-pointers`.** `ignore-json-pointers` resolves each of its
 * own `pointers` as an RFC 6901 PATH into the parsed JSON tree and removes exactly the member or
 * element that path names (`removeJsonPointer`'s own doc comment) — a pointer is a NAME/INDEX chain,
 * never a text position, so re-ordering the document's own object keys before or after removal
 * changes nothing about which logical field a given pointer names or removes (the one way `sort-lines`
 * was unsafe with a position-sensitive `replace` — making a LATER rule's target content-independent —
 * cannot arise here, because `ignore-json-pointers` never targets "whatever sorts last", only "the
 * field this declared path names", whatever its new key position is). `json-canonical` is applied
 * either as the first step (canonicalising before the named paths are removed, which only changes
 * display key order, read by {@link removeJsonPointer} regardless) or the last (canonicalising
 * what removal left, which cannot resurrect a removed field or rename a surviving one). Two documents
 * that differ in any field `ignore-json-pointers` was not told to remove still differ after either
 * order — confirmed directly by the identical fixture approach above.
 */
const PROVEN_SAFE_CONTENT_DISCARDING_PAIRS: readonly ReadonlySet<NormalizeRule['rule']>[] = [
  new Set(['sort-lines', 'trim-trailing-whitespace']),
  new Set(['json-canonical', 'ignore-json-pointers']),
];

/** True when `kinds` is EXACTLY one of {@link PROVEN_SAFE_CONTENT_DISCARDING_PAIRS} — not a subset,
 * not a superset: a third content-discarding kind sharing the scope is never proven safe by either
 * proof above, so it must still trip the general restriction. */
function isProvenSafePair(kinds: ReadonlySet<NormalizeRule['rule']>): boolean {
  return PROVEN_SAFE_CONTENT_DISCARDING_PAIRS.some(
    (pair) => pair.size === kinds.size && [...pair].every((kind) => kinds.has(kind)),
  );
}

/** The literal value {@link effectiveScopeKeyOf} returns for a rule with no explicit `stream`/`file`
 * — "every target" in the conflict count below. Named rather than inlined so every comparison site
 * reads the same word; typed as plain `string` (not a `'unscoped' | string` union, which ESLint's
 * `no-redundant-type-constituents` correctly rejects as the literal arm being swallowed by `string`
 * anyway). */
const UNSCOPED = 'unscoped';

/** This rule's own effective scope key for the conflict count below: `replace`'s `file` wins over its
 * `stream` when (unusually) both are set, matching `normalize.ts`'s own `applyNormalizeRulesToText`
 * scoping precedence exactly, so the two modules never disagree about what one rule's scope is.
 * `sort-lines` and `trim-trailing-whitespace` carry no scope field at all (`declaration-types.ts`'s
 * own `NormalizeRule` union) and are always {@link UNSCOPED}. */
function effectiveScopeKeyOf(rule: NormalizeRule): string {
  if (rule.rule === 'replace') {
    if (rule.file !== undefined) return `file:${rule.file}`;
    if (rule.stream !== undefined) return `stream:${rule.stream}`;
  }
  return UNSCOPED;
}

/**
 * True when two or more of `rules` would ever apply to the same effective scope — the one counting
 * primitive both {@link hasConflictingContentDiscardingRules} and
 * {@link hasRepeatedRuleKindInScope} share, each calling it over a different, pre-filtered subset of
 * one case's own `normalize` list (the content-discarding rules regardless of kind; one single kind
 * at a time). An unscoped rule's scope is "every target", so a second rule anywhere (unscoped, or
 * scoped to any name) collides with it; two differently-named scoped rules (one scoped to `stdout`,
 * the other to `stderr`, say) never collide with EACH OTHER, since they can never apply to the same
 * text.
 */
function hasOverlappingScopes(rules: readonly NormalizeRule[]): boolean {
  let unscopedCount = 0;
  const scopedCounts = new Map<string, number>();
  for (const rule of rules) {
    const key = effectiveScopeKeyOf(rule);
    if (key === UNSCOPED) {
      unscopedCount += 1;
    } else {
      scopedCounts.set(key, (scopedCounts.get(key) ?? 0) + 1);
    }
  }
  if (unscopedCount >= 2) return true;
  for (const count of scopedCounts.values()) {
    if (unscopedCount + count > 1) return true;
  }
  return false;
}

/**
 * True when two or more CONTENT-DISCARDING rules in `rules` would ever apply to the same effective
 * scope — see {@link CONTENT_DISCARDING_RULES}'s own doc comment for the full account, the two
 * repros, and why. This is the cross-KIND restriction (two DIFFERENT content-discarding kinds
 * sharing a scope); {@link hasRepeatedRuleKindInScope} is the separate, same-KIND restriction a round
 * 5 finding added — a case can violate either independently of the other.
 *
 * **`specs/22` M17 P14: the two proven-safe pairs are exempted, not just accepted as a cost.**
 * `replace` is the one content-discarding kind that EVER carries its own `stream`/`file` scope
 * (`effectiveScopeKeyOf`'s own doc comment) — the other four are always {@link UNSCOPED}, so whenever
 * no `replace` rule is present at all, every content-discarding rule in `rules` shares the identical
 * single scope by construction, and "which KINDS are present" is the whole question: if that set is
 * exactly one of {@link PROVEN_SAFE_CONTENT_DISCARDING_PAIRS}, it is not a conflict. The moment any
 * `replace` rule is present, this exemption never applies (neither proof above covers a combination
 * including `replace`) and the general, scope-aware check below runs exactly as it always has.
 *
 * The exemption fires only for EXACTLY two content-discarding rules, each a DIFFERENT kind, matching
 * one proven-safe pair: two occurrences of the SAME kind (`sort-lines` twice, say) is not what either
 * proof covers, and keeps tripping this check exactly as before (`hasRepeatedRuleKindInScope` already
 * refuses that same shape independently, for the identical same-kind reason `CFG-513` exists).
 */
export function hasConflictingContentDiscardingRules(rules: readonly NormalizeRule[]): boolean {
  const discarding = rules.filter((rule) => CONTENT_DISCARDING_RULES.has(rule.rule));
  const hasReplace = discarding.some((rule) => rule.rule === 'replace');
  if (!hasReplace && discarding.length === 2) {
    const kinds = new Set(discarding.map((rule) => rule.rule));
    if (kinds.size === 2 && isProvenSafePair(kinds)) return false;
  }
  return hasOverlappingScopes(discarding);
}

/**
 * True when the SAME normalise rule KIND — any of the seven, not only the three content-discarding
 * ones — appears two or more times over the same effective scope in `rules`. Groups `rules` by kind
 * first, then asks {@link hasOverlappingScopes} of each kind's own occurrences independently: two
 * `replace` rules scoped to different streams never conflict with each other through THIS check (nor
 * does one `replace` and one `line-endings` sharing a scope — different kinds are
 * {@link hasConflictingContentDiscardingRules}'s own, separate concern), but two occurrences of the
 * identical kind sharing a scope always do.
 *
 * **Round 5's finding, the reason this exists at all.** `strip-ansi` applied TWICE to the same scope
 * is not idempotent, and nothing before this stopped a declaration from doing exactly that (`CFG-512`
 * never counted `strip-ansi` — it is not in {@link CONTENT_DISCARDING_RULES} — and nothing anywhere
 * enforced uniqueness on a `normalize` array; `declaration.ts`'s loader maps each entry
 * independently, with no cross-entry check). Confirmed directly, independent of round 4's allowlist
 * narrowing (reproduces identically against the old, unbounded `[@-~]` range too): with
 * `o1 = ESC + '[1' + ESC + '[31mAfter'` and `o2 = ESC + '[99' + ESC + '[31mAfter'`, a SINGLE
 * `applyStripAnsi` pass genuinely differs between the two (`ESC + '[1After'` vs. `ESC + '[99After'`)
 * — but applying it a SECOND time collapses BOTH to `'fter'`. The mechanism: the first pass's own
 * match (`ESC[31m`, the only complete CSI sequence either string contains) sits BETWEEN a dangling,
 * never-completed `ESC[<params>` prefix and the literal text that follows it; removing that match
 * makes the dangling prefix suddenly ADJACENT to a literal character (`'A'` from `"After"`) the
 * second pass's own fresh scan now reads as that prefix's final byte — a "CSI sequence" that did not
 * exist anywhere in the ORIGINAL bytes, consuming a real leading character neither original string
 * exposed to a single pass.
 *
 * **Why this is a general restriction, not a `strip-ansi`-specific patch.** Four straight rounds each
 * closed the SPECIFIC mechanism a critic found, and the next round found the next one. Rather than
 * add a fifth narrow, mechanism-specific guard (which would leave open whatever a SIXTH round finds
 * for a different rule), this forecloses the whole CLASS: no rule kind may repeat on one scope, full
 * stop. `line-endings`, `json-canonical` and `ignore-json-pointers` each appear idempotent (a second
 * pass is a safe no-op) or a safe no-op by construction on inspection — but "appears safe on
 * inspection" is the exact confidence level each of the last four finding's own PRIOR code also had,
 * so this piece is no longer willing to trust that confidence for any individual rule without the
 * identical scrutiny a dedicated adversarial round would need, rather than assumed here under time
 * pressure. Refusing repetition uniformly costs nothing a reviewed declaration plausibly needs (no
 * legitimate case applies the SAME rule twice to the SAME scope on purpose), and removes the need to
 * separately prove idempotency for all seven kinds under every future angle.
 */
export function hasRepeatedRuleKindInScope(rules: readonly NormalizeRule[]): boolean {
  const byKind = new Map<NormalizeRule['rule'], NormalizeRule[]>();
  for (const rule of rules) {
    const sameKind = byKind.get(rule.rule);
    if (sameKind === undefined) {
      byKind.set(rule.rule, [rule]);
    } else {
      sameKind.push(rule);
    }
  }
  for (const sameKind of byKind.values()) {
    if (hasOverlappingScopes(sameKind)) return true;
  }
  return false;
}

/** One case whose `normalize` list has a content-discarding-rule conflict — the unit
 * {@link assertNoConflictingContentDiscardingRules} reports against, named the identical dotted-path
 * way {@link ReplacePatternLocation} is, down to the list itself rather than one rule within it (the
 * conflict is a property of the LIST, not of any single rule in it). */
export interface ContentDiscardingConflict {
  readonly key: string;
}

/** Every case in `declaration` whose `normalize` list has a content-discarding-rule conflict, in the
 * identical fixed, sorted order (`QUALITY-BAR.md` R10) {@link collectReplacePatterns} uses. */
export function collectContentDiscardingConflicts(
  declaration: ParityDeclaration,
): readonly ContentDiscardingConflict[] {
  const conflicts: ContentDiscardingConflict[] = [];
  for (const kind of SURFACE_KINDS) {
    const surface = declaration.surfaces[kind];
    if (surface === undefined) continue;
    surface.cases.forEach((parityCase, caseIndex) => {
      if (hasConflictingContentDiscardingRules(parityCase.normalize ?? [])) {
        conflicts.push({ key: `surfaces.${kind}.cases[${String(caseIndex)}].normalize` });
      }
    });
  }
  return conflicts;
}

/**
 * Throws `CFG-512` naming the first conflicting case {@link collectContentDiscardingConflicts}
 * finds, or returns normally when there is none. Intended to run once a declaration has loaded
 * structurally, the identical "load-adjacent, owned by this piece" timing
 * {@link assertParityDeclarationPatternsSafe} already uses, and for the identical reason (this is a
 * property of the declaration's own shape, decidable with no data at all, so there is no reason to
 * wait for a real comparison to find it).
 *
 * A NEW code, `CFG-512`, rather than reusing `CFG-511`: the two refusals need genuinely different,
 * specific remedies (simplify ONE pattern's own shape, versus reduce HOW MANY content-discarding
 * rules share one scope), and `CFG-510`/`CFG-511` already established the precedent of a dedicated
 * code per distinct remedy — conflating two unrelated remedies into one code's fixed string would
 * make it generic and less actionable for whichever specific problem a reader actually hit. The live
 * ceiling was checked immediately before taking this number (`CFG-511` is this piece's own highest at
 * the time; the sibling P3 piece's own, separately-tracked codes are in the `RUN`/`ENV` prefixes and
 * do not collide here).
 */
export function assertNoConflictingContentDiscardingRules(declaration: ParityDeclaration): void {
  const conflicts = collectContentDiscardingConflicts(declaration);
  const first = conflicts[0];
  if (first === undefined) return;
  throw new ForgeError('CFG-512', {
    file: `.forge/parity/${declaration.name}.parity.yaml`,
    key: first.key,
    detail:
      'lists two or more content-discarding normalise rules (replace, sort-lines, ' +
      'trim-trailing-whitespace) that apply to the same effective scope, which can compound to ' +
      'erase genuinely different observations down to the identical bytes even though none of ' +
      'them alone would',
    more: conflicts.length - 1,
  });
}

/** One case whose `normalize` list applies the SAME rule kind more than once to one effective scope
 * — the unit {@link assertNoRepeatedRuleKindInScope} reports against, named the identical way
 * {@link ContentDiscardingConflict} is (the list itself, not one rule within it). */
export interface RepeatedRuleKindConflict {
  readonly key: string;
}

/** Every case in `declaration` whose `normalize` list repeats one rule kind over one effective
 * scope, in the identical fixed, sorted order {@link collectReplacePatterns} and
 * {@link collectContentDiscardingConflicts} both use. This is checked INDEPENDENTLY of
 * {@link collectContentDiscardingConflicts}: a case can violate either restriction without
 * violating the other (two `line-endings` rules repeat a STRUCTURAL kind, which the content-
 * discarding check does not look at; one `replace` plus one `sort-lines` sharing a scope are two
 * DIFFERENT content-discarding kinds, which this repeated-kind check does not look at). */
export function collectRepeatedRuleKindConflicts(
  declaration: ParityDeclaration,
): readonly RepeatedRuleKindConflict[] {
  const conflicts: RepeatedRuleKindConflict[] = [];
  for (const kind of SURFACE_KINDS) {
    const surface = declaration.surfaces[kind];
    if (surface === undefined) continue;
    surface.cases.forEach((parityCase, caseIndex) => {
      if (hasRepeatedRuleKindInScope(parityCase.normalize ?? [])) {
        conflicts.push({ key: `surfaces.${kind}.cases[${String(caseIndex)}].normalize` });
      }
    });
  }
  return conflicts;
}

/**
 * Throws `CFG-513` naming the first case {@link collectRepeatedRuleKindConflicts} finds whose
 * `normalize` list applies one rule kind more than once to the same effective scope, or returns
 * normally when there is none. The identical "load-adjacent, owned by this piece" timing
 * {@link assertParityDeclarationPatternsSafe}/{@link assertNoConflictingContentDiscardingRules}
 * already use, for the identical reason (a property of the declaration's own shape, decidable with
 * no data at all).
 *
 * A NEW code, `CFG-513`, rather than extending `CFG-512`'s own fixed remedy string to cover both
 * shapes: `CFG-512`'s remedy ("reduce the content-discarding rules... to at most one") is specific
 * to, and only correct for, the cross-KIND restriction, and reads as actively WRONG advice for this
 * restriction's own failure mode — repeating a single STRUCTURAL kind such as `line-endings`, which
 * `CFG-512`'s remedy does not even name, let alone address. A reader hitting a real repeated-kind
 * refusal deserves a remedy that names the actual fix ("remove the duplicate, or scope the two
 * occurrences differently"), not one that talks about a different three-rule set that may not even
 * be involved. The live ceiling was re-checked immediately before taking this number: `CFG-512` is
 * this piece's own highest at the time of this fix; the sibling P3 piece's own codes remain in the
 * `RUN`/`ENV` prefixes and do not collide.
 */
export function assertNoRepeatedRuleKindInScope(declaration: ParityDeclaration): void {
  const conflicts = collectRepeatedRuleKindConflicts(declaration);
  const first = conflicts[0];
  if (first === undefined) return;
  throw new ForgeError('CFG-513', {
    file: `.forge/parity/${declaration.name}.parity.yaml`,
    key: first.key,
    detail:
      'applies the same normalise rule kind more than once to the same effective scope, which can ' +
      'compound (even for a rule that looks idempotent on inspection) to erase genuinely different ' +
      'observations down to the identical bytes',
    more: conflicts.length - 1,
  });
}

/**
 * The surface kinds the always-on root-path rewrite reaches (`normalize.ts`'s own `rewriteRootPaths`
 * doc comment; `compare.ts`'s own `normalizeTextOrThrow` runs it before any declared rule on every
 * one of these). `library`'s own structured value is deliberately excluded: `compare.ts`'s own
 * `normalizeObservationOrThrow` never calls the rewrite for `library` at all (confirmed by reading
 * that function, not assumed — see its own doc comment), so a `replace` rule declared there has
 * nothing to interact with and is already a complete no-op (the identical, already-confirmed reason
 * {@link assertNoConflictingContentDiscardingRules}'s own doc comment gives for not special-casing
 * `library` there either).
 */
const ROOT_REWRITTEN_SURFACES: ReadonlySet<SurfaceKind> = new Set(['process', 'file', 'http']);

/**
 * True when `rules` declares at least one `replace` rule — the one check
 * {@link collectReplaceOnRootRewrittenSurfaceConflicts} needs per case on a root-rewritten surface.
 */
function hasReplaceRule(rules: readonly NormalizeRule[]): boolean {
  return rules.some((rule) => rule.rule === 'replace');
}

/** One case whose `normalize` list declares a `replace` rule on a surface the always-on root-path
 * rewrite reaches — the unit {@link assertNoReplaceRuleOnRootRewrittenSurface} reports against, named
 * the identical way {@link ContentDiscardingConflict}/{@link RepeatedRuleKindConflict} are. */
export interface ReplaceOnRootRewrittenSurfaceConflict {
  readonly key: string;
}

/**
 * Every case, on a {@link ROOT_REWRITTEN_SURFACES} member, whose `normalize` list declares a
 * `replace` rule, in the identical fixed, sorted order {@link collectReplacePatterns} and its
 * siblings all use.
 *
 * **`specs/22` M17 P14: closing the always-on root-token masking gap M16 P4 disclosed and left open**
 * (`normalize.ts`'s own `rewriteRootPaths` doc comment, `SPEC-QUESTIONS.md` Q298 Decision 4). The
 * rewrite substitutes a variable-length real root path for a FIXED-length token, unconditionally,
 * before any declared rule — the two real roots being compared are essentially never the same
 * length, so the substitution shifts the two sides' text by two different amounts. A later `replace`
 * rule anchored at a text boundary (`.{N}$`, `^.{N}`, and the like — an entirely ordinary shape, e.g.
 * "drop a trailing fixed-width id") then cuts a different offset into the real content on each side,
 * which can turn a genuine difference into byte-identical normalised text (confirmed live: see this
 * module's own test file for the repro, reproduced both as M16 P4 originally found it and as a fresh
 * M17 P14 adversarial round independently re-derived it).
 *
 * **Why `replace` is refused outright here, rather than only the pattern shapes that are actually
 * anchored.** `isPathologicalReplacePattern` already shows that statically classifying "is this
 * pattern dangerous" is itself an open-ended problem this piece's own history (`SPEC-QUESTIONS.md`
 * Q298 Decisions 1 and 4) has twice found a gap in; Decision 4 explicitly rejected a heuristic
 * detector for "a dangerous, length-anchored `replace` pattern" for exactly that reason. The other
 * six normalise rules are each either structural (addressed by content or JSON path, never by
 * absolute text position or length — `line-endings`, `strip-ansi`, `sort-lines`, `json-canonical`,
 * `ignore-json-pointers`) or content-BOUNDED (`trim-trailing-whitespace` can only ever consume
 * whitespace, never a real byte, so it cannot be shifted into consuming part of a real difference);
 * `replace` alone accepts an author-supplied, unconstrained regular expression, which is the one
 * shape capable of depending on absolute position or length at all. Refusing it outright, on every
 * surface the rewrite reaches, widens the EXISTING "coarse but provably sufficient" mechanism
 * {@link hasConflictingContentDiscardingRules}/{@link hasRepeatedRuleKindInScope} already chose
 * over a cleverer detector, rather than inventing a third one.
 */
export function collectReplaceOnRootRewrittenSurfaceConflicts(
  declaration: ParityDeclaration,
): readonly ReplaceOnRootRewrittenSurfaceConflict[] {
  const conflicts: ReplaceOnRootRewrittenSurfaceConflict[] = [];
  for (const kind of SURFACE_KINDS) {
    if (!ROOT_REWRITTEN_SURFACES.has(kind)) continue;
    const surface = declaration.surfaces[kind];
    if (surface === undefined) continue;
    surface.cases.forEach((parityCase, caseIndex) => {
      if (hasReplaceRule(parityCase.normalize ?? [])) {
        conflicts.push({ key: `surfaces.${kind}.cases[${String(caseIndex)}].normalize` });
      }
    });
  }
  return conflicts;
}

/**
 * Throws `CFG-516` naming the first case {@link collectReplaceOnRootRewrittenSurfaceConflicts} finds
 * whose `normalize` list declares a `replace` rule on a surface the always-on root-path rewrite
 * reaches, or returns normally when there is none. The identical "load-adjacent, owned by this piece"
 * timing every sibling assertion in this module already uses.
 */
export function assertNoReplaceRuleOnRootRewrittenSurface(declaration: ParityDeclaration): void {
  const conflicts = collectReplaceOnRootRewrittenSurfaceConflicts(declaration);
  const first = conflicts[0];
  if (first === undefined) return;
  throw new ForgeError('CFG-516', {
    file: `.forge/parity/${declaration.name}.parity.yaml`,
    key: first.key,
    detail:
      'declares a "replace" rule on a surface the always-on root-path rewrite reaches, which ' +
      'cannot be proven safe against a length-anchored pattern (specs/13 F-TEST-9)',
    more: conflicts.length - 1,
  });
}

/** One problem {@link firstNormalizeRuleSafetyProblem} found — plain data, carrying the already-
 * rendered `ForgeError.message` so a caller never has to re-derive or duplicate the code's own
 * message/remedy text (`codes.ts` is the one place that renders it). */
export interface NormalizeRuleSafetyProblem {
  readonly code: ForgeErrorCode;
  readonly key: string;
  readonly message: string;
}

/**
 * Runs every normalize-rule-shape safety check this module owns — `CFG-511` (catastrophic-
 * backtracking shape), `CFG-512` (conflicting content-discarding rules), `CFG-513` (a repeated rule
 * kind) and `CFG-516` (`specs/22` M17 P14: `replace` on a root-rewritten surface) — in that fixed
 * order, and returns the FIRST problem found as plain data, never throwing.
 *
 * **Why this exists, beside the four throwing `assert*` functions above.** `capture-command.ts`'s
 * own `captureOneDeclaration` already lets a `ForgeError` propagate (it throws `CFG-515` inline
 * itself), so it calls the four `assert*` functions directly, in this identical order, needing no
 * wrapper. `check-command.ts`'s own `processDeclaration` has the opposite contract — every outcome
 * is a returned `ProcessedDeclaration`, never a thrown exception (`declaration.ts`'s own
 * `loadParityDeclaration` doc comment: "Never throws") — so THIS function exists for it: one
 * non-throwing call that still reports each hazard under its own real code and its own real,
 * already-rendered message, rather than a generic one.
 *
 * **Why these four checks were never reachable from either real command before `specs/22` M17 P14.**
 * Confirmed by reading every call site in this package before this piece's own build: none of the
 * four `assert*`/`collect*` functions above had ANY caller outside this module's own test file —
 * `capture-command.ts`/`check-command.ts`/`declaration.ts` never imported `replace-lint.ts` at all.
 * Six real gauntlet rounds (`GAUNTLET-LOG.md`'s own `## M16 P4` entry) built and proved these checks
 * against the primitive directly; nothing wired them into `forge parity capture`/`check` itself, so a
 * real declaration with a genuinely dangerous shape was never actually refused by either command —
 * only by a test calling the function in isolation. This piece wires both commands to this module for
 * the first time; see this piece's own report for the full account.
 */
export function firstNormalizeRuleSafetyProblem(
  declaration: ParityDeclaration,
): NormalizeRuleSafetyProblem | undefined {
  for (const assertSafe of [
    assertParityDeclarationPatternsSafe,
    assertNoConflictingContentDiscardingRules,
    assertNoRepeatedRuleKindInScope,
    assertNoReplaceRuleOnRootRewrittenSurface,
  ]) {
    try {
      assertSafe(declaration);
    } catch (cause) {
      if (!isForgeError(cause)) throw cause;
      const key = cause.details['key'];
      return {
        code: cause.code,
        key: typeof key === 'string' ? key : '(unknown)',
        message: cause.message,
      };
    }
  }
  return undefined;
}
