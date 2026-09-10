/**
 * `hashFixDiff`/`detectForbiddenFixPattern` — F-DEBUG-2's own anti-thrash rule and F-DEBUG-1 step 7's
 * own explicitly-forbidden fix shapes, as real, checkable functions `loop.ts`'s own FIX phase
 * actually calls, never merely documented.
 *
 * @see specs/13 §13.2 F-DEBUG-1
 * @see specs/13 §13.2 F-DEBUG-2
 * @see PLAN-M8.md P8
 */
import { createHash } from 'node:crypto';

/** Replaces every real string-literal's own *contents* with a fixed placeholder (`"..."`/`'...'`/
 * `` `...` ``, escapes honoured) — used before both `normalizeForHash` and
 * `detectForbiddenFixPattern` strip comments, so a line- or block-comment-shaped sequence *inside* a real string
 * (a URL, an error message) is never mistaken for an actual comment, and neither function's own
 * pattern matching fires on a forbidden-sounding *word* that only ever appears inside a string a fix
 * legitimately added (an error message mentioning "retry", e.g.). A deliberately minimal regex
 * approach, not a real lexer — the identical scoping this whole module already discloses. */
function stripStringLiteralContents(text: string): string {
  return text
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''")
    .replace(/`(?:[^`\\]|\\.)*`/g, '``');
}

/** Strips line and block comments — always called *after* `stripStringLiteralContents`, so a
 * comment-shaped sequence inside a real string was already neutralised first. */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
}

/** A deliberately minimal source-text normaliser, not a real parser — the identical "proportionate
 * scaffolding for an overwhelmingly syntactic job" precedent `oracle-lint.ts`'s own doc comment
 * already establishes for this codebase (`PLAN-M8.md` P5). Strips unified-diff hunk/index metadata
 * (kept: the real `+++`/`---` file-path lines, prefixed onto the normalised content below — a fresh
 * critic round reproduced directly that discarding them entirely let two attempts touching two
 * *different* files, with the identical content change, hash identically, silently refusing a real,
 * substantively different fix as if it were a repeat), the leading `+`/`-` marker off every remaining
 * content line (kept content, dropped which side it's on — two attempts differing only in *which*
 * lines moved is not the "near-identical diff" F-DEBUG-2's own wording is about), every real string
 * literal's own contents and every line/block comment, and collapses every run of whitespace to a
 * single space — "whitespace/comment-insensitive," `13` §13.2's own literal wording for what
 * "normalised" means here. String-literal *contents* are blanked (not merely comment-stripped)
 * *before* comment-stripping runs — a real, disclosed trade-off: a naive line/block-comment strip applied
 * directly to raw source text would otherwise eat everything from a `//` sequence *inside* a real
 * string (a URL, e.g.) through to end-of-line, silently dropping whatever real code follows it on
 * that same line from the hash entirely — confirmed as a real corruption risk, not a hypothetical
 * one. Blanking first avoids that; the cost is that two attempts differing *only* inside a string's
 * own content (not the surrounding code) now also hash identically, treated the same as a
 * whitespace-only difference — a false "near-identical" refusal in that one narrow case is judged the
 * lesser risk against silently losing real code from the comparison. */
function normalizeForHash(diff: string): string {
  const lines = diff.split('\n');
  const filePaths = lines
    .filter((line) => line.startsWith('+++') || line.startsWith('---'))
    .join('\n');
  const contentLines = lines
    .filter((line) => !/^(diff --git|index |---|\+\+\+|@@)/.test(line))
    .map((line) => line.replace(/^[+-]/, ''));
  const body = stripComments(stripStringLiteralContents(contentLines.join('\n')));
  return `${filePaths}\n${body}`.replace(/\s+/g, ' ').trim();
}

/** A real, normalised hash of one attempted fix diff — F-DEBUG-2's own "the loop hashes each
 * attempted fix diff... a repeated or near-identical diff (normalised) is refused." Two diffs
 * differing only in whitespace or comments (on the *same* file) hash identically; two diffs with a
 * real, substantive difference (even a one-character change to actual logic, or the same change
 * applied to a different file) hash differently. */
export function hashFixDiff(diff: string): string {
  return createHash('sha256').update(normalizeForHash(diff)).digest('hex');
}

/** F-DEBUG-1 step 7's own explicit, named list: "broadening a catch, adding a retry to mask a race,
 * loosening an assertion, adding a sleep, adding a null-check that hides an invalid state upstream."
 * Checked against the diff's own real *added* lines only (`+`-prefixed, unified-diff convention),
 * with every real string literal's own contents and every comment stripped first (the identical
 * `stripStringLiteralContents`/`stripComments` pair `normalizeForHash` already uses) — a fresh critic
 * round reproduced directly that the first draft matched these patterns against raw source text,
 * flagging a comment *documenting* why a retry was deliberately not added, a string literal merely
 * mentioning "sleep", and a doc comment listing the very words this function's own FIX prompt already
 * warns against (`loop.ts`'s own FIX prompt names all five). A forbidden pattern already present
 * before this fix (on a `-`-prefixed or context line) is a pre-existing fact about the codebase, not
 * something *this* fix attempt introduced. Returns the one, real matched reason (F-DEBUG-1's own
 * "blocks the loop with an explanation"), or `undefined` when none of the five apply — a deliberately
 * minimal, pattern-based check (the identical scoping `oracle-lint.ts` already establishes), not a
 * semantic diff analyser: it can still miss a real instance phrased unusually (a logging-only catch
 * with no rethrow, disclosed and not attempted here — real catch-*block*-boundary extraction needs
 * real brace matching this deliberately minimal check does not do), and can still flag a legitimate
 * addition that happens to match a pattern in real *code*, not a comment or string (a real
 * `setTimeout()` call a fix genuinely, correctly needs for an unrelated reason, e.g.) — real,
 * disclosed limitations, not a silent guess (`SPEC-QUESTIONS.md` has the fuller record). */
export function detectForbiddenFixPattern(diff: string): string | undefined {
  const addedLines = diff
    .split('\n')
    .filter((line) => line.startsWith('+') && !line.startsWith('+++'))
    .map((line) => line.slice(1));
  const added = stripComments(stripStringLiteralContents(addedLines.join('\n')));

  if (/catch\s*\([^)]*\)\s*\{\s*\}/.test(added) || /catch\s*\{\s*\}/.test(added)) {
    return 'broadens a catch block to swallow the error silently';
  }
  if (/\bsetTimeout\s*\(|\bsleep\s*\(|\bawait\s+delay\s*\(/.test(added)) {
    return 'adds a sleep/delay — the explicitly forbidden "wait it out" race-masking shape';
  }
  if (/\bretry\b|\bretries\b|\bfor\s*\([^)]*retry/i.test(added)) {
    return 'adds a retry — the explicitly forbidden "mask a race by trying again" shape';
  }
  if (
    /\.skip\s*\(|\bxit\s*\(|\bxdescribe\s*\(|toBeTruthy\s*\(\s*\)|toBeDefined\s*\(\s*\)/.test(added)
  ) {
    return 'loosens or disables an assertion — the explicitly forbidden shape';
  }
  if (
    /if\s*\([^)]*(===|!==|==|!=)\s*(null|undefined)[^)]*\)\s*\{?\s*(return|continue)\s*;/.test(
      added,
    )
  ) {
    return 'adds a null-check that silently skips work with no fallback — may hide an invalid state upstream rather than fixing its real cause';
  }
  return undefined;
}
