# PLAN-M3 — Knowledge Body and diagrams

Source: `specs/22` M3. **Build:** `@forge/kb` (store, `KbWriter` with a serialised queue and proposal
channel, SQLite index + JSON fallback, FTS retrieval, graph expansion, context packing with budgets,
the linter with every rule from `08` §8.7, staleness and verification); `@forge/diagrams` (Mermaid
parse/validate, the eight generators, drift detection, complexity/caption lint, HTML render fallback).
**Do not build:** embeddings retrieval (the `kb.retrieval.embeddings` config flag already exists in
`@forge/schemas`; no implementation here — `08` §8.5 rule 4 is explicitly off-by-default and additive
later), PlantUML/D2 support (report the notation unavailable, per `08` §8.11.8c and `02` §2.1).

Ten pieces. `02` §2.2's dependency graph is `diagrams ← core, schemas` and `kb ← core, schemas,
diagrams` — **not** the reverse — so the diagrams track (P1–P5) is built and closed out first, and the
kb track (P6–P10) after it, even though `specs/22`'s own prose names `@forge/kb` first. Two new
packages: `packages/diagrams`, `packages/kb`; neither exists yet.

Two spec sources, both normative: `specs/08-knowledge-body.md` (§8.1–8.10 for KB, §8.11 for diagrams —
diagrams have no separate numbered spec file) and `specs/05-agent-system.md` §5.4 (context packing —
narrower and more concrete than `08`'s own retrieval section, and the one `@forge/kb/pack`'s actual
surface is built against). `specs/18-persistence-config-and-schemas.md` §18.1–18.2 is authoritative for
on-disk layout; `@forge/schemas` already carries the config schema (`kbSchema`, `diagramsSchema`) and
two of the artifact schemas this milestone reuses rather than redefines (`adrSchema`, `diagramSchema`,
both from M1 P7) — see each piece's own Depends-on for exactly what is reused versus new.

Two plan-shaping ambiguities are resolved before any piece below is built, not discovered mid-piece:
**`SPEC-QUESTIONS.md` Q43** (this milestone's own exit tests name `forge kb lint`/`forge diagram
validate` CLI invocations that cannot exist before `@forge/cli`, M6 — resolved by building the library
functions and testing them directly against fixtures created in this milestone) and **Q44** (three of
`08` §8.11.7's `diagram:*` checks need KB-owned data `@forge/diagrams` is forbidden from reading itself
— resolved by an injected resolver for `diagram:refs` and by moving `diagram:required`/
`diagram:adr-coverage` into `@forge/kb`'s own linter entirely). Every piece below already reflects
both answers.

Legend: **Surface** = what the piece exports. **Checks** = the acceptance evidence a judge reads.

---

## P1 — Mermaid parsing and the diagram structural model

**Mandate:** parse Mermaid source into a typed structural model (diagram kind, nodes, edges,
subgraphs) using a pure-JS parser with no browser/DOM dependency, refusing anything that fails to
parse with the location of the failure — this is the one piece every later diagrams check reads
through, so it owns the only parse call in the package.

**Spec:** `08` §8.11.1 ("validated: syntax-checked..."), §8.11.2 (why Mermaid, and that it "parses in
pure JavaScript with no browser and no server"); `02` §2.1's "Diagram validation" row.

**Surface:** `@forge/diagrams/parse`
- `type DiagramKind = 'flowchart' | 'sequenceDiagram' | 'stateDiagram-v2' | 'erDiagram' | 'gantt' | 'C4Context' | 'C4Container' | 'C4Component' | 'C4Deployment' | 'quadrantChart'` — the kinds `08`
  §8.11.3's taxonomy table actually names; parsing rejects (as a `ForgeError`, a new low `KB-0xx` code
  — `KB-005`/`KB-010` are already spec-registered for contradiction/staleness (M1, reused by P10) and
  `KB-031` is spec-given verbatim for transclusion mismatch (`08` §8.11.4, reused by P4); this piece
  picks the next genuinely free slot below those and records it in `SPEC-QUESTIONS.md`) anything
  outside this set rather than silently passing through an unrecognised diagram type.
- `interface DiagramNode { id: string; label: string }`, `interface DiagramEdge { from: string; to: string; label?: string }`, `interface ParsedDiagram { kind: DiagramKind; nodes: readonly DiagramNode[]; edges: readonly DiagramEdge[]; subgraphs: readonly { id: string; nodeIds: readonly string[] }[] }`.
- `parseDiagram(source: string): Promise<ParsedDiagram>` — `mermaid`'s own parse entry points are
  Promise-based even though the underlying grammars run synchronously (verified empirically, not a
  design preference); rejects with a `ForgeError` carrying the parser's own line/column on a syntax
  error, never for a merely-unusual-but-valid diagram. Implemented on top of
  `mermaid` itself with a `jsdom`-backed DOM shim (`SPEC-QUESTIONS.md` Q45 — the taxonomy's own kinds
  are not yet covered by Mermaid's DOM-free `@mermaid-js/parser` grammars), set up once at module load,
  never as a per-call side effect. `nodes`/`edges` are read from Mermaid's own unified
  `diagram.db.getData()` for `flowchart`/`stateDiagram-v2`/`erDiagram`; from `getActors()`/
  `getMessages()` for `sequenceDiagram`; from `getC4ShapeArray()`/`getRels()` (own properties of
  `db`, not inherited — see Q45) for all four `C4*` kinds; `gantt`/`quadrantChart` always report empty
  `nodes`/`edges` — not because Mermaid ships no data for them, but because a task list and a set of
  quadrant coordinates are not a node/edge graph, a modelling boundary documented on `ParsedDiagram`
  itself, not a missing-extraction gap.
- `subgraphs` is populated only for `flowchart` (the one kind with a `subgraph` construct in `08`
  §8.11.3's own taxonomy); `[]` for every other kind.

**Checks:**
- Every diagram kind in `DiagramKind` parses at least one small worked example without throwing.
- `flowchart`/`stateDiagram-v2`/`erDiagram`/`sequenceDiagram`/`C4*` extract nodes/edges matching the
  source by hand-inspection; `gantt`/`quadrantChart` parse cleanly with `nodes: []`/`edges: []`,
  documented as an intentional modelling boundary, not silently wrong or unimplemented.
- A leading `---`-delimited YAML frontmatter block (a real, valid Mermaid construct for `title`/
  `config`) does not defeat kind detection — a diagram opening with one still parses correctly.
- A syntactically invalid diagram (unclosed subgraph, a stray arrow with no target) throws a
  `ForgeError` identifying the diagram kind and, where Mermaid's own error carries one, the failing
  line — never a bare "parse failed".
- A quoted label containing a pipe character (the realistic case `mermaid-authoring`, `08` §8.11.10,
  calls out) round-trips exactly; Mermaid's own HTML-entity-style escapes (`#quot;` etc., verified to
  decode only at render time, not in the parsed `db` data this module reads) are out of scope for this
  piece's own label extraction, not silently mishandled.
- The `jsdom` shim is installed exactly once regardless of how many times `parseDiagram` is called or
  imported (a test asserts idempotent setup — no duplicate global redefinition error on a second
  import in the same process).
- Determinism (R10): `parseDiagram` is a pure function of its string input; the module-load DOM shim
  carries no per-call state (two calls with the same source produce identical results).

**Depends on:** nothing new beyond `@forge/core`'s `ForgeError`. `mermaid` and `jsdom` are new runtime
dependencies of this package only, per `SPEC-QUESTIONS.md` Q45.

*(P1 is committed: `59d17bc`.)*

---

## P2 — Diagram lint rules and the `Diagram` artifact

**Mandate:** implement every `08` §8.11.7 check that needs nothing beyond one diagram's own parsed
structure plus its `Diagram` front matter (reusing `@forge/schemas`' already-built `diagramSchema`) —
`diagram:syntax` (via P1), `diagram:refs` (against an injected resolver, `SPEC-QUESTIONS.md` Q44),
`diagram:orphan-nodes`, `diagram:complexity`, `diagram:label-quality`, `diagram:caption`,
`diagram:staleness` — returning one finding per violated rule with its own check id and severity.

**Spec:** `08` §8.11.5 (the Diagram artifact), §8.11.7 (the table, for the seven rules named above),
§8.11.9 (`complexity.maxNodes/maxEdges/hardMaxNodes`, `requireCaptions` — both already real config
fields in `@forge/schemas`' `diagramsSchema`).

**Surface:** `@forge/diagrams/lint`
- `interface DiagramFinding { checkId: string; severity: 'error' | 'warn'; message: string; nodeId?: string }`.
- `interface LintDiagramOptions { knownIds?: ReadonlySet<string>; complexity?: { maxNodes: number; maxEdges: number; hardMaxNodes: number }; requireCaptions?: boolean; now?: Date }` — every field optional
  with the `08` §8.11.9 defaults (20/30/40, `true`), so a caller with no config still gets sane checks.
- `lintDiagram(diagram: Diagram, parsed: ParsedDiagram, options?: LintDiagramOptions): readonly DiagramFinding[]` — never throws for adversarial input, matching the M2-established boundary-input
  pattern; a missing `knownIds` skips `diagram:refs` rather than failing every node.

**Checks:**
- `diagram:refs`: a `depicts` id present in `knownIds` passes; one absent fails with that id named;
  omitting `knownIds` entirely skips the rule (documented, not silently "everything passes").
- `diagram:orphan-nodes`: a node with no incident edge is flagged; a node used only as an edge
  endpoint is not.
- `diagram:complexity`: exactly at `maxNodes`/`maxEdges` is clean; one over is `warn`; at or past
  `hardMaxNodes` is `error` — the three-tier boundary from `08` §8.11.7's own "warn → error at 40".
- `diagram:label-quality`: empty, single-character, and the literal placeholder examples the spec
  names (`foo`, `TODO`, `Component1`) each fail; an ordinary short real label (`API`) does not.
- `diagram:caption`: missing `caption`/`alt_text` fails (though `diagramSchema` itself already
  requires both as non-empty strings — this rule additionally catches a caption that is only
  whitespace-padded or a single word, "non-trivial" per `08` §8.11.7); disabled entirely when
  `requireCaptions: false`.
- `diagram:staleness`: `review_by` in the past (relative to `options.now`, injected — no wall-clock
  read) is `warn`; today or future is clean.
- Determinism (R10): identical inputs (including `now`) always produce findings in the same order.

**Depends on:** P1 (`ParsedDiagram`), `@forge/schemas` (`diagramSchema`, `DIAGRAM_NOTATIONS`).

*(P2 is committed: `2a137a4`.)*

---

## P3 — The eight diagram generators

**Mandate:** produce Mermaid source (plus the `Diagram` front matter fields a generator can itself
know: `kind`, `generated: true`, `generator`, `depicts`) from each generator's own declared source of
truth, by name, through one registry every later piece (drift detection, and eventually a CLI) can
call without knowing the individual generator functions.

**Spec:** `08` §8.11.6's table (the eight generators, each row's Source of truth → Output).

**Surface:** `@forge/diagrams/generate`
- `type GeneratorName = 'components-to-c4' | 'interfaces-to-sequence' | 'datamodel-to-er' | 'schema-introspect-to-er' | 'specgraph-to-graph' | 'workflow-to-dag' | 'deps-to-graph' | 'pipeline-to-flow'`.
- `interface GeneratedDiagram { source: string; kind: DiagramKind; depicts: readonly string[] }`.
- `runGenerator(name: GeneratorName, input: unknown): GeneratedDiagram` — each generator's own `input`
  shape is documented at its own function, not unified into one interface (the eight sources of truth
  share no common shape: `SpecGraph` for `specgraph-to-graph`, workflow definitions for
  `workflow-to-dag`, plain structured records for the rest).
- `GENERATORS: Readonly<Record<GeneratorName, (input: unknown) => GeneratedDiagram>>` — the registry
  P4 (drift) and later `@forge/cli` (M6) call by name.

**Checks:**
- One golden-file test per generator (`08` M3's own acceptance criterion: "every generator golden-file
  tested") — a small hand-built input produces byte-identical Mermaid source to a checked-in fixture.
- `specgraph-to-graph` takes a real `@forge/core/graph` `SpecGraph` and renders every node/edge it
  reports — reusing the already-built graph, not a second parallel traversal of spec artifacts.
- Every generator's output re-parses cleanly through P1's `parseDiagram` (a generator that emits
  syntactically invalid Mermaid is a defect in the generator, not an acceptable output).
- Determinism (R10): generator output for the same input is byte-identical across two calls — node/
  edge ordering never depends on `Map`/`Set` iteration order of an unordered input structure without
  an explicit sort.

**Depends on:** P1 (re-parse check), `@forge/core/graph` (`specgraph-to-graph`).

*(P3 is committed: `15826b1`.)*

---

## P4 — Drift detection and transclusion sync

**Mandate:** for a `generated: true` diagram, regenerate it via P3's registry and compare against the
committed source, reporting a mismatch as configurable-severity drift (`fail`/`autofix`/`warn`, `08`
§8.11.6); separately, for an inline transcluded block (the `<!-- forge:diagram id=... src=... -->`
marker), detect when its fenced content has diverged from the `.mmd` file it claims to mirror.

**Spec:** `08` §8.11.4 (the transclusion marker format, `forge diagram sync`), §8.11.6 (drift rule and
the three policies), §8.11.7 (`diagram:drift`, `diagram:transclusion`); `specs/22` M3's own diagram
exit test names a `fixtures/diagram-drift` fixture this piece creates.

**Surface:** `@forge/diagrams/drift` — corrected in place from an earlier draft that had `checkDrift`
regenerate with no generator *input* to regenerate from, and `validateDiagrams` returning
synchronously despite needing `parseDiagram` (async, `SPEC-QUESTIONS.md`): neither omission survives
contact with what P3's real `GENERATORS` and P1's real `parseDiagram` actually require.
- `interface DriftResult { diagramId: string; hasDrift: boolean; expected: string; actual: string }`.
- `checkDrift(diagram: Diagram, actualSource: string, generatorInput: unknown): DriftResult` — a
  generator needs real input to regenerate from (P3's own `ComponentsToC4Input` etc.), which this
  piece cannot fetch itself (no project-tree access — `diagrams ← core, schemas` only); the caller,
  wherever it has that current input, supplies it. Throws `ForgeError('KB-003', ...)` for
  `generated: true` with no `generator` name, or a name outside `GENERATOR_NAMES`.
- `interface TransclusionBlock { diagramId: string; src: string; fencedContent: string }`,
  `parseTransclusionMarkers(markdown: string): readonly TransclusionBlock[]`,
  `checkTransclusion(block: TransclusionBlock, sourceContent: string): boolean` — `true` when the
  fenced copy matches its `.mmd` source exactly, including the transclusion's own injected
  `%% forge:generated-from <src> — do not edit here` header line (the worked example's own line —
  not part of the `.mmd` file itself, added at transclusion time); a mismatch is reported by the
  caller as `ForgeError('KB-031', ...)` — `08` §8.11.4's own exact, spec-given code for this one case,
  registered in `@forge/core/errors` (not invented here, since it is already normative text).
- `applyAutofix(target: AbsolutePath, expected: string): Promise<void>` — `@forge/core/fs`'s
  `writeFileAtomic`, one call; the caller resolves `diagram.source` (a project-relative path) to a
  real `AbsolutePath` — this package owns no project-root/containment logic of its own.
- `interface DiagramToValidate { diagram: Diagram; actualSource: string; knownIds?: ReadonlySet<string>; generatorInput?: unknown; target?: AbsolutePath; now?: Date }`,
  `interface ValidateDiagramsOptions { driftPolicy: 'fail' | 'autofix' | 'warn'; complexity?: ComplexityBudget; requireCaptions?: boolean; markdownDocuments?: readonly string[] }`,
  `async function validateDiagrams(diagrams: readonly DiagramToValidate[], options: ValidateDiagramsOptions): Promise<{ findings: readonly DiagramFinding[]; errors: readonly { diagramId: string; error: unknown }[] }>` —
  the one entry point `SPEC-QUESTIONS.md` Q43 has M3's kb-lint-equivalent Checks call; parses each
  `actualSource` (P1), runs P2's `lintDiagram`, and for every `generated: true` entry also runs
  `checkDrift` (skipped, not failed, when `generatorInput` is omitted — the same "caller didn't supply
  it, not caller supplied nothing" shape `knownIds` already uses) — `autofix` actually rewrites the
  file only when the entry also supplies `target`. `markdownDocuments`, when supplied, is scanned for
  `08` §8.11.4 transclusion markers, each resolved against `diagrams`' own `diagram.source`/
  `actualSource` pairs and reported as `diagram:transclusion` on a mismatch — corrected in place
  after a gauntlet critic found an earlier draft's `validateDiagrams` never actually called
  `checkTransclusion` despite claiming to (`SPEC-QUESTIONS.md` Q47); `errors` — also added in that
  round — means one entry's own `parseDiagram`/`checkDrift` failure no longer discards every other
  entry's already-computed findings.

**Checks:**
- `fixtures/diagram-drift` (created here): one `generated: true` diagram whose committed source has
  been hand-edited out of sync with its generator's real output — `checkDrift` reports `hasDrift: true`
  naming exactly the diverging diagram id.
- A `generated: true` diagram whose committed source exactly matches regeneration reports
  `hasDrift: false`.
- `autofix` policy actually rewrites the committed `.mmd` to the regenerated content (via
  `@forge/core/fs`'s atomic write); `fail`/`warn` never touch disk.
- A transclusion marker's fenced block edited by hand (diverged from its `.mmd` source) is caught by
  `checkTransclusion`; one left exactly as `forge diagram sync` would have produced it is not.
- `validateDiagrams` against `fixtures/diagram-drift` returns a result whose shape is what a future
  `forge diagram validate` CLI wrapper (M6) maps to exit code 3 — asserted directly on the returned
  value, per `SPEC-QUESTIONS.md` Q43, not by shelling out to a CLI that does not exist yet.

**Depends on:** P1, P2, P3.

*(P4 is committed: `63919c5`.)*

---

## P5 — Self-contained HTML render fallback

**Mandate:** render a diagram to a single self-contained HTML file — a bundled Mermaid script and the
raw diagram source inlined, zero network calls, zero external references — as the default, always-
available rendering path; a local-renderer path is optional and simply not built here (`08` §8.11.8a
is "if the optional dependency is installed", which this milestone does not install).

**Spec:** `08` §8.11.8 (the two-path pipeline, fallback (b) as "the default fallback and requires no
extra install and no network at render time"), §8.11.8's theming paragraph (light/dark pair, shape
legend); `02` §2.1's "Diagram rendering" row; `20` §20's note that "the bundled Mermaid script used for
diagram rendering is version-pinned and integrity-checked."

**Surface:** `@forge/diagrams/render`
- `interface RenderOptions { legend?: Readonly<Record<string, string>>; theme?: { light: string; dark: string } }`.
- `renderHtml(source: string, options?: RenderOptions): string` — one HTML string: `<!doctype html>`,
  a `<script>` block with the pinned Mermaid UMD build's full text inlined (not a `<script src>` —
  "self-contained" per `08` §8.11.8b means no fetch of any kind, including of the script itself), a
  `<pre class="mermaid">` containing the escaped source, and an auto-appended legend when `legend` is
  given.
- `BUNDLED_MERMAID_VERSION: string` — exported so a test (and later a security audit, `20`) can assert
  the pinned version in use.

**Checks (revised — see `SPEC-QUESTIONS.md` Q48; the original "no `fetch(`/`http://` substring
anywhere" text was unsatisfiable once checked against the real, pinned `mermaid.min.js`, which
legitimately contains SVG namespace URIs, license-comment URLs and dead-code `fetch(` tokens):**
- Static check, scoped to the HTML wrapper `renderHtml` itself authors (excluding the verbatim-inlined
  third-party bundle text): no `<script src=`, no hardcoded external URL of this package's own
  authorship.
- Behavioural check, in the headless-DOM render test: `globalThis.fetch`/`XMLHttpRequest.prototype.send`
  are spied on before the rendered HTML's scripts run in `jsdom` and asserted never called during a
  real render pass, for one example per diagram kind from P1's own worked examples — this is what
  actually proves the zero-network claim, including for the vendored bundle this package does not
  author.
- The emitted HTML, opened in the same headless-DOM test, actually renders the Mermaid block to a
  real SVG with no thrown error, for one example per diagram kind.
- A legend, when supplied, appears in the output; omitted when not.
- Special characters in `source` (an inline `</script>`-looking sequence, raw `<`/`>`) are escaped so
  the diagram source can never break out of its container element; the inlined bundle text is itself
  guarded against a `</script` sequence prematurely closing its own `<script>` element.
- Determinism (R10): `renderHtml` is a pure function of its inputs; the bundled script text and
  version are build-time constants (read once, from this package's own pinned dependency), never
  fetched at render time.

**Depends on:** nothing new (takes raw Mermaid source directly; does not need P1's structural model).

*(P5 is committed: `40bee2f`.)*

*(Diagrams track (P1–P5) complete at this point — `@forge/diagrams` has no further pieces this
milestone.)*

---

## P6 — The KB entry schema and on-disk tree

**Mandate:** give every KB file kind its schema and give the whole `docs/forge/kb/**` tree (`08` §8.2)
a single parse/validate entry point, reusing `@forge/schemas`'s already-built `adrSchema` and
`diagramSchema` (and its `Risk`/`Assumption`/`OpenQuestion`/`Environment` collection-*entry* schemas)
rather than redefining any of the five, and adding two things that do not already exist anywhere: the
generic `knowledge`/`glossary` KB entry `08` §8.3 describes (deliberately outside the 21-type
`specs/18` §18.7 registry per `SPEC-QUESTIONS.md` Q18/the `@forge/schemas` registry's own comment, so
never built), and — discovered only while actually trying to parse the tree, not anticipated in this
plan's first draft — a wrapper schema for each `collection: true` file's own on-disk shape
(`risks.md`/`assumptions.md`/`open-questions.md`/`kb/delivery/environments.md`), since no spec section
states what a *populated* collection file looks like once it holds more than one entry
(`SPEC-QUESTIONS.md` Q29's second deferred point, closed by Q50). The four wrapper schemas live in
`@forge/schemas/artifacts/collection-file.ts`, alongside the entry schemas they wrap, not in
`@forge/kb` — this piece's own mandate is to *reuse* schemas, not grow new ones inside `@forge/kb`
itself; `kbEntrySchema` remains the one schema that is genuinely `@forge/kb`'s own to define, since it
has no home in the 21-type registry at all.

**Spec:** `08` §8.2 (layout), §8.3 (entry format, verbatim worked example), §8.4 (ADR, reused not
rebuilt).

**Surface:** `@forge/kb/schema`
- `KB_ENTRY_TYPES = ['knowledge', 'adr', 'risk', 'assumption', 'open-question', 'glossary'] as const`
  (`08` §8.3's own `type:` enum comment) — `'adr'`/`'risk'`/`'assumption'`/`'open-question'` here name
  how a *generic* entry may reference itself when it isn't one of those dedicated artifact kinds; the
  dedicated kinds keep using their own `@forge/schemas` schema.
- `kbEntrySchema` (zod) — every §8.3 field: `id` (new `KB-{SECTION}-{####}` shape, not
  `entryIdSchema`'s prefix-only pattern — a new regex), `type`, `section`, `title`, `status`,
  `confidence`, `owner`, `sources` (`{ kind: 'decision' | 'human' | 'code'; ref: string }[]`,
  non-empty — "provenance is mandatory"), `created`/`updated`/`verified?`/`review_by`, `supersedes`,
  `superseded_by`, `related`, `diagrams`, `tags`, `applies_to`; a `superRefine` requiring
  `Verification` body content whenever `confidence: 'verified'` (mirrors `adrSchema`'s own
  `superseded_by`-consistency pattern from M1).
- `parseKbTree(rootDir: AbsolutePath): Promise<KbTree>` — walks `08` §8.2's fixed directory shape,
  parsing each file with `@forge/core/artifacts`'s existing front-matter parser and the right schema
  for its path (ADR files → `adrSchema`, `views/*.mmd.yaml` → `diagramSchema`, the four
  `collection: true` files → their new `@forge/schemas` wrapper schema (`SPEC-QUESTIONS.md` Q50),
  everything else → `kbEntrySchema`); never throws for one bad file — collects a `KbParseError` per
  file instead, matching `@forge/extensions`' established never-throws-on-boundary-input pattern.

**Checks:**
- `08` §8.3's own worked example (`KB-ARCH-0007`) parses to the exact field values shown.
- A `KB-{SECTION}-####` id in a section that does not match its own file's directory (`KB-DATA-0001`
  filed under `architecture/`) is a distinct, named validation failure — not folded into a generic
  schema error.
- `confidence: verified` with no `## Verification` body section fails; the same entry with one passes.
- `sources: []` fails ("a write with no source is rejected" — checked here at the schema level; P7
  enforces it again at the write boundary since a hand-edited file could otherwise slip past).
- A minimal valid KB tree (`fixtures/greenfield-service`, created here — the base this milestone's
  later pieces extend) parses with zero `KbParseError`s, including all four `collection: true` files
  populated with more than one entry each (the exact case `SPEC-QUESTIONS.md` Q29/Q50 found nothing
  in the spec pack to test against before).
- ADR and Diagram files inside the tree parse via the *existing* `@forge/schemas` schemas — asserted
  by checking the returned value's type tag, proving no shadow re-implementation was written.

**Depends on:** `@forge/schemas` (`adrSchema`, `diagramSchema`, `riskSchema`, `assumptionSchema`,
`openQuestionSchema`, `environmentSchema`, and the four new collection-file wrapper schemas),
`@forge/core/artifacts` (front-matter parsing), `@forge/core/fs`.

*(P6 is committed: `28e0946`.)*

---

## P7 — KB id allocation and `KbWriter`

**Mandate:** allocate `KB-{SECTION}-{seq:04d}` ids centrally, monotonically, never reused (per
section, mirroring `08` §8.6 exactly), and give every KB write one of exactly two paths — direct write
(schema-valid, `updated` bumped, event appended) or proposal (a structured single-field change +
rationale, queued per target, rebased or conflict-escalated) — with concurrent writes to the same
entry serialised through one queue, rebasing the second onto the first. Five real gaps in this plan's
own first draft, none answerable from `08` §8.6 alone, were found and closed before writing code —
see `SPEC-QUESTIONS.md` Q52 for all five and why each answer was taken.

**Spec:** `08` §8.6 (both write paths, all four `KbWriter` invariants).

**Surface:** `@forge/kb/write`
- `KbIdAllocator` — same shape as `@forge/core/ids`'s `IdAllocator` (a scan-based, queued, never-
  reuse allocator) but keyed by KB section rather than `ArtifactTypeId`, since `08` §8.3's id scheme is
  explicitly outside that registry (`SPEC-QUESTIONS.md` Q18's own note, confirmed again at P6). Not a
  subclass or a fork of `IdAllocator` — a new, small class following the same established pattern
  (scan real files as truth; queue every operation) for a genuinely different key space. Its own scan
  counts an id as claimed straight from a file's raw `id` field (mirroring `countIdsFromFiles`'s own
  "a schema-invalid document's id still counts as claimed" rule) — it does not reuse `parseKbTree`'s
  full-validation results, since a document failing validation for an unrelated field must not read as
  "this id is still free."
- `interface KbEntryInput` — every `kbEntrySchema` field except `id`/`created`/`updated` (allocated/
  clock-derived), plus `path: string` (Q52 point 1: the caller supplies the destination's relative
  path under the KB root; `08` §8.2 gives no rule for naming a brand-new topic's file).
- `KB_PROPOSAL_FIELDS = ['statement', 'rationale', 'implications', 'verification'] as const` — `08`
  §8.3's own four fixed body sections.
- `interface KbProposal { targetId: string; field: (typeof KB_PROPOSAL_FIELDS)[number]; baseValue:
  string; proposedValue: string; rationale: string; sources: readonly KbSource[] }` (Q52 point 3: a
  structured single-field change, not a raw text diff — rebasing is optimistic-concurrency-control on
  that one field's current value, not a hand-rolled patch-application engine with no spec-given format
  to build against).
- `type KbProposalOutcome = { status: 'applied'; proposal: KbProposal; diff: string } | { status:
  'conflict'; proposal: KbProposal; currentValue: string }` (Q52 point 4: corrected from the original
  `Promise<KbProposal>`, which could not report which of the two actually happened).
- `class KbWriter { write(entry: KbEntryInput): Promise<KbEntry>; propose(proposal: KbProposal):
  Promise<KbProposalOutcome>; }` — `write` throws `ForgeError` (a new, low free `KB-0xx` slot, picked
  and recorded in `SPEC-QUESTIONS.md` the same way P1 picks its own) for a schema-invalid entry or an
  entry with no `sources`; `propose` never throws — a conflict is a normal, reported outcome, not an
  error. Neither method performs contradiction detection (Q52 point 2: that is `08` §8.7's KB-linter
  algorithm, P10, not yet built and not this piece's job standalone). Each successful operation appends
  one line to its own small, KB-scoped event log at `.forge/state/kb-events.jsonl` (Q52 point 5: no
  general, run-wide event-log implementation exists anywhere yet to hook into).

**Checks:**
- `write` on a schema-valid entry with real `sources` succeeds, bumps `updated` to the injected clock's
  `now()`, and appends one event to the writer's event log.
- `write` on an entry with `sources: []` is refused with the documented remedy, never silently
  accepted.
- Two concurrent `write` calls targeting the same section allocate two distinct, contiguous ids — no
  race where both read the same "next" counter (same queuing discipline P1–P9 of M2 already
  established and tested for `@forge/extensions`' own writers).
- Two concurrent `propose` calls against the *same target entry*, targeting *different* fields, both
  apply — the second is not blocked by the first touching an unrelated part of the entry.
- Two concurrent `propose` calls against the same target and the same field: the first applies; the
  second, still holding the pre-first `baseValue`, is reported as `status: 'conflict'` rather than
  silently overwriting the first or throwing.
- Determinism (R10): id allocation and `updated` timestamps derive only from the injected `Clock` and
  the real on-disk scan — no wall-clock read, no reliance on file iteration order.

**Depends on:** P6 (`kbEntrySchema`, `parseKbTree`'s dispatch conventions), `@forge/core/ids` (the
established allocator pattern, reused by shape not by inheritance), `@forge/core/clock`,
`@forge/core/fs` (atomic writes, `resolveState` for the id cache and event log).

---

## P8 — SQLite index with a JSON fallback

**Mandate:** maintain the derived index `08` §8.5 names (`entries`, `links`, `terms`, `symbols`,
`usage`) at `.forge/state/index.db`, fully rebuildable from the KB tree alone, on the three-tier
backend `02` §2.1 mandates (`better-sqlite3` → `node:sqlite` if present → a pure JSON index), with one
interface hiding which of the three is actually active from every caller.

**Spec:** `08` §8.5's table (the five tables' contents); `02` §2.1's "Local DB" and "Node API surface"
rows (the exact three-tier fallback, and that it "MUST be rebuildable from event log" — here, from the
KB tree, this package's own source of truth per `18` §18.1).

**Surface:** `@forge/kb/index`
- `interface KbIndexBackend { upsertEntry(row: EntryRow): void; upsertLinks(id: string, links: readonly LinkRow[]): void; search(query: string): readonly { id: string; score: number }[]; expand(ids: readonly string[], hops: number): readonly string[]; close(): void }` — one shape, three
  implementations (`SqliteBackend` via `better-sqlite3`, `NodeSqliteBackend` via `node:sqlite`,
  `JsonBackend` — a plain object written atomically), selected by `openKbIndex(paths): KbIndexBackend`
  probing availability in that exact order and never throwing for an unavailable native module.
- `rebuildIndex(tree: KbTree, backend: KbIndexBackend): void` — clears and repopulates every table from
  a freshly-parsed tree; the only path callers should trust as ground truth, matching `08` §8.5's own
  "derived index (rebuildable)" framing.

**Checks:**
- `rebuildIndex` run twice from the same `KbTree` produces identical query results both times (the
  milestone's own acceptance criterion: "KB round-trips/lints/indexes with identical index-rebuild
  query results") — asserted against all three backends, not just whichever one happens to be
  installed in CI.
- `terms` search (BM25 via SQLite FTS5 for the two SQLite backends; a deterministic scored-substring/
  term-overlap ranking for the JSON fallback — documented as an approximation, not BM25, since FTS5 has
  no pure-JS equivalent) returns the same *top result* for a simple, unambiguous query regardless of
  backend, even though exact scores differ.
- `expand(ids, hops: 1)` returns exactly the entries linked to `ids` and nothing two hops away; `hops: 0`
  returns `ids` unchanged.
- Deleting `.forge/state/index.db` (or the JSON file) and calling `rebuildIndex` again leaves the
  project's queryable state identical to before deletion — the `18` §18.1 invariant, checked directly.
- `openKbIndex` with `better-sqlite3`'s native binding deliberately made unloadable (a test double, not
  actually uninstalling the package) falls through to `node:sqlite` or the JSON backend without
  throwing.

**Depends on:** P6 (`KbTree`), `@forge/core/fs` (JSON backend's atomic writes). `better-sqlite3` and,
conditionally, `node:sqlite` are new to this package only (`@forge/extensions` never needed a DB).

---

## P9 — Retrieval, graph expansion, and context packing

**Mandate:** implement `08` §8.5's four non-embedding retrieval steps (structural, lexical, graph
expansion, budget re-rank) over P8's index, and `@forge/kb/pack` exactly as `05` §5.4 specifies it —
pinned core first and never evicted, declared inputs in full, retrieved entries capped by token budget,
composition recorded for the run record — rather than `08` §8.5's own shorter restatement, since `05`
§5.4 is the more concrete of the two and the one this surface is actually named after.

**Spec:** `05` §5.4 (all seven numbered rules); `08` §8.5 (retrieval strategy, numbered steps 1–3 and
5 — step 4, embeddings, is explicitly out of scope this milestone).

**Surface:** `@forge/kb/pack`
- `estimateTokens(text: string): number` — a documented, deterministic, dependency-free approximation
  (character-length-based; exact ratio is an implementation choice recorded in `SPEC-QUESTIONS.md` when
  this piece is built) — no tokenizer library is named anywhere in the spec pack for this purpose.
- `interface PackRequest { declaredInputIds: readonly string[]; briefText: string; budgetTokens: number; pinnedCoreOverrides?: Partial<PinnedCore> }`, `interface PinnedCore { projectIdentity?: string; level?: string; glossary: string; adrIndex: string; stageGoal?: string; codingStandards: string }`
  — `glossary`, `adrIndex` and `codingStandards` are fetched from the KB tree itself (they are KB
  entries: `glossary.md`, the generated ADR index, `engineering/standards.md`); `projectIdentity`,
  `level` and `stageGoal` are not KB data (config and run-state, owned by packages this one cannot
  depend on) and are accepted only via `pinnedCoreOverrides`, defaulting to omitted when not supplied.
- `interface ContextPack { pinnedCore: PinnedCore; declaredInputs: readonly { id: string; content: string }[]; retrieved: readonly { id: string; content: string; score: number }[]; manifest: { ids: readonly string[]; tokenCounts: Record<string, number> } }`.
- `buildContextPack(request: PackRequest, backend: KbIndexBackend, tree: KbTree): ContextPack`.

**Checks:**
- Structural retrieval (`declaredInputIds`) always returns full text for every declared id, even one
  the lexical/graph steps would never have surfaced on their own.
- Lexical retrieval over `briefText` ranks an entry containing the brief's salient terms above one that
  does not, using P8's FTS/JSON search.
- Graph expansion pulls exactly the 1-hop neighbours of the *structurally* required entries (not of
  every retrieved entry), filtered by recency when two candidates tie on relevance.
- Budget respected: shrinking `budgetTokens` below what every candidate would need drops the lowest-
  ranked *retrieved* entries first and never drops anything in `pinnedCore` or `declaredInputs` — the
  milestone's own acceptance criterion ("never evicts pinned core") checked at the boundary (a budget
  smaller than pinned core alone still returns pinned core in full, over budget, rather than truncating
  it).
- `manifest` records exactly the ids actually included and each one's token count — no content —
  matching `18` §18.2's `context.json` description verbatim.
- Determinism (R10): identical `PackRequest` + identical index state always produces byte-identical
  `ContextPack` output, including tie-break ordering.
- Benchmark (informational, not a gate): pack assembly over a ~500-entry fixture completes well inside
  `21` §21's own 300 ms figure — recorded, not enforced as a hard failure in this milestone's own test
  run.

**Depends on:** P8 (`KbIndexBackend`), P6 (`KbTree`).

---

## P10 — The KB linter and verification

**Mandate:** implement every `08` §8.7 rule as one `lintKb` pass (schema validity via P6, referenced-
id existence, no dangling/cyclic supersession, deterministic contradiction detection, ADR coverage,
every `diagram:*` rule — P2/P4's checks composed in, plus `diagram:required`/`diagram:adr-coverage`
implemented here per `SPEC-QUESTIONS.md` Q44 — CAP-to-epic coverage, staleness, low-confidence-into-
accepted-ADR, verification-command presence, orphan entries, glossary drift), and `08` §8.8's
staleness/verification pass (`forge kb verify`'s two literal checks: running `Verification` commands,
and `review_by` staleness) as a second, related function.

**Spec:** `08` §8.7 (the full rule table plus the contradiction-detection implementation paragraph),
§8.8 (staleness and drift — the code-drift half is explicitly narrowed, see Depends-on).

**Surface:** `@forge/kb/lint`
- `interface KbFinding { ruleId: string; severity: 'error' | 'warn'; message: string; entryId?: string }`.
- `lintKb(tree: KbTree, specArtifacts: { capabilities: readonly Capability[]; epics: readonly Epic[] }, diagramsBackend: { validateDiagrams: typeof validateDiagrams }, now: Date): readonly KbFinding[]` —
  the `SPEC-QUESTIONS.md` Q43 entry point M3's own exit-test-equivalent Check calls; returns the exact
  finding set a future `--json` CLI flag (M6) would print, `[]` when clean.
- `checkContradictions(entries: readonly KbEntry[]): readonly KbFinding[]` — the curated antonym-pair
  table (`08` §8.7's three named examples, seeded and extensible) plus the two ADR-status rules;
  exported separately so a later, optional LLM-backed semantic pass (no adapter exists until M7) can
  be composed alongside it as pure additional warnings without touching this function.
- `verifyKb(tree: KbTree, runCheck: (command: string) => Promise<boolean>, now: Date): Promise<readonly KbFinding[]>` — runs every `confidence: verified` entry's `Verification` command through the
  injected `runCheck` (never shells out itself — keeps this package's own dependency surface clean) and
  flags a failing or now-past-`review_by` entry as `needs-review`.

**Checks:**
- `fixtures/greenfield-service` (P6's base fixture, extended here) lints clean (`lintKb` returns `[]`)
  — the milestone's own exit-test target, asserted directly per Q43.
- A dangling `related` id, a supersession cycle (A supersedes B supersedes A), and two `active` entries
  in the same section with an antonym-pair tag conflict on the same `applies_to` each produce their own
  named finding — one fixture case per rule, not one combined fixture.
- Two `accepted` ADRs in the same `category` + `applies_to` scope with no supersession link between
  them is flagged; adding a `supersedes` link between them clears the finding.
- A component in `components.md` with zero owning ADRs is flagged at error severity; one with ≥1 is
  clean.
- `diagram:required`/`diagram:adr-coverage` (built here, not in `@forge/diagrams`) correctly flag a
  structural ADR (`category: architecture`, no `diagrams` entry) and a missing taxonomy-required
  diagram for the fixture's own configured level.
- An LLM-shaped semantic-contradiction finding (simulated: a caller composes one extra warning-severity
  `KbFinding` alongside `checkContradictions`' own output) never elevates to `error` — proven by the
  return type itself (`severity` stays a caller-supplied value on that composed finding, never
  upgraded), matching "LLM findings are warnings only, never fail a gate" by construction.
- `verifyKb` marks an entry `needs-review` when its injected `runCheck` returns `false`, and separately
  when `now` is past `review_by`, with two distinguishable finding messages.
- Determinism (R10): `lintKb` and `verifyKb` produce identically-ordered output across repeated runs
  over the same tree and the same injected `now`.

**Depends on:** P6, P7 (id/section data), P8 (orphan-entry detection needs the `links` table), P2 and
P4 (`@forge/diagrams`' own findings, composed in), `@forge/core/artifacts` (reading `Capability`/`Epic`
spec artifacts for CAP-coverage — outside the KB tree proper, inside `docs/forge/specs/`). Code-drift
detection (`08` §8.8's "re-checked when the component's files change beyond a threshold... post-merge
check") is narrowed per a build-time `SPEC-QUESTIONS.md` entry to a pure function taking a caller-
supplied changed-file list, since the actual git/post-merge wiring needs orchestration hooks this
package has no dependency path to and that do not exist before later milestones.

*(kb track (P6–P10) complete — `@forge/kb` and `@forge/diagrams` both closed out; M3 done.)*
