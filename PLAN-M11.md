# PLAN-M11 — Distribution, second adapter, security hardening

Source: `specs/22` M11. **Build:** overlay bundle fetching (path, npm, git) with integrity
verification, the capability consent screen, the static safety scan; `@forge/adapter-generic`
(declarative `adapter.yaml`); `@forge/adapter-codemachine` as a declarative binding with capability
probing and the documented degradation matrix; the full security test suite (S1-S12); `forge audit`;
`forge doctor` complete with `--fix` and `--rebuild-index`. **Depends on M10** (`22` §22.2's own
sequencing: `M10 ── M11 ── M12`).

## A real, pre-existing gap this plan does not paper over

**M10 is not actually 20/20 complete.** Direct inspection (`GAUNTLET-LOG.md` has only 18 of the 20
`## M10 P<n>` entries; `packages/cli/src/commands/module.ts`'s `moduleAdd`/`moduleRemove`/
`moduleUpdate` are still literal `never`-returning `USR-003` stubs) confirms `PLAN-M10.md` P7 (module
lifecycle CLI) and P8 (module conformance test runner) were never built, despite an earlier session
declaring M10 complete on the strength of a clean full-suite run — a real verification gap (a stub
that throws on every call has no test asserting otherwise, so its absence is invisible to `pnpm test`).

**Resolution below, not deferred:** M11's own Build line already needs a full local/npm/git overlay
install pipeline with a real consent screen — a strict superset of what P7 originally scoped
(local-path-only lifecycle CLI, per `PLAN-M10.md`'s own text). **P1-P6 below complete M10 P7/P8's real
scope as part of building M11's own distribution pipeline** — the local-path channel this milestone
builds first *is* P7 finished, done once, not twice. This is recorded here and in
`SPEC-QUESTIONS.md`/`GAUNTLET-LOG.md` as closing a real M10 gap, not silently absorbed as if it were
always M11's own scope.

## Real, already-built surface this milestone reuses (confirmed by direct inspection, three parallel
research passes before this plan was drafted)

- **The adapter conformance suite (`07` §7.6's own C1-C16) is already fully generic and reusable.**
  `packages/adapter-kit/src/conformance/{suite,fixtures,capabilities,context,control-and-abort,
  filesystem,git,helpers,secrets,session-basics}.ts` (M4 P4) exports `runAdapterConformanceSuite
  (createAdapter, options)` — takes an arbitrary `() => PlatformAdapter` factory and registers real
  vitest suites against it, with `SAFETY_CRITICAL_CONFORMANCE_IDS = ['C2','C5','C13','C14','C16']`
  already exported for the exact assertion `07` §7.6 and this milestone's own Acceptance line demand.
  **Neither `@forge/adapter-generic` nor `@forge/adapter-codemachine` needs new conformance tests
  written — both call this existing function against their own real `createAdapter`.**
- **`07` §7.4 (CodeMachine) and §7.5 (generic declarative CLI adapter) are both fully, normatively**
  **specified already**, with worked examples: §7.4's own explicit "treat CodeMachine's exact CLI
  surface as unverified... build as a thin, capability-probing, config-declared binding," a real
  `binding.yaml` conforming to the generic adapter schema, preflight probing (`--version`/`--help`),
  and a complete 10-row degradation matrix (streaming→polling, sessionResume→rollback-rerun,
  interject→queued addendum, etc.) written verbatim in the spec. §7.5's own `adapter.yaml` schema
  (`id`/`displayName`/`binary`/`minimumVersion`/`versionRegex`/`capabilities`/`invoke.args+when`/
  `events.format+map`/`result`/`files.changeDetection`) is complete — this milestone implements the
  spec's own literal format, it does not design a new one.
- **`packages/extensions/src/skills/patterns.ts`'s `INJECTION_PATTERNS`/`SECRET_PATTERNS` are real,**
  **already-built, already-tested detectors** — the exact four instruction-shaped-content patterns
  `15` §15.10 I9 names, and AWS/GitHub/Slack/PEM/Bearer-token shapes. Applied today in two places
  (`skills/validate.ts` per-skill; `invariants/security.ts` whole-resolved-set re-assertion at compile
  time on already-installed content) — **neither covers templates yet, and neither runs at install
  time against a freshly-fetched, not-yet-trusted bundle**, both real, disclosed gaps this milestone's
  own static-safety-scan piece closes, reusing these detectors rather than re-deriving them.
- **`forge doctor` is real and substantial**, not a stub: `packages/cli/src/commands/doctor/
  {run-doctor,secrets,environment,project,diagrams,locks-and-worktrees,types}.ts`, six real check
  modules already wired. **`--fix` is a genuine gap** — `locks-and-worktrees.ts`'s own remedy text
  twice tells the user to "run `forge doctor --fix`," but no such flag exists anywhere in `run-doctor.ts`
  or `index.ts`. **`--rebuild-index` is a near-trivial wire-up, not a new mechanism**:
  `packages/kb/src/db/rebuild.ts`'s `rebuildIndex(tree, backend)` already exists and is already called
  by `kb.ts`'s own search command — the flag only needs to invoke this existing function.
- **`forge audit` does not exist at all** (confirmed: no `audit.ts` anywhere in `packages/cli/src/
  commands/`) — but `20` §20.9 fully specifies its behaviour, and every event category it needs to
  aggregate (gate decisions, ceiling escalations, policy violations, blocked injections, redacted
  secrets, destructive-op confirmations, MCP calls, artifact writes) is already a real, already-emitted
  `ForgeEvent` type in `@forge/telemetry`'s own closed catalogue. **This milestone's own `forge audit`
  piece is primarily an aggregation/query layer over events that already exist, not new event-producing
  code.**
- **`20` §20.10's own S1-S12 security invariants already have real, piecemeal enforcement mechanisms**
  **scattered across M1-M10's own prior work — none has a coherent, S-labeled adversarial test.**
  Per-invariant status (full detail in the piece list below): S5 (control-token strip/log) and S10
  (compile-time ceiling refusal) are closest to done, needing only the adversarial test wrapper; S7
  (destructive-op typed confirmation) is a genuine, unbuilt mechanism, not merely an untested one — the
  one real net-new piece of runtime behaviour this milestone's security work adds, not just tests for.
  A separate, adjacent `I7`/`I8`/`I9` numbering already exists (`packages/extensions/test/invariants/
  security.test.ts`, `15`'s own customization invariants) with real conceptual overlap (I7↔S10, I8↔S3,
  I9↔S5) — this plan's own pieces reuse those primitives directly where the overlap is real, rather than
  re-implementing them under the S-numbering.
- **No overlay-bundle fetching code exists for any of the three channels** (confirmed: zero hits for
  `fetch`/`npm:`/`git+`/`checksum`/`integrity` anywhere in `packages/extensions/src`). **No capability
  consent screen exists anywhere in this codebase** — the premise an earlier research pass carried into
  M10 planning (that M10 P7 had already built a local-path-only consent screen) was itself false, per
  the gap this plan opens with; corrected here, not carried forward a second time.
- **`extensions: ['schemas', 'core', 'templates']`** (`tools/eslint-plugin-forge-boundaries/src/
  graph.mjs`) **has no edge to `vcs`**, the same structural fact M10 hit repeatedly for `sessions`/`kb`
  reaching `engine` — the git-channel fetch needs `@forge/vcs`'s own real git primitives
  (`simple-git`, already `02` §2.1's own chosen dependency), so this plan makes the identical kind of
  deliberate, disclosed graph-edge decision M10's own Q104/P10/P16 precedents already established.
  **No npm-package-fetching client library is named anywhere in `02` §2.1's own dependency list** (no
  `pacote`, no `tar`) — this plan chooses a concrete mechanism (below) rather than leaving it open.

## Real Surface deviations this plan commits to before building

- **The git-channel fetch lives in `@forge/vcs`, not `@forge/extensions`.** A new `@forge/vcs` export
  (`fetchOverlayFromGit` or similar, using the already-real `simple-git`/`execa` machinery this package
  already owns) is called by `@forge/extensions`'s own install orchestration through a new, deliberate
  `extensions → vcs` graph edge — the same direction as every other cross-package fetch-vs-orchestrate
  split this codebase has already made (`engine → sessions`, `engine → kb`), never the reverse.
- **The npm-channel fetch shells out to the real, already-installed `npm` CLI** (`npm pack <spec>
  --json`, extracting the resulting tarball) via `execa`, rather than adding a new dependency
  (`pacote`/`tar`) — `22` §22.1 rule 7's own "dependencies are justified in the PR" bar is not clearly
  met by a new library when the one real, already-present tool (`npm`, a hard requirement of this
  project's own toolchain already) does the identical job with zero new supply-chain surface. Recorded
  here as the deliberate choice, not discovered mid-piece.
- **The capability consent screen is CLI-rendered, interactive-by-default, `--yes`-overridable data**,
  not a new TUI screen — `@forge/tui`'s own M9 scope never named overlay installation, and this
  milestone's own Build line describes CLI-driven distribution (`forge overlay add`, `forge module
  add`), matching `03`'s own command surface, not a new interactive screen for `@forge/tui` to own.
- **`forge audit`'s own event aggregation lives in `@forge/telemetry`** (a new, pure query/filter module
  over `readEvents`'s already-real output), with `@forge/cli`'s own `audit.ts` a thin formatting/
  `--json` layer over it — matching `@forge/telemetry`'s own existing "the one place that reads the
  event log" role, not duplicating log-reading logic into the CLI package directly.

---

## P1 — Overlay/module bundle fetch: local path and git channels, with integrity verification

**Mandate:** the real, currently-nonexistent fetch mechanism for two of the three `19` §19.5 channels
— this piece also closes the real part of M10 P7's own scope (a local-path lifecycle needs a real
"resolve this path into installable content" step even before any consent/install logic runs).

**Spec:** `19` §19.5.

**Surface:** `packages/vcs/src/overlay-fetch.ts` (new export, per this plan's own recorded Surface
deviation) + `packages/extensions/src/install/` (new — the orchestration layer)
- `fetchLocalOverlay(path)`: reads and validates a local directory is a real overlay/module (has a real
  `overlay.yaml`/`module.yaml`), no network, no integrity check needed (the user already has direct
  filesystem access to what they're installing).
- `fetchGitOverlay(spec)` (`@forge/vcs`): parses `git+https://…#tag-or-sha` per `19` §19.5's own literal
  format, clones to a real temp checkout (the same `mkdtemp`+real-git pattern already established by
  M5's crash-resume test infrastructure and M10 P17's VERIFICATION sandbox), checks out the pinned ref,
  **warns explicitly on a floating ref** (a branch name, not a tag/SHA) per `19` §19.5's own "floating
  refs warned about" line.
- Checksum computation (a real SHA-256 over the fetched content) for both channels, stored for the
  later `manifest.yaml` record (`19` §19.5 step 5).

**Checks:** a real local directory round-trips through `fetchLocalOverlay` and is recognised as valid;
an invalid local directory (no manifest file) is refused with a named error; a real git-channel fetch
(against a real, disposable local git remote this test constructs, not a live network call) resolves a
pinned tag/SHA correctly and warns on a floating branch ref; checksums are deterministic and stable
across two fetches of the identical content.

**Depends on:** nothing new outside already-real `@forge/vcs` primitives.

---

## P2 — Overlay/module bundle fetch: npm channel, with integrity verification

**Mandate:** the third `19` §19.5 channel, deliberately built via the real, already-present `npm` CLI
rather than a new dependency (this plan's own recorded Surface deviation).

**Spec:** `19` §19.5.

**Surface:** `packages/extensions/src/install/fetch-npm.ts`
- `fetchNpmOverlay(spec)`: parses `npm:@scope/name` or `npm:@scope/name@version` per `19` §19.5's own
  literal format, shells out to `npm pack <spec> --json` (a real, already-available tool this project's
  own toolchain already requires) via `execa`, extracts the resulting tarball into a real temp
  directory, validates a real manifest file is present.
- Checksum verification against npm's own registry-published integrity hash (`npm pack --json`'s own
  output includes a real `integrity` field) — a real, structural verification, not merely trusting the
  download succeeded.
- Private-registry support (`19` §19.5's own "versioned, private registries supported" line): reads
  the project's own real `.npmrc`/registry config, never a hardcoded public-registry-only assumption.

**Checks:** a real `npm pack` against a real, small, disposable test package (published to a local
verdaccio-style registry this test stands up, or a real local `file:`-protocol package if a registry
fixture is disproportionate — resolved concretely by the piece's own investigation, recorded either
way) round-trips correctly; a tampered/corrupted tarball fails the integrity check with a named error;
a private-registry config is read and respected, not silently ignored.

**Depends on:** nothing new outside `execa`, already a real dependency.

---

## P3 — Capability consent screen

**Mandate:** the real, currently-entirely-nonexistent mechanism `19` §19.5 step 3 and this milestone's
own Acceptance line ("nothing installs without consent; the consent screen lists every requested
capability") both require — closes the real, corrected part of M10 P7's own scope.

**Spec:** `19` §19.5, `15` §15.11 (`overlay.yaml`'s own `requestsCapabilities` field).

**Surface:** `packages/extensions/src/install/consent.ts`
- `describeRequestedCapabilities(manifest)`: reads a parsed `overlay.yaml`/`module.yaml`'s own real
  `requestsCapabilities`/`ceilings` fields (M10 P2's own real `moduleSchema` for the module case) and
  renders a real, complete, human-readable list — every shell pattern, network host, MCP server, and
  tool grant requested, per `19` §19.5's own literal "every requested... shown before anything is
  installed" line.
- `promptForConsent(description, options)`: interactive by default (a real terminal prompt), a real
  `--yes`/`--json` non-interactive path for CI (matching this project's own established CLI convention
  — check `packages/cli/src/commands/init.ts`'s own real `--yes` handling for the precedent to follow).
  **Refusal aborts installation with nothing written to disk** — a real, tested guarantee, not merely
  documented intent.

**Checks:** a real manifest with 3 different capability kinds (a shell pattern, a network host, a tool
grant) produces a description naming all 3, none omitted, none fabricated; refusal (simulated via a
scripted "no" input) leaves the target `.forge/` tree byte-identical to before the attempt; `--yes`
bypasses the interactive prompt but still requires the caller to have explicitly passed it — never a
silent default.

**Depends on:** P1 or P2 (a real fetched bundle with a real manifest to render consent against).

---

## P4 — Static safety scan, extended to templates and moved to the pre-install gate

**Mandate:** `19` §19.5 step 4's own literal "skill and template bodies scanned for injection-shaped
content and grant-widening attempts" — reusing the real, already-built `INJECTION_PATTERNS`/
`SECRET_PATTERNS` detectors, extended to templates (currently uncovered) and run before install
(currently only re-checked at compile time on already-installed content).

**Spec:** `19` §19.5, `15` §15.10 I9, `20` §20.6.

**Surface:** `packages/extensions/src/install/safety-scan.ts`
- `scanBundleForSafety(bundlePath)`: walks every `skills/**/SKILL.md` (reusing `skills/patterns.ts`'s
  own real detectors directly, not re-deriving them) **and every `templates/**/*.hbs`** (the genuinely
  new coverage) for the same instruction-shaped-content and secret-literal patterns.
- **Grant-widening detection**: a scanned bundle's own declared `ceilings`/`requestsCapabilities`
  compared against what its own agent/skill bodies' literal text implies asking for (a heuristic,
  disclosed as such — `15` §15.10 I9's own "attempts" framing already concedes this is adversarial
  pattern-matching, not a proof) — reuses M10 P2's own real ceiling-comparison logic where the shapes
  match.
- Runs as a real, blocking gate **before** step 5's `.forge/` install (`19` §19.5's own step ordering),
  never merely as a later compile-time re-check — a bundle that fails this scan is never written to
  disk at all.

**Checks:** a bundle with a real, known instruction-shaped injection pattern in a skill body is
refused before install, nothing written; the identical pattern in a **template** body (the new
coverage) is also refused — a regression test proving this specific gap is closed; a clean bundle
passes through untouched; a bundle whose skill body's own prose asks for a wider grant than its
declared ceiling requests is flagged (not silently passed).

**Depends on:** P1/P2 (a real fetched bundle to scan).

---

## P5 — Module/overlay lifecycle CLI: the real `moduleAdd`/`moduleRemove`/`moduleUpdate`/`overlay add`

**Mandate:** replaces the three real `never`-returning `USR-003` stubs in `packages/cli/src/commands/
module.ts` — this is M10 P7's own original mandate, completed here with the fuller three-channel reach
this milestone's own distribution work already built (P1-P4), not built twice.

**Spec:** `19` §19.5, `03` §3.2.8.

**Surface:** `packages/cli/src/commands/module.ts` (replacing the stubs) + `packages/cli/src/commands/
overlay.ts` (new, for `forge overlay add` — `19` §19.5's own separate-but-parallel overlay concept)
- `moduleAdd(id, source)`/`overlayAdd(source)`: chain P1/P2's fetch → parse manifest + check
  `forgeVersion`/`requires` (M10 P2's own real parser) → P3's consent screen → P4's safety scan →
  install into `.forge/` + record in `manifest.yaml` with version and checksums → `forge compile` +
  report the diff of what changed in the resolved set (`19` §19.5's own literal step 6).
- `moduleRemove(id)`: refuses if another installed module's own `requires` names it (a real, checked
  dependent-module guard).
- `moduleUpdate(id, source)`: re-validates and re-runs the consent screen only for **newly**-requested
  grants versus the currently-installed version (a real diff, not a blanket re-prompt).

**Checks:** add/remove/update each round-trip against real fixture bundles across all three channels
(local/npm/git); refusal at any gate (version mismatch, missing `requires`, consent refusal, safety-scan
failure) leaves the manifest and `.forge/` tree untouched; removing a required-by-another-module module
fails with a named error; updating a module that widens a ceiling shows exactly the new grants in the
diff, not the whole resolved set.

**Depends on:** P1, P2, P3, P4.

---

## P6 — Module/overlay conformance test runner

**Mandate:** `19` §19.1's own `tests/` module-layout directory ("module conformance tests"), with no
existing runner anywhere in this repo — this completes M10 P8's own original mandate.

**Spec:** `19` §19.1, `19` §19.3.

**Surface:** `packages/extensions/src/install/conformance.ts`
- `runModuleConformance(modulePath)`: discovers `tests/*.test.ts` under a module directory, runs them
  against `@forge/testkit`'s `FakePlatformAdapter`, and additionally re-validates every agent/workflow/
  framework/check the module declares via `provides` against M10 P2's own real schema — a conformance
  suite proves "this module's own content still satisfies the contracts it claims," not merely "its own
  hand-written tests pass."
- Wired into P5's own `moduleAdd` as a real, blocking pre-install step for a module (not an overlay,
  which has no `provides` concept) — a module that fails its own declared conformance tests is refused
  install, matching `19` §19.3's own "a template that cannot produce a valid artifact is broken at
  authoring time" discipline extended to installation time.

**Checks:** run against the real, already-shipped `fm-web`/`fm-service`/`fm-data`/`fm-mobile` modules
(M10 P3-P6) — all four pass their own conformance; a deliberately-broken fixture module (a `provides`
entry naming a file that does not exist) fails conformance with a named, actionable error and is
refused install via P5's own wiring.

**Depends on:** P2 (M10), P5.

---

## P7 — `@forge/adapter-generic`: the declarative `adapter.yaml` binding

**Mandate:** `07` §7.5's own fully-specified generic declarative CLI adapter — a `PlatformAdapter`
implementation driven entirely by a config file, no adapter-specific code per external tool.

**Spec:** `07` §7.5.

**Surface:** new package `packages/adapter-generic` (`['adapter-kit', 'schemas', 'telemetry']`, the
already-declared, unmodified graph row)
- `parseAdapterConfig(path)`: real schema validation for `adapter.yaml`'s own complete shape
  (`id`/`displayName`/`binary`/`minimumVersion`/`versionRegex`/`capabilities`/`invoke.args+when`/
  `events.format+map`/`result`/`files.changeDetection`) per `07` §7.5's own worked example, matched
  exactly.
- `GenericAdapter implements PlatformAdapter`: spawns `binary` with `invoke.args` (template-resolved
  against the real `SessionRequest`), parses its own stdout per the declared `events.format` (line-JSON,
  or another declared shape) and `events.map` (translating the external tool's own event vocabulary into
  real `AdapterEvent`s), reports `result`/`files.changeDetection` per the declared config.
- Preflight: `binary --version`, checked against `minimumVersion`/`versionRegex`, refusing to construct
  a session against an incompatible or absent binary (matching `PlatformAdapter`'s own established
  preflight contract, `@forge/adapter-claude-code`'s own `preflight.ts` as the real precedent).

**Checks:** `runAdapterConformanceSuite` (the real, already-built, reused-not-reinvented mechanism) runs
clean against a real `GenericAdapter` instance constructed from a real `adapter.yaml` fixture, driving
P8's own scripted fake binary — all `SAFETY_CRITICAL_CONFORMANCE_IDS` (C2/C5/C13/C14/C16) pass,
matching this milestone's own literal Acceptance line ("the generic adapter passes conformance against
a scripted binary").

**Depends on:** P8 (the scripted binary fixture the conformance suite drives against).

---

## P8 — A real, scripted external binary fixture for adapter conformance testing

**Mandate:** genuinely new test infrastructure (confirmed: no existing precedent for a scripted,
NDJSON-emitting external binary fixture — `@forge/testkit`'s own `FakePlatformAdapter` is in-process,
not a spawned process) — the concrete "scripted binary" this milestone's own Acceptance line names.

**Spec:** `07` §7.5, `07` §7.6.

**Surface:** `packages/adapter-generic/test/fixtures/scripted-binary.ts` (a real, standalone
process — `node --experimental-strip-types <this file>`, matching the established
`run-engine-child.ts`/`mcp-server.ts` real-child-process fixture pattern from M5/M7)
- Reads a scripted response table (matching argv/stdin against expected invocations, mirroring
  `FakePlatformAdapter`'s own `.script()` API shape for familiarity) and emits real, line-delimited
  events on stdout in a format `P7`'s own `events.format`/`events.map` config can parse.
- Supports the conformance suite's own real failure-injection needs (a scripted non-zero exit, a
  scripted hang for timeout-path tests, a scripted malformed-output line) — read `07` §7.6's own C1-C16
  list directly to confirm every conformance case this fixture needs to support is covered.

**Checks:** the fixture itself is directly tested (its own scripted responses replay correctly, its own
failure-injection modes actually fail the right way) before P7 ever depends on it; a full
`runAdapterConformanceSuite` pass against `GenericAdapter` + this fixture is the real, end-to-end proof.

**Depends on:** nothing new.

---

## P9 — `@forge/adapter-codemachine`: the declarative, capability-probing binding

**Mandate:** `07` §7.4's own explicit "treat CodeMachine's exact CLI surface as unverified... build as
a thin, capability-probing, config-declared binding" — a real adapter for a tool this spec deliberately
does not claim certainty about, built defensively per its own instruction.

**Spec:** `07` §7.4.

**Surface:** new package `packages/adapter-codemachine` (`['adapter-kit', 'schemas', 'telemetry']`, the
already-declared, unmodified graph row)
- `binding.yaml` conforming to P7's own real `adapter.yaml` schema (`07` §7.4's own literal "a
  declarative `binding.yaml` conforming to the generic adapter schema" line) — this package is real,
  CodeMachine-specific *configuration and probing logic* layered over `@forge/adapter-generic`'s own
  real `GenericAdapter`, not a second, independent adapter implementation.
- **Capability probing**: real `--version`/`--help` preflight calls, parsing output to determine which
  of the declared capabilities the actually-installed CodeMachine binary genuinely supports — `07`
  §7.4's own explicit design response to "the exact CLI surface is unverified."
- **The 10-row degradation matrix**, made real: for each capability CodeMachine's own probe reports as
  unsupported, the documented fallback (streaming→polling, sessionResume→rollback-rerun,
  interject→queued addendum, etc., transcribed exactly from `07` §7.4's own table) is what
  `AdapterCapabilities` actually reports and what the adapter actually does, not merely documentation
  text with no behavioural backing.

**Checks:** `runAdapterConformanceSuite` runs clean against a real `CodemachineAdapter` instance
constructed from a scripted binary (P8's own fixture, reused, scripted to simulate CodeMachine's own
declared behaviour) in two configurations — full-capability and every-capability-degraded — proving
every one of the 10 degradation-matrix rows produces its own documented fallback behaviour for real,
not merely as asserted spec text.

**Depends on:** P7, P8.

---

## P10 — Adapter conformance verification pass for both new adapters

**Mandate:** a dedicated, cross-cutting piece confirming both P7/P9's own adapters genuinely satisfy
`07` §7.6's own full C1-C16 suite (not merely the safety-critical five already checked inline in P7/P9's
own pieces) — the milestone's own Acceptance line ("the generic adapter passes conformance against a
scripted binary") read as a real, standalone gate, not merely an implicit byproduct of P7/P9 existing.

**Spec:** `07` §7.6.

**Surface:** `packages/adapter-generic/test/conformance/`, `packages/adapter-codemachine/test/
conformance/` (both real files calling `runAdapterConformanceSuite`, matching `@forge/adapter-claude-
code/test/conformance/`'s own established file layout as the precedent)

**Checks:** all 16 conformance ids pass for `GenericAdapter`; all 16 pass for `CodemachineAdapter` in
both its full-capability and degraded configurations; a deliberately-broken `adapter.yaml` (a required
field renamed) fails to even construct an adapter, confirmed as a real refusal, not a silent partial
adapter.

**Depends on:** P7, P9.

---

## P11 — Security invariants S1, S2, S4: containment, denylist composition, network isolation

**Mandate:** the first batch of `20` §20.10's own S1-S12 adversarial tests — establishing the real
adversarial-test harness pattern this piece and P12-P14 all reuse, against invariants whose own
enforcement mechanism already exists (this piece adds the missing S-labeled test, not new runtime
behaviour).

**Spec:** `20` §20.10 S1, S2, S4.

**Surface:** `packages/vcs/test/security/s1-containment.test.ts`, `packages/engine/test/security/
s2-denylist.test.ts`, `packages/adapter-kit/test/security/s4-network-isolation.test.ts`
- S1: a real adversarial attempt to write outside the project root/lane worktree via a symlink and via
  `../` traversal — both refused, reusing `@forge/core`'s own real `ProjectPaths.resolveWithin`
  containment (already the real mechanism; this test proves it against genuinely adversarial input, not
  merely well-formed input).
- S2: a real hard-denylisted command attempted at every autonomy level, **including composed with shell
  operators** (`;`, `&&`, `|`, backticks) — the specific "composed with shell operators" clause `20`
  §20.10 names explicitly, confirmed not yet tested anywhere.
- S4: a step granted `network: none` genuinely attempting a real network call (against a real, local
  test listener, not merely asserting a capability flag) — proving the isolation is structurally
  enforced, not merely declared.

**Checks:** each of the three produces a real, reproducible adversarial failure the invariant correctly
blocks; each test is independently rerunnable and documents its own real attack shape in its own name
(matching this codebase's own long, descriptive test-name convention).

**Depends on:** nothing new outside already-real containment/denylist/grant machinery.

---

## P12 — Security invariants S3, S5, S6: secret leakage, control-token stripping, taint enforcement

**Mandate:** the second batch — S5 is the closest to already-done (reuses M10 P16's own real
`injection-telemetry.ts`), S3 and S6 need real new adversarial scans/tests against existing but
previously S-unlabeled mechanisms.

**Spec:** `20` §20.10 S3, S5, S6.

**Surface:** `packages/kb/test/security/s3-secret-leakage.test.ts`, `packages/adapter-kit/test/
security/s5-control-token-stripping.test.ts`, `packages/engine/test/security/s6-taint-enforcement.test.ts`
- S3: a real fixture run seeded with a real-shaped secret literal (an AWS-key-shaped string, reusing
  `extensions/src/skills/patterns.ts`'s own `SECRET_PATTERNS` as the detection oracle) — scans every
  file under `.forge/` and `docs/forge/` after the run completes, asserting zero matches.
- S5: a real MCP/fetched-content payload containing a real control-token-shaped string — asserts it is
  stripped before reaching the model and a real `InjectionAttemptBlocked` telemetry event is logged,
  reusing `control-tokens/{scan,strip}.ts` and M10 P16's own `injection-telemetry.ts` directly.
- S6: a real tainted step (per `20` §20.5's own taint marking, `mark-external-content.ts`) genuinely
  attempting to approve a gate, escalate a grant, or target a production environment — all three refused
  structurally, not merely by convention.

**Checks:** each produces a real, reproducible adversarial scenario the invariant correctly blocks; S6
specifically tests all three named attack surfaces (gate approval, grant escalation, production
targeting) independently, not just one as a stand-in for all three.

**Depends on:** nothing new outside already-real detection/stripping/taint machinery.

---

## P13 — Security invariants S7, S8, S9: destructive-op confirmation, dirty-tree halt, budget enforcement

**Mandate:** the third batch — **S7 is a genuine, unbuilt mechanism** (confirmed: no "destructive
operation" typed-confirmation flow exists anywhere in this codebase), the one real piece of new runtime
behaviour this milestone's security work adds, not merely a missing test for existing behaviour.

**Spec:** `20` §20.10 S7, S8, S9.

**Surface:** `packages/engine/src/security/destructive-confirmation.ts` (new) + adversarial tests in
`packages/engine/test/security/{s7-destructive-confirmation,s8-dirty-tree,s9-budget-enforcement}.test.ts`
- **S7, new mechanism**: `requireDestructiveConfirmation(operation, environment, resource)` — a real,
  typed confirmation gate (naming the environment and resource, per `20` §20.10's own literal text) a
  caller must pass before a classified-destructive operation (a real, small, named list — e.g. dropping
  a database table, force-pushing, deleting a production resource — confirmed against whatever this
  codebase's own existing operation catalogue already distinguishes as destructive, not invented from
  scratch) proceeds. Human-only at every autonomy level — no autonomy setting bypasses this gate,
  matching `20`'s own "the user's uncommitted work is sacred"-adjacent stance already established for
  S8.
- S8: reuses `@forge/vcs`'s own real `assertCleanWorkingTree` — an adversarial test proving a genuinely
  dirty tree halts a run with the documented remedy options, not merely that the function exists.
- S9: reuses `@forge/engine`'s own real budget/ledger enforcement (M5-era) — adversarial tests proving a
  budget cap genuinely aborts or pauses a run, and that a retry's own cost is attributed to the
  originating step, not double-counted or silently dropped.

**Checks:** S7's new mechanism is exercised against a real, named destructive operation, confirmed
refused without confirmation and confirmed to proceed once a real, typed confirmation matching the
named environment/resource is supplied (a mismatched confirmation — wrong resource name typed — is
also refused, not silently accepted); S8/S9 each produce a real, reproducible adversarial scenario.

**Depends on:** nothing new outside already-real dirty-tree/budget machinery for S8/S9; S7 is genuinely
new.

---

## P14 — Security invariants S10, S11, S12: ceiling refusal, doctor secret-safety, orphan-free crash recovery

**Mandate:** the fourth and final batch — all three already have strong existing mechanisms (M10 P2's
ceiling enforcement, `doctor/secrets.ts`, and the crash-resume/orphan-reclaim infrastructure from M5/
the post-M9 checkpoint) — this piece adds the missing S-labeled adversarial tests, confirming each
mechanism holds under real adversarial pressure, not merely under its own already-passing unit tests.

**Spec:** `20` §20.10 S10, S11, S12.

**Surface:** `packages/extensions/test/security/s10-ceiling-refusal.test.ts`, `packages/cli/test/
security/s11-doctor-secret-safety.test.ts`, `packages/engine/test/security/s12-orphan-free-crash.test.ts`
- S10: an overlay/module requesting a capability genuinely beyond its own declared ceiling — refused at
  compile time (reusing M10 P2's own real `checkModuleCeilings`), an S-labeled adversarial framing of
  an already-real mechanism.
- S11: `forge doctor`'s own real `secrets.ts` check — a real adversarial assertion that its own output
  (console text, `--json` output, and any written report file) contains zero resolved secret values,
  only resolution *status* (present/absent/expired), even when a real secret value is deliberately
  present in the test environment.
- S12: reuses the real crash-resume infrastructure (`packages/engine/test/e2e/crash-resume.test.ts`)
  and the post-M9 checkpoint's own orphan-reclaim mechanisms (`Q149`) directly — an adversarial framing
  confirming a genuine supervisor-level kill (not just an engine-process kill, the identical group-kill
  fidelity fix from `Q149`) leaves no orphaned child processes or worktrees blocking a subsequent
  resume.

**Checks:** each of the three produces a real, reproducible adversarial scenario the invariant
correctly blocks or recovers from; S11 specifically greps its own captured output for the literal
secret value used in the test fixture, asserting zero occurrences, not merely trusting the code's own
intent.

**Depends on:** nothing new outside already-real ceiling/doctor/crash-resume machinery.

---

## P15 — `forge audit`

**Mandate:** `20` §20.9's own fully-specified command, genuinely absent from this codebase — built as
an aggregation/query layer over the already-real `ForgeEvent` catalogue, per this plan's own recorded
Surface deviation, not new event-producing code.

**Spec:** `20` §20.9.

**Surface:** `packages/telemetry/src/audit.ts` (new, pure query/filter module) + `packages/cli/src/
commands/audit.ts` (new, thin CLI layer)
- `queryAuditEvents(projectRoot, options)`: filters `readEvents`'s own real output by the audit-relevant
  categories `20` §20.9 names (gate decisions, ceiling escalations, policy violations, blocked
  injections, redacted secrets, destructive-op confirmations — reusing P13's own new S7 event if one is
  emitted, MCP calls, artifact writes), by a real `--since <date>` cutoff.
- `forge audit --since <date> [--json]`: renders a real, human-readable report by default, structured
  JSON on the flag — matching this project's own established `--json` stability contract (`22` §22.1
  rule 4: "`--json` output is a stable contract from M6 onward").

**Checks:** a fixture run producing at least one real event in every named audit category is fully and
correctly reported by both output modes; `--since` correctly excludes events before the cutoff; the
JSON output validates against a real, versioned schema (this command's own first release, so the
schema itself is new — built once, held stable per rule 4 from here on).

**Depends on:** P13 (if S7 introduces a new destructive-confirmation event type audit should aggregate
— confirmed concretely once P13 lands; if S7's own confirmation reuses an existing event type instead,
this dependency resolves to "none new").

---

## P16 — `forge doctor --fix` and `--rebuild-index`

**Mandate:** the two real, named gaps in `forge doctor`'s own already-substantial six-check
implementation — `--fix`'s remedy text already promises this flag exists; `--rebuild-index` is a
near-trivial wire-up to an already-real function.

**Spec:** `21` E10 ("`corrupt-state/` is diagnosed; `--fix` and `--rebuild-index` restore a working
project").

**Surface:** `packages/cli/src/commands/doctor/run-doctor.ts` (extended)
- `--fix`: for each of the six existing check modules (`secrets`/`environment`/`project`/`diagrams`/
  `locks-and-worktrees`), a real, safe, automatic remediation where one exists (e.g.
  `locks-and-worktrees.ts`'s own already-real orphan-reclaim mechanisms, M10/`Q149`'s own vcs exports,
  invoked for real rather than merely reported) — a check with no safe automatic fix continues to only
  report, honestly, rather than a fabricated no-op "fixed" claim.
- `--rebuild-index`: invokes `@forge/kb`'s own real, already-built `rebuildIndex(tree, backend)`
  directly — confirmed this is genuinely all this flag needs to do.

**Checks:** `21` E10's own literal exit test — a real `corrupt-state/` fixture project (a stale lock, a
corrupted search index, an orphaned worktree) is diagnosed accurately by a plain `forge doctor` run,
and `--fix`/`--rebuild-index` genuinely restore it to a clean, working state, verified by re-running
plain `forge doctor` afterward and confirming zero remaining findings.

**Depends on:** nothing new outside already-real doctor/kb machinery.

---

## Notes on sequencing and scope

- **Distribution (P1-P6), the two adapters (P7-P10), and security/audit/doctor (P11-P16) are three**
  **genuinely independent subsystems**, matching M10's own precedent — buildable in any order or
  interleaved.
- **P1-P6 close a real M10 gap (P7/P8) as part of building M11's own, larger distribution scope** —
  recorded explicitly in this plan's own opening section, in `SPEC-QUESTIONS.md`, and in
  `GAUNTLET-LOG.md` once built, so the milestone history stays honest about what closed which gap.
- **Total: 16 pieces**, plus the two M10 pieces this milestone's own P1-P6 subsume — proportionate to
  M11's own three-subsystem Build line (distribution, a second real adapter, and a 12-invariant security
  suite plus two CLI commands), smaller than M10's 20 since M11 has one fewer independent subsystem and
  reuses more already-built machinery (the conformance suite, the injection/secret detectors, the crash-
  resume infrastructure) than M10 could.
- Every piece follows the identical `BUILD-PROMPT.md` gauntlet-loop discipline already established
  across M1-M10: tests-first, a fresh context-free critic per round, judge-and-loop on real findings,
  two-commit pattern, `SPEC-QUESTIONS.md` entries for every real design decision — **plus the process
  fix M10's own final checkpoint should have caught and did not: before declaring this milestone
  complete, independently verify every one of the 16 `## M11 P<n>` `GAUNTLET-LOG.md` entries actually
  exists and every named CLI command/flag genuinely does not throw, rather than trusting a clean
  full-suite run alone.**
