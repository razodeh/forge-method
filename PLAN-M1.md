# PLAN-M1 — Foundations: repo, schemas, core domain

Source: `specs/22` M1. **Build:** monorepo per `02` §2.2; `@forge/schemas`; `@forge/core`; the
dependency-boundary lint. **Do not build:** engine, adapters, TUI, KB retrieval, any agent.

Fifteen pieces, dependency-ordered (P1b added mid-milestone; see its entry). Each has its own public surface, its own tests, and a
one-sentence mandate, so each can be judged alone against `QUALITY-BAR.md`. Production-code budget is
≤ ~400 lines per piece (data files and generated JSON Schemas excluded from the count; tests
excluded).

Legend: **Surface** = what the piece exports. **Checks** = the acceptance evidence a judge reads.

---

## P1 — Workspace scaffold and the deterministic floor

**Mandate:** make the floor commands real, with a strict, formatted, cross-platform toolchain behind
them.

> **Scope narrowed after P1's third review** (approved; see `BLOCKED-P1.md` §4, option B). P1 owns the
> toolchain and configuration. The *hermetic test environment* — network denial, locale, collection
> completeness, and proof that each rule actually fires — moved to **P1b**, because "no bypass
> exists" is a security property that needs a threat model and a test per declared channel, not a
> deny-list extended one critic at a time.

**Spec:** `02` §2.1 (tech choices), `02` §2.2 (layout), `21` §21.1 (determinism, no-network).

**Surface:** no runtime exports. `pnpm-workspace.yaml`, `turbo.json`, `tsconfig.base.json`
(strict, ESM, `NodeNext`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`), root
`package.json` scripts, `eslint.config.js` (flat, v9), `.prettierrc`, `.changeset/config.json`,
`vitest.workspace.ts`, `test/setup.ts`, `.github/workflows/ci.yml` (ubuntu + windows, node 20/22/24).

**Checks:**
- The four floor commands available at this point (`build`, `typecheck`, `lint`, `test`) exit 0 on
  the empty workspace. `pnpm boundaries` is **not** among them: its implementation is P2's mandate,
  and adding a script that exits 0 without checking anything would be exactly the stub `QUALITY-BAR`
  R7 forbids. P2 adds both the script and its CI step. *(Amended after P1's review, which correctly
  read the original wording as promising five.)*
- `pnpm install --frozen-lockfile` succeeds from a clean checkout — the first step of every CI leg.
- The timezone is pinned and the pin is load-bearing: the suite passes under a non-UTC host zone, and
  the assertions observe rendered output rather than reading back the variable that was just set.
- Git is pinned to reproducible *bytes*, not just identity: a `git init && commit` in a tmpdir
  produces a fixed SHA, which fails if author, committer, date, `core.autocrlf`, `commit.gpgsign` or
  the default branch is uncontrolled.
- Per-file coverage thresholds per `QUALITY-BAR.md` §3, with a fixture proving an uncovered line
  fails the run — aggregate thresholds pass a wholly untested module and are not sufficient.
- `.gitattributes` normalises line endings, without which the `windows-latest` legs fail
  `prettier --check` on checkout.
- Every source file in the repo is covered by `tsconfig` (`scripts/` included) — a file typechecked
  by nothing is outside the discipline this piece exists to install.
- CI matrix includes `windows-latest` and a non-UTC timezone leg; the required status check treats a
  skipped job as failure.

**Depends on:** nothing.

---

## P1b — The hermetic test environment

**Mandate:** every guarantee the floor claims is proven by a test that fails when the guarantee is
removed — and the network control is specified by a threat model with a closed allow-list, not by a
list of bypasses someone happened to think of.

Added mid-milestone after P1's third review (approved). `BLOCKED-P1.md` §3 records why: three
adversarial rounds found the same three classes of defect — an allow-list that fails open, an
enforcement claim with no test, and each new mechanism arriving as unguarded surface.

**Spec:** `21` §21.1 (network denial, determinism), `QUALITY-BAR.md` R10, §3.

**Surface:** `test/network-guard.mjs`, `scripts/run-tests.mjs`, the collection and coverage globs in
`vitest.config.ts`, the R10 rule set in `eslint.config.js`, and the tests that prove each fires.

**Design constraint — patch before the ESM facade exists.** The guard reaches `node:dns`, `node:net`,
`node:dgram`, `node:worker_threads` and `node:child_process` through `process.getBuiltinModule`,
never a static import.
Node builds a builtin's ESM facade once and snapshots its exports, so a patch applied afterwards is
invisible to `import { resolve4 } from 'node:dns'` — the spelling ordinary code uses. That single
mechanism defeated three channels across three reviews before being recognised as one cause; see
`BLOCKED-P1b.md` §1.

**Design constraint — the allow-list is positive and closed.** The guard permits exactly: a unix
domain socket, the literal host `localhost` (case-insensitively), an IPv4 literal in
`127.0.0.0/8` as validated by `net.isIP`, the IPv6 loopback in any of its legal spellings, and the
unspecified addresses `0.0.0.0` and `::` — which is what `server.address().address` reports for a
server bound with no host, and denying them forced tests into worse workarounds. Everything else is denied, including every hostname and every
input whose destination cannot be determined. No prefix matching on a host string anywhere. This is
what makes `127.0.0.1.nip.io`, a `String` object host, and any future spelling denied *by
construction* rather than by having been anticipated.

**Threat model — one declared channel, one test.** `fetch`; `node:http`/`https`/`net`/`tls`/`http2`;
`dgram` addressed and connected; `dns`, `dns.promises` and `Resolver`; `WebSocket`; a worker thread,
including one with explicit `execArgv` and a nested one; **a child process**, which is reachable
because the guard already arrives there via inherited `NODE_OPTIONS`; and dynamic `import()` of any
of the above. Anything genuinely out of reach is listed in `SPEC-QUESTIONS.md` with a rationale that
has been *executed*, not assumed.

**Checks:**
- One test per declared channel, each asserting `NetworkAccessDeniedError` with its `channel` field.
- `isPermittedHost` has direct unit tests, including `127.example.com`, `127.0.0.1.nip.io`, a
  bracketed IPv6 form, a non-string input, and every permitted case.
- Loopback stays usable: a test starts a server on `127.0.0.1` and reaches it over both `net` and
  `fetch`.
- **Collection completeness by set equality.** A whole-repo walk for `*.{test,spec}.*` at any
  extension is compared with `vitest list --json` as an equality, not a subset — the round-2 version
  scanned the same roots as the globs and so could never observe a gap.
- A planted failing test at the repo root, in `scripts/`, in a package `specs/` directory, in a
  dot-directory, and with an `.mjs` extension is each collected; one of them is additionally run in a
  nested invocation to prove a failing test actually fails the run rather than merely being found.
- **Coverage cannot be dodged.** Ignore pragmas (`v8 ignore`, `istanbul ignore`, `c8 ignore`) are a
  lint error, per `QUALITY-BAR.md` §3, which names adding one as a review failure in itself. Coverage
  globs are extension-agnostic, and a test asserts every workspace package keeps its source where the
  globs look.
- **The lint rules have tests.** `ESLint#lintText` over a fixture per spelling — alias, `globalThis`,
  destructuring, default-import, and detached-method forms — asserting the specific message. Deleting
  the R10 rule block must fail the suite; today it does not.
- Ambient locale is not depended upon: production code may not call `localeCompare`, `toLocale*` or
  `Intl.*` without an explicit locale, enforced by lint and proven by the lint tests. The environment
  variables the launcher sets are belt-and-braces for POSIX, not the guarantee — ICU reads the system
  locale on Windows and ignores them.

**Depends on:** P1.

---

## P2 — Dependency-boundary enforcement

**Mandate:** make an upward or undeclared cross-package import fail CI, from a single declaration of
the `02` §2.2 graph.

**Spec:** `02` §2.2 (dependency rules), `21` §21.3.

**Surface:** `tools/eslint-plugin-forge-boundaries/`
- `PACKAGE_GRAPH: Readonly<Record<ForgePackage, readonly ForgePackage[]>>` — the §2.2 table, one
  declaration, no duplication.
- rule `no-undeclared-package-import` — an import of `@forge/x` from package `y` is an error unless
  `x ∈ PACKAGE_GRAPH[y]`.
- rule `no-deep-package-import` — importing past another package's declared entry points is an error.
- rule `no-platform-concept` — the tokens `claude`, `subagent`, and model identifiers outside
  `packages/adapter-*` are an error (`mcp` carved out per `SPEC-QUESTIONS.md` Q2).
- `scripts/check-boundaries.mjs` → `pnpm boundaries`, a second non-eslint check over the built
  `package.json` dependency fields.

**Checks:**
- `RuleTester` cases for each rule: a valid import, an upward import, a sibling-but-undeclared
  import, a deep import, a relative `../../<pkg>` escape.
- A fixture package declaring `core → engine` fails `pnpm boundaries` with a non-zero exit and names
  both packages.
- `PACKAGE_GRAPH` matches `02` §2.2 exactly — a test asserts every row and rejects extra keys.

**Depends on:** P1.

**Also owns (deferred from P1):** a `runtime-floor` CI job that runs the built artifact on Node
20.10 — the floor `specs/02` §2.1 sets for published packages, which the dev toolchain itself cannot
run on. See `SPEC-QUESTIONS.md` Q9.

---

## P3 — `ForgeError` taxonomy

**Mandate:** one error type that every FORGE failure uses, carrying a code, a severity, an actionable
remedy, and the process exit code it maps to.

**Spec:** `02` §2.6 (taxonomy, code prefixes, exit codes).

**Surface:** `@forge/core/errors`
- `type ErrorCodePrefix = 'CFG'|'ENV'|'ADP'|'VCS'|'SPEC'|'KB'|'GATE'|'RUN'|'BUD'|'USR'` (literal
  union, per R1).
- `type ForgeErrorCode = \`${ErrorCodePrefix}-${string}\`` with a registry of every declared code.
- `type ErrorSeverity = 'fatal'|'error'|'warning'`.
- `class ForgeError extends Error { readonly code; readonly severity; readonly remedy: string;
  readonly docsUrl: string; readonly details: Readonly<Record<string, unknown>>; readonly cause?:
  unknown; toJSON(): ForgeErrorJson }`.
- `function exitCodeFor(error: unknown): ExitCode` implementing `0/1/2/3/4/5/6/130`.
- `function isForgeError(value: unknown): value is ForgeError`.
- `function formatForTerminal(error: ForgeError, opts: { color: boolean; ascii: boolean }): string`.

**Checks:**
- Constructing a `ForgeError` without a non-empty `remedy` is a *type* error and a runtime error
  (test asserts both).
- Every code in the registry has a prefix from the union, a remedy template, and a `docsUrl`; a test
  iterates the whole registry.
- `exitCodeFor` maps each documented case: gate failure → 3, budget → 4, env/prereq → 5, lock → 6,
  interrupt → 130, usage → 2, unknown non-Forge throwable → 1.
- `toJSON()` round-trips and never includes a stack in the serialised payload.
- **Coverage ratchet automation** (deferred here from P1, which had no package to ratchet):
  `scripts/check-coverage-ratchet.mjs` compares achieved per-package coverage against the committed
  high-water marks in `coverage-ratchet.json` and fails when coverage falls, so `specs/13` F-TEST-5
  is a check rather than a comment. Wired into `pnpm test`. Its decision logic lives in
  `scripts/lib/coverage-ratchet.mjs` and is unit tested; the command itself is driven as a
  subprocess against fixture trees, because a check nobody has exercised is indistinguishable from
  one that always passes.
- A wrapped `cause` is preserved and rendered, without leaking the cause's stack into `remedy`.

**Depends on:** P1, P2.

---

## P4 — Atomic filesystem helpers with path containment

**Mandate:** every write to a host project is contained, deny-listed, and atomic — no partial file is
ever observable.

**Spec:** `02` §2.5 (I/O safety), `18` §18.10 (atomic writes, fsync).

**Surface:** `@forge/core/fs`
- `class ProjectPaths { constructor(root: string); resolveWithin(relative: string): AbsolutePath }` —
  rejects `..` traversal, absolute escapes, and symlink escapes (checked with `realpath` on the
  resolved parent), on both POSIX and Windows path shapes.
- `const DENIED_PREFIXES` — `.git/`, `.forge/state/`, `node_modules/`.
- `writeFileAtomic(path: AbsolutePath, contents: string | Uint8Array): Promise<void>` — temp file in
  the same directory → `fsync(file)` → `rename` → `fsync(dir)`.
- `readTextFile`, `pathExists`, `ensureDir`, `listDirSorted` (explicit `localeCompare`-free byte
  sort, per R10).
- All failures are `ForgeError` with `CFG-`/`RUN-` codes.

**Checks:**
- Escape attempts rejected with the documented code: `../../etc/passwd`, `/etc/passwd`,
  `C:\\Windows\\system32`, a symlink inside the project pointing outside it.
- Deny-list rejection for each of the three prefixes, including nested paths.
- Atomicity: a write interrupted after the temp write but before rename leaves the destination at its
  previous content, and no temp file is left behind after a successful write.
- fsync ordering asserted by spying on the `fs` handle: `fsync` resolves before `rename` is called.
- `listDirSorted` returns byte-sorted order regardless of the order the FS reports.
- Every path is built with `node:path`; a lint assertion forbids `'/'` string concatenation.

**Depends on:** P3.

---

## P5 — Base front matter and the artifact type registry

**Mandate:** one canonical front-matter base and one machine-readable registry of the 21 artifact
types, from which paths, ID widths and parent edges are derived.

**Spec:** `18` §18.6 (canonical front matter), `18` §18.7 (registry), `09` §9.2 (ID rules).

**Surface:** `@forge/schemas/registry`
- `baseFrontMatterSchema` — `id` (`^[A-Z]+-\d{3,4}(-\d+)?$`), `type`, `schemaVersion`, `title`,
  `status`, `created`, `updated`, `revision`, `author`, `run?`, `changelog[]`.
- `ARTIFACT_TYPES: readonly ArtifactTypeDefinition[]` — the §18.7 table verbatim, with
  `id`, `idPrefix`, `pathTemplate`, `idWidth` (default 3, ADR 4), `parent?`, `cardinality?`,
  `collection?`, `requiredSections: readonly string[]`.
- `type ArtifactTypeId` — literal union of the 21 ids.
- `renderArtifactPath(type, vars): RenderArtifactPathResult` — pure, POSIX-only (repo-relative IDs
  per `02` §2.7); returns `{ success: true, path }` or `{ success: false, missingVariable }` rather
  than throwing, per `SPEC-QUESTIONS.md` Q3 (`@forge/schemas` cannot import `ForgeError` from
  `@forge/core`, and Q3's resolution is that this package never throws — it returns typed results).
- `artifactTypeByPrefix(prefix)`, `artifactTypeById(id)`, `definitionForType(id: ArtifactTypeId)` —
  the last one definite (never `undefined`) for a caller who already has a real `ArtifactTypeId`.

**Checks:**
- A test asserts the registry equals the §18.7 table row-for-row (all 21 types, prefixes, paths,
  parents, cardinality, collection flags) and rejects unknown keys.
- Prefixes are unique; `idWidth` is 4 for ADR and 3 elsewhere unless declared.
- `renderArtifactPath` returns a failure result naming the missing variable, rather than emitting
  `{id}` literally.
- Valid and invalid base front-matter fixtures, each invalid one asserting the **error path**
  (`21` §21.3) — not merely that it failed.

**Depends on:** P1, P2.

---

## P6 — Spec artifact schemas

**Mandate:** zod schemas for the eight spec-side artifact types, enforcing the rules `09` states as
validation errors.

**Spec:** `09` §9.3 (Vision, Capability, NFR, Epic, Story, Task), `09` §9.6 (InterfaceContract,
DataModel), `09` §9.5 (AC ids).

**Surface:** `@forge/schemas/artifacts` — `visionSchema`, `capabilitySchema`, `nfrSchema`,
`epicSchema`, `storySchema`, `taskSchema`, `interfaceContractSchema`, `dataModelSchema`, plus the
inferred types and `acceptanceCriterionSchema`.

**Checks:**
- **A non-numeric NFR target is a validation error** (`09` §9.3: "should be fast" is refused) —
  asserted with the error path.
- Story: `size: L` is accepted at `status: draft` and refused at `status: ready`; `files_expected`
  non-empty for `ready`; every AC is Given/When/Then with a `kind`; AC ids match
  `^AC-\d{3,4}-\d+$` and are unique within the story.
- Capability `priority` is the MoSCoW literal union; `stage` required.
- Every schema: a valid fixture passes and at least three invalid fixtures fail with the expected
  error path.

**Depends on:** P5.

---

## P7 — KB, session and report artifact schemas

**Mandate:** zod schemas for the remaining thirteen registry types, including the ADR and Diagram
shapes that other milestones' gates depend on.

**Spec:** `18` §18.7, `08` §8.4 (ADR), `08` §8.11.5 (Diagram), `09` §9.2.

**Surface:** `@forge/schemas/artifacts` — `adrSchema`, `diagramSchema`, `riskSchema`,
`assumptionSchema`, `openQuestionSchema`, `waiverSchema`, `sessionRecordSchema`, `rcaSchema`,
`defectSchema`, `environmentSchema`, `runbookSchema`, `gateReportSchema`, `handoffRecordSchema`.

**Checks:**
- ADR: `reversibility` and `status` are the literal unions from `08` §8.4; `revisit_trigger`
  required; `superseded_by` and `supersedes` are mutually consistent (a test asserts the refusal).
- Diagram: `caption` and `alt_text` are **required** (`08` §8.11.5) — asserted with the error path;
  `generated: true` requires a `generator`.
- Waiver requires a reason, an owner and an expiry (`specs/22` M5 depends on this).
- Collection-type artifacts (Risk, Assumption, OpenQuestion, Waiver, Environment, HandoffRecord)
  validate as entries within one file, not as whole documents.
- Valid + ≥3 invalid fixtures per schema, each asserting the error path.

**Depends on:** P5.

---

## P8 — Configuration schema

**Mandate:** the whole of `.forge/config.yaml` as one zod schema with a documented default for every
key and no undocumented keys.

**Spec:** `18` §18.3 (canonical config), `02` §2.8 (precedence — schema only; resolution is M2).

**Surface:** `@forge/schemas/config` — `configSchema`, `type ForgeConfig`, `DEFAULT_CONFIG`,
`CONFIG_KEY_DOCS: Readonly<Record<ConfigKeyPath, string>>`.

**Checks:**
- The canonical YAML block from §18.3 parses and validates unchanged (golden fixture).
- Unknown keys are refused, not ignored (`strict()`), with the offending path in the error.
- Every leaf key has an entry in `CONFIG_KEY_DOCS` and a default — a test walks the schema and fails
  on any key missing either. This is what makes `forge config explain` possible in M2.
- Enum keys (`level`, `mode`, `autonomy`, `onBreach`, `conflictPolicy`, `driftPolicy`,
  `destructiveOps`, `secretSource`, `retainLaneWorktrees`, `render`) are literal unions; an invalid
  member fails with the key path.
- `redactPatterns` entries compile as regular expressions; an invalid pattern is a validation error.

**Depends on:** P5.

---

## P9 — JSON Schema emission and drift assertion

**Mandate:** every zod schema has a committed, byte-stable JSON Schema, and a drifted one fails CI.

**Spec:** `02` §2.1 (`zod-to-json-schema`), `specs/22` M1 exit test
(`node -e "require('./scripts/assert-schema-drift.mjs')"`).

**Surface:** `@forge/schemas/json-schema`
- `emitJsonSchemas(): ReadonlyMap<SchemaFileName, string>` — deterministic: sorted keys, `\n` line
  endings, trailing newline, no timestamps, no absolute paths.
- `scripts/emit-schemas.mjs` (writes `packages/schemas/json/*.schema.json`) and
  `scripts/assert-schema-drift.mjs` (exits non-zero, printing the diff, when committed ≠ emitted).

**Checks:**
- Emitting twice in the same process and in two processes produces byte-identical output.
- Every registry type and the config schema has an emitted file; a test asserts the file set matches
  the schema set exactly, in both directions.
- Mutating a committed file makes the drift script exit non-zero and name the file.
- The exit test from `specs/22` M1 runs verbatim and passes.

**Depends on:** P6, P7, P8.

---

## P10 — Migration runner

**Mandate:** run ordered, pure schema migrations across a document, with reversible ones proven to
round-trip.

**Spec:** `18` §18.9.

**Surface:** `@forge/schemas/migrations` — see `SPEC-QUESTIONS.md` Q27 for why the two functions
below return typed results rather than the bare array/throw this section originally sketched.
- `interface Migration { from: number; to: number; types: readonly ArtifactTypeId[];
  description: string; reversible: boolean; up(doc: MigratableDocument): MigratableDocument;
  down?(doc: MigratableDocument): MigratableDocument }`.
- `planMigrations(type, fromVersion, toVersion, migrations = MIGRATIONS): PlanMigrationsResult` —
  resolves the chain (in either direction) or fails with a typed reason.
- `applyMigrations(doc, plan): ApplyMigrationsResult` — pure; no FS, no network; deep-freezes the
  document handed to each step so an in-place mutation throws rather than corrupting shared state.
- `MIGRATIONS: readonly Migration[]` (empty at M1 beyond the fixtures, since schemaVersion starts
  at 1 — the runner and its tests are what M1 delivers).

**Checks:**
- A chain spanning two versions applies in order; a gap in the chain is refused with a typed failure
  naming the missing step (a `CFG-` `ForgeError` is for whatever caller outside `@forge/schemas`
  eventually surfaces this to a user, per Q27 — schemas itself never throws, per Q3).
- `reversible: true` migrations round-trip on a real "before" fixture (golden-file `before` → `after`
  → `before`).
- `reversible: false` with a `down` is refused at registration; `reversible: true` without a `down`
  is refused.
- Purity: a migration that touches the FS or the clock is caught by the harness (the runner passes a
  frozen document and asserts the input object is not mutated).
- Migrating a type not in `migration.types` is a no-op, not a silent corruption.

**Depends on:** P5, P9.

---

*(P1, P1b, P3, P2, P4, P5, P6, P7, P8, P9 and P10 are committed: `9b98217`, `7fef54d`, `47ba1ea`,
`bb6e67d`, `dfc56b5`, `b082407`, `273ffcf`, `0f979fb`, `4d540d3`, `27cf2b9`, `5873bbe` (fix:
`9796a10`).)*

## P11 — Template stubs for every artifact type

**Mandate:** every registry type has a template whose front matter validates against its schema and
whose headings are exactly its `requiredSections`.

**Spec:** `specs/22` M1 acceptance ("a template stub" per type), `18` §18.6 (two-phase validation).

**Surface:** `@forge/templates` (data package; `templates ←` no forge code deps)
- `templates/artifacts/<TypeId>.md` — 21 files.
- `TEMPLATE_INDEX: Readonly<Record<ArtifactTypeId, string>>` resolving type → file path.

**Checks:**
- A single table-driven test over all 21 types: the template exists, its front matter validates
  against that type's schema, and its `##` headings equal the type's `requiredSections` in order.
- Templates contain no `TODO`/`FIXME` (R7) — placeholders use an explicit `<…>` angle-bracket
  convention, matching the spec pack's own style.
- Handlebars placeholders parse in strict mode with the declared helper set only.

**Depends on:** P6, P7.

---

## P12 — Artifact model and front-matter round-trip

**Mandate:** read and write an artifact file such that a no-op edit is byte-identical, and a
front-matter change preserves every unrelated byte.

**Spec:** `18` §18.6, `02` §2.3 rule 4 (artifacts are files), `specs/22` M1 acceptance
("Artifact round-trip preserves formatting exactly").

**Surface:** `@forge/core/artifacts`
- `class ArtifactDocument { static parse(source: string, path: string): ArtifactDocument;
  readonly frontMatter: unknown; readonly body: string; get(path): unknown;
  set(path, value): void; bumpRevision(by, summary, today): void; toString(): string }`
  — implemented over `yaml`'s `parseDocument` node API so comments, key order, quoting style, anchors
  and blank lines survive; the body is retained verbatim as a substring, never re-serialised.
- `validateArtifact(doc, registry): ValidationOutcome` — phase 1 front matter against the type
  schema, phase 2 body headings against `requiredSections`, returning `ForgeError`s.
- `readArtifact(paths, relative)`, `writeArtifact(paths, doc)` — via P4's atomic helpers.

**Checks:**
- Round-trip corpus: for every template from P11 and a hand-built awkward fixture (comments between
  keys, single- and double-quoted scalars, a block scalar, CRLF line endings, no trailing newline,
  a BOM), `parse(x).toString() === x` byte-for-byte.
- A `set()` of one key changes exactly that key's line(s); the diff against the original touches
  nothing else (asserted as a diff, not a snapshot of the whole file).
- Missing front matter, unterminated front matter, and non-YAML front matter each fail with a
  distinct documented code.
- Two-phase validation: a document with valid front matter but a missing required section fails at
  phase 2 with the section named.
- CRLF input round-trips as CRLF (Windows, per R11).

**Depends on:** P4, P5, P11.

---

## P13 — ID allocation

**Mandate:** allocate the next id for a type from a filesystem scan, never reuse one, and serialise
concurrent allocation.

**Spec:** `18` §18.8, `09` §9.2.

**Surface:** `@forge/core/ids`
- `class IdAllocator { constructor(deps: { paths: ProjectPaths; registry; clock }) ;
  scan(): Promise<IdIndex>; allocate(type: ArtifactTypeId): Promise<ArtifactId>;
  allocateMany(type, n): Promise<readonly ArtifactId[]> }`.
- `IdIndex` cache persisted to `.forge/state/ids.json` with a `validityHash` over the scanned file
  set; a mismatched hash forces a rescan rather than trusting the cache.

**Checks:**
- Truth is the scan: deleting `ids.json` yields the same next id; a hand-edited `ids.json` claiming a
  lower counter is overridden by the scan, not obeyed.
- **Never reused:** an artifact with `status: deprecated` still occupies its id; a *deleted* file's id
  is still not reissued as long as any reference to it survives in a retained artifact, and the
  documented retention rule (`18` §18.8: files are retained) is asserted by a fixture.
- Zero-padding respects `idWidth`: `ADR-0001` (4) vs `STORY-001` (3); the 1000th story widens to
  `STORY-1000` without colliding with `STORY-100`.
- Concurrency: 50 concurrent `allocate('Story')` calls return 50 distinct, contiguous ids (serialised
  through one queue), and the same test run twice gives the same set.
- Cache write is atomic (P4) and a corrupt `ids.json` is discarded with a warning, not fatal.
- No `Date.now()` — the cache timestamp comes from the injected clock (R10).

**Depends on:** P12.

---

## P14 — The spec graph with typed edges

**Mandate:** build the typed traceability graph from artifacts on disk, and answer the `09` §9.4
queries the gates will need.

**Spec:** `09` §9.4 (edge table, orphan/coverage checks), `09` §9.1 (the chain).

**Surface:** `@forge/core/graph`
- `type EdgeKind = 'realises'|'delivers'|'partOf'|'belongsTo'|'proves'|'implements'|'primaryFor'
  |'constrains'|'consumedBy'|'verifiedBy'` (literal union).
- `REQUIRED_EDGES: readonly EdgeRule[]` — the §9.4 table as data, including the "1 test proves
  exactly 1 AC" cardinality.
- `class SpecGraph { static build(docs: readonly ArtifactDocument[]): SpecGraph;
  nodes(); edges(); parentsOf(id); childrenOf(id); orphans(): readonly Orphan[];
  missingRequiredEdges(): readonly GraphViolation[]; detectCycles(): readonly Cycle[];
  renderCycle(cycle): string }`.
- Violations surface as `SPEC-` `ForgeError`s with the offending ids in `details`.

**Checks:**
- The `09` §9.4 edge table is asserted row-for-row against `REQUIRED_EDGES`.
- A story with no parent epic produces the documented `SPEC-` violation naming the story
  (`02` §2.6 example: `SPEC-021 STORY-014 has no parent capability`).
- Cardinality: a TEST proving two ACs is a violation; an AC with many tests is legal.
- Orphan detection finds both an orphan story and an orphan test (the `09` §9.4 example output).
- A cycle (`STORY-A depends_on STORY-B depends_on STORY-A`) is detected and `renderCycle` prints the
  path — required because M5's plan compilation rejects cycles "with a rendered graph".
- Graph build is deterministic: shuffling the input document order gives an identical graph and
  identical violation ordering (R10).

**Depends on:** P12, P13.

---

## Exit tests for M1 (`specs/22`)

Run after P14 wins, reported per criterion with command output:

```
pnpm build && pnpm typecheck && pnpm lint && pnpm test
pnpm test -- packages/schemas packages/core --coverage   # ≥90% lines
node -e "require('./scripts/assert-schema-drift.mjs')"    # emitted schemas match committed
```

Plus the four `specs/22` M1 acceptance statements, each mapped to its piece: registry completeness
(P5/P6/P7/P9/P11), round-trip fidelity (P12), ID allocation (P13), path containment (P4), boundary
lint (P2).
