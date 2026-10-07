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

/**
 * The `http` surface's own request/response shape (`specs/22` M16 P8, `13` F-TEST-9's surfaces
 * bullet: "`http` observes a request/response pair"). One case belongs to exactly one surface
 * (`ParityCase`'s own doc comment), and this is the `http` case's entire request: method, path,
 * request headers, a literal body, and which RESPONSE headers to observe.
 *
 * **DECISION — why this is a sibling shape on `ParityCase`, not a reuse of `args`.** `args` composes
 * onto a surface's `run` as single-quoted shell words (`compose-args.ts`); an `http` surface's `run`
 * starts a SERVER once, and a case never composes anything onto it — see `observe.ts`'s own report
 * section on why the dispatch itself had to branch. `request` is additive and optional on the one
 * shared `ParityCase` shape (consistent with how `SurfaceDeclaration` already keeps `network`/
 * `streams` as kind-specific optional fields on one shared shape, enforced per-kind by
 * `declaration.ts`'s loader) rather than a wholly separate case type, so every surface's `cases` list
 * stays the one array type `PLAN-M16.md` P2 established. `declaration.ts`'s loader enforces that an
 * `http` case carries `request` (and never `args`/`outputs`/`expect`, none of which has a coherent
 * meaning for a request/response pair) and every other kind never carries `request`.
 *
 * **DECISION — `method`.** Required, and validated at load as an upper-case HTTP token
 * (`declaration.ts`'s own `HTTP_METHOD_PATTERN`): the spec text names no shape beyond "method", and
 * restricting to the conventional upper-case form (`GET`, `POST`, `DELETE`, ...) is the smallest
 * reading that avoids a silent `get`/`Get`/`GET` inconsistency a reviewer would not expect to matter.
 *
 * **DECISION — `path`.** Required, must start with exactly one `/` (never two or more —
 * `declaration.ts`'s own `hasSingleLeadingSlash`) and contain no ASCII control character
 * (`declaration.ts`'s own `unsafeHttpTextReason`): this is a request-target string sent verbatim on
 * the request line to a server this harness itself started on an explicit `host`/`port` (never parsed
 * as a URL that could redirect the TCP connection elsewhere — `http-client.ts`'s own doc comment), so
 * the one real risk it carries is request-line/header injection via an embedded CR/LF, which the
 * control-character check refuses outright. A leading "//" is refused too, even though it is
 * byte-for-byte inert for the identical "never parsed as a URL" reason — it reads like a
 * protocol-relative URL on review, which is confusing enough on its own to refuse outright.
 *
 * **DECISION — `headers`/`body`.** Literal values, exactly as a case's `args` are literal words: a
 * header name/value may not contain a CR, LF or NUL (`declaration.ts`'s own `unsafeHttpTextReason`)
 * for the identical request-line-injection reason `path` is checked; `body`, if given, is sent
 * verbatim as the request body with no transformation. A header NAME is held to a narrower charset
 * still — the RFC 7230 `tchar`/token set, never merely "no control character"
 * (`declaration.ts`'s own `unsafeHttpHeaderNameReason`) — because Node's own `http.request` enforces
 * that charset internally and throws a synchronous, unwrapped exception for anything outside it; a
 * header VALUE has no such narrower restriction here (RFC 7230 §3.2.6's own `field-value` already
 * permits most of what a control-character check alone would otherwise allow through).
 *
 * **DECISION — `responseHeaders`.** An explicit, OPT-IN allowlist of which response header names are
 * even part of the observation (lower-cased at load, since HTTP header names are case-insensitive) —
 * the inverse default of `process`'s own `streams` (which defaults to "observe both"). Absent means
 * NO headers are observed, deliberately: an ordinary HTTP server response carries at least a `Date`
 * header that changes on every single request, and the stability probe runs each case
 * `stability.runs` times and requires EVERY run to agree byte-for-byte (`13` F-TEST-9) — defaulting to
 * "observe every header" would make an ordinary, correctly-behaving server fixture `unstable` on its
 * very first declaration, for a reason that has nothing to do with the behaviour under test. A
 * reviewer who wants a header compared says so by name; one who selects a volatile header (`date`,
 * `set-cookie` with a fresh token, …) gets exactly the instability that selection deserves, which is
 * the correct, deliberate failure mode, not a trap the harness sets by default.
 */
export interface HttpRequestSpec {
  readonly method: string;
  readonly path: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: string;
  readonly responseHeaders?: readonly string[];
}

/**
 * The `http` surface's own readiness probe (`specs/22` M16 P8, Q294 Decision 7: "a readiness probe
 * with a timeout"). `path` is requested by a plain `GET` (the probe is a liveness check, not a case:
 * it has no method/headers/body of its own to declare — see `http-server.ts`'s own report section for
 * why `GET` specifically), and the server is considered ready the moment a complete HTTP response, of
 * ANY status code, is read back within `timeoutMs` of the server process starting.
 *
 * **DECISION — why ANY status counts as ready, not only 2xx.** The spec's own text fixes only "a
 * readiness probe with a timeout", not an expected status; requiring 2xx specifically would refuse a
 * server whose own health path legitimately answers 404 (no handler yet mounted during a cold start,
 * for one) or 401 (the convention some frameworks use for "cold but reachable") while still being
 * genuinely able to answer every declared case. "The TCP/HTTP stack is alive and this process is the
 * one answering it" — which ANY well-formed HTTP response proves — is the smallest, most honest
 * reading of "ready" a harness can enforce without also reviewing the project's own health-check
 * semantics, which this milestone does not ask for.
 */
export interface HttpReadinessProbe {
  readonly path: string;
  readonly timeoutMs: number;
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
  /** The `http` surface's own case shape — required on an `http` case, refused on every other kind
   * (`declaration.ts`'s loader). See {@link HttpRequestSpec}'s own doc comment for the full DECISION
   * record on its shape. */
  readonly request?: HttpRequestSpec;
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
  /** The `http` surface's own literal loopback port — required on an `http` surface, refused on
   * every other kind (`declaration.ts`'s loader). A literal port, never `0`/ephemeral or a range
   * (Q294 Decision 7, the plan's own Mandate: "a literal loopback port"): the harness's own pre-start
   * free check and every case's request both need one fixed number to agree on, and an ephemeral port
   * the OS chooses would give the pre-start check nothing to check against in advance. */
  readonly port?: number;
  /** The `http` surface's own readiness probe — required on an `http` surface, refused on every
   * other kind. See {@link HttpReadinessProbe}'s own doc comment for the full DECISION record. */
  readonly readiness?: HttpReadinessProbe;
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
