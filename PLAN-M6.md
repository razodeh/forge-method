# PLAN-M6 — Agents, method content and the headless CLI

Source: `specs/22` M6. **Build:** `@forge/agents` (registry, prompt compilation with all nine blocks,
handoff records, separation-of-duties enforcement, interaction modes); `@forge/methods` (framework
execution engine, rubric scoring, level selection); `@forge/catalog` (entries + selection engine);
`@forge/templates` with `fm-core` content — the full roster from `05` §5.2, the ten lifecycle
workflows, all gates and checks, the frameworks from `11`-`14`, base templates and skills; `@forge/cli`
with every non-interactive command from `03` (no TUI: `--no-tui` behaviour is the only mode). **Do not
build:** `fm-web`/`fm-service`/`fm-data`/`fm-mobile` (M10), sessions (M10), TUI (M9).

This is the largest milestone by content volume (M5 was the largest by engineering complexity). Five
packages, none of which exist yet except `@forge/templates` (M1 shipped its own 21 artifact-type
stubs; M6 adds `fm-core` content on top — workflows, gates, frameworks, base templates, skills — into
the same package) and `@forge/extensions` (M2, already ships the *overlay* schema and the customization
compile pipeline for agents/workflows/gate-checks/frameworks/templates/skills/MCP — `@forge/agents`
etc. build the *base* definitions and the runtime machinery M2 explicitly deferred, not a second overlay
system). Every piece below cites exactly which M2/M4/M5 surface it reuses rather than re-invents.

**Package dependency order** (`02` §2.2's own boundary graph, confirmed directly against
`tools/eslint-plugin-forge-boundaries/src/graph.mjs`):
`methods ← core, kb, schemas` · `catalog ← schemas` · `templates ← []` (already exists, self-contained)
· `agents ← core, kb, schemas, adapter-kit, templates, extensions` · `cli ← everything`.
So: `@forge/methods` and `@forge/catalog` first (no dependency on each other or on the content-heavy
packages), then `@forge/templates` content (workflows/gates/frameworks/skills — needs nothing from
`methods`/`catalog`/`agents` to exist as *data*, only `@forge/schemas`' already-built artifact schemas
and `@forge/engine`'s already-built workflow/gate DSL parsers to validate against), then `@forge/agents`
(needs `templates` for its own prompt/brief file references and skill attachments), then `@forge/cli`
last (depends on everything).

**Real, already-built surface this milestone reuses rather than re-invents** (confirmed by direct
inspection, not assumed):
- `@forge/engine/workflow`'s `parseWorkflow`/`validateWorkflow` (M5 P8-P9) — the workflow DSL parser
  already accepts *any* spec-conforming workflow; M6 ships real content through it, not a second parser.
- `@forge/engine/gates`' `evaluateGate` (M5 P14) — the generic gate-check runner already exists with no
  built-in knowledge of what any specific check means; M6 ships real gate/check content through it.
- `@forge/engine/plan`'s `compileRunPlan` (M5 P10-P11) — already compiles `fanout`/`parallel`/`sequence`
  and resolves the full `06` §6.2 `StepNode` shape; already treats `agent`/`brief` as opaque strings
  (`SPEC-QUESTIONS.md` Q62 part 2) that `@forge/agents`' registry now gives real meaning to.
- `@forge/kb/pack`'s `buildContextPack` (M3 P9) — `05` §5.4's context-pack mechanism (pinned core,
  declared inputs, retrieved KB entries, token budgeting) is already built; `@forge/agents`' own context
  packing (piece A4) is real *new* wiring (skill-body inclusion, the expansion protocol, external-content
  marking) layered on an existing, working pack builder, not a rebuild of it.
- `@forge/extensions/agents`' `agentOverlaySchema`/`REQUIRED_ROLES`/`checkToolCeiling` (M2 P3) — the
  *overlay* shape and roster-composition/ceiling rules already exist; confirmed directly (`roles.ts`)
  that no *base* agent schema or real roster content exists anywhere yet — that is this milestone's own
  job (piece A1/A2), designed to compose with M2's resolver (`@forge/extensions/resolve`), not duplicate
  its merge logic.
- `@forge/extensions/workflows`' `workflowOverlaySchema`/`gateCheckSchema`/`frameworkOverlaySchema`/
  `templateOverlaySchema` (M2 P6) — same relationship: M2 built the *overlay* shape for these four
  document kinds; M6 ships the *base* content they overlay onto.
- `@forge/extensions/compile`'s `compile()`/`explainOverlay()` (M2 P9) — already assembles every
  overlay-able document kind into one resolved set; `@forge/cli`'s own `forge compile`/`forge overlay
  explain` commands (piece C8) are thin CLI wrappers around this, not new logic.
- `@forge/adapter-kit/control-tokens`' `parseControlTokens`/`stripControlTokens` (M4) — the `FORGE_*`
  token grammar already exists generically; `@forge/agents`' handoff/separation-of-duties pieces consume
  already-parsed tokens (`FORGE_HANDOFF:`, etc.), they do not re-parse raw session text.
- `@forge/testkit`'s `FakePlatformAdapter` (M4) — every piece below that needs a real adapter session
  (prompt compilation output, interaction-mode dispatch) tests against this, never a real platform.

**A real, unresolved scoping question this plan does not silently resolve — flagged for its own
`SPEC-QUESTIONS.md` entry once piece A6 is actually built:** `05` §5.7's own "each [interaction] mode is
a workflow primitive (`10`), not ad-hoc code" is confirmed, on inspection of `10` §10.1's own worked
example, to mean something narrower than "a new `StepNodeKind`": `swarm-review` appears there as a bare
`mode:` field on an ordinary `agent`-kind step, not a new step kind. `Fan-out` is already `06`/`10`'s own
`fanout` kind (M5, already built) and needs nothing new. `Relay` is already expressible as an ordinary
sequential `dependsOn` chain with handoff records between agent steps — no new mechanism. `Solo` is the
existing, unmarked default. That leaves `Pair`, `Panel`, `Debate`, and `Swarm-review` as the four modes
whose real semantics (multiple sessions or a continuous co-reviewer within what the DAG still sees as
one node) are not obviously expressible with M5's `@forge/engine/plan`/`@forge/engine/dispatch` exactly
as they stand today — piece A6 must determine, empirically, whether `mode`-bearing dispatch can be
implemented entirely inside `@forge/agents` (driving N adapter sessions from one `executeStep` call,
e.g. by supplying `@forge/engine/dispatch`'s already-generic `runAgentStep` a differently-shaped
`SessionRequest`-builder) or genuinely needs a small, additive extension to already-committed M5 code
(the identical "next piece touches a previous, already-committed piece" pattern M5 itself hit repeatedly
against P15/P19). Recorded here so that piece's own build starts from this question, not from scratch.

Twenty-nine pieces across five packages, dependency-ordered within and across packages.
Production-code budget is ≤ ~400 lines per piece for genuinely new *logic*; content-only pieces (real
YAML/Markdown data, no new runtime logic beyond a loader already built in an earlier piece) are exempt
from the line count the same way `PLAN-M2.md`'s own presets piece and `PLAN-M1.md`'s own artifact-stub
piece already were — judged instead on completeness against the spec's own named inventory and on every
entry validating against its own real schema.

---

# `@forge/methods` — framework execution engine, rubric scoring, level selection

## M1 — Framework definition schema and loader

**Mandate:** give `11` §11.0's own framework YAML shape a real, validated schema and a loader that
reads one from disk into a typed `FrameworkDefinition`.

**Spec:** `11` §11.0 (the full worked `repo-strategy` example, verbatim schema).

**Surface:** `@forge/methods/schema`
- `frameworkSchema` (zod) — `id`, `name`, `owner_agent`, `produces` (`adr_category`, `kb_section`),
  `inputs` (`required`, `derived` with `id`/`from` expression strings), `questions` (`id`, `text`,
  `type`, `default_from`), `options` (`id`), `criteria` (`id`, `weight`), `scoring`
  (`'rubric'|'rules'|'hybrid'`), `rules` (`if`/`then` with `eliminate`/`prefer`), `output_template`,
  `follow_on`.
- `loadFramework(source: string, path: string): FrameworkDefinition` — parses YAML, validates against
  `frameworkSchema`, never throws a raw YAML/zod error (matching `@forge/engine/workflow`'s own
  `parseWorkflow` precedent — a discriminated `ParseResult`, not an exception, for exactly the same
  "this can fail on ordinary malformed input, a caller needs to react to that" reason).
- `readFramework(paths: ProjectPaths, relative: string): Promise<FrameworkDefinition>` — the on-disk
  read, mirroring `@forge/core/artifacts`' own `readArtifact` shape (M1).

**Checks:**
- The full `11` §11.0 `repo-strategy` worked example round-trips through `loadFramework` with every
  field intact.
- Criteria weights are validated to sum to 1.0 (±a documented float-tolerance epsilon) — a rubric whose
  weights don't sum to 1 is a real authoring bug this schema should catch at load time, not silently
  under/over-weight results at scoring time.
- A `rules[].if` expression that fails to parse is a load-time error naming the framework id and the bad
  expression. `@forge/engine/expr` (M5) is *not* a real dependency option here — `02` §2.2's own
  boundary graph (`methods ← core, kb, schemas` only, confirmed directly against
  `tools/eslint-plugin-forge-boundaries/src/graph.mjs`) gives `@forge/methods` no `engine` edge at all,
  so this piece ships its own small, local expression evaluator for the bounded grammar the worked
  examples actually use (dotted-path field access, `==`/`!=`/comparison operators, boolean
  `&&`/`||`/`!`) — the identical "duplicate a small helper rather than force a cross-cutting dependency"
  precedent M5 itself already established repeatedly (P16's own `seededHash`, P15's own
  `createTempRepo`), not a design gap.
- `scoring: rubric` with a real elimination pre-pass (`rules[].then.eliminate`/`.prefer`) is accepted,
  not rejected — `rules` (an elimination pre-pass) is orthogonal to `scoring` (how the *surviving*
  options are compared): `11` §11.0's own worked `repo-strategy` example is exactly `scoring: rubric`
  with two real elimination rules, so any "scoring mode requires/forbids `rules`-shaped content" check
  is speculation this one real data point already disproves — none ships without a second, real
  data point (real framework content, T3/T4) to justify it.
- `rules[].then.eliminate`/`.prefer` entries are checked referentially against the framework's own
  declared `options[].id` set — a typo'd id is a load-time error, not a silent no-op at scoring time.
- A `type: 'choice'` question declares at least one option.

**Depends on:** `@forge/core` (artifact paths). No `@forge/engine` edge — see above.

**Status:** done — see `SPEC-QUESTIONS.md` Q83.

---

## M2 — Rubric scoring and the elimination pass

**Mandate:** `11` §11.0's own execution contract, steps 1-3: "run rules → eliminate → score remaining
against criteria with evidence per cell → produce a ranked recommendation with the top option's own
*killer risk* stated."

**Spec:** `11` §11.0's execution contract paragraph.

**Surface:** `@forge/methods/score`
- `interface EvidenceCell { readonly optionId: string; readonly criterionId: string; readonly score: number; readonly evidence: string }`
- `interface ScoredOption { readonly optionId: string; readonly totalScore: number; readonly cells: readonly EvidenceCell[]; readonly eliminated: boolean; readonly eliminatedBy?: string }`
- `applyRules(framework: FrameworkDefinition, derivedValues: Readonly<Record<string, unknown>>): { readonly eliminated: ReadonlySet<string>; readonly preferred: string | undefined }`
  — evaluates every `rules[].if` against `derivedValues` (M1's own `inputs.derived` results, computed
  by a caller — this piece is pure, given already-resolved values, not itself an expression-evaluation
  orchestrator over live KB/artifact data, that is piece M3's job).
- `score(framework: FrameworkDefinition, cells: readonly EvidenceCell[]): readonly ScoredOption[]` —
  pure weighted sum over non-eliminated options, sorted descending by `totalScore`.
- `killerRisk(topOption: ScoredOption, framework: FrameworkDefinition): string | undefined` — the
  lowest-scoring *non-eliminated* criterion cell for the top option, framed as the recommendation's own
  named risk (`11` §11.0: "the top option's own killer risk stated") — a real, evidence-backed choice,
  not a placeholder string.

**Checks:**
- The worked `repo-strategy` example: `deployable_units == 1` eliminates `polyrepo`/`meta-repo` and
  prefers `monorepo-single-package`, exactly as the framework's own `rules` declare.
- A rubric with no matching rule scores every option; the ranked order matches a hand-computed weighted
  sum for a small fixture.
- `killerRisk` never names an eliminated option's own weakness (only ever the winning, non-eliminated
  option's own lowest cell).
- Determinism (R10): identical `cells`/`derivedValues` input produces byte-identical output across
  repeated calls — no `Math.random()`/`Date.now()` anywhere in the scoring path.
- `evidence` per cell is a real string every real fixture supplies (never empty) — `11` §11.0's own
  "with evidence per cell" is load-bearing, not decorative; the schema/scoring function refuses (or
  flags, decided when built) an evidence-free cell.

**Depends on:** M1.

**Status:** done — see `SPEC-QUESTIONS.md` Q84.

---

## M3 — Level selection

**Mandate:** `01` §1.9's own L0-L4 table, resolved from real signals rather than a hardcoded default —
`03` §3.3 step 4's own "auto-proposed L0-L4 with reasoning shown; confirm or override."

**Spec:** `01` §1.9 (the L0-L4 table); `03` §3.3 step 4; `10` §10.2's own "Level mapping" paragraph
(which phases/gates each level runs).

**Surface:** `@forge/methods/level`
- `type ProjectLevel = 'L0' | 'L1' | 'L2' | 'L3' | 'L4'` — `@forge/extensions/agents` already declares
  the identical type (M2), but `02` §2.2's own boundary graph gives `@forge/methods` no `extensions`
  edge (`methods ← core, kb, schemas` only; `extensions`/`methods` are graph peers, neither can import
  the other), so this is a second, independent declaration of the same five-value union, not a shared
  import — the same small, unavoidable duplication this plan's own M1 already accepts for its
  expression evaluator, for the identical boundary reason.
- `interface LevelSignals { readonly greenfield: boolean; readonly userFacingCapabilities: number; readonly deployableUnits: number; readonly hasPersistentState: boolean; readonly hasExternalIntegrations: boolean; readonly regulatory: boolean; readonly multiRuntime: boolean }`
  — `01` §1.9 names this exact seven-signal set verbatim ("greenfield vs brownfield, number of
  user-facing capabilities, number of deployable units, presence of persistent state, presence of
  external integrations, regulatory flags, and whether more than one runtime/language is involved"), an
  earlier draft of this plan invented a different, wrong shape before that sentence was reread closely —
  corrected here before implementation. `01` §1.9 gives the L0-L4 table and this signal list but not a
  derivation algorithm from one to the other, so the actual decision rules are this piece's own invented
  resolution of that spec silence, recorded in `SPEC-QUESTIONS.md`, not a guess left unrecorded.
- `proposeLevel(signals: LevelSignals): { readonly level: ProjectLevel; readonly reasoning: string }` —
  pure, deterministic; `reasoning` names which signal(s) drove the choice (`03` §3.3: "reasoning shown").
- `phasesForLevel(level: ProjectLevel): readonly LifecyclePhase[]` — `10` §10.2's own level-mapping
  paragraph, made real: L0 → `{P6,P7}`; L1 adds `{P5 light, P8}`; L2 adds `{P2 delta, P3 delta, P9}`;
  L3/L4 run everything; L4 adds `G-Integration` and the domain-decomposition step (neither is its own
  lifecycle phase, so `phasesForLevel` itself returns the same phase set for L3 and L4).

**Checks:**
- A greenfield signal proposes `L3`; a regulatory, multi-runtime, or multi-deployable-unit signal
  proposes `L4` regardless of every other signal (`01` §1.9's own "Platform" row wording).
- `phasesForLevel` matches `10` §10.2's own literal level-mapping paragraph phase-for-phase.
- Determinism (R10).

**Depends on:** nothing beyond `@forge/core`. No `@forge/extensions` edge — see above.

**Status:** done — see `SPEC-QUESTIONS.md` Q85.

---

# `@forge/catalog` — technology entries and the selection engine

## C1 — Catalog entry schema and registry

**Mandate:** `12` §12.2's own entry YAML shape, validated, loaded into an in-memory registry keyed by
`(kind, id)`.

**Spec:** `12` §12.2 (the full worked `postgresql` example, verbatim schema; the `kind` enum's own
20-member list — an earlier draft of this plan miscounted this as 19; re-verified by direct enumeration
of the spec's own comment before implementation, corrected here).

**Surface:** `@forge/catalog/schema`
- `catalogEntrySchema` (zod) — every field of the worked example: `id`, `kind` (the closed 20-value
  enum), `name`, `category`, `maturity` (`'emerging'|'growing'|'mature'|'legacy'|'declining'`),
  `licence`, `managed_options`, `strengths`, `weaknesses`, `fits_when`, `avoid_when`, `pairs_with`,
  `alternatives`, `operational_burden`, `team_familiarity_weight`, `exit_cost`, `agent_friendliness`,
  `notes_for_agents`. The four burden/weight/cost/friendliness fields are `'low'|'medium'|'high'` — `12`
  §12.2's own worked example only ever shows `medium`/`high` values; `low` is this piece's own inferred
  third value completing the obvious ordinal scale, a spec-silence resolution recorded in
  `SPEC-QUESTIONS.md`, not a silent guess.
- `class CatalogRegistry { get(kind: string, id: string): CatalogEntry | undefined; hasId(id: string): boolean; byKind(kind: string): readonly CatalogEntry[]; all(): readonly CatalogEntry[] }`
  — `hasId` is an addition beyond this plan's own first draft, needed because `pairs_with`/
  `alternatives` name only an id, never a `(kind, id)` pair (see `validateEntry` below).
- `loadCatalogRegistry(dir: string): { registry: CatalogRegistry; issues: readonly CatalogLoadIssue[] }`
  — reads every `<dir>/<kind>/<id>.entry.yaml`. Changed from this plan's own first-draft signature
  (a bare `CatalogRegistry` return) to a result carrying load issues alongside the registry: a directory
  of many entries can have one malformed file, and silently dropping it with no signal would hide a real
  authoring bug from whatever calls this (ultimately `@forge/cli`) — the same "never throw, return
  issues" precedent `@forge/methods`'s own `loadFramework` (M1) already established, extended here to a
  whole-directory load rather than one document. A plain `string` parameter, not `@forge/core/fs`'s own
  `AbsolutePath` — `02` §2.2's own boundary graph gives `@forge/catalog` no `core` edge at all
  (`catalog ← schemas` only, confirmed directly against
  `tools/eslint-plugin-forge-boundaries/src/graph.mjs`), so this package cannot use `@forge/core`'s
  path-containment machinery; the caller (ultimately `@forge/cli`, which does have a `core` edge) is
  responsible for handing this function an already-safe, already-resolved directory.
- `validateEntry(entry: CatalogEntry, registry: CatalogRegistry): readonly ValidationIssue[]` — `12`
  §12.2's own hygiene rules made real: `pairs_with`/`alternatives` reference real ids in the same
  registry (a dangling reference is a real authoring bug); no entry claims a banned superlative
  ("fastest"/"best"/a bare performance number) in `strengths`/`weaknesses`/`fits_when`/`avoid_when` — a
  real, mechanical lexical check per `12` §12.2's own "never claim... performance numbers" rule.

**Checks:**
- The worked `postgresql` example round-trips through the schema with every field intact.
- `validateEntry` catches a dangling `pairs_with` reference and a superlative-shaped string in
  `strengths`, each with the offending field named.
- `CatalogRegistry.byKind('datastore')` returns every real datastore entry piece C2 ships, no more, no
  fewer.

**Depends on:** nothing beyond `yaml`/`zod` — this piece never actually reuses anything from
`@forge/schemas`, so a fresh critic round caught the declared-but-unused dependency and it was removed
from `package.json`; the boundary graph's own `catalog ← schemas` edge stays available for a later piece
(C2+) to use if one of them genuinely needs it.

**Status:** done — see `SPEC-QUESTIONS.md` Q86.

---

## C2 — Catalog content, part 1: languages, frameworks, frontend, mobile, stacks

**Mandate:** ship real, schema-valid catalog entries for every item `12` §12.2's own "Catalog scope (v1
minimum coverage)" table lists under Languages, Backend frameworks, Frontend, Mobile/cross-platform, and
Stacks — content, not new logic.

**Spec:** `12` §12.2's own scope table, rows 1-5.

**Surface:** `catalog/language/*.entry.yaml`, `catalog/framework/*.entry.yaml` (backend),
`catalog/frontend/*.entry.yaml`, `catalog/mobile/*.entry.yaml`, `catalog/stack/*.entry.yaml` — real
data files under `@forge/catalog`'s own package, one file per named technology/stack in the table.

**Checks:**
- Every named item in the table's first five rows has a real entry (a completeness check against the
  table itself, run as a real test: parse the spec's own table, diff against the shipped file set).
- Every entry validates cleanly against C1's `catalogEntrySchema` and `validateEntry`.
- Every entry's `fits_when`/`avoid_when` names at least two real, specific conditions (not a placeholder
  single generic line) — a mechanical non-emptiness/length floor, not a subjective quality bar.

**Depends on:** C1.

**Status:** done — see `SPEC-QUESTIONS.md` Q89. Required a real C1 schema extension
(`CatalogKind` gains `'stack' | 'feature-flags' | 'secrets'`, see Q87) found while starting this piece.

---

## C3 — Catalog content, part 2: datastores, messaging, stream/batch, API styles, ORM, auth

**Mandate:** the same as C2, for the table's Datastores, Messaging/stream, Stream/batch processing, API
styles, ORM/data access, and Auth rows.

**Spec:** `12` §12.2's own scope table, rows 6-11.

**Surface:** `catalog/datastore/*.entry.yaml`, `catalog/queue/*.entry.yaml`, `catalog/stream/*.entry.yaml`,
`catalog/api-style/*.entry.yaml`, `catalog/orm/*.entry.yaml`, `catalog/auth/*.entry.yaml`.

**Checks:** identical shape to C2's, against this piece's own six rows.

**Status:** done — see `SPEC-QUESTIONS.md` Q90. Generalized C2's own hygiene test into
`test/content/catalog-hygiene.test.ts` (one whole-catalog test, not one per piece) and added a permanent
exact/near-duplicate list-item regression test to it, closing the gap Q89 found.

**Depends on:** C1.

---

## C4 — Catalog content, part 3: CI/CD, containers, IaC, observability, testing, flags, secrets

**Mandate:** the same as C2/C3, for the table's remaining rows.

**Spec:** `12` §12.2's own scope table, remaining rows (CI/CD, Containers/orchestration, IaC,
Observability, Testing, Feature flags & config, Secrets).

**Surface:** `catalog/ci/*.entry.yaml`, `catalog/container/*.entry.yaml`, `catalog/iac/*.entry.yaml`,
`catalog/observability/*.entry.yaml`, `catalog/testing/*.entry.yaml`, `catalog/feature-flags/*.entry.yaml`,
`catalog/secrets/*.entry.yaml` — the schema extension this note originally deferred (`feature-flags`,
`secrets`, alongside `stack` for C2's own row) was decided and shipped in C2 already, once the identical
gap was found there first; see `SPEC-QUESTIONS.md` Q87.

**Checks:** identical shape to C2/C3's, against this piece's own remaining rows; plus a final,
whole-catalog completeness test (every row of `12` §12.2's own full table has real coverage, run once
here since this is the last content piece). The hygiene test already checks the whole catalog generically
(`test/content/catalog-hygiene.test.ts`, generalized during C3 — see `SPEC-QUESTIONS.md` Q90) and needs no
new copy here, only this piece's own ids removed from its `KNOWN_FUTURE_IDS` allowlist.

**Depends on:** C1.

**Status:** done — see `SPEC-QUESTIONS.md` Q95. All 183 catalog entries now shipped across all 18 scope-
table rows; `KNOWN_FUTURE_IDS` is now the empty set, and the whole catalog is verified internally
self-consistent (zero dangling `pairs_with`/`alternatives` references anywhere).

---

## C5 — The technology selection engine

**Mandate:** `12` §12.3's own five-step procedure — constraint filter, coherence grouping, weighted
scoring, runtime-count penalty, structured output — as real, tested logic distinct from
`@forge/methods`' generic rubric engine (M2 above), since this procedure needs live catalog data
(`pairs_with` edges, `maturity`) the generic engine has no concept of.

**Spec:** `12` §12.3 (all five steps, verbatim); `12` §12.3's own three "Hard rules"; `12` §12.4's
worked output shape.

**Surface:** `@forge/catalog/select`
- `interface StackConstraints { readonly mandated: readonly string[]; readonly forbidden: readonly string[]; readonly teamSkills: readonly string[]; readonly cloud?: string; readonly licencePolicy?: readonly string[]; readonly compliance?: readonly string[] }`
- `interface StackSelectionInput { readonly constraints: StackConstraints; readonly architectureStyle: string; readonly accessPatterns: readonly string[]; readonly nfrs: readonly string[]; readonly deploymentTargets: readonly string[]; readonly level: ProjectLevel }`
- `filterByConstraints(candidates: readonly CatalogEntry[], constraints: StackConstraints): { readonly kept: readonly CatalogEntry[]; readonly removed: readonly { readonly entry: CatalogEntry; readonly reason: string }[] }`
  — `12` §12.3 step 1's own "print what was removed and why... silent elimination is a bug" made a real,
  non-optional return field, not a side-effect log.
- `scoreCoherence(selected: readonly CatalogEntry[]): number` — rewards real `pairs_with` edges among
  the selected set, penalises a new runtime/package-manager/deployment-mechanism introduced without an
  existing edge justifying it (step 2 + step 4's runtime-count penalty, combined here since both operate
  on the same candidate combination).
- `selectStack(registry: CatalogRegistry, input: StackSelectionInput): StackSelectionResult` — runs all
  five steps; `StackSelectionResult` names the chosen entry per `kind` plus every eliminated candidate's
  own reason plus the coherence/penalty scores that decided between coherent combinations.
- The three hard rules enforced as real refusals/flags, not comments: primary-language count > 1
  (> 2 at L3) without an accompanying justification is flagged; any selected entry with
  `maturity: 'emerging'` is flagged as requiring human approval and a documented fallback; a
  `constraints.mandated` entry is recorded as the decision with no re-scoring (`framework: mandated`).

**Checks:**
- `12` §12.4's own worked example (`TypeScript + Fastify`, `Next.js`, `PostgreSQL`, etc.) is reproducible
  from a matching `StackSelectionInput` fixture — not byte-for-byte prose, but the same *entries chosen*
  and the same *reasoning shape* (a named coherence edge, a named constraint).
- A forbidden-tech constraint removes every matching candidate and the result names each one and why.
- Two candidate stacks with equal raw fit-scores but one sharing more real `pairs_with` edges wins via
  coherence grouping — proving step 2 is a real, distinct pass from step 3's plain weighted score.
- An `emerging`-maturity selection is flagged, not silently accepted.
- Determinism (R10).

**Depends on:** C1-C4 (a real, populated registry to select against).

**Status:** done — see `SPEC-QUESTIONS.md` Q96. `@forge/catalog` is now fully complete: C1-C5 all
committed. Two design bugs self-caught before any critic round (a polarity inversion in `scoreCandidate`,
an additive-vs-lexicographic coherence bug in `selectStack`), one structural bug (mandated-entry cap)
found and fixed via a critic round plus a scoped verify round.

---

# `@forge/templates` — `fm-core` content (workflows, gates/checks, frameworks, base templates, skills)

`@forge/templates` already exists (M1: 21 artifact-type stub templates). These five pieces add the
`fm-core` module's own real content into the same package, each validated against an already-built (M5)
generic parser/evaluator — no new engine logic anywhere in this package.

## T1 — Workflow content: the lifecycle workflow roster

**Mandate:** ship every workflow `10` §10.5's own built-in roster names, as real, `parseWorkflow`-valid
YAML (`@forge/engine/workflow`, M5 P8, already built and unchanged by this piece).

**Spec:** `10` §10.5's own table (20 named workflows — recounted directly against the spec text before
writing this section; an earlier draft of this plan miscounted it as 19); `10` §10.1's own full worked
`build-stage` example as the literal content for that one entry; `10` §10.6 (the story implementation
loop, for `implement-story`).

**Surface:** `templates/workflows/<id>.workflow.yaml` — one real file per `10` §10.5 row.

A real, unresolved wording tension to settle when this piece is built, recorded here rather than
guessed silently: `specs/22` M6's own Build line says "the ten lifecycle workflows," but `10` §10.5's
own table names twenty distinct workflow ids. The ten `10` §10.2 lifecycle *phases* (P0-P10, eleven
including P0) do not map 1:1 onto the twenty workflow ids either. Record the actual resolution
(most likely: ship all twenty, since `10` §10.5 is the concrete, load-bearing content list and "ten
lifecycle workflows" is `22`'s own loose paraphrase of the phases, not a literal subset instruction) in
`SPEC-QUESTIONS.md` before writing the first workflow file, not after.

**Checks:**
- Every workflow in `10` §10.5's table parses cleanly via `parseWorkflow` and compiles cleanly via
  `compileRunPlan` (M5, already built) against a representative fixture context.
- `build-stage` matches `10` §10.1's own literal worked example content exactly (the one workflow the
  spec gives byte-for-byte, already proven parseable by `@forge/engine/workflow`'s own P8 test suite
  against the identical text — this piece ships it as real shipped content, not merely a test fixture).
- Every `agent:` field in every step references a real role id from the T-piece roster (piece A2 below)
  — cross-checked once A2 exists; if T1 is built first (dependency order allows either), this check is
  deferred and re-run once A2 lands, recorded as a real cross-piece follow-up, not silently skipped.

**Depends on:** `@forge/engine/workflow` (M5, already built).

---

## T2 — Gate and check content

**Mandate:** ship every gate `10` §10.3's own catalogue names, with real `checks.deterministic`/
`checks.advisory` entries, valid against `@forge/engine/gates`' own generic evaluator (M5 P14, already
built and unchanged).

**Spec:** `10` §10.3 (the full worked `G-Design` example, verbatim schema; the ten-row gate catalogue
table).

**Surface:** `templates/checks/<id>.gate.yaml` — one file per `10` §10.3's own ten gates
(`G-Problem`, `G-Product`, `G-Design`, `G-Foundation`, `G-Ready`, `G-Verify`, `G-Stable`,
`G-Integration`, `G-Deliver`, `G-Operate`), each with the deterministic checks its own catalogue-table
row names as concrete `run:`/`failOn:` entries (e.g. `G-Design`'s own `spec:validate`, `kb:lint`,
`adr:coverage`, `interfaces:frozen`, `nfr:numeric`, `diagram:validate`, `diagram:drift` — all real
`forge` subcommands piece C-series below ships).

**Checks:**
- `G-Design` matches `10` §10.3's own literal worked example exactly.
- Every gate's `checks.deterministic[].run` names a real command `@forge/cli` (this milestone) actually
  implements — cross-checked once the CLI pieces exist; if built first, the check names the expected
  command surface for the CLI pieces to satisfy, the same forward-reference discipline T1 uses for A2.
- `G-Deliver`'s production-environment `alwaysHuman` default (`10` §10.3 gate rule 5) is set.
- Every gate round-trips through `@forge/engine/gates`' own `evaluateGate` (M5) against a fixture
  project where every check is scripted to pass, and again where one is scripted to fail — proving the
  content, not just its shape, actually drives the existing evaluator correctly.

**Depends on:** `@forge/engine/gates` (M5, already built).

---

## T3 — Framework content, part 1: initialization and architecture (`11`)

**Mandate:** ship every framework `11` §11.1-§11.2 names, as real, `@forge/methods`-schema-valid YAML
(piece M1 above).

**Spec:** `11` §11.1 (F-INIT-1 through F-INIT-7); `11` §11.2 (F-ARCH-1 through F-ARCH-7).

**Surface:** `templates/frameworks/<id>.framework.yaml` — fourteen files (`repo-strategy` from `11`
§11.0's own worked example plus thirteen more).

**Checks:**
- Every framework in this piece's own fourteen validates against `@forge/methods/schema`'s
  `frameworkSchema` (M1) and its criteria weights sum to 1.0.
- `repo-strategy` matches `11` §11.0's own literal worked example exactly (already proven loadable by
  M1's own test suite against the identical text; shipped here as real content).
- Each framework's `output_template` references a real file this piece (or T5 below) actually ships.

**Depends on:** `@forge/methods/schema` (M1 above).

---

## T4 — Framework content, part 2: data/technology, testing/debugging, delivery/operations (`12`-`14`)

**Mandate:** the same as T3, for every framework `12`-`14` name.

**Spec:** `12` §12.1 (F-DATA-1 through F-DATA-8) and `12` §12.3 (F-TECH-1 — this one's own `criteria`/
`rules` shape is thinner than the others, since its real procedure is `@forge/catalog/select`, piece C5
above, not the generic rubric alone; record how the framework YAML itself signals "delegate to the
catalog selection engine" — most likely a `scoring: hybrid` plus a documented convention this piece
establishes, not a new schema field, unless that turns out to be insufficient once actually built); `13`
§13.1-§13.2 (F-TEST-1 through F-TEST-7, F-DEBUG-1 through F-DEBUG-3, F-REVIEW-1 through F-REVIEW-2); `14`
(F-DELIVER-1 through F-DELIVER-5, F-OPS-1 through F-OPS-3).

**Surface:** `templates/frameworks/<id>.framework.yaml` — twenty-nine more files.

**Checks:** identical shape to T3's, against this piece's own twenty-nine; plus a whole-set completeness
test (every `F-*` id named anywhere in `11`-`14` has a real shipped file — run once here, the last
framework-content piece) and confirmation that `F-TECH-1`'s own framework definition is real and
`@forge/catalog/select`-compatible per whatever convention T3/T4 settled on.

**Depends on:** `@forge/methods/schema` (M1), `@forge/catalog/select` (C5, for F-TECH-1 specifically).

---

## T5 — Base templates and the built-in skill library

**Mandate:** ship the `output_template` files every T3/T4 framework references, plus `15` §15.4.4's own
named built-in skill library, as real, schema-valid `SKILL.md` packages.

**Spec:** `15` §15.4.1-§15.4.4 (skill format, the six-group built-in library table).

**Surface:** `templates/output/<name>.md.hbs` (or the real templating format decided when built — check
whether `@forge/core`/`@forge/schemas` already commit to a specific templating engine anywhere before
inventing one), `templates/skills/<id>/SKILL.md` (+ `references/`/`examples/`/`scripts/`/`assets/` as
each real skill needs) — one real, non-trivial skill per named example in `15` §15.4.4's own table
(method, discipline, diagramming, stack, tooling, writing groups).

**Checks:**
- Every skill validates against `@forge/extensions/skills`' own `skillFrontMatterSchema`/`validateSkill`
  (M2 P4, already built) with zero errors — dead references, budget overrun, injection-shaped content,
  and bare-secret checks all pass cleanly on real, shipped content, not just on P4's own test fixtures.
- Every `output_template` a T3/T4 framework references resolves to a real file here.
- The diagramming skills (`mermaid-authoring`, `c4-diagramming`, `sequence-diagramming`, `er-diagramming`,
  `state-diagramming`, `diagram-review`) each reference real, checkable conventions `@forge/diagrams`
  (M1) already enforces — not aspirational prose disconnected from what the generators actually validate.

**Depends on:** `@forge/extensions/skills` (M2 P4, already built).

---

# `@forge/agents` — registry, prompt compilation, handoff, separation of duties, interaction modes

## A1 — Base agent schema and loader

**Mandate:** `05` §5.3's own full agent-definition YAML shape (distinct from `@forge/extensions/agents`'
own *overlay* schema, M2 P3, which validates only a partial document layered on top of this one) — a
real schema for the *complete* base document, plus a loader.

**Spec:** `05` §5.3 (the full worked `architect` example, verbatim schema, every field).

**Surface:** `@forge/agents/schema`
- `agentDefinitionSchema` (zod) — every field of the worked example: `id`, `name`, `version`, `tier`,
  `extends`, `mandate`, `decisions_owned`, `persona` (`voice`, `stance`, `disagreement_style`), `inputs`
  (`required`/`optional`, each `artifact`/`kb`-shaped), `outputs` (`type`, `schema`, `path`,
  `cardinality`), `kb_write`, `kb_propose`, `tools` (`read`, `write`, `exec`, `network`, `git_commit`,
  `deploy`), `model` (`tier`, `thinking`), `limits`, `parallel_safety` (`file_ownership`, `exclusive`),
  `gates` (`produces_evidence_for`, `may_approve`), `frameworks`, `skills`, `mcp`, `ceiling`, `prompt`
  (`system`, `briefs`).
- `loadAgentDefinition(source: string, path: string): AgentDefinition` — same discriminated-result
  discipline as `@forge/methods/schema`'s `loadFramework` above, for the same reason.
- `resolveExtends(id: AgentId, registry: AgentRegistry): AgentDefinition` — applies `extends:
  base-engineer`-shaped inheritance (a *base document* concept, distinct from `@forge/extensions`' own
  L0-L4 *customization-layer* resolution, M2 P2 — this is plain single-parent inheritance among shipped
  base agents, e.g. `backend`/`frontend`/`mobile` all extending a shared `base-engineer`).

**Checks:**
- The full `05` §5.3 `architect` worked example round-trips through the schema with every field intact.
- `resolveExtends` correctly layers a child's own fields over `base-engineer`'s, with the child winning
  on any field both declare.
- `gates.may_approve` is validated against `05` §5.2's own roster rule ("`pm`/`po` cannot approve
  engineering gates; `architect`/`platform` cannot approve product gates") at load time for every
  shipped base agent (piece A2), not merely left to a later customization-layer invariant to catch.
- `05` §5.2's own separation-of-duties rule ("`reviewer`, `critic`, `diagnostician`, `test-architect`
  MUST never be the same session instance as the author") is recorded here as a load-time *shape* check
  where checkable statically — narrowed during implementation to `reviewer` alone (a fresh critic round
  found `diagnostician`/`critic` both have real, spec-literal code-shaped outputs — "failing test",
  "+ test" — that a blanket ban on Code/Component-typed outputs would falsely reject; see
  `SPEC-QUESTIONS.md` Q97) — the *runtime* half (an actual step's actual assigned agent instance) is
  piece A5's job, not this one's.

**Depends on:** `@forge/core` (artifact/schema conventions), `@forge/extensions` (`ceiling.tools` reuses
`ToolGrant`, M2 P3), `@forge/schemas`.

**Status:** done — see `SPEC-QUESTIONS.md` Q97. `resolveExtends`'s own real design limit (most fields
are required on every document, so `extends` only deduplicates a small optional-field set) is documented
in its own doc comment as an open item for A2/A3 to resolve with real content, not fixed speculatively
here.

---

## A2 — Roster content, part 1: Direction & product, Architecture & design

**Mandate:** ship every real agent `05` §5.2's own Direction & product and Architecture & design
subsections name, as real, `A1`-schema-valid YAML.

**Spec:** `05` §5.2 (both table subsections, every row); `05` §5.3's own worked `architect` example is
this piece's own literal content for that one row.

**Surface:** `modules/fm-core/agents/<id>.agent.yaml` — eleven files: `orchestrator`, `analyst`, `pm`,
`po`, `ux`, `em` (Direction & product); `architect`, `data-architect`, `domain-modeler`,
`integration-architect`, `security` (Architecture & design).

**Checks:**
- Every agent in this piece's own eleven validates against `A1`'s `agentDefinitionSchema`.
- `architect` matches `05` §5.3's own literal worked example exactly.
- Every agent's `tier`/`decisions_owned`/`outputs`/`kb_write` matches its own `05` §5.2 table row
  (owns/primary-outputs columns) faithfully — a real cross-check between the roster table and the
  shipped YAML, not independently invented content that happens to use the same role name.
- `domain-modeler`/`integration-architect` correctly declare their own `S`(pecialised) tier and module
  gating (`fm-service`) per the table's own `Tier` column.

**Depends on:** A1.

---

## A3 — Roster content, part 2: Build, Quality & operations, Facilitation

**Mandate:** the same as A2, for the table's remaining three subsections.

**Spec:** `05` §5.2's Build, Quality & operations, and Facilitation subsections, every row.

**Surface:** `modules/fm-core/agents/<id>.agent.yaml` — seventeen more files: `platform`, `backend`,
`frontend`, `mobile`, `data-engineer`, `ml-engineer` (Build, 6); `test-architect`, `sdet`, `reviewer`,
`diagnostician`, `sre`, `release`, `techwriter`, `finops`, `compliance` (Quality & operations, 9);
`facilitator`, `critic` (Facilitation, 2) — 6+9+2 = 17, counted directly against the real `05` §5.2 table
during A1 (this plan's own earlier drafts said "fifteen," then "sixteen, not fifteen" — both wrong; A2's
own eleven plus this piece's seventeen totals the real 28-role roster `05` §5.2 names, confirmed by
direct enumeration, not the "24 (or possibly 27)" estimate an even earlier pass through this codebase's
own conversation history once guessed).

**Checks:** identical shape to A2's, against this piece's own roster subset; plus the milestone's own
whole-roster completeness test (every row of `05` §5.2's full table, across both A2 and A3, has a real
shipped agent — run once here, the last roster-content piece) and the full separation-of-duties
load-time check (A1's own static half) re-run across the complete, real roster rather than a fixture
subset.

**Depends on:** A1.

---

## A4 — Agent registry, context packing integration, and the expansion protocol

**Mandate:** a real `AgentRegistry` resolving a bare `AgentId` (the opaque branded string M5's own
`@forge/engine/plan` already treats it as, `SPEC-QUESTIONS.md` Q62 part 2) into a real, `extends`-
resolved `AgentDefinition`; wire `@forge/kb/pack`'s own `buildContextPack` (M3, already built) with `05`
§5.4's remaining, not-yet-built pieces: skill-body inclusion, the `FORGE_REQUEST_CONTEXT:` expansion
protocol, and external-content taint marking.

**Spec:** `05` §5.4 (all seven numbered points — points 1-3 are `buildContextPack`'s own already-proven
job; points 4-7 are this piece's real, new work).

**Surface:** `@forge/agents/registry`
- `class AgentRegistry { get(id: AgentId): AgentDefinition | undefined; all(): readonly AgentDefinition[] }`
- `loadAgentRegistry(dir: AbsolutePath): AgentRegistry` — reads every `modules/*/agents/*.agent.yaml`.

`@forge/agents/context`
- `packForStep(node: StepNode, agent: AgentDefinition, kbBackend, kbTree, options): ContextPack` —
  calls M3's `buildContextPack` for the pinned-core/declared-inputs/retrieved layers, then adds: skill
  front-matter summaries for every attached skill (cheap) plus bodies for `activation: always` skills or
  ones whose `applies_to` matches the step's own file claim/language, up to `skills.packBudgetTokens`
  (`15` §15.4.3, M2's own already-validated skill shape, consumed here for the first time by a real
  packing caller).
- `resolveContextRequest(request: string, kbBackend): ContextPack` — the `FORGE_REQUEST_CONTEXT:`
  expansion protocol (`05` §5.4 point 4): parses an already-adapter-kit-parsed control token's own
  payload (reusing `@forge/adapter-kit/control-tokens`, M4, not a second token parser) and resolves
  either a specific KB id or a fresh retrieval query into an incremental pack addition.
- `markExternalContent(pack: ContextPack, source: 'mcp' | 'fetch'): { readonly pack: ContextPack; readonly taint: 'external' }`
  — `05` §5.4 point 6's own labelled-untrusted-content wrapping and the step-level `taint: external`
  marker that strips privileged actions (`15` §15.5.4's own compile-time half, M2 P5, already built;
  this piece supplies the *runtime* half that actually marks a real pack this way).

**Checks:**
- `packForStep` never includes a skill body over `skills.packBudgetTokens`, demoting it to
  metadata-only with the demotion recorded, not silently dropped (`15` §15.4.3 point 3).
- `resolveContextRequest` against a real `FORGE_REQUEST_CONTEXT: kb-id-123` token returns that entry's
  own real content; against a bare query string, runs a real retrieval call through the same backend
  `buildContextPack` itself uses.
- `markExternalContent` output round-trips: a pack built from real MCP-sourced content is provably
  wrapped and tainted; one built entirely from KB/artifact content is not.
- `05` §5.4 point 7 ("never included: secrets, `.env` contents, other lanes' in-flight work, raw event
  logs") is asserted as a real negative test against `packForStep`'s own output on a fixture project
  containing all four, not merely a documentation claim.

**Depends on:** A1, `@forge/kb/pack` (M3, already built), `@forge/adapter-kit/control-tokens` (M4,
already built), `@forge/extensions/skills` (M2 P4, already built).

---

## A5 — Prompt compilation (the nine blocks)

**Mandate:** `05` §5.3's own "Prompt compilation" subsection — the real function assembling the nine
ordered blocks into one system prompt string, with blocks [1] and [6] provably invariant.

**Spec:** `05` §5.3's "Prompt compilation" subsection (the nine-block list, verbatim); `05` §5.5 (the
constant operating-contract block, verbatim eleven-point normative text — this piece ships it as real,
literal content, not a paraphrase).

**Surface:** `@forge/agents/prompt`
- `const OPERATING_CONTRACT: string` — `05` §5.5's own eleven points, verbatim, as the real, shipped
  block [1] content.
- `compilePrompt(node: StepNode, agent: AgentDefinition, pack: ContextPack, constraints: PromptConstraints, definitionOfDone: readonly string[]): CompiledPrompt`
  — assembles blocks [1]-[9] in order: `[1]` `OPERATING_CONTRACT`; `[2]` role block (mandate, persona,
  decisions_owned, output contract) from `agent`; `[3]` the project context pack from `pack`; `[4]` step
  brief from `node.brief` (M5's already-resolved template text); `[5]` output contract (exact schema +
  paths + front-matter template) from `agent.outputs`; `[6]` constraints (tool grants, forbidden
  actions, budget, autonomy) — invariant, same guarantee as block [1]; `[7]` definition of done; `[8]`
  skills (from `pack`); `[9]` house style + `$append_guidance` overlay (from the resolved agent
  overlay, `@forge/extensions/resolve`, M2, already built).
- `writePromptRecord(runId: string, stepId: string, prompt: CompiledPrompt, paths: ProjectPaths): Promise<void>`
  — `05` §5.3's own mandatory audit write to
  `.forge/state/runs/<runId>/steps/<stepId>/prompt.md`.

**Checks:**
- The nine blocks appear in exactly the documented order, every time, for a real multi-agent fixture.
- Blocks [1] and [6] are provably unaffected by any overlay/skill/MCP-result/fetched-content input a
  fixture throws at `compilePrompt` — a destructive test (deliberately crafted malicious overlay content
  targeting block [1]/[6]) proves this structurally, not merely "the happy path looks right."
  Blocks [2] and [9] *are* affected by the identical inputs — proving the invariant is real and
  selective, not an accidental blanket immutability nobody actually tested for.
- `writePromptRecord` produces a real, readable file at the documented path for a real fixture run.
- `OPERATING_CONTRACT`'s eleven points match `05` §5.5's own text exactly, word for word (a literal
  content-fidelity test, not merely "eleven items exist").

**Depends on:** A1, A4 (a real `ContextPack` to compile with), `@forge/extensions/resolve` (M2 P2,
already built).

---

## A6 — Interaction modes and separation-of-duties runtime enforcement

**Mandate:** `05` §5.7's own seven interaction modes, dispatched correctly per this plan's own top-level
open design question (resolved concretely, here, as this piece is built — see the note above); `05`
§5.2's own separation-of-duties rule enforced at the point an actual agent instance is actually assigned
to an actual step, not merely at schema-load time (A1's own static half).

**Spec:** `05` §5.7 (the seven-mode table); `05` §5.2's own roster-rules paragraph (the runtime half).

**Surface:** `@forge/agents/interaction`
- `type InteractionMode = 'solo' | 'pair' | 'fan-out' | 'panel' | 'debate' | 'relay' | 'swarm-review'`.
- `dispatchAgentStep(node: StepNode, agent: AgentDefinition, ctx, mode: InteractionMode): Promise<StepOutcome>`
  — for `solo`/`fan-out`/`relay`, delegates directly to `@forge/engine/dispatch`'s own already-built
  `runAgentStep`/`runAgentWork` (M5) unchanged, since this plan's own research confirmed these three
  need no new mechanism; for `pair`/`panel`/`debate`/`swarm-review`, the real, resolved implementation
  this piece settles on (multiple `runAgentWork` calls from one dispatch, or a small additive extension
  to M5's own dispatch layer — whichever the build determines is actually correct, recorded in
  `SPEC-QUESTIONS.md` with the concrete reasoning, not decided silently).
- `checkSeparationOfDuties(runId: string, stepId: string, agentInstanceId: string, authoredBy: ReadonlyMap<string, string>): SeparationViolation | undefined`
  — the runtime check: a `reviewer`/`critic`/`diagnostician`/`test-architect`-tagged step whose actually-
  assigned session instance matches the actually-recorded author of the work under review/test/diagnosis
  is refused before dispatch, not merely discouraged.

**Checks:**
- `swarm-review`'s own `perspectives: [design, security, testing, performance]` (the `10` §10.1 worked
  example's own literal case) produces one real, de-duplicated `ReviewReport` merging every perspective
  — proven against `@forge/testkit`'s `FakePlatformAdapter` (M4) scripted with four distinct perspective
  responses.
- `debate`'s own "≤3 rounds, then a decider role rules and records an ADR" (`05` §5.7's table) is a real,
  bounded loop, proven to terminate at 3 rounds even when neither side concedes.
- `checkSeparationOfDuties` refuses a fixture where the same session instance both implemented a story
  and was then assigned its own review step, and permits the identical fixture with two distinct
  instances.
- Whatever A6's own resolved design decision is for `pair`/`panel` (delegate-only vs. additive-engine-
  extension), its own regression test is real: a fixture proving the chosen mechanism actually drives
  more than one real session/perspective for one logical step, not merely that the *type* compiles.

**Depends on:** A1, A5, `@forge/engine/dispatch` (M5, already built — and, contingent on this piece's
own resolved design question, possibly one small, additive extension to it, following M5's own
established "next piece touches a previous, already-committed piece" pattern).

---

## A7 — Handoff records

**Mandate:** `05` §5.6's own `HandoffRecord` shape, real emission on `FORGE_HANDOFF:` (already parsed by
`@forge/adapter-kit/control-tokens`, M4), and inclusion in the receiving agent's own next context pack.

**Spec:** `05` §5.6 (the full worked `HO-0042` example, verbatim schema).

**Surface:** `@forge/agents/handoff`
- `handoffRecordSchema` (zod) — `id`, `from`, `to`, `step`, `timestamp`, `delivered`, `open_questions`,
  `assumptions` (`id`, `text`, `confidence`, `validate_by`), `constraints_for_receiver`,
  `acceptance_for_receiver`.
- `emitHandoff(token: ParsedControlToken, ctx): Promise<HandoffRecord>` — turns an already-parsed
  `FORGE_HANDOFF:` token plus the emitting step's own real context (delivered artifacts, current open
  questions, current assumptions) into a real, schema-valid `HandoffRecord`, written to the event log
  (`@forge/telemetry`, M5, already built — a real `NewForgeEvent`-shaped emission, reusing the existing
  event log rather than a second persistence mechanism).
- `inboundHandoffFor(stepId: string, records: readonly HandoffRecord[]): HandoffRecord | undefined` —
  the record A4's own `packForStep` includes for the receiving agent's context pack (`05` §5.6: "The
  receiving agent's context pack always includes the inbound handoff record").

**Checks:**
- The full `05` §5.6 `HO-0042` worked example round-trips through `handoffRecordSchema` exactly.
- `emitHandoff` against a real `FORGE_HANDOFF:` token (parsed by M4's own real parser) produces a real,
  schema-valid record with real, non-empty `delivered`/`constraints_for_receiver` derived from the
  emitting step's own actual output, not placeholder text.
- `inboundHandoffFor` correctly finds the one real record for a receiving step among several unrelated
  ones in a multi-handoff fixture.

**Depends on:** A4, A1, `@forge/adapter-kit/control-tokens` (M4, already built), `@forge/telemetry` (M5,
already built).

---

# `@forge/cli` — every non-interactive command from `03`

`@forge/cli`'s own boundary edge (`cli ← everything`) means every piece below is, by design, mostly a
thin dispatch/formatting layer over already-built package functions — the real engineering weight in
this package is the entry-point resolution, the four output modes, `forge init`'s real file-writing, and
`forge doctor`'s real environment probing; most command groups are integration, not new logic, and are
sized/grouped accordingly (several thin command groups per piece, the heavier ones alone).

## C1 — Entry point, global flags, and output modes

**Mandate:** `03` §3.1's own resolution logic (node-version check → context detection → branch →
non-TTY refusal) and `03` §3.5's own four output modes as a real, reusable formatting layer every later
command piece renders through.

**Spec:** `03` §3.1 (verbatim resolution steps); `03` §3.2's own global-flags table (parsed once, here,
shared by every command); `03` §3.5 (the four-mode table, the `--json` NDJSON contract, `{"v":1,...}`
versioning).

**Surface:** `@forge/cli/entry`
- `resolveEntryContext(cwd: string, argv: readonly string[]): EntryResolution` — the real branch logic:
  Node version check (exit 5 below 20.10); walk up for `.forge/config.yaml`/`.forge-root`; classify
  not-a-project-empty vs. not-a-project-has-code vs. is-a-project; non-TTY refusal with the printed
  non-interactive equivalent, exit 2.
- `parseGlobalFlags(argv: readonly string[]): GlobalFlags` — every row of `03` §3.2's own table.

`@forge/cli/output`
- `type OutputMode = 'tui' | 'stream' | 'json' | 'quiet'` — `resolveOutputMode(flags: GlobalFlags, isTty: boolean): OutputMode`
  (this milestone: `'tui'` is never actually selected, `--no-tui` is the only real mode per `22`'s own
  "Do not build" line — the type still names it, since `@forge/cli`'s own resolution logic is real and
  shared code the future TUI milestone reuses unchanged, not re-derived).
- `formatStreamLine(event, ctx): string` — `[lane][agent][step]`-prefixed, ANSI gated on
  `--no-color`/`NO_COLOR`/`FORCE_COLOR`.
- `formatJsonEvent(event): string` — one `{"v":1,...}` NDJSON line per real engine event
  (`@forge/telemetry`'s own event shape, M5, already built — this is a real serializer over it, not a
  second event schema).

**Checks:**
- Node < 20.10 exits 5 with the documented message (a real subprocess-level test, not a mocked version
  check).
- A piped/non-TTY invocation of an interactive-shaped command prints the real non-interactive equivalent
  and exits 2 — proven for at least one real command once later pieces exist (a forward-referenced check
  this piece's own test suite re-runs once C2+ land, the same discipline T1/T2 use above).
- `--json` output is genuinely stable/versioned: parsing every line as JSON and checking `.v === 1`
  never fails for a real, multi-event fixture stream.
- `resolveEntryContext` correctly classifies all three real branch cases against real fixture
  directories (empty, has-code-no-forge, has-forge-config).

**Depends on:** `@forge/telemetry` (M5, already built), `@forge/core` (config/paths).

**Status:** done — see `SPEC-QUESTIONS.md` Q100. Built alongside the coordinator's concurrent
`@forge/agents` A2/A3 (roster-independent, per its own explicit go-ahead).

---

## C2 — `forge init`, the greenfield wizard's non-interactive path

**Mandate:** `03` §3.3's own eleven-step wizard, driven end to end via `--yes` plus flags (no TUI
interaction), writing the full real file tree `03` §3.3's own "Files written by `init`" section names.

**Spec:** `03` §3.3 (all eleven steps; the full flag example; the full file-tree listing; the
idempotency/regenerated-file-header rule).

**Surface:** `@forge/cli/init`
- `interface InitOptions` — every flag `03` §3.3's own worked `forge init . --yes --name ... ` example
  shows, typed.
- `runInit(dir: string, options: InitOptions): Promise<InitResult>` — resolves level (via
  `@forge/methods/level`'s `proposeLevel`, this milestone, or the explicit `--level` override), runs
  the platform connectivity smoke test (`@forge/adapter-kit`'s own `preflight`, M4, already built), and
  writes every real file `03` §3.3's own tree names: `.forge/config.yaml`, `manifest.yaml`, the
  regenerable subdirectories (agents/workflows/frameworks/templates/checks/skills — populated from
  `@forge/agents`/`@forge/templates`, this milestone's own earlier pieces), the `overrides/` skeleton,
  `docs/forge/`, `.gitignore` entries, `FORGE.md`, plus platform-native assets
  (`.claude/agents/forge-*.md` etc., via `@forge/adapter-kit`'s own `installAssets`, M4).
- Every regenerable file carries the documented
  `<!-- forge:generated v=<ver> hash=<sha> -->` header.
- Re-running `runInit` on an existing project detects it and switches to `upgrade` semantics (`03`
  §3.3's own idempotency rule) — delegates to C7's real `runUpgrade`, not a re-implementation.

**Checks:**
- A clean, empty directory produces the exact documented file tree, every file present, every
  regenerable one carrying a real header with a real, verifiable content hash.
- Re-running against the just-initialized directory switches to upgrade semantics and does not
  clobber a hand-edited `overrides/` file.
- The `forge init . --yes --name ... --modules fm-service,fm-web --preset startup-lean ...` worked
  example (`03` §3.3's own literal flag line) runs to completion against a real fixture and produces a
  project that passes `forge doctor` (C6) cleanly.
- A hand-modified regenerable file's hash mismatch is detected and reported (`keep-mine`/`take-theirs`/
  `merge`/`show-diff` offered, not silently overwritten) on a second `init`-turned-`upgrade` run.

**Depends on:** C1, A2/A3 (roster content), T1-T5 (template content), `@forge/methods/level` (M3),
`@forge/adapter-kit` (M4, already built), `@forge/extensions/presets` (M2 P7, already built).

**Status:** done — see `SPEC-QUESTIONS.md` Q103. Two real forward gaps stood in for rather than faked
(prompt compilation not yet landed when this piece started, real content written instead of a fabricated
compiled asset; real `upgrade` semantics not yet built at all, `already-initialized` returned instead of
either blocking or re-implementing C7 early) — both documented, neither silently papered over.

---

## C3 — Lifecycle and discovery commands

**Mandate:** `03` §3.2.1 (`adopt`, `uninstall`) and §3.2.2's own command group, as real,
non-interactive-capable CLI commands (excluding `init`/`upgrade`/`doctor`, each its own piece).

**Spec:** `03` §3.2.1, §3.2.2 (every row).

**Surface:** `forge adopt`, `forge uninstall`; `forge discover`; `forge kb <list|show|search|lint|diff|
sync|open|graph>`; `forge spec <list|show|validate|trace|matrix|orphans|new>`; `forge adr <new|list|
show|supersede|accept|reject>`; `forge diagram <list|show|validate|render|sync|generate|diff|legend>`;
`forge decide <framework>`.

Every subcommand is a thin dispatch over an already-built package function
(`@forge/kb`, M3; `@forge/core/artifacts`+`@forge/schemas`, M1; `@forge/diagrams`, M1; this milestone's
own `@forge/methods` for `decide`) plus C1's own output-mode rendering — real wiring, not new logic,
except `forge adopt` (`17`, brownfield ingestion) which this milestone's own scope (`22`'s M6 Build
line names `@forge/cli` generally, and `17` is not itself a separate M6 package) treats as a thin
wrapper over whatever `17`'s own mechanism already provides; if no such mechanism exists yet in any
earlier milestone, record that gap explicitly rather than inventing brownfield ingestion here.

**Checks:**
- Every subcommand has a real, working non-interactive invocation (no bare interactive prompt anywhere
  in this piece) producing correct `--json` output validated against C1's own NDJSON contract.
- `forge decide repo-strategy` (a real framework from T3) runs `@forge/methods`' own rules→score→rank
  pipeline end to end against a real fixture project and produces a real ranked recommendation with a
  killer risk named.
- `forge kb lint`/`forge spec validate` correctly surface real, already-built validator output
  (`@forge/kb`/`@forge/core`, M1/M3) through C1's JSON contract unchanged in substance.

**Depends on:** C1, `@forge/kb` (M3), `@forge/core`/`@forge/schemas` (M1), `@forge/diagrams` (M1),
`@forge/methods` (this milestone).

---

## C4 — Planning and execution commands

**Mandate:** `03` §3.2.3 and §3.2.4's own command groups.

**Spec:** `03` §3.2.3, §3.2.4 (every row).

**Surface:** `forge plan <product|architecture|data|init|testing|delivery|stages|stage <id>|replan>`;
`forge run <workflow>`, `forge resume`, `forge pause`/`forge abort`, `forge status`, `forge lanes`,
`forge logs`, `forge gate <list|check|approve|reject|waive>`, `forge merge`.

`forge plan <phase>` commands each run the real corresponding `10` §10.5 workflow (T1) via
`@forge/engine`'s own `runEngine` (M5 P20, already built) against real project state. `forge run`/
`resume`/`status`/`lanes`/`logs`/`gate`/`merge` are the first real caller of `@forge/engine`'s own
public entry point outside its own test suite — the actual "supervisor" process this milestone's own
`--yes`/non-interactive scope needs (a long-lived process driving `runEngine` to completion, polling/
tailing the event log for `status`/`logs`/`lanes`, writing a lock file for `pause`/`abort` to signal
against). This is real, new integration work, not a thin wrapper, and is this piece's own main risk.

**Checks:**
- `forge run <workflow> --dry-run` plans and prints without spawning any session or writing any file —
  `03` §3.2's own `--dry-run` global flag, proven real for at least this command.
- `forge status`/`forge lanes`/`forge logs` against a real, running (or just-completed) fixture run
  report real, correct state — not merely "does not crash."
- `forge pause`/`forge abort` against a real running fixture supervisor actually stop it (verified the
  same way M5 P20's own crash-resume test verifies a real process's own death: `process.kill(pid, 0)`
  throwing, not a trusted promise).
- `forge gate check <id>` re-evaluates without approving (`10` §10.3 gate rule 3, already enforced by
  `@forge/engine/gates`, M5) — this piece's own job is only that the CLI command correctly calls the
  non-mutating path, proven by a fixture where `check` is called twice with no state change between.

**Depends on:** C1, `@forge/engine` (M5, already built, including P20's own `runEngine`), T1/T2
(real workflow/gate content to actually run against).

---

## C5 — Engineering-loop and collaboration commands

**Mandate:** `03` §3.2.5 and §3.2.6's own command groups.

**Spec:** `03` §3.2.5, §3.2.6 (every row).

**Surface:** `forge implement <storyId>`, `forge test <plan|generate|run|report|flaky|coverage>`,
`forge debug`, `forge review`, `forge refactor`, `forge deploy`; `forge session <type>`, `forge session
<list|show|resume>`, `forge ask <question>`, `forge panel <question> --roles ...`.

Each of `implement`/`debug`/`review`/`refactor`/`deploy` runs its own named `10` §10.5 workflow (T1)
through the same `runEngine` integration C4 establishes — real, but structurally identical wiring, not
a second mechanism. `forge session <type>` is explicitly `16`'s own collaboration-sessions surface,
which `22`'s own M6 Build line does not list (`16` is not named anywhere in M6's Build bullet) — record
this as a real scope boundary: `session`/`ask`/`panel` ship as CLI *command surface* only (parsing,
flags, `--json` shape) with a clearly-marked "not yet implemented" real error for the actual facilitated-
session mechanism itself, rather than silently building `16`'s own real engine ahead of its own
milestone or silently omitting the command from the CLI's own `--help` surface. `forge panel` is the
one partial exception: `05` §5.7's own `Panel`/`Debate` interaction modes (piece A6) give it a real,
already-built mechanism to call.

**Checks:**
- `forge implement <storyId>` against a real fixture story runs the real `implement-story` workflow
  (T1) to completion through `runEngine`.
- `forge panel <question> --roles architect,security,sre` produces a real, multi-perspective synthesis
  using A6's own `panel`/`debate` dispatch — not a stub.
- `forge session <type>` correctly reports its own real "not yet implemented, ships in a later
  milestone" error rather than crashing, hanging, or silently no-op-succeeding — a real, typed
  `ForgeError` with a remedy naming the actual milestone, not a bare `TODO`.

**Depends on:** C1, C4 (the `runEngine` integration), A6 (panel/debate dispatch).

---

## C6 — `forge doctor` and prerequisite detection

**Mandate:** `03` §3.7's own full checklist, each with a copy-pasteable real fix, plus the exit-code
contract (`5` hard failure, `0` warnings-only).

**Spec:** `03` §3.7 (every bullet).

**Surface:** `@forge/cli/doctor`
- `interface DoctorCheck { readonly id: string; readonly ok: boolean; readonly message: string; readonly fix?: string }`
- `runDoctor(paths: ProjectPaths, options: DoctorOptions): Promise<DoctorReport>` — real checks for
  every `03` §3.7 bullet: Node version; git ≥ 2.30 + identity; platform adapters (`@forge/adapter-kit`'s
  own `preflight`, M4, already built — this piece is the first real CLI caller of it); disk space;
  config validity (`@forge/core`); manifest checksum drift; KB lint (`@forge/kb`, M3); spec graph
  validity (`@forge/core`, M1); index freshness (`@forge/kb`); stale locks/orphaned worktrees/dangling
  branches (`@forge/vcs`'s own `listOrphanedWorktrees`, M5, already built); diagram parser/renderer
  presence and drift (`@forge/diagrams`, M1); overlay compile errors (`@forge/extensions/compile`, M2
  P9, already built — this piece is its first real CLI caller too); unresolved `${secret:...}`
  references (existence-only, never printing a value).
- `--fix`/`--rebuild-index` real remediation for the checks that have one.

**Checks:**
- Every one of `03` §3.7's own bullets has a real, working check against a real fixture that can be made
  to fail it (not merely "the happy path never fails").
- Exit code 5 for any hard-prerequisite failure, 0 with warnings otherwise — a real subprocess-level
  test of the actual exit code, not an in-process return-value proxy.
- `--json` output is a real, `{"v":1,...}`-shaped report per C1's own contract.
- `${secret:...}` existence checks never print a real secret value even when one is present and
  resolvable — a real negative test against stdout/stderr content.

**Depends on:** C1, `@forge/adapter-kit` (M4), `@forge/vcs` (M5), `@forge/kb` (M3), `@forge/core`/
`@forge/diagrams` (M1), `@forge/extensions/compile` (M2).

---

## C7 — `forge upgrade`

**Mandate:** `03` §3.4's own seven-step upgrade procedure, real for this milestone's own actual version
history (which, honestly, has no prior shipped version to migrate *from* yet — this piece's own real
scope is the mechanism, proven against a synthetic "prior version" fixture, not a real historical
migration).

**Spec:** `03` §3.4 (all seven steps); the "every migration MUST be pure, reversible-or-flagged,
golden-file-tested" closing paragraph.

**Surface:** `@forge/cli/upgrade`
- `interface Migration { readonly from: string; readonly to: string; readonly reversible: boolean; migrate(artifact: unknown): unknown }`
- `runUpgrade(paths: ProjectPaths, options: { readonly dryRun?: boolean; readonly to?: string }): Promise<UpgradeReport>`
  — reads `manifest.yaml`, computes the migration path, backs up to
  `.forge/backups/<timestamp>.tar.gz` (retaining the last 5), applies migrations, regenerates the
  regenerable directories (reusing C2's own file-writing logic, not a duplicate), re-runs `forge doctor`
  (C6) and prints a diff stat.
- A real, working migration-path resolver even with zero real registered migrations yet — the mechanism
  is this milestone's own claim; `@forge/schemas/migrations/` shipping its first *real* migration is a
  later milestone's concern once a version boundary actually exists to migrate across.

**Checks:**
- `--dry-run` prints the real plan and writes nothing — proven by a real filesystem-untouched assertion,
  not merely "the option is parsed."
- `--to <version>` pins correctly; a downgrade attempt is refused with a real, typed error.
- The backup tarball is real and restorable; the retain-last-5 rule is proven with six synthetic
  upgrade runs.
- A synthetic two-migration fixture (registered only for this piece's own test, not shipped as real
  product migrations) proves the full pipeline: backup → migrate → regenerate → re-doctor → report,
  with the golden-file discipline the spec's own closing paragraph requires.

**Depends on:** C1, C2 (shared file-writing), C6 (`forge doctor` re-run).

---

## C8 — Meta and customization commands

**Mandate:** `03` §3.2.7 and §3.2.8's own command groups.

**Spec:** `03` §3.2.7, §3.2.8 (every row); `03`'s own closing line ("`forge help` with no args... MUST
inspect state and recommend the next command").

**Surface:** `forge module <list|add|remove|update|info>`, `forge agent <list|show|new|validate|
compile>`, `forge workflow <list|show|validate|graph|new>`, `forge config <get|set|list|explain|edit>`,
`forge cost`, `forge export <target>`, `forge help [topic]`; `forge customize`, `forge compile
[--check]`, `forge overlay <sub>`, `forge agent override/diff/reset`, `forge skill <sub>`, `forge mcp
<sub>`, `forge preset <sub>`.

`forge compile`/`forge overlay explain`/`forge preset apply|eject` are thin wrappers over
`@forge/extensions/compile`/`resolve`/`presets` (M2, already built) — real wiring, minimal new logic.
`forge agent validate`/`forge agent compile` are `05` §5.9's own real, new logic (schema validity,
KB-write/file-ownership overlap checks across the *whole* real roster from A2/A3, platform-native asset
emission via `@forge/adapter-kit`'s `installAssets`, M4). `forge workflow validate`/`forge diagram
validate` (already in C3) similarly call already-built validators.

**Checks:**
- `forge help` with no args, inside a real fixture project at a known state, recommends a real,
  contextually-correct next command (`03`'s own explicit "you are here, these are your next moves"
  requirement) — a real behavioural test against at least three distinct project states, not a static
  string.
- `forge agent validate --all` against the real, complete A2/A3 roster passes cleanly with zero errors
  — this is the milestone's own first exit-test line (`pnpm forge agent validate --all`), so this
  specific invocation must be real and green, not merely "the command exists."
- `forge agent compile` emits real, valid Claude Code subagent files (`@forge/adapter-kit`'s own
  `installAssets`, M4, already built) for the real roster.
- `forge cost`/`forge export markdown-bundle`/`forge export html` produce real output against a real
  fixture; `forge export jira|linear|github-issues` correctly report `--dry-run`-only per `03` §3.2.7's
  own "v1: first two + dry-run for the rest."

**Depends on:** C1, C6, `@forge/extensions` (M2, its full compile/resolve/presets/agents surface),
`@forge/adapter-kit` (M4), A1-A3 (the real roster to validate/compile).

---

## C9 — The M6 exit-test harness: `template validate --all`, `workflow validate --all`, and
`scripts/assert-json-contract.mjs`

**Mandate:** the milestone's own literal exit criteria, made real and green: `forge template validate
--all` (not named as its own subcommand anywhere in `03` §3.2 — record this gap and add it, most likely
under the existing `forge workflow`/`forge agent` sibling pattern, e.g. folded into a `forge module
validate`-shaped command or a small new `forge template <validate|list>` group this piece adds,
whichever the real `22` exit-test line's own literal `pnpm forge agent validate --all && pnpm forge
workflow validate --all && pnpm forge template validate --all` most naturally supports); the
`scripts/assert-json-contract.mjs` script the exit test's own third line pipes `forge --json status`
into (confirmed not to exist anywhere in the repo yet — this piece writes it, mirroring
`scripts/check-boundaries.mjs`'s own existing style).

**Spec:** `specs/22` M6's own Acceptance and Exit-tests sections, verbatim.

**Surface:** the `forge template validate --all` command (wherever C8 or this piece settles it);
`scripts/assert-json-contract.mjs` (a real, repo-root script asserting `{"v":1,...}` shape, required
fields, and monotonic/well-formed structure against a real `forge --json status` invocation's stdout).

**Checks (this milestone's own literal exit tests, run for real):**
```
pnpm forge agent validate --all && pnpm forge workflow validate --all && pnpm forge template validate --all
pnpm test -- --grep "E1 init"
pnpm forge --json status -C fixtures/greenfield-service | node scripts/assert-json-contract.mjs
```
- Every one of the three commands in line 1 passes cleanly against the real, complete roster/workflow/
  template content this milestone ships (A2/A3, T1-T5) — zero validation errors, not a curated subset.
- `"E1 init"` is a real, passing, non-trivial test (this milestone's own first real end-to-end proof:
  `forge init` producing a full artifact set that every validator accepts cleanly) under exactly that
  name — the identical "the exit-test grep must find a real test under this literal name" discipline
  M5's own P20 already established for `"E3 crash-resume"`/`"scheduler determinism"`.
- `fixtures/greenfield-service` is a real fixture project this piece creates (or reuses if an earlier
  piece already needed one) that `forge init` can produce and `forge status --json` can report on.
- `assert-json-contract.mjs` genuinely fails on a deliberately malformed `--json` stream in its own test,
  not only passing on well-formed input — the same "prove the checker can actually catch something"
  discipline `check-boundaries.mjs`'s own test suite already established.

**Depends on:** every prior piece in this plan (this is, by design, the milestone's own closing,
integrating piece).
