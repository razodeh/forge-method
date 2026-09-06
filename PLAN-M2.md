# PLAN-M2 — Customization layering (`@forge/extensions`)

Source: `specs/22` M2. **Build:** the five-layer resolver (`15` §15.2); merge semantics with all
array operators; `$extends`; compile pipeline producing the resolved set; provenance tracking per
field; `forge compile` and `forge overlay explain` as library functions; ceiling enforcement; the
twelve invariant checks (`15` §15.10) with their error codes; skill packet parsing and validation;
MCP registry parsing and grant validation; preset application and eject. **Do not build:** overlay
bundle fetching from npm/git (M11), the Customize TUI screen (M9), any adapter-side provisioning
(`15` §15.6 — that is `@forge/adapter-kit`'s surface, M4).

Nine pieces, dependency-ordered. Each has its own public surface, its own tests, and a one-sentence
mandate, so each can be judged alone against `QUALITY-BAR.md`. Production-code budget is ≤ ~400 lines
per piece (data files excluded from the count; tests excluded).

`@forge/extensions` depends on `@forge/schemas`, `@forge/core`, `@forge/templates` only (`02` §2.2's
dependency graph: `extensions ← schemas, core, templates`) — no engine, adapter, or KB dependency
anywhere in this milestone.

Legend: **Surface** = what the piece exports. **Checks** = the acceptance evidence a judge reads.

---

## P1 — The overlay merge engine

**Mandate:** apply one overlay document onto one base document with JSON-Merge-Patch scalar/object
semantics plus the six explicit array operators, in the fixed order the spec gives, refusing an
unrecognised operator rather than ignoring it.

**Spec:** `15` §15.2 ("Merge semantics" subsection).

**Surface:** `@forge/extensions/merge`
- `type ArrayOperator = '$set' | '$append' | '$prepend' | '$remove' | '$replaceWhere' | '$clear'`.
- `applyOverlay(base: unknown, overlay: unknown): unknown` — throws a `ForgeError` (new `CFG-4xx`
  code(s); no spec page fixes the exact number, so this piece picks the next free slot and records
  the choice in `SPEC-QUESTIONS.md`) for an unrecognised operator key or a shape the patch cannot
  apply to (an array operator object appearing where the base is not an array, etc.).
- `mergeScalarOrObject` semantics: RFC 7386 (JSON Merge Patch) is the base behaviour the spec's own
  examples build on — a `null` value in the overlay deletes the corresponding base key; every other
  scalar or object value replaces or recursively merges.

**Checks:**
- Every one of the six operators works alone, exactly as `15` §15.2's own worked example shows:
  `$append`/`$prepend` add without disturbing existing order; `$remove` removes by value (a plain
  array) or by `id` (an array of objects); `$replaceWhere` matches on `id` and merges the matched
  element rather than replacing it wholesale; `$clear` empties the array regardless of its current
  contents; `$set` replaces the whole array.
- Operators compose on the same array in one overlay (the spec's own `tools.allowlistHosts: $set`
  next to `skills: $append` + `$remove` in one document) and apply in the documented order.
- An overlay key that looks like an operator but isn't one of the six (a typo, `$appand`) is a
  refused compile error naming the bad key and the field path, never silently dropped or treated as
  a literal object key.
- `$append_guidance` is a first-class field per the spec's explicit emphasis, not something a caller
  has to build out of `$append` — appending a guidance paragraph works with one field, not a
  fork of a whole prompt.
- Determinism (R10): `applyOverlay(base, overlay)` is a pure function — object key iteration order
  in either input never changes the result plus no reliance on `Date`/RNG anywhere.

**Depends on:** nothing (`@forge/core`'s `ForgeError` only).

*(P1 is committed: `f9da688`.)*

---

## P2 — The five-layer resolver, `$extends`, and per-field provenance

**Mandate:** resolve L0–L4 sources for one entity into one merged document, deepest layer wins, with
every field traceable to the layer that supplied it.

**Spec:** `15` §15.2 ("The layering and override model" through "Upgrade safety").

**Surface:** `@forge/extensions/resolve`
- `type Layer = 'L0' | 'L1' | 'L2' | 'L3' | 'L4'` (built-in / module / org / project / personal).
- `interface LayerContribution { readonly layer: Layer; readonly source: string; readonly document: unknown }`
  — `source` is a human-readable origin (a file path or module id) for diagnostics, not part of the
  merge itself.
- `class Resolver { resolve(id: string, contributions: readonly LayerContribution[]): ResolvedEntity }`
  — applies P1's `applyOverlay` in `L0 → L1 → … → L4` order; honours a contribution's own
  `$extends: <id>` to resolve against a different base id than its own (default: the same id).
- `interface ResolvedEntity { readonly value: unknown; readonly provenance: ReadonlyMap<FieldPath, Layer> }`.
- `explainField(entity: ResolvedEntity, path: FieldPath): Layer | undefined`.

**Checks:**
- Deepest wins: an L3 project override beats every L1 module and L0 default for the same field; an
  L4 personal override beats L3.
- `$extends` omitted resolves against the contribution's own id (the default the spec states); an
  explicit `$extends: backend` on an overlay filed under a different id resolves against `backend`
  instead.
- Per-field provenance is correct across all five layers (`AC15-2`): for a resolved object built from
  contributions at three different layers, every field's `explainField` names the actual layer that
  last touched it — not merely "the deepest layer that contributed anything."
- Two L1 modules contributing conflicting fields for the same entity resolve by module install order
  (the order `contributions` lists them in) and produce a compile-time warning naming both modules and
  the field, per `15` §15.2 rule 4 — the resolution is never silent.
- A later layer's `$replaceWhere`/field-path target that does not exist in what the earlier layers
  produced is a specific, named error (`15` §15.2's own worked example: `CFG-04x overlay target not
  found`) rather than a silent no-op or a crash — implemented as `CFG-012`, checked against the ids a
  same-directive `$set`/`$append`/`$prepend`/`$remove` would actually leave in place (matching
  `applyOverlay`'s fixed operator order), not only against the base as it stood before the directive.
- Determinism (R10): resolving the same `contributions` array twice, or with two same-layer,
  non-conflicting contributions swapped, produces byte-identical `value` and `provenance`.

**Depends on:** P1.

*(P1, P2 are committed: `f9da688`, `44fd9db`.)*

---

## P3 — Agent overlays: schema, roster composition, tool ceilings

**Mandate:** give an agent overlay document the exact changeable/constrained/immutable shape `15`
§15.3.1's table specifies, and enforce ceiling-bound tool grants and required-role roster rules.

**Spec:** `15` §15.3 (all subsections); `19` §19.1's `module.yaml` `ceilings` field (the ceiling a
project overlay is bound by is declared by the *module*, not invented here).

**Surface:** `@forge/extensions/agents`
- `agentOverlaySchema` (zod) — every `15` §15.3.1 field, with `gates.may_approve`, `tier`, and `id`
  rejected outright if an overlay document sets them (`.strict()`-adjacent refinement, not merely
  "unknown key," since these ARE known base-agent keys that an overlay specifically may not touch).
- `rosterConfigSchema` — `preset`, `enable`, `disable`, `alias`, `add`, `split` per §15.3.3's example.
- `REQUIRED_ROLES: readonly { role: string; minLevel: 'L0'|'L1'|'L2' }[]` — `orchestrator`, `pm`
  (L2+), `architect` (L2+), `test-architect` (L1+), `reviewer`, `diagnostician`.
- `checkToolCeiling(ceiling: ToolGrant, requested: ToolGrant, escalations: readonly Escalation[]): CeilingResult`.

**Checks:**
- An overlay setting `gates.may_approve`, `tier`, or `id` is a compile error naming the field and
  pointing at "create a new agent instead" (the spec's own remedy for `tier`/`id`).
- `limits.*` may be raised up to a module's declared ceiling with no escalation; raising past it
  without a matching `security.toolCeilingEscalations` entry naming the same agent is refused;
  raising past it *with* a matching entry succeeds and the escalation is recorded as active.
- An escalation granting `write: true` to a role whose base grants mark it a review/critic role, or
  `deploy: true` to a role not tagged `ops`, is refused outright — `15` §15.3.2's named exception,
  not a general ceiling rule.
- `roster.disable: [reviewer]` or `[test-architect]` is refused, with a message naming `autonomy`
  settings as the alternative, per the spec's own required wording.
- `roster.split` produces the declared sibling agents with their own `file_ownership`; two siblings
  declaring overlapping `exclusive` file claims is refused.
- A custom agent added via `roster.add` missing `decisions_owned`, `outputs`, `file_ownership`, or
  `tools` is refused — "there is no unconstrained agent" (§15.3.4), checked here at the schema level;
  the cross-cutting invariant framing of the same rule (I11) is P8's to assert as one of the twelve.

**Depends on:** P1, P2.

*(P1, P2, P3 are committed: `f9da688`, `44fd9db`, `868b35e`.)*

---

## P4 — Skill packets: parsing and validation

**Mandate:** parse a Skill package's front matter and directory layout, and validate it against every
rule `15` §15.4.5 lists by name.

**Spec:** `15` §15.4 (all subsections).

**Surface:** `@forge/extensions/skills`
- `skillFrontMatterSchema` (zod) — `id`, `name`, `version`, `description`, `when_to_use`,
  `applies_to`, `activation` (`'auto'|'explicit'|'always'`), `budget_tokens`, `requires_tools`,
  `scripts`, `provides_checks`, `forge_version`.
- `parseSkillPackage(dir: AbsolutePath): ParsedSkill` — reads `SKILL.md` plus what's present of
  `references/`, `examples/`, `scripts/`, `assets/`.
- `validateSkill(skill: ParsedSkill): SkillValidationOutcome` — never throws (matching
  `@forge/schemas`' established "validation returns, it does not throw" precedent, `SPEC-QUESTIONS.md`
  Q3, since this is exactly that kind of boundary-input check).
- `INJECTION_PATTERNS: readonly RegExp[]` — the concrete patterns `15` §15.10's I9 paragraph names by
  example ("ignore previous instructions", "you may write to", "approve the gate", any `FORGE_*`
  token), exported so P8's I9 check and this piece's own validator share one list rather than two
  that can drift apart.

**Checks:**
- Every file under `references/` is linked from the body, and every reference link in the body
  resolves to a real file — bidirectional, per "dead-weight detection."
- A body under `budget_tokens` passes silently; over `budget_tokens` but under a hard cap is a
  warning; over the hard cap is an error.
- `scripts[].run` naming a file that doesn't exist, or existing but not executable, is refused;
  `scripts[].grant` outside a closed, known capability set is refused.
- A skill body containing any `INJECTION_PATTERNS` match is refused at validation time — `AC15-7`'s
  compile-time half (the runtime-strip half is adapter-layer, M4+/M7+, out of scope here).
- A secret-shaped literal (an API-key-looking string, not a `${secret:...}` reference) in a skill body
  is refused, matching §15.4.5's "no secrets" line.
- `forge skill validate` catches size, dead references, injection-shaped content and secrets — the
  exact four things `specs/22`'s own M2 acceptance line names for this piece.

**Depends on:** P1, P2.

*(P1, P2, P3, P4 are committed: `f9da688`, `44fd9db`, `868b35e`, `5b6c381`.)*

---

## P5 — MCP registry: parsing and grant validation

**Mandate:** parse the MCP server registry and role grants, and enforce every structural rule in `15`
§15.5.2 that does not require a live session (secret *resolution*, the injection *runtime* strip, and
actual server handshakes are all out of scope — those need a running adapter, M4+).

**Spec:** `15` §15.5.1–§15.5.3 (§15.5.4's compile-time half only: the *shape* of what must be treated
as untrusted, not the runtime wrapping itself).

**Surface:** `@forge/extensions/mcp`
- `mcpServerSchema` (zod) — `id`, `transport` (`'stdio'|'http'|'sse'`), `command`/`args`/`env` or
  `url`, `timeoutMs`, `trust` (`'internal'|'vendor'|'community'|'untrusted'`), `readOnly`,
  `environments`.
- `mcpGrantsSchema` — role → server id → tool name list, plus `defaults.grantMode` and
  `defaults.injectionPosture`.
- `secretReferenceSchema` — validates `${secret:<name>}` *syntax* only; resolving a secret is a
  runtime concern this package never performs.
- `validateMcpConfig(config): McpValidationOutcome` (never throws, same reasoning as P4).

**Checks:**
- A `readOnly: false` server granted to a role tagged `reviewer`, `critic`, or `diagnostician` is
  refused outright, regardless of `grantMode`.
- `grantMode: explicit` (the default) requires every grant to name specific tools; a server-wide grant
  is only accepted under `grantMode: server-wide`, and is reported as such (§15.5.2 rule 2).
- A server declaring `environments: [dev, staging]` contributes no grant when resolved for a
  production-targeted run (a parameter this function takes, not something it infers).
- A value in an `env`/`args` field that is not `${secret:<name>}`-shaped but looks like it was meant
  to be (a bare token resembling an API key) is flagged — matching §15.4.5/§15.5.3's "no secrets"
  posture applied to MCP config, not only skills.
- No ambient MCP: `validateMcpConfig` only ever reports grants for servers explicitly present in
  `config.servers` — there is no code path here that could pick up a host platform's own MCP config,
  since that inheritance (`mcp.adoptHostServers`) is itself an explicit, adapter-layer opt-in (M4+).

**Depends on:** P1, P2.

*(P1, P2, P3, P4, P5 are committed: `f9da688`, `44fd9db`, `868b35e`, `5b6c381`, `7705672`.)*

---

## P6 — Workflow, gate-check, framework, and template overlays

**Mandate:** give each of the four remaining overlay-able document kinds (C6–C9) its schema and the
specific guardrail `15` §15.7 names for it.

**Spec:** `15` §15.7.

**Surface:** `@forge/extensions/workflows`
- `workflowOverlaySchema` — steps via `$replaceWhere`/`$remove`/a workflow-scoped `$insertAfter`
  (anchor + steps), on top of P1's six base operators.
- `gateCheckSchema` — `id`, `run`, `parser`, `failOn`, `remedy`, `appliesTo.gates`, `severity`.
- `frameworkOverlaySchema` — `criteria.$replaceWhere` (weights), `options.$remove`/`$append`,
  `rules.$append`.
- `templateOverlaySchema` — a template overlay plus `requiredFieldsFor(artifactType): readonly string[]`,
  reading `@forge/schemas`' per-type zod schema (M1) to know which fields must survive.

**Checks:**
- A workflow overlay's `$remove` naming a gate step, a `red` (test-first) step, or a `review` step is
  refused with a message naming the step id and which of the three protected categories it is —
  `GATE-9xx` per the spec's own text; the exact number is this piece's to pick and record.
- `$insertAfter` anchored on a real step id inserts the new steps immediately after it without
  reordering anything else; anchored on a step id that doesn't exist is refused.
- A custom gate check missing any of `id`/`run`/`failOn`/`remedy` is refused; a valid one is
  attachable to `appliesTo.gates` and carries `severity` through unchanged.
- Lowering a built-in check's threshold below "the module floor" (the ceiling-bearing module's own
  declared value, analogous to P3's tool ceilings) is detected and the delta recorded on the result —
  this piece records the fact; *printing* it in every gate report is M5's `GateReport` concern.
- A template overlay omitting a field `@forge/schemas`' real per-type schema (M1, P6/P7) marks
  required is refused, naming the missing field — never silently producing an artifact that fails
  validation later.
- Removing a framework via overlay while a gate config still names it is refused (the schema-level
  half of this rule; the cross-entity, whole-resolved-set version is P8's to assert if it turns out
  to need the full compiled set rather than just these two documents).

**Depends on:** P1, P2 (`@forge/schemas` for template field checks — already a declared dependency).

---

## P7 — Style profile and presets: schema, apply, eject

**Mandate:** give the style profile its schema, and make a preset a signed, atomically-applied bundle
of the other six pieces' overlay shapes that expands into ordinary, visible overlay files.

**Spec:** `15` §15.8, §15.9.

**Surface:** `@forge/extensions/style` — `styleProfileSchema` (zod, `15` §15.8's full field list).

`@forge/extensions/presets`
- `presetSchema` — a named bundle referencing overlay documents in every other piece's shape.
- `PRESET_REGISTRY: readonly PresetDefinition[]` — the five presets §15.9's table names
  (`solo-fast`, `startup-lean`, `enterprise-rigor`, `regulated`, `agency-delivery`), as data, each a
  minimal-but-real set of overlays expressing its documented posture (mirroring `@forge/templates`'
  stub-per-type precedent from M1 P11 — real, schema-valid content, not placeholders).
- `applyPreset(id: string, target: ProjectPaths): AppliedPreset` — writes the preset's overlays into
  the resolved layer they belong at.
- `ejectPreset(id: string): readonly OverlayFile[]` — the same overlays as plain files, with no
  runtime magic left implicit.

**Checks:**
- `applyPreset('enterprise-rigor')` then resolving, versus `ejectPreset('enterprise-rigor')`'s files
  applied as ordinary L3 overrides then resolving, produce byte-identical resolved output (`AC15-8`).
- Every preset in `PRESET_REGISTRY` validates against every relevant schema from P3–P6 — a preset is
  "just a bundle of the above" (§15.9), never a shape of its own that could drift from the rest.
- Applying a preset one of whose component overlays would fail validation on its own rejects the
  whole preset — atomic, not partial.
- `enterprise-rigor`'s and `regulated`'s postures are real, not nominal: `alwaysHuman` gates present
  where the table says so, `regulated` refuses write-capable MCP and `emerging`-maturity technology as
  its own description requires (a fixture-level check, not a new invariant).

**Depends on:** P1, P2, P3, P4, P5, P6.

---

## P8 — The twelve compile-time invariants (I1–I12)

**Mandate:** refuse every one of `15` §15.10's twelve scenarios, by name, with its documented error
code, given a resolved set (or the specific overlay slice each invariant needs) and a fixture built to
trigger exactly it.

**Spec:** `15` §15.10 (table + the I9 emphasis paragraph).

**Design note to resolve before this piece's error codes are added:** `15` §15.10 uses a `SEC-`
prefix (I7 `SEC-501`, I8 `SEC-502`, I9 `SEC-503`), but `@forge/core/errors`' `ErrorCodePrefix` is a
*closed* union of exactly ten prefixes (`02` §2.6) with no `SEC` member. This is a genuine spec
conflict — record it in `SPEC-QUESTIONS.md` before writing a single `SEC-*` code, with a recommended
resolution (most likely: fold I7/I8/I9 under `CFG-5xx`, since `02` §2.6 defines `CFG` as
"Configuration/validation" broadly enough to cover a refused overlay, and widening the closed
`ErrorCodePrefix` union is a much larger, cross-cutting change this piece should not make unilaterally).

**Surface:** `@forge/extensions/invariants`
- `type InvariantId = 'I1' | 'I2' | … | 'I12'`.
- `runInvariants(resolvedSet: ResolvedSet): readonly InvariantViolation[]`.

**Checks (one fixture per invariant, each asserting its specific code):**
- **I1** — a role configured to review, test, or diagnose its own output is refused.
- **I2** — the same agent instance authoring tests and implementation, or an implementer's
  `file_ownership` covering a test path, is refused.
- **I3** — scoped to what compile time can actually see: a gate config that would let itself be
  marked approved while a required deterministic check is disabled is refused. (The full rule —
  "cannot be approved with a *failing* check" — is a run-time gate-approval fact, M5's to enforce; this
  piece owns only the configuration-shape half. Record the split explicitly if it needs its own
  `SPEC-QUESTIONS` entry once the fixture is written.)
- **I4** — a gate defined with zero deterministic checks is refused.
- **I5** — an overlay attempting to downgrade an `alwaysHuman` gate's autonomy is refused.
- **I6** — an overlay disabling a required spec-graph traceability edge is refused, using
  `@forge/core/graph`'s `REQUIRED_EDGES` (M1, P14) as the source of what "required" means — a direct,
  real cross-milestone dependency, not a re-declared copy of the table.
- **I7** — a tool grant exceeding a module ceiling with no matching escalation is refused (re-asserts
  P3's ceiling check at the whole-resolved-set level, with the invariant's own code).
- **I8** — a secret literal (not a `${secret:...}` reference) anywhere in resolved prompts, artifacts,
  skills, or KB-bound overlay content is refused.
- **I9** — resolved skill or MCP content matching `@forge/extensions/skills`' `INJECTION_PATTERNS` is
  refused at the whole-set level (reuses P4's list; does not re-derive it).
- **I10** — an overlay disabling event-log, cost-ledger, or audit-trail configuration is refused.
- **I11** — a custom agent lacking mandate, outputs, or file ownership is refused (re-asserts P3's
  roster-add check at the invariant level).
- **I12** — a required role disabled below its applicable level (P3's `REQUIRED_ROLES`) is refused.
- All twelve fixtures are "malicious or careless," per `AC15-6`'s own wording — each is a plausible
  overlay a real project could accidentally write, not a contrived adversarial construction.

**Depends on:** P3, P4, P5, P6 (each invariant's fixture), `@forge/core/graph` (I6).

---

## P9 — The compile pipeline and `overlay explain`

**Mandate:** assemble every previous piece into the two library functions `15` §15.12 names —
`forge compile` and `forge overlay explain` — as plain functions with no CLI attached yet (the CLI
itself is `@forge/cli`, M6).

**Spec:** `15` §15.2 rules 1–3, §15.12 (library-function halves of `forge compile [--check]` and
`forge overlay explain <id>` only).

**Surface:** `@forge/extensions/compile`
- `interface CompileResult { readonly resolvedSet: ResolvedSet; readonly violations: readonly InvariantViolation[]; readonly warnings: readonly CompileWarning[] }`.
- `compile(sources: CompileSources, options?: { check?: boolean }): CompileResult`.
- `explainOverlay(result: CompileResult, entityKind: EntityKind, id: string): readonly FieldProvenanceEntry[]`.

**Checks:**
- `compile()` over a fixture five-layer input produces a resolved set covering every kind `15` §15.2
  rule 1 names (`agents, workflows, frameworks, templates, checks, skills`) — matching, not a subset.
- `compile({ check: true })` surfaces every invariant violation from P8 without partially returning a
  resolved set a caller could mistake for a clean compile.
- `explainOverlay` reproduces `AC15-2` exactly through the full pipeline (not just P2's unit-level
  guarantee): every field of a real, multi-layer fixture's resolved object names its true supplying
  layer end to end.
- Determinism (R10): compiling the same `sources` twice, and compiling with a same-layer, non-conflicting
  contribution order shuffled, produce byte-identical `resolvedSet` and identically-ordered
  `violations`/`warnings`.
- `specs/22`'s own M2 exit tests map onto this piece directly: `pnpm test -- packages/extensions
  --coverage` (≥90%, exercising everything built in P1–P9); `pnpm test -- --grep "invariant I"` (P8's
  twelve, re-run through this pipeline); `pnpm forge compile --check -C fixtures/customized` needs a
  real `forge` binary and a `fixtures/customized` host project, neither of which exists before
  `@forge/cli` (M6) — this piece implements the equivalent as a direct `compile({ check: true })` call
  against a fixture project built for this test, and records the literal CLI-invocation form as owed
  to whichever M6 piece first wires `forge compile` to this function.

**Depends on:** P1, P2, P3, P4, P5, P6, P7, P8.

---

## Exit tests for M2 (`specs/22`)

```
pnpm build && pnpm typecheck && pnpm lint && pnpm test
pnpm test -- packages/extensions --coverage        # ≥90% lines
pnpm test -- --grep "invariant I"                  # 12 tests, all asserting specific codes
```

The third exit test specs/22 gives — `pnpm forge compile --check -C fixtures/customized` — needs
`@forge/cli` (M6) to exist as a real binary; P9's own Checks record the library-level equivalent this
milestone can actually run, and the literal command is this milestone's debt to M6, not something to
fake here with a stub binary.

`specs/22`'s five M2 acceptance statements map to pieces as: array-operator/ordering correctness → P1;
per-field provenance across all five layers → P2; each invariant refusing its fixture with the
documented code → P8; skill validation catching size/dead-references/injection/secrets → P4; preset
eject byte-identical to direct application → P7.
