# PLAN-M4 — Adapter kit and the fake adapter

Source: `specs/22` M4. **Build:** `@forge/adapter-kit` (the `PlatformAdapter` interface, `AdapterEvent`
normalisation, `ToolGrant` mapping helpers, control-token parsing/stripping, untrusted-content wrapping,
the 16-test conformance suite); `@forge/testkit` with `FakePlatformAdapter` (scripted responses,
capability degradation, failure injection, replay). **Do not build:** the Claude Code adapter (`07`
§7.3, M7), the CodeMachine adapter (`07` §7.4, M11), the generic declarative CLI adapter (`07` §7.5,
M11) — this milestone builds the interface, the suite every adapter must pass, and one adapter
(`FakePlatformAdapter`) that proves both are usable, nothing that talks to a real coding-agent platform.

Five pieces. `02` §2.2's dependency graph: `adapter-kit ← schemas, telemetry`; `adapter-* ← adapter-kit,
schemas, telemetry`. `@forge/telemetry` is not built until M5 (`specs/22` M5's own Build line) — a real
forward-dependency conflict, not a spec silence. Resolved the same way Q43 resolved M3's own
CLI-doesn't-exist-yet conflict: nothing in this milestone's own Surface calls into a telemetry package
that cannot exist yet. Anywhere `02`'s prose implies "this gets logged" (control-token stripping →
`InjectionAttemptBlocked`, `20` §20.5), the function returns the structured fact as data instead of
calling a logger itself — the caller (M5's engine, once telemetry exists) decides where it goes. See
`SPEC-QUESTIONS.md` Q57.

One spec source, normative: `specs/07-platform-adapters.md` §7.1–§7.2 (the interface, verbatim where
given), §7.6 (the conformance suite, verbatim). `specs/15-customization-and-user-freedom.md` §15.6 adds
two capability flags and two provisioning hooks to the same interface, and two more conformance tests
(C15/C16) — already folded into §7.2's own listing in this repo's read of the spec pack, not built
twice. `specs/05-agent-system.md` §5.4 point 6 and §5.5, and `specs/20-security-safety-and-cost.md`
§20.5, are normative for control tokens and untrusted-content handling — `07` only shows the *shape*
these produce (`AdapterEvent{type:'control'}`, `ParsedControlToken`), not the parsing/stripping rules
themselves, which live in `05`/`20`.

Two new packages: `packages/adapter-kit`, `packages/testkit`; neither exists yet.

---

## P1 — Core adapter types, control-token schemas, and `AdapterEvent` normalisation

**Mandate:** transcribe `07` §7.2's `PlatformAdapter` interface and every type it names, folding in
`15` §15.6's two capability flags and two provisioning hooks. A large fraction of the named types
(`PreflightContext`, `PreflightResult`, `ModelInfo`, `ResumeRequest`, `AssetContext`, `InstalledAsset`,
`StructuredRequest<T>`, `ResolvedSkill`, `SessionContext`, `SkillProvisioning`, `GrantedMcpServer`,
`McpProvisioning`, `ForgeControlToken`, `ParsedControlToken`) are referenced by name only, never given
field-level shape anywhere in the spec pack — designed here from what the surrounding prose says each
one is used for, recorded in `SPEC-QUESTIONS.md` Q58. Build `normalizeAdapterEvent`, the one piece of
real runtime logic this piece owns: every future adapter (an SDK's own event objects, CLI NDJSON, a
generic YAML-mapped stream) produces its own raw shape, and this is the one gate every raw event is
squeezed through before it becomes a typed `AdapterEvent` the rest of FORGE can trust.

**Spec:** `07` §7.1–§7.2 (interface, verbatim); `15` §15.6 (capability/hook additions, verbatim);
`05` §5.5 last line ("Structured control tokens... turned into engine events... each has a schema") for
`ParsedControlToken`'s own contract.

**Surface:** `@forge/adapter-kit/types`, `@forge/adapter-kit/events`
- Every interface/type from `07` §7.2 + `15` §15.6, as TypeScript types — `PlatformAdapter`,
  `AdapterCapabilities`, `SessionRequest`, `SessionHandle`, `AdapterEvent`, `SessionResult`,
  `ToolGrant`, plus the under-specified types named above, each with a one-line doc comment stating the
  field choices made and pointing at Q58.
- `adapterEventSchema` — a Zod discriminated union mirroring `AdapterEvent` exactly (one variant per
  `type`), for `normalizeAdapterEvent`'s own use and for any future adapter that wants to validate its
  own emission before it leaves the process boundary.
- `normalizeAdapterEvent(raw: unknown): NormalizeAdapterEventResult` — a discriminated result (`{ok:
  true, event} | {ok:false, issue}`), never a thrown `ForgeError`: `02` §2.2's own graph gives
  `adapter-kit ← schemas, telemetry`, no `core` edge, so `ForgeError` (`@forge/core/errors`) is
  structurally unreachable from this package — the same position-in-the-graph reason
  `@forge/schemas` itself never throws (`SPEC-QUESTIONS.md` Q58 point 15).
- `ForgeControlToken`/`ParsedControlToken` — the closed set from `05` §5.5/§15.4.3:
  `FORGE_REQUEST_CONTEXT`, `FORGE_ASK`, `FORGE_ASSUME`, `FORGE_HANDOFF`, `FORGE_REQUEST_CHANGE`,
  `FORGE_CONFLICT`, `FORGE_LOAD_SKILL`. The type only — declared here since `AdapterEvent{type:
  'control'}`/`SessionResult.controlTokens` both need it at this layer; the per-token Zod payload
  schemas and the parser that actually produces a `ParsedControlToken` are P3's own job, not this
  piece's (they are not needed by anything in P1's own Surface).

**Checks:**
- Every `AdapterEvent` variant `07` §7.2 lists round-trips through `adapterEventSchema` unchanged.
- `normalizeAdapterEvent` accepts a realistic raw shape per variant (`{ ok: true, event }`) and rejects
  a shape missing a required field, extra-field-strict (`{ ok: false, issue }` naming the field path).
- No public type in this piece references anything outside `@forge/schemas`/Node/Zod built-ins —
  `02` §2.2's `adapter-kit ← schemas, telemetry` line, minus the telemetry half (Q57).

**Depends on:** nothing new (first piece).

*(P1 is committed: `02edf73`.)*

---

## P2 — `ToolGrant` mapping helpers

**Mandate:** `07` §7.2's own mandate — "Adapters MUST fail closed: if a grant cannot be expressed...
the adapter reports `unsupported`" — needs one shared, correctly-tested implementation, not one
per future adapter. Generic helpers over `ToolGrant` any concrete adapter (M7, M11) calls rather than
reimplementing exec-pattern matching or network-allowlist checks itself.

**Spec:** `07` §7.2's tool-grant-mapping paragraph (verbatim: fail-closed is normative, not a suggestion).

**Surface:** `@forge/adapter-kit/grants`
- `isExecAllowed(grant: ToolGrant, command: string): boolean` — `false` when `grant.exec === false` or
  `command` matches no pattern in `grant.exec`; pattern syntax is a simple prefix/glob (`"pnpm test*"`)
  per `07` §7.2's own worked examples, not a full glob engine (`SPEC-QUESTIONS.md` Q58).
- `isHostAllowed(grant: ToolGrant, host: string): boolean` — `network: 'none'` always `false`,
  `'full'` always `true`, `'allowlist'` checks `host` against `grant.allowlistHosts`.
- `describeGrant(grant: ToolGrant): string` — one deterministic, stable line for an audit/escalation
  log entry (`20` §20.9's own "every tool-ceiling escalation... shown" — this is the line shown).

**Checks:**
- Exec: exact match, prefix-wildcard match, `false` denies everything, `[]` denies everything
  (an empty allowlist is not "everything," the same fail-closed reading as a missing grant).
- Network: all three `network` values behave as stated; `allowlistHosts` absent + `'allowlist'` denies
  everything (fail closed, never silently permissive).
- `describeGrant` output is identical for two structurally-identical grants regardless of object
  identity or key insertion order (R10).

**Depends on:** P1 (`ToolGrant`).

*(P2 is committed: `d8e49a1`.)*

---

## P3 — Control tokens: parsing, and untrusted-content wrapping/stripping

**Mandate:** `05` §5.5's "Structured control tokens (`FORGE_*`) are parsed out of agent output... each
has a schema; unknown tokens are logged and ignored" and `20` §20.5's five untrusted-content controls
(points 1–2 are this piece's job; taint propagation, structural defence and output scanning are engine
concerns, later milestones) — implemented as the one shared parser/wrapper/stripper every adapter and
every future untrusted-content consumer (MCP results, fetched pages) calls.

**Spec:** `05` §5.4 point 6, §5.5; `20` §20.5 points 1–2 (verbatim: delimit-and-label, strip-and-report).

**Surface:** `@forge/adapter-kit/control-tokens`
- `parseControlTokens(text: string): { tokens: readonly ParsedControlToken[]; unknownLines: readonly string[] }` —
  line-anchored `FORGE_TOKEN: payload` syntax, matching `05`'s own worked examples
  (`FORGE_REQUEST_CONTEXT: <kb-id|query>`, `FORGE_HANDOFF: <role> <reason>`, ...); a `FORGE_`-prefixed
  line naming an unregistered token lands in `unknownLines`, not an error — "logged and ignored," not
  "rejected."
- `wrapUntrustedContent(text: string, source: string): string` — a delimited, labelled block declaring
  `text` is external data, not instructions; the delimiter is chosen so a nested occurrence of the same
  delimiter *inside* `text` cannot forge a fake close boundary (`SPEC-QUESTIONS.md` Q58).
- `stripControlTokens(text: string): { text: string; stripped: readonly ParsedControlToken[] }` — same
  line-anchored recognition as `parseControlTokens`, removing every recognised token line and returning
  what was removed, so a caller can log `InjectionAttemptBlocked` (`20` §20.5 point 2) — this piece
  returns the fact, per Q57; it does not log anything itself.

**Checks:**
- Every one of the seven named tokens parses its own spec-given worked-example syntax.
- A `FORGE_`-shaped but unregistered token is captured in `unknownLines`, not dropped silently and not
  thrown.
- A token mid-sentence (not line-anchored, e.g. "...so I'll FORGE_ASK: is this right?") is not parsed
  as a real token — only a line whose own content starts with the token name counts, matching every
  spec worked example's own presentation.
- `wrapUntrustedContent`: content containing the delimiter string itself cannot break out of the
  wrapped block (an adversarial-content test, not just a happy-path one).
- `stripControlTokens` removes every real token line, changes nothing else in the text, and its
  `stripped` list matches exactly what `parseControlTokens` alone would have found in the same text.

**Depends on:** P1 (`ForgeControlToken`, `ParsedControlToken`).

*(P3 is committed: `f749b7b`. `wrapUntrustedContent`'s return type changed from `string` to
`{ wrapped, stripped, unknownLines }` during the gauntlet loop — see `SPEC-QUESTIONS.md` Q59's
critic-round and verify-round addenda.)*

---

## P4 — Adapter conformance suite (`07` §7.6, C1–C16)

**Mandate:** the 16-test suite `@forge/adapter-kit/conformance` exports, runnable against *any*
`PlatformAdapter` — the fake adapter here (P5), a real one in M7/M11. Exported as a function that
registers real vitest `describe`/`it` blocks against a caller-supplied adapter factory, not a report
generator — `forge doctor --adapter <id> --conformance` (a later milestone's CLI) is a thin wrapper
around running this same suite and reading its pass/fail.

**Spec:** `07` §7.6's table, verbatim (C1–C14) plus `15` §15.6's addition (C15–C16). "Adapters that fail
C2, C5, C13, C14 or C16 MUST be rejected at load time" — these five get their own explicit, separately
assertable safety-critical marking in the suite's own output, not folded anonymously into the other 11.

**Surface:** `@forge/adapter-kit/conformance`
- `runAdapterConformanceSuite(createAdapter: () => PlatformAdapter | Promise<PlatformAdapter>, options: ConformanceOptions): void` —
  called from a consuming package's own `*.test.ts` file (this package depends on `vitest`'s test
  globals to register cases into whichever file calls it); `options` carries the scratch-directory
  factory and any fixture inputs a specific test needs (a prompt that should trigger a file write, one
  that should trigger a tool call, ...) since a scripted fake adapter and a real platform need different
  prompts to elicit the same behaviour.
- `SAFETY_CRITICAL_CONFORMANCE_IDS = ['C2','C5','C13','C14','C16']` — exported so a caller (this
  milestone's own P5 test, and any future `forge doctor` wrapper) can assert specifically that none of
  these five are the ones that failed, matching the spec's own load-time-rejection line precisely.

**Checks:**
- All 16 cases (C1–C16) exist and each asserts exactly what its own table row says.
- Run against a deliberately-*non*-compliant minimal stub adapter built only inside this piece's own
  test file (never exported): confirms the suite's own assertions actually fail closed (a stub that
  writes outside the given `cwd` fails C2; one that leaks an orphan child process fails C5; one that
  exposes an ungranted MCP tool fails C16) — proving the suite catches violations, not just that a
  correct adapter happens to pass it.
- Run against a fully-compliant minimal stub adapter (also test-local): all 16 pass, proving the suite
  is satisfiable at all and not accidentally over-strict.

**Depends on:** P1 (`PlatformAdapter` and every referenced type), P3 (`ParsedControlToken`, for C10's
own expected-shape assertion).

*(P4 is committed: `ee821dc`. See `SPEC-QUESTIONS.md` Q60 and its critic-round/verify-round addenda for
the observation-mechanism design decisions each check needed.)*

---

## P5 — `@forge/testkit`: `FakePlatformAdapter`

**Mandate:** a fully spec-compliant, in-memory `PlatformAdapter` — the one adapter every other future
FORGE package (engine, TUI, agents) tests against instead of a real, costly, non-deterministic coding
platform. `PLAN-M4.md`'s own milestone acceptance criterion, verbatim: "the fake adapter passes all 16
conformance tests." Scripted responses, capability degradation simulation, failure injection, and NDJSON
replay are the four named capabilities `specs/22`'s own M4 Build line lists.

**Spec:** `07` §7.2 (the interface this implements), §7.6 (the suite it must pass); `21` §21.3's own
"Degradation: for each capability turned off, the documented fallback is exercised and asserted" —
this piece is what makes that later-milestone test possible, not what performs it itself.

**Surface:** `@forge/testkit`
- `FakePlatformAdapter` — implements `PlatformAdapter` in full (every optional method too, since a
  fake adapter with everything "on" is what proves the interface itself is implementable end to end).
- `FakeSessionScript` — a caller-supplied, per-`SessionRequest`-matching script describing what a
  session "does": text/thinking events to emit, tool calls to claim, files to actually write into the
  given `cwd` (so C2/C14 have something real to assert against), a final result. Unscripted requests
  get a minimal default script (emits one text event, ends `complete`) so the fake adapter never hangs
  waiting for a caller to script every possible input.
- `withCapabilities(overrides: Partial<AdapterCapabilities>): FakePlatformAdapter` — returns a fake
  adapter reporting the given capability subset, refusing (not silently ignoring) any request that
  needs a capability it was configured without — this is the "capability degradation simulation" a
  later milestone's own degradation-fallback tests run against.
- `injectFailure(match: SessionRequestMatcher, failure: 'error' | 'timeout' | 'abort'): void` — the
  next matching `startSession` call fails the given way instead of running its script.
- `replayFromNdjson(path: string): SessionHandle` — replays a previously-recorded `AdapterEvent` stream
  (through `normalizeAdapterEvent`, P1) as a session's own live event stream, for deterministic
  re-testing of a captured real run.

**Checks:**
- `runAdapterConformanceSuite(() => new FakePlatformAdapter())` (P4): all 16 pass, none of
  `SAFETY_CRITICAL_CONFORMANCE_IDS` among any failure — the milestone's own top-line acceptance
  criterion, asserted directly, not by inspection.
- A scripted session's claimed file writes actually land in the given `cwd` and nowhere else.
- `withCapabilities({ sessionResume: false })`: `resumeSession` refuses with a typed, actionable error
  rather than pretending to resume.
- `withCapabilities({ mcp: false, toolProxy: false })` + a session requiring a granted MCP server:
  refused with a precise message naming the server, matching `07` §7.4's own degradation-matrix wording
  for the identical situation on a real adapter.
- `injectFailure` produces exactly the requested failure shape (`error`/`timeout`/`abort`) and no
  others; an unmatched request is unaffected by an injection registered for a different matcher.
- `replayFromNdjson` against a real recorded stream reproduces the identical event sequence
  (byte-identical after JSON round-trip) — determinism (R10) for replay specifically, not just live
  scripting.
- Control tokens inside a *scripted* untrusted-content input (P3) are stripped before the session's own
  text events are emitted — `FakePlatformAdapter` is where "control tokens inside untrusted content are
  stripped and logged, never executed" (M4's own #2 acceptance criterion) gets its first real exercise.

**Depends on:** P1, P2, P3, P4 (must pass P4's own suite as its defining Check).

---

*(adapter-kit track (P1–P5) complete — `@forge/adapter-kit` and `@forge/testkit` both closed out; M4
done. Nothing above builds a real coding-platform adapter — that is M7 (`Claude Code`) and M11
(`CodeMachine`, the generic declarative adapter).)*
