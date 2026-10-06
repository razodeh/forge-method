/**
 * The typed shape of a parity declaration (`13` F-TEST-9) — the contract three later builders (P3's
 * observation engine, P4's comparison engine, P6/P7's verbs) read against, so every field here is the
 * field the spec names, never a convenience shortcut invented for this piece alone.
 *
 * @see specs/13-frameworks-testing-and-debugging.md F-TEST-9
 * @see process/plans/PLAN-M16.md P2
 */

/** The four observable surfaces `13` F-TEST-9 defines. */
export type SurfaceKind = 'process' | 'file' | 'library' | 'http';

/** `SurfaceKind`'s members, in the fixed order every sorted listing of surfaces in this package uses
 * (`QUALITY-BAR.md` R10: no reliance on object-key enumeration order for anything observable). */
export const SURFACE_KINDS: readonly SurfaceKind[] = ['process', 'file', 'library', 'http'];

/** Whether `value` is one of `SurfaceKind`'s own members — the one place that needs to compare a
 * plain `string` against `SURFACE_KINDS`, so every caller gets a real type guard instead of its own
 * `as SurfaceKind` (`QUALITY-BAR.md` R1: every `as` needs a comment naming the invariant that makes
 * it sound, and a type guard is how this module avoids needing one at every call site). */
export function isSurfaceKind(value: unknown): value is SurfaceKind {
  // Widening to `readonly string[]` is sound both ways: every `SurfaceKind` IS a `string` (so no
  // runtime value changes meaning), and this lets `.includes` compare against the already-narrowed
  // `string` on the left without a second, equally-unexplained cast there instead.
  return typeof value === 'string' && (SURFACE_KINDS as readonly string[]).includes(value);
}

/** One of the two streams a `process` (or `library`) surface may observe. */
export type ProcessStream = 'stdout' | 'stderr';

/**
 * One declarative normalisation rule, run in the order a declaration lists them (`13` F-TEST-9).
 * `rule` discriminates; `replace` and `ignore-json-pointers` are the only two with their own extra
 * fields. Applying a rule is P4's job (`PLAN-M16.md` P4) — this package only carries the declared
 * shape through, unmodified, into the digest.
 */
export type NormalizeRule =
  | { readonly rule: 'line-endings' }
  | { readonly rule: 'strip-ansi' }
  | { readonly rule: 'trim-trailing-whitespace' }
  | { readonly rule: 'sort-lines' }
  | { readonly rule: 'json-canonical' }
  | { readonly rule: 'ignore-json-pointers'; readonly pointers: readonly string[] }
  | {
      readonly rule: 'replace';
      readonly pattern: string;
      readonly replacement: string;
      readonly stream?: ProcessStream;
      readonly file?: string;
    };

/** A case's overlaid input: `from` is a source identifier under `.forge/parity/` (where the trust
 * anchor reaches it); `to` is the destination the harness writes it to, in the tree under
 * observation, before the case runs (`13` F-TEST-9). */
export interface OverlayInput {
  readonly from: string;
  readonly to: string;
}

/** A `file` surface's declared output: `mode: 'bytes'` stores only its sha256, never its content
 * (`13` F-TEST-9); `mode` absent means `'text'`. */
export interface DeclaredOutput {
  readonly path: string;
  readonly mode?: 'text' | 'bytes';
}

/** The exit a `process`/`library` case's reference run is expected to end with: a numeric exit code
 * (default 0), or the literal `'empty'` meaning "I expect this case's whole observation to be empty,
 * so do not refuse it for that" (`13` F-TEST-9's "a reference that did not do what was expected"
 * bullet). Enforcing this is capture-time behaviour (P3/P4); this package only carries it. */
export type ExpectedExit = number | 'empty';

/**
 * One case of one surface: literal arguments, overlaid inputs, declared outputs, normalisation
 * rules, and per-case limits. A case belongs to exactly one surface (`13` F-TEST-9) — there is no
 * cross-surface case type, only this one shape reused by every surface's own `cases` list.
 *
 * **Case identity.** Neither this type nor the spec text gives a case its own `id`/`name` field; a
 * case's identity, for capture selection and for a capture's own per-case entries, is its own
 * (surface, zero-based index within that surface's `cases` array) pair — see `capture.ts`'s
 * `ParityCaptureCaseEntry`. Flagged in this piece's own report as a DECISION P3/P4/P6/P7 should
 * confirm rather than silently rely on.
 */
export interface ParityCase {
  readonly args?: readonly string[];
  readonly inputs?: readonly OverlayInput[];
  readonly outputs?: readonly DeclaredOutput[];
  readonly normalize?: readonly NormalizeRule[];
  readonly timeoutMs?: number;
  readonly outputCapBytes?: number;
  readonly expect?: ExpectedExit;
}

/**
 * One declared surface: its vetted `run`, an optional vetted `setup` (scratch tree only, at capture),
 * which streams it observes (`process`/`library` only — `undefined` means both), the `http` surface's
 * required `network: 'loopback'` opt-in, its stability sample size, and its cases.
 *
 * `stability` is never left implicit in a PARSED declaration: `declaration.ts`'s loader materialises
 * the spec's own default (`{ runs: 3 }`) when a surface omits the key, so two declarations that mean
 * the same stability sample size digest identically whether or not their author wrote it out — see
 * that module's own DECISION note.
 */
export interface SurfaceDeclaration {
  readonly run: string;
  readonly setup?: readonly string[];
  readonly streams?: readonly ProcessStream[];
  readonly network?: 'loopback';
  readonly stability: { readonly runs: number };
  readonly cases: readonly ParityCase[];
}

/** A human's declaration that one surface of this declaration genuinely cannot be observed — the
 * shape of an F-TEST-8 exemption (`13` F-TEST-9). */
export interface UnobservableEntry {
  readonly surface: SurfaceKind;
  readonly reason: string;
  readonly owner: string;
  readonly expiry: string;
}

/**
 * A full, structurally valid parity declaration (`13` F-TEST-9) — the parsed form of
 * `.forge/parity/<name>.parity.yaml`. Producing one is `declaration.ts`'s job; this type is the
 * contract every later piece imports.
 *
 * `surfaces` and `unobservable` are never `undefined` on a successfully parsed declaration (an
 * absent YAML key for either becomes `{}`/`[]`), so a reader never needs its own `?? {}`/`?? []`.
 */
export interface ParityDeclaration {
  readonly name: string;
  readonly reference: { readonly ref: string };
  readonly review: { readonly by: string; readonly basis: string; readonly at: string };
  readonly expires: string;
  readonly surfaces: Readonly<Partial<Record<SurfaceKind, SurfaceDeclaration>>>;
  readonly unobservable: readonly UnobservableEntry[];
}
