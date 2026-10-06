/**
 * `classifyReferenceRefFormat` — whether a declaration's `reference.ref` text is well-formed, as a
 * pure FORMAT question: `13` F-TEST-9 — "`reference.ref` is a full commit sha (40 hexadecimal digits,
 * or 64 in a repository that uses SHA-256) or a tag name... a branch name, `HEAD` or an abbreviated
 * sha is `invalid`."
 *
 * **This is not resolution.** Whether a syntactically valid sha or tag name actually names a commit
 * in any real repository is a question only a real git tree can answer, which this piece does not
 * have (`PLAN-M16.md` P2's own Mandate: "no network, no clock of its own... it runs nothing"). A
 * well-formed name or sha that turns out not to exist reads `missing`, a declaration-level verdict
 * distinct from `invalid` — P6/P7's job, over a real repository, not this function's. This module
 * answers one question only: is the TEXT shaped like a sha, or like a tag name `git check-ref-format`
 * would accept as `refs/tags/<name>` — never whether that tag exists.
 *
 * **The sha check is pure text.** No subprocess, no filesystem.
 *
 * **The tag check shells out to the real `git check-ref-format` binary** — a syntax linter, not a
 * resolution: its own man page states it "does not verify that the reference exists," confirmed
 * directly (`git check-ref-format refs/tags/main` exits 0 run from a directory that is not, and does
 * not contain, a git repository at all). Needing no repository, its result cannot depend on which
 * directory it runs from, so this passes no `cwd` at all (never the project root, never a temp
 * directory manufactured for the purpose — there is nothing for R10's host-facts ban to apply to when
 * the command's own output is provably independent of it) and relies on `execa`'s own default of the
 * calling process's cwd, which this module never reads or reasons about. This is the identical class
 * of load-time shelling-out `declaration.ts` already does for command vetting, just narrower in what
 * it asks. The ref text is passed as an argv ARRAY element, never interpolated into a shell string,
 * and always prefixed with the literal `refs/tags/`, so a `name` that happens to start with `-` can
 * never be read as an option (the argument git actually receives always begins `refs/tags/-...`, not
 * `-...`).
 *
 * @see specs/13 F-TEST-9
 * @see process/SPEC-QUESTIONS.md Q294 (Decision 3's trust-anchor exactness rules, which Amendment A5
 *   holds `reference.ref` to as well)
 */
import { execa } from 'execa';

/** The result of the full format check: a well-formed sha, a well-formed (accepted) tag name, or why
 * the text is rejected outright, before any repository is consulted. */
export type ReferenceRefFormat =
  | { readonly kind: 'sha'; readonly sha: string }
  | { readonly kind: 'tag'; readonly name: string }
  | { readonly kind: 'invalid'; readonly reason: string };

/** The pure-text half of the check, exposed on its own so a caller that cannot await a subprocess
 * (or a test of the sha/HEAD/abbreviated-sha rules alone) does not have to. `maybe-tag` defers the
 * only question that needs git: whether `git check-ref-format` accepts the name. */
export type ReferenceRefShape =
  | { readonly kind: 'sha'; readonly sha: string }
  | { readonly kind: 'maybe-tag'; readonly name: string }
  | { readonly kind: 'invalid'; readonly reason: string };

const LOWER_HEX_40 = /^[0-9a-f]{40}$/;
const LOWER_HEX_64 = /^[0-9a-f]{64}$/;
const ANY_CASE_HEX = /^[0-9a-fA-F]+$/;

/**
 * The pure-text classification: a full lower-case sha (40 or 64 digits) is `sha`; the literal string
 * `HEAD`, or any all-hex string that is not a full lower-case sha (too short/long to be one, or the
 * right length with an upper-case digit), is `invalid` outright — never retried as a tag name, since
 * each is refused specifically BECAUSE it could otherwise be misread as a sha (`13` F-TEST-9: "reject
 * any upper-case letter in the digits," "an abbreviated sha... is `invalid`"). Anything else is
 * `maybe-tag`: syntactically a candidate tag name, pending `git check-ref-format`.
 *
 * A bare branch name (`main`, say) is NOT specially detected here and is not detectable from text
 * alone without a real repository — nothing about a tag name's own syntax differs from a branch
 * name's, so a value someone intended as a branch reads `maybe-tag` here and, at P6/P7's resolution
 * time, either finds no such tag (`missing`) or, if a tag of that name genuinely exists, resolves to
 * it (the declaration's own `reference.ref` has no branch code path to resolve against instead — see
 * this module's own report-level disclosure).
 */
export function classifyReferenceRefShape(ref: string): ReferenceRefShape {
  if (ref.trim() === '') {
    return { kind: 'invalid', reason: 'reference.ref is empty.' };
  }
  if (ref === 'HEAD') {
    return {
      kind: 'invalid',
      reason: '"HEAD" moves with every commit, so it cannot be a reviewed, stable reference.',
    };
  }
  if (LOWER_HEX_40.test(ref) || LOWER_HEX_64.test(ref)) {
    return { kind: 'sha', sha: ref };
  }
  if (ANY_CASE_HEX.test(ref)) {
    const fullLength = ref.length === 40 || ref.length === 64;
    return {
      kind: 'invalid',
      reason: fullLength
        ? 'reference.ref has the length of a full commit sha but contains an upper-case letter; a commit sha must be lower-case.'
        : `reference.ref is ${String(ref.length)} hexadecimal digit(s), neither 40 nor 64, so it is refused as an abbreviated or malformed commit sha rather than tried as a tag name.`,
    };
  }
  return { kind: 'maybe-tag', name: ref };
}

/**
 * Whether `git check-ref-format` accepts `refs/tags/<name>` — a syntax question only, needing no
 * repository. No `cwd` is passed at all (see this module's own header comment: the command's result
 * is provably independent of it, confirmed directly, so there is nothing for R10's host-facts ban to
 * apply to — never the project root, never a manufactured scratch directory). Never throws: a git
 * binary that cannot be found or cannot run is reported as a rejection (`false`), the fail-closed
 * direction, via `execa`'s own `reject: false` plus a non-zero exit code when the process itself
 * could not start.
 */
export async function isAcceptedTagName(name: string): Promise<boolean> {
  const result = await execa('git', ['check-ref-format', `refs/tags/${name}`], {
    reject: false,
  });
  return result.exitCode === 0;
}

/**
 * The full `reference.ref` format check: {@link classifyReferenceRefShape}, and, only for a
 * syntactically tag-shaped value, {@link isAcceptedTagName}.
 *
 * This is `declaration.ts`'s one source of async-ness beyond command vetting: the sync shape check
 * alone is enough for a caller that does not want to await a subprocess (digest and selection tests
 * need neither, per `PLAN-M16.md` P2's own Mandate).
 */
export async function classifyReferenceRefFormat(ref: string): Promise<ReferenceRefFormat> {
  const shape = classifyReferenceRefShape(ref);
  if (shape.kind !== 'maybe-tag') return shape;
  const accepted = await isAcceptedTagName(shape.name);
  return accepted
    ? { kind: 'tag', name: shape.name }
    : {
        kind: 'invalid',
        reason: `"${shape.name}" is refused as a tag name (\`git check-ref-format\` rejects "refs/tags/${shape.name}").`,
      };
}
