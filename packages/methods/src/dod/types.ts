/**
 * `09` §9.8's own Definition of Ready/Done profile shape, verbatim: a named profile carries a `ready`
 * list and a `done` list, each a mix of bounded expressions and named `check:` references. See
 * `load.ts`'s own doc comment for why `{ check: id }` is deliberately open-ended rather than a closed
 * set this package enumerates.
 *
 * @see specs/09 §9.8
 * @see PLAN-M8.md P1
 */

export type DodCheck = string | { readonly check: string };

/** One profile's own `ready`/`verify`/`done` lists — every entry in each is checked independently; a
 * profile passes a phase only when every one of that phase's own `DodCheck` entries passes. `verify`
 * is optional (`schema.ts`'s own doc comment): a pre-M14 profile that has not yet split `done` still
 * parses, with no `verify` list to check. */
export interface DodPhase {
  readonly ready: readonly DodCheck[];
  // Explicit `| undefined` (not just `?`): this project's `exactOptionalPropertyTypes: true` treats
  // those as distinct, and `dodPhaseSchema`'s own zod-inferred type for an `.optional()` field is
  // `T | undefined`, which a bare `readonly verify?: readonly DodCheck[]` cannot accept assignment from.
  readonly verify?: readonly DodCheck[] | undefined;
  readonly done: readonly DodCheck[];
}

/** One parsed `dod-profiles.yaml` document. `profiles` is keyed by profile id — the same id a real
 * `Story.dod_profile` field names (`09` §9.8's own worked example: `dod_profile: backend-default`) —
 * open-ended, never a closed set this package could enumerate. */
export interface DodProfileFile {
  readonly profiles: Readonly<Record<string, DodPhase>>;
}

/** One problem `loadDodProfile` found — the same discriminated-result shape
 * `@forge/methods/schema`'s own `FrameworkIssue`/`FrameworkParseResult` already establish. */
export interface DodIssue {
  readonly path: string;
  readonly message: string;
}

/** `loadDodProfile`/`readDodProfile`'s own return shape — never throws on ordinary malformed input;
 * a caller always gets either a real `profileFile` (plus `warnings`, possibly empty) or the full list
 * of everything wrong with it. `warnings` is the "kb lint" advisory the schema's own optional
 * `verify` field enables (`schema.ts`'s own doc comment): a profile that loads fine but still models
 * only `ready`/`done` gets one `DodIssue`-shaped warning per such profile, naming the `verify`/`done`
 * split (`09` §9.8, M14 P1) — never a load failure, since the file genuinely still loads.
 *
 * Disclosed, not fixed here (M14 P25): of this package's two real callers, `@forge/cli`'s
 * `story.ts` (`forge story verify`) reads `warnings` and surfaces it; `spec/validate-rules.ts`'s
 * `validateDefinitionOfReady` (`forge spec validate --rule definition-of-ready`), which also loads this
 * same file for the SAME project, does not — a project whose profile lacks `verify` gets the advisory
 * from one command and not the other, until a later piece wires it there too. */
export type DodParseResult =
  | {
      readonly success: true;
      readonly profileFile: DodProfileFile;
      readonly warnings: readonly DodIssue[];
    }
  | { readonly success: false; readonly issues: readonly DodIssue[] };

/** The one real fact `evaluateDodProfile`'s own bounded expressions need — a plain-string check
 * (`story.acceptance.length > 0`) reads dotted paths off `story` via `@forge/methods/expr`'s own
 * generic `Record<string, unknown>` reader. `{ check: id }` resolution needs no context of its own
 * here: it is answered entirely by the caller-supplied `resolveCheck` function (see `evaluate.ts`),
 * which may close over whatever data *it* needs — this type stays exactly as small as the one thing
 * this package's own expression grammar actually reads. */
export interface DodContext {
  readonly story: Readonly<Record<string, unknown>>;
}

/** One `DodCheck` entry (either kind) that failed, from `evaluateDodProfile`. `check` is always the
 * failed entry's own label — the raw expression text for a plain-string check, or the bare `check:`
 * id for a `{ check: id }` entry (never both, and never further disambiguated on this type: `message`
 * is where a caller distinguishes "an expression failed" from "a named check failed", since which kind
 * it was determines that message's own wording). A `profileId` that does not exist in the profile file
 * at all is reported as a single `DodViolation` with `check: '(profile)'` — a config error, not a
 * report about any real `ready`/`done` entry. */
export interface DodViolation {
  readonly profileId: string;
  readonly phase: 'ready' | 'done';
  readonly check: string;
  readonly message: string;
}
