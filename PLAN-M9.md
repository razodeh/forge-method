# PLAN-M9 — TUI

Source: `specs/22` M9. **Build:** `@forge/tui` — the eight screens (`04` §4.3), the fourteen-component
inventory (`04` §4.5), the event-sourced read-model store (`04` §4.6), the six modal flows (`04` §4.4),
degradation modes (`04` §4.7), resize handling, interject. **Do not build:** `forge run`/`forge status`
CLI wiring that actually launches `@forge/tui` against a real, running engine process — `03` §3's own
`--no-tui` flag and stream-mode fallback already establish that the TUI is the *default* interactive
surface, but M9's own Build line names only the package itself, and every piece below is independently
testable against a real or fixture event log without a live `forge run` process to launch it against.
Wiring `@forge/tui` as `forge`'s own real default entry point is CLI-integration work in the same spirit
M7's own adapter-construction gap and M8's own gate-CLI-wiring both were — real, disclosed, out of this
milestone's own named scope, left for a later piece exactly the way M8 P2/P4 etc. each wired their own
narrow CLI slice rather than this milestone inventing a general one.

## Real, already-built surface this milestone reuses (confirmed by direct inspection)

- **`@forge/telemetry`'s `readEvents(projectRoot, runId)`** (`packages/telemetry/src/events.ts`) is a
  real, working, one-shot reader of `.forge/state/runs/<runId>/events.ndjson` — parses every NDJSON
  line into a typed `ForgeEvent`, throws a typed `TelemetryError` on a real `seq` gap, yields nothing
  (not an error) for a run that has not started. **Confirmed gap**: it is not a live tail/follow — it
  reads the file's current content once and returns. `04` §4.6's own "subscribes to the engine event
  stream" therefore needs `@forge/tui`'s own polling loop on top of it (re-`readEvents`, keep only
  `seq` values past the last one already folded into the read model, coalesced into the spec's own
  100ms window) — not a new primitive added to `@forge/telemetry` itself, since `tui`'s own boundary
  (`02` §2.2: `tui ← engine, core, kb, telemetry, schemas`, read-only) is already satisfied by repeated
  calls to an existing, real function. A full-file re-read every poll is the honest, simplest correct
  design for this milestone's own real scope; recorded as a real, accepted cost (not a silent
  performance promise) rather than adding a byte-offset-resuming variant to `@forge/telemetry` this
  milestone does not need.
- **`ForgeEvent`'s own real, complete 40-member `EventType` catalogue** (`18` §18.4, already
  implemented) is the literal input alphabet the read-model reducer(s) below switch on — Run/Step/Lane/
  Adapter/Artifact/KB/Gate/Merge/Human/Cost/Security/Custom groups, all real, all already produced by
  `@forge/engine`'s own real dispatch code across M5-M8. No new event type is invented by this
  milestone; every screen's own state need is satisfied by events that already exist.
- **`@forge/engine/resume`'s `reconstructRunState`** (`packages/engine/src/resume/types.ts`,
  `packages/engine/src/resume/reconstruct.ts`, M5 P18) is a real, already-tested, pure
  `AsyncIterable<ForgeEvent> → RunState` projection — `runId`/`planRef`/`runStatus`/`stepStatuses`/
  `unresolvedStepIds`/`laneStatuses`/`spentUsd`/session-id-by-step. Built for *resume* (P19's own,
  narrower "what needs re-running" question), not for the TUI's own much richer per-screen needs
  (transcripts, diffs, gate evidence, KB entries, cost-per-model breakdowns) — its own doc comment is
  explicit that every other real event type "produces no dedicated `RunState` field of its own... out of
  this piece's own named scope." **This milestone's own read model is therefore a new, separate
  reducer**, not an extension of `RunState` (which stays M5's own, closed, resume-scoped surface) — but
  the same "one pure projection over an `AsyncIterable<ForgeEvent>`, unit-tested against recorded event
  fixtures" shape is reused directly as the established pattern, matching `04` §4.6's own literal
  "Reducers are pure and unit-tested against recorded event fixtures."
- **No `@forge/tui`, `ink`, `react`, or `ink-testing-library` dependency exists anywhere in this**
  **monorepo yet** — confirmed via `pnpm-lock.yaml`/every `package.json`. Fully greenfield. `specs/02`
  §2.1's own normative "Ink 5 (React 18 renderer)" pairing is still real and installable today —
  confirmed directly against the real npm registry: `ink@5.2.1` (latest 5.x, not deprecated) declares
  `peerDependencies: { react: '>=18.0.0' }`; `ink@6`/`ink@7` both require React ≥19 instead, a real,
  current major-version split the spec's own explicit pairing already anticipates by naming the version.
  `ink-testing-library@4.0.0` (latest, published 2024-05-22, predating Ink 6/7) is the confirmed-current,
  Ink-5-era test harness. Pinned: `ink@5.2.1`, `react@18.3.1`, `@types/react@18.3.x`, `react-dom` is
  **not** a dependency at all (Ink renders directly to the terminal, no DOM), `ink-testing-library@4.0.0`
  as a devDependency. `ink-text-input`/`ink-select-input`/`cli-boxes`/`ansi-escapes` (`02` §2.1's own
  "TUI extras" row, itself hedged "or hand-rolled... avoid heavy deps; hand-roll where a dep is
  <100 LOC") are decided per-piece, not pinned up front — P5/P3 below make the real call once the actual
  component need is concrete.
- **`packages/testkit`'s own real fixture/golden-file conventions** (`@forge/testkit`, M1-M8's own
  established `FakePlatformAdapter`/NDJSON-scripting precedent) are the direct model for this
  milestone's own `fixtures/events/*.ndjson` recorded-event fixtures (`04` §4.6, §4.8) — real NDJSON
  files this package's own reducer/screen tests read and replay, not a new fixture mechanism.

## Piece list

## P1 — Package scaffold, environment/render-mode detection, and the event-sourced store core

**Mandate:** stand up `@forge/tui` for real — installable, typechecked, boundary-clean — with the two
genuinely foundational pieces every later piece needs: (1) a real, terminal-environment-aware
`RenderMode` decision (`04` §4.7: `NO_COLOR`/`FORCE_COLOR`/`TERM=dumb`/`--ascii`/`--linear`/`COLUMNS`/
`LINES`), and (2) the generic store mechanism (`04` §4.6: "hand-rolled ~80 LOC reducer store... do not
pull in Redux") plus `EngineClient`'s own real event-polling subscription over `readEvents`, with gap
detection and re-subscribe-on-restart. No screen, no React component yet — this piece is pure state/
environment logic, directly unit-testable without rendering anything.

**Spec:** `04` §4.6, §4.7; `02` §2.1, §2.2.

**Surface:** `packages/tui/` (new package)
- `package.json`/`tsconfig.json`/`tsup.config.ts` matching every sibling package's own real convention
  (`type: module`, `exports` mapping to `./src/index.ts`, `typecheck` script).
- `@forge/tui/env`: `detectRenderMode(env: Readonly<Record<string, string | undefined>>, argv:
  readonly string[]): RenderMode` — pure, takes `process.env`/`process.argv` as explicit parameters
  (this package's own equivalent of `probeAuthAvailability`'s established "never read ambiently"
  discipline). `RenderMode = { readonly color: boolean; readonly ascii: boolean; readonly linear:
  boolean; readonly columns: number; readonly lines: number }`. Real precedence, `04` §4.7 read
  literally: `--ascii`/`FORGE_ASCII=1` → `ascii: true`; `--linear` → `linear: true` (CI-friendly, no
  panes); `NO_COLOR` set (any value, per the real, documented convention) → `color: false`, overriding
  even `FORCE_COLOR`; `FORCE_COLOR` set and `NO_COLOR` absent → `color: true`; `TERM=dumb` → `color:
  false` AND `linear: true` (dumb terminals get the stream/linear fallback, matching `03` §3's own
  `--no-tui`/non-TTY stream-mode precedent); `COLUMNS`/`LINES` env vars parsed as the real terminal
  size when set (Ink's own `process.stdout.columns/rows` is the real runtime source once rendering
  starts — this function's own `columns`/`lines` fields are the pre-render, testable equivalent).
- `@forge/tui/state`: `createStore<S>(initial: S, reduce: (state: S, event: ForgeEvent) => S):
  TuiStore<S>` — the ~80-LOC generic mechanism: `getState()`, `subscribe(listener): () => void`,
  `dispatch(event)` (folds through `reduce`, notifies subscribers only on a real, `Object.is`-different
  new state — no redundant re-renders). `createEngineClient(projectRoot: string, runId: string, options:
  { readonly pollIntervalMs?: number }): EngineClient` — polls `readEvents` on an interval (default
  matching `04` §4.1's own 100ms coalescing budget), tracks the highest `seq` already dispatched,
  dispatches only genuinely new events in `seq` order, exposes `subscribe`/`stop()`. A `TelemetryError`
  from a real `seq` gap is caught and re-surfaced as a real, typed `EngineClientEvent{type:'gap'}`
  notification (not an uncaught rejection) — `04` §4.6's own "gap detection → request snapshot" read
  as "the TUI is told, honestly, that its own read model may now be stale," since no real snapshot
  RPC exists anywhere in this codebase to actually request one from (a real, disclosed scope boundary,
  recorded in `SPEC-QUESTIONS.md` rather than inventing a snapshot mechanism this milestone does not
  need — a `'gap'` notification is exactly the trigger a caller needs to re-fetch from `seq: 1`, which
  `EngineClient`'s own next poll already does naturally since it has no persisted offset of its own
  across a restart).
- `RunReadModel`: the first, real reducer slice — `runStatus`, `stepStatuses: ReadonlyMap<string,
  {status, ...}>`, `laneStatuses`, `spentUsd` — deliberately mirroring `RunState`'s own already-proven
  field set (not `RunState` itself; a fresh, TUI-owned type, per the "already-built surface" note above)
  as this piece's own real, working proof that the store mechanism folds real `ForgeEvent`s correctly.
  Later pieces (P7+) extend this same reducer with their own screen's own needed slices (Gate/KB/Cost/
  Session state) rather than this piece attempting to pre-build all of it speculatively.

**Checks:**
- `detectRenderMode` matches `04` §4.7's own literal precedence table for every documented combination,
  including the two-flag interactions (`NO_COLOR` overriding `FORCE_COLOR`; `TERM=dumb` implying both
  `color:false` and `linear:true`).
- `createStore`'s `dispatch` is a pure fold — the same event sequence replayed twice from the same
  initial state produces identical states (determinism, the same discipline `21` §21.1 already
  establishes elsewhere in this codebase); a subscriber is notified exactly once per genuinely-changed
  state, never for a no-op reduction.
- `createEngineClient`, driven against a real, temp-directory event log (real `appendEvent` calls, not
  a fake), dispatches events in `seq` order across multiple poll cycles as the file grows between polls.
- A deliberately corrupted (seq-gapped) event log produces a `'gap'` notification, not an uncaught
  rejection, and does not stop the client from continuing to poll.
- The `RunReadModel` reducer round-trips a recorded `fixtures/events/*.ndjson` fixture (a real run:
  planned → started → several step/lane transitions → completed) to the exact expected final state.

**Depends on:** none (first piece).

---

## P2 — Presentational primitives: `<StatusGlyph>`, `<Pane>`, `<KeyValue>`, `<ProgressBar>`, `<Sparkline>`, `<Toast>`

**Mandate:** the small, stateless, `RenderMode`-aware building blocks `04` §4.5's own component
inventory names first — every later screen composes these directly. First real Ink/React code in the
package; proves the `ink-testing-library` snapshot-testing harness works at all before anything more
complex depends on it.

**Spec:** `04` §4.2 (the 8 canonical states), §4.5, §4.7 (colour/ascii/colourblind-safety).

**Surface:** `packages/tui/src/components/`
- `<StatusGlyph state>` — the 8 canonical states verbatim (`04` §4.2: `✓ pass`, `✗ fail`, `● running`,
  `◐ waiting`, `⏸ paused`, `⚠ warn`, `⊘ blocked`, `↷ skipped`), each glyph + colour + label; ASCII
  fallback set (`04` §4.7) for `RenderMode.ascii`; colour is never the only signal (glyph+label render
  regardless of `RenderMode.color`).
- `<Pane title focused children>` — bordered box (`cli-boxes`-style single/double/ascii border sets,
  chosen by `RenderMode.ascii`), a visible focus ring when `focused`, a scroll indicator when content
  overflows.
- `<KeyValue rows>` — aligned two-column metadata display.
- `<ProgressBar value max label>` — budget/progress bars, ascii-safe (`[####----]` fallback).
- `<Sparkline series>` — cost/velocity trend, unicode block-height glyphs with an ascii-digit fallback.
- `<Toast queue>` — transient notifications, queued, max 3 visible at once (`04` §4.5), auto-expiring.

**Checks:**
- Snapshot tests (`ink-testing-library`) for every one of `<StatusGlyph>`'s 8 states, each rendered
  once under `RenderMode.ascii: false` and once under `true` — 16 golden snapshots, none identical to
  its own opposite-mode sibling.
- A colour-blindness pass: every state's glyph+label combination is a real, unique string independent
  of colour (asserted structurally: extracting only the rendered text, never inspecting ANSI colour
  codes, still disambiguates all 8 states).
- `<Toast>` queued past 3 entries drops the oldest, never silently grows unbounded.
- `<Pane>` renders a visible focus indicator difference between `focused: true` and `focused: false`
  snapshots.

**Depends on:** P1 (`RenderMode`).

---

## P3 — Navigation primitives: `<ListPane>`, `<Tree>`

**Mandate:** the two "browse a collection" primitives every list/tree-shaped screen (S2-S6) needs —
virtualised list with selection/filter/keyboard nav, and a collapsible tree with lazy children.

**Spec:** `04` §4.5; the `↑↓/jk`, `←→/hl`, `/`-filter global keys (§4.2) as implemented by these two
components specifically (screens wire the *meaning* of a selection; these components own the *motion*).

**Surface:** `packages/tui/src/components/`
- `<ListPane items renderItem onSelect focused>` — virtualised (renders only the visible window plus a
  small overscan, real for a 2000-line ring buffer per `04` §4.1, not a naive full-list render);
  `↑↓`/`j k` move selection, `g`/`G` jump top/bottom, `/` opens an inline filter input narrowing
  `items` by a caller-supplied predicate.
- `<Tree nodes>` — `readonly TreeNode[]` where a node's own `children` may be a lazy `() =>
  Promise<readonly TreeNode[]>` (`04` §4.3's own "S3 lazy children" need, e.g. a Story's own Tasks not
  fetched until expanded); `←→`/`h l` collapse/expand; keyboard nav mirrors `<ListPane>`'s own.
- Both decide `ink-select-input`/hand-rolled per the "already-built surface" note's own deferred
  call — resolved here directly: hand-rolled (neither library's own real API accommodates
  virtualisation or lazy tree children, and both components are well under the "avoid heavy deps"
  100-LOC-per-dependency bar `02` §2.1 sets once virtualisation is subtracted from a plain list).

**Checks:**
- `<ListPane>` with 5000 items renders a bounded number of real Ink nodes (asserted via the rendered
  frame's own line count, not an internal render-count spy) — proves virtualisation is real, not
  assumed.
- Keyboard-driven interaction test: a scripted `↑↓ g G` key sequence against a known item list produces
  the expected selection at each step.
- `<Tree>` expand triggers the lazy `children` loader exactly once per node, cached on subsequent
  collapse/re-expand (never re-fetched).
- `/` filter narrows the rendered set live and clears on `Esc`, restoring the full list and prior
  selection.

**Depends on:** P1 (`RenderMode`), P2 (`<StatusGlyph>` used inside default `renderItem`).

---

## P4 — Content viewers: `<StreamView>`, `<DiffView>`

**Mandate:** the two "show me a body of real content" primitives S2 (transcript/diff tabs) and S3/S4
(diff-against-base, before/after) need.

**Spec:** `04` §4.1 (2000-line ring buffer, follow-mode), §4.3 S2, §4.5.

**Surface:** `packages/tui/src/components/`
- `<StreamView source maxLines follow>` — a bounded ring buffer (default 2000 lines/lane, configurable,
  `04` §4.1) over a real `AsyncIterable<string>`/pre-materialised `readonly string[]` source; `f`
  toggles follow-mode (auto-scroll to newest); manually scrolling up suspends follow until `f` is
  pressed again or the view is scrolled back to the bottom.
- `<DiffView patch>` — a real unified-diff string parsed and rendered with syntax-agnostic
  add/remove/context colouring (never language-aware highlighting — out of this milestone's own real
  scope, `04` doesn't ask for it), hunk folding for a diff exceeding a configurable line threshold.

**Checks:**
- `<StreamView>` fed 3000 real lines retains exactly the most recent `maxLines` (2000 by default),
  never all 3000 — a real, asserted bound, not merely "renders without crashing."
- Follow-mode: appending new lines while following keeps the view scrolled to the bottom; scrolling up
  manually suspends it (subsequent appends do not move the viewport) until re-enabled.
- `<DiffView>` on a real, multi-hunk unified diff (captured from an actual `git diff` in this repo,
  fixture-frozen) renders every hunk's own real add/remove line count correctly; a hunk beyond the
  folding threshold renders collapsed with an expand affordance.

**Depends on:** P1 (`RenderMode`), P2 (`<Pane>` as the enclosing frame both use in practice, though
neither strictly requires it structurally).

---

## P5 — Modal infrastructure: `<Modal>`, `<QuestionForm>`, `<CommandPalette>`, `<HelpOverlay>`

**Mandate:** `04` §4.4's own six modal flows all render through these four components — focus-trapping
overlay, the elicitation-question renderer, the `:` command palette, and contextual help.

**Spec:** `04` §4.4, §4.5; the `?`/`:`/`Esc` global keys (§4.2).

**Surface:** `packages/tui/src/components/`
- `<Modal onClose children>` — focus-trapping (no key reaches anything but the modal's own subtree
  while open); `Esc` closes; renders as a real overlay layer, not a screen replacement (the underlying
  screen's own state is preserved, matching `04` §4.4's "pop to parent" framing).
- `<QuestionForm questions onAnswer>` — `04` §4.4's own literal "max 3 questions per modal, ordered by
  information gain, with the agent's recommended default preselected... 'I don't know' always
  available." Renders select/multiselect/text/confirm/rank question shapes (the five real forms
  `05`/`16`'s own elicitation mechanisms already produce, confirmed against `@forge/adapter-kit`'s own
  control-token vocabulary this milestone's own read model receives via `ElicitationRequested` events);
  throws a real, typed refusal (not a silent truncation) if handed more than 3 questions, since §4.4's
  own "must never be a wall of questions" is a hard MUST, not a rendering suggestion for the caller to
  violate quietly.
- `<CommandPalette onSubmit>` — `:` opens it; fuzzy-matches against a real, injected list of known
  `forge` subcommands (not every screen's own ad-hoc action — the same subcommand vocabulary `03`'s own
  CLI already defines); `Enter` submits, `Esc` cancels.
- `<HelpOverlay context keys>` — `?` opens it; renders the *current screen's own* real, active key
  bindings (not a static, global cheat sheet) plus a one-line "what can I do here" per `04` §4.5.

**Checks:**
- `<Modal>` open: a scripted key sequence targeting content behind the modal produces zero effect on
  that background content; `Esc` closes and restores the prior screen's own focus state exactly.
- `<QuestionForm>` with 4 questions throws synchronously (a real, typed error, caught by a test) rather
  than silently rendering only 3 — the hard-MUST is enforced, not merely documented.
- `<QuestionForm>`'s "I don't know" path is always present and, when chosen, calls `onAnswer` with a
  real, distinguishable "unknown" answer shape a caller can route to a decision framework (`04` §4.4).
- `<CommandPalette>` fuzzy-matches a partial, non-prefix substring (e.g. `"gt appr"` → `gate approve`)
  and submits the matched real command string.
- `<HelpOverlay>` rendered with two different `context`/`keys` inputs produces two genuinely different
  snapshots (proving it is context-sensitive, not a static overlay).

**Depends on:** P1, P2 (`<Pane>`), P3 (`<ListPane>` inside `<CommandPalette>`'s own match list).

---

## P6 — `<AppShell>`: header, footer, screen router, modal stack, resize, global keys

**Mandate:** the piece that makes `@forge/tui` a real, running application for the first time — `04`
§4.2's own global chrome (header/footer), screen switching, the modal stack, resize handling, and every
global key binding not already owned by a leaf component (`1`-`8`, `Tab`, `p`/`r`/`a`/`x`, `Ctrl+L`,
`q`).

**Spec:** `04` §4.2, §4.1 (redraw budget, resize), §4.3 (screen router only — screen *bodies* are P7+).

**Surface:** `packages/tui/src/components/`
- `<AppShell client screens>` — `client: EngineClient` (P1); `screens: ReadonlyMap<ScreenId,
  ScreenComponent>` (P7+ each register their own); owns: the header line (product/stage/lanes/spend/
  elapsed, `⚙ N`/`⚠ escalations: N` badges per `04` §4.2), the footer key-hint bar, the modal stack
  (a real `readonly ModalEntry[]` — only the top entry receives keys, matching `<Modal>`'s own
  focus-trap contract), `1`-`8` screen switching, `Tab`/`Shift+Tab` pane-focus cycling *within* the
  active screen (delegated: `<AppShell>` tracks which pane index is focused, the active screen's own
  body decides what that index means), resize (Ink's own `useStdout().stdout` resize event, re-deriving
  `RenderMode.columns/lines` live — `04` §4.1's own <100-cols/<24-rows collapse rules applied here,
  once, not duplicated per screen).
- Redraw coalescing: `EngineClient` dispatches are batched into the spec's own 100ms window (P1 already
  built the polling side of this; `<AppShell>` is the one place that actually schedules a React
  re-render from a batch, via a single `setState` per window rather than one per event).

**Checks:**
- A scripted `1`…`8` key sequence switches the active screen exactly as expected, each transition
  producing a distinct snapshot.
- `Tab`/`Shift+Tab` cycles pane focus within a screen without ever changing the active screen itself.
- Resizing (a fake `columns`/`lines` change) below 100 cols collapses to the single-pane/tab-bar layout
  `04` §4.1 mandates; below 24 rows drops the footer to a single key hint — both asserted structurally
  against the rendered frame, not merely "does not crash."
- The modal stack: opening a second modal while one is already open still routes every key to only the
  topmost; `Esc` pops exactly one level, never the whole stack.
- `q` with no active run quits immediately (asserted via the injected quit callback); `q` with an
  active run (asserted via `client`'s own `RunReadModel.runStatus`) prompts instead, offering
  pause-and-exit, never quitting silently out from under a running lane.
- A burst of 50 real engine events arriving inside one 100ms window produces exactly one re-render, not
  50 (a real, counted render-count assertion, proving the coalescing is real).

**Depends on:** P1 (`EngineClient`, `RenderMode`), P2, P3, P5 (modal stack renders whatever's pushed).

---

## P7 — S1 Home / Dashboard

**Mandate:** the first real screen — "what is the state of this product, and what should I do next?"

**Spec:** `04` §4.3 S1.

**Surface:** `packages/tui/src/screens/home.tsx`
- Four panes verbatim: Project (name/level/platform/stages/autonomy), Next actions, Health (KB/Specs/
  Build/Gates one-line-each summaries), Recent activity (a bounded, most-recent-first event log).
- Next-actions ranking: `04` §4.3's own literal "blocking-ness → gate readiness → cheapest-unblock →
  user's declared goal" — a pure, unit-testable ranking function over the read model, independent of
  rendering, taking the same generated-suggestions shape `forge help` (`03`) already surfaces if that
  real function exists yet (checked directly against `packages/cli/src/commands/help.test.ts`'s own
  real coverage before deciding whether to import it or re-derive the ranking locally — recorded in
  `SPEC-QUESTIONS.md` either way, not silently duplicated logic if a shared function already exists).

**Checks:**
- Snapshot tests at 80×24, 100×30, 120×40 for every canonical state `04` §4.8 names (empty, loading,
  running, blocked, failed, complete) — the milestone's own first real instance of this required matrix.
- The ranking function orders a fixture set of candidate next-actions exactly per the four-factor
  precedence, including a tie broken by the declared-goal factor alone.
- Health pane's four rows each independently reflect a fixture read-model's own real KB/Specs/Build/
  Gates state — a KB contradiction present in the fixture renders the `✗` row, absent renders `✓`.

**Depends on:** P1, P2, P3 (Recent activity as a `<ListPane>`), P6 (`<AppShell>` screen slot).

---

## P8 — S2 Run board (lane list + detail, sub-tabs, interject)

**Mandate:** `04` §4.3's own explicit "the core screen" — lane list/detail two-pane, five detail
sub-tabs, the scheduler footer, and the interject flow.

**Spec:** `04` §4.3 S2.

**Surface:** `packages/tui/src/screens/run-board.tsx`
- Two-pane (`<ListPane>` lanes 30% / detail 70%), `Tab` toggles focus between them (delegated through
  `<AppShell>`'s own pane-focus index, P6).
- `v` cycles the detail pane's own sub-tab: Transcript (`<StreamView>`) / Diff (`<DiffView>`) / Files /
  Checks / Prompt — each a real projection of the read model's own per-lane state (P1's `RunReadModel`
  extended here with lane-scoped transcript/diff/file/check/prompt slices, folded from
  `SessionEvent`/`StepProgress`/real diff-bearing events).
- Lane keys verbatim (`04` §4.3): `Enter` inspect, `f` follow, `i` interject, `s` stop, `R` retry,
  `m` merge, `d` diff, `o` open worktree in `$EDITOR`. Every key **emits a command** (a plain, typed
  `EngineCommand` object this screen never executes itself — `04`'s own "the TUI is a view + command
  emitter... acts via engine commands," `02` §2.2's "READ-ONLY on domain state" boundary made concrete)
  rather than calling engine internals directly.
- Interject: `04` §4.3's own literal "delivered via the adapter's streaming-input capability; if
  unsupported, queued as an addendum... and the TUI says so explicitly" — the emitted `EngineCommand`
  carries the message; whether the real adapter underneath supports live delivery is read from the
  read model's own `AdapterCapabilities.interject` field (already real, `@forge/adapter-kit`, M4) and
  rendered as an explicit, honest "queued for next step" notice when `false`, never silently assumed
  delivered.
- Scheduler footer: ready/running/blocked/merge-queue/budget counts, a direct render of P1's own
  `RunReadModel` aggregates.

**Checks:**
- Snapshot tests at three sizes × the canonical states, for both the lane list and each of the five
  detail sub-tabs independently.
- `v` cycles sub-tabs in the documented order and wraps.
- Every lane key produces exactly one `EngineCommand` of the expected shape on the injected command
  sink — never a direct engine call (asserted by the test double having no other real capability at
  all, matching this milestone's own "acts via engine commands" contract structurally, not just by
  convention).
- Interject against a read model reporting `AdapterCapabilities.interject: false` renders the explicit
  "queued as an addendum" notice; `true` renders no such caveat.
- The scheduler footer's four counts match a fixture read model's own real lane/budget state exactly.

**Depends on:** P1, P2, P3, P4 (`<StreamView>`/`<DiffView>`), P6.

---

## P9 — S3 Specs / Spec graph

**Mandate:** the spec-graph tree, traceability, and the traceability matrix view.

**Spec:** `04` §4.3 S3.

**Surface:** `packages/tui/src/screens/specs.tsx`
- `<Tree>` (P3) over `Vision → Capabilities → Epics → Stories → Tasks`, with `Tests`/`ADRs` as
  cross-links — real data from `@forge/core/graph`'s own already-built `SpecGraph` (M2/M3), read
  through the `EngineClient`'s own read model (a real `Custom`/`Artifact`-event-derived projection, or
  a direct, read-only `@forge/core` graph load if the spec graph itself is not event-sourced —
  confirmed directly against `SpecGraph`'s own real construction path before deciding, recorded either
  way).
- `t` traceability path to root, `n` new-artifact-from-template (emits a command, never writes itself —
  matching P8's own "view + command emitter" discipline), `e` edit in `$EDITOR` then auto-`forge spec
  validate` (emits both commands in sequence), `x` orphans-only filter, `m` traceability matrix.
- Traceability matrix: capabilities × stories × tests grid, empty required cells rendered `✗` and
  keyboard-navigable as their own actionable items (`04` §4.3's own literal requirement).

**Checks:**
- Snapshot tests at three sizes × canonical states.
- `t` on a real, multi-level fixture graph produces the exact expected root-path node sequence.
- `x` (orphans-only) against a fixture graph with 2 known orphan stories shows exactly those 2, nothing
  else.
- The traceability matrix marks exactly the fixture's own known-missing edges `✗`, every present edge
  otherwise unmarked/`✓`.

**Depends on:** P1, P2, P3, P6.

---

## P10 — S4 Knowledge Body browser

**Mandate:** the KB section tree, entry viewer, contradictions/stale views, and diagram affordances.

**Spec:** `04` §4.3 S4.

**Surface:** `packages/tui/src/screens/kb.tsx`
- Left `<Tree>` over the eight real KB sections (`product/`, `architecture/`, `data/`, `delivery/`,
  `ops/`, `domain/`, `decisions/`, `constraints/`, `glossary` — `08`'s own real, already-committed
  section set); right pane: entry + front matter + confidence + last-verified + sources + "used by."
- Keys: `/` search (emits a read-only query command against `@forge/kb`'s own already-built search,
  never re-implemented here), `c` contradictions, `s` stale, `v` mark-verified (command), `a` new-ADR
  (command), `w` write-history, `o` open diagrams in browser (a real, disclosed side effect — shells
  out, the one deliberate exception to "never causes side effects itself," matching `04` §4.4's own
  diagram-affordance text: "inline images are not portable... opens them" already implies a real
  external open, not a command round-tripping through the engine).
- Diagram affordance: `⬚ N diagrams` count, source+caption+alt-text render (never an inline image
  requirement, `04` §4.3's own explicit "never as the only way to read the diagram"); `D` before/after
  diff when the entry changed in the current run.

**Checks:**
- Snapshot tests at three sizes × canonical states.
- `c`/`s` filters against a fixture KB tree with known contradiction/stale entries show exactly those,
  correctly counted in the section tree's own badge.
- The diagram affordance renders the real, fixture-attached diagram's source+caption+alt-text, never
  attempts an inline image render outside a real, injected "supports inline graphics" capability flag.
- `/` search emits a read-only query command, never a direct `@forge/kb` call from within the component
  tree itself (the same boundary-enforcement-by-construction test shape P8 already established).

**Depends on:** P1, P2, P3, P6.

---

## P11 — S5 Gates

**Mandate:** gate status/checks/evidence/open-questions, and the approve/reject/waive flow with its own
hard MUST (`04` §4.3: approving with a failing deterministic check must be impossible).

**Spec:** `04` §4.3 S5; `04` §4.4 (Gate review modal reuses this screen's own body, "As S5, focused").

**Surface:** `packages/tui/src/screens/gates.tsx`
- Deterministic + advisory check lists (`<StatusGlyph>` per check), open questions list, the four keys
  (`a` approve, `x` reject, `w` waive, `c` re-run checks) plus `Enter` open-question.
- **Approve is structurally unavailable, not merely warned against, when any deterministic check is
  failing** — the `a` key handler itself checks the read model's own gate-evidence state and emits no
  command at all (a real, typed refusal reason surfaced in the UI) rather than emitting an approve
  command the engine would have to reject; `04`'s own literal "MUST be impossible," read as a UI-layer
  guarantee on top of whatever the engine itself also enforces, not a substitute for it.
- Waive: requires a typed confirmation string (`04` §4.1's own "type \"abort\" to confirm" pattern,
  generalised — a waive reason, not the literal word "abort") before emitting the waive command; refused
  outright (no path to waive at all, not even with a typed reason) when the read model reports the
  gate's own `alwaysHuman` flag, matching `13`'s own already-established "waivers of alwaysHuman gates
  are not permitted at any autonomy level."

**Checks:**
- Snapshot tests at three sizes × canonical states (including a gate with failing deterministic checks
  specifically, since that state drives the approve-refusal behaviour).
- `a` against a fixture gate with ≥1 failing deterministic check emits zero commands and renders the
  refusal reason — structurally proven (the command sink receives nothing), not merely visually implied.
- `w` against an `alwaysHuman` gate emits zero commands regardless of any typed reason supplied.
- `w` against an ordinary gate with a real typed reason emits exactly one waive command carrying that
  reason verbatim.

**Depends on:** P1, P2, P3, P5 (typed-confirmation reuses `<QuestionForm>`'s own text-question shape),
P6.

---

## P12 — S6 Sessions

**Mandate:** the facilitated-discussion list + live-session transcript/technique-indicator/input view.

**Spec:** `04` §4.3 S6.

**Surface:** `packages/tui/src/screens/sessions.tsx`
- Session list (past + "start new," emits a command) via `<ListPane>`.
- Live-session body: transcript (`<StreamView>`, speaker-labelled per participating persona), a
  technique/step indicator (`SCAMPER (3/7)`-shaped, driven by `@forge/sessions`'s own already-built
  technique/step model, M10 — **a real, disclosed forward dependency**: if `@forge/sessions` is not yet
  built when this piece is reached, the technique indicator renders against a plain, typed
  `SessionProgress { technique: string; step: number; total: number }` shape this piece defines
  independently, satisfied later by whatever `@forge/sessions` actually emits — never blocked on M10).
- Input box (free text) + `[space]` next-technique-step, `c` converge, `s` save-to-KB, `Esc` end — all
  commands, never direct writes.

**Checks:**
- Snapshot tests at three sizes × canonical states, including mid-technique and converged states.
- The technique indicator renders `SessionProgress`'s own real fields verbatim, independent of whether
  a real `@forge/sessions` value or a fixture stand-in supplied them.
- `s`/`c`/`[space]` each emit exactly the one expected command, never a direct KB write from within the
  component tree (the same construction-level boundary proof as P10's `/` search).

**Depends on:** P1, P2, P3, P4 (`<StreamView>`), P6.

---

## P13 — S7 Cost & telemetry

**Mandate:** spend/token/wall-clock breakdowns, cache-hit indicators, budget burn-down, top-10 most
expensive steps, cost-per-merged-story.

**Spec:** `04` §4.3 S7.

**Surface:** `packages/tui/src/screens/cost.tsx`
- Per-run/per-stage/per-agent/per-model breakdowns as `<KeyValue>` groups; `<Sparkline>` for burn-down
  and velocity trends; a `<ListPane>`-rendered top-10-expensive-steps table; cache-hit indicators
  rendered only when the read model's own adapter-capability data confirms the adapter reports them
  (never fabricated when the real adapter is silent on cache hits).
- Cost-per-merged-story: `total spend attributed to a lane ÷ merged story count`, a pure function over
  the read model's own `UsageRecorded`/`MergeCompleted` projections — reuses `@forge/telemetry`'s own
  already-built `attributedSpend` (confirmed real, M-series) rather than re-deriving spend attribution
  locally.

**Checks:**
- Snapshot tests at three sizes × canonical states.
- Cost-per-merged-story against a fixture with known spend/merge counts matches the expected computed
  value exactly (a real arithmetic assertion, not a rendering-only check).
- Top-10 ordering against a fixture with more than 10 real steps shows exactly the 10 most expensive,
  correctly ordered, ties broken deterministically (stable, not `Array.sort`'s own engine-dependent
  default for equal keys — an explicit tiebreaker).
- Cache-hit indicators are absent for a fixture adapter reporting no cache data, present and correct for
  one that does.

**Depends on:** P1, P2, P3, P6.

---

## P14 — S8 Customize

**Mandate:** the fifteen customization surfaces (`15` §15.1) with layer-provenance colouring and live
validation.

**Spec:** `04` §4.3 S8.

**Surface:** `packages/tui/src/screens/customize.tsx`
- Left `<ListPane>` of all fifteen real surfaces (`15` §15.1's own literal list) with a modified-count
  badge each; right pane: the resolved object with **per-field layer provenance** (built-in/module/org/
  project/local — `15`'s own already-real overlay-resolution result, `@forge/extensions`, consumed
  read-only here, never re-implemented).
- `e` edit overlay, `d` diff-vs-base, `r` reset, `t` test (runs the surface's own real validation —
  skill checks / MCP handshake with grant-fidelity verification / framework dry-run, each a command
  this screen emits and waits on, never executes inline), `E` eject preset.
- Locked fields (an invariant like CFG-501/I1) render with a lock glyph + the real invariant id —
  `15`'s own already-real locked-field data, surfaced, not invented.

**Checks:**
- Snapshot tests at three sizes × canonical states, including a state with ≥1 locked field and ≥1
  overridden-at-every-layer field simultaneously (the richest real provenance-rendering case).
- Provenance colouring against a fixture resolved object matches the fixture's own real per-field layer
  source exactly, for all five layers.
- `t` emits a command and renders a pending/result state driven by the read model, never runs validation
  logic inline within the component.
- A locked field's own `e`/`r` keys are refused (no edit/reset command emitted), rendering the
  invariant id as the refusal reason — mirroring P11's own approve-refusal discipline.

**Depends on:** P1, P2, P3, P5 (`d`/diff reuses `<DiffView>`, P4), P6.

---

## P15 — Degradation modes: `--ascii`, `--linear`, environment matrix, colourblind pass

**Mandate:** `04` §4.7 in full, as its own dedicated, cross-cutting pass over everything P2-P14 already
built — the milestone's own explicit "degradation modes" Acceptance line and its own named exit test.

**Spec:** `04` §4.7.

**Surface:** `packages/tui/src/linear.tsx` (the `--linear` renderer: no panes, purely sequential output,
every state change announced as one line — genuinely a *different* render path from the panelled
`<AppShell>`, not a CSS-style reflow of it, since `04` calls it out as "this doubles as the CI-friendly
mode," implying deterministic, greppable, non-interactive-safe output) plus real fixes to any P2-P14
component found, in this piece's own dedicated pass, not honouring `RenderMode` correctly.

**Checks:**
- Every component built in P2-P14 is re-snapshotted under `--ascii` at least once (a real matrix test
  sweeping the component/screen list programmatically, not 14 hand-written duplicate files).
- `--linear` mode against a real, recorded event fixture produces a deterministic, line-oriented
  transcript — the milestone's own literal "screen-reader-ish... every state change announced as a
  line" — with zero ANSI escape codes present in the output when `NO_COLOR`/`TERM=dumb` also apply.
  simultaneously.
- `NO_COLOR=1`/`FORCE_COLOR=1`/`TERM=dumb`/narrow-`COLUMNS`/narrow-`LINES` each independently verified
  against `<AppShell>` end to end (not just `detectRenderMode`'s own unit tests from P1 — a real,
  rendered-frame-level proof each environment variable actually changes what gets drawn).
- A colourblind simulation pass (deuteranopia/protanopia approximation applied to the real ANSI colour
  values every component emits) confirms every pass/fail-bearing surface remains distinguishable by
  glyph+label alone, matching P2's own per-component check but exercised here at the full-screen level.

**Depends on:** P2-P14 (this piece audits, and where necessary fixes, all of them).

---

## P16 — Fuzz harness and event-replay golden-file tests

**Mandate:** `04` §4.8's own two most distinctive test requirements, each with its own named milestone
exit-test command: a 10,000-iteration random resize+key fuzz test, and event-replay-to-golden-frame
tests.

**Spec:** `04` §4.8; `22`'s own M9 exit-test list.

**Surface:** `packages/tui/test/fuzz/` — a real fuzz harness driving `<AppShell>` (mounted once via
`ink-testing-library`) through 10,000 randomised resize + key events (a seeded PRNG, so a failure is
reproducible from the logged seed, not a genuinely one-off flake); asserts no thrown error escapes the
render tree and no unhandled promise rejection occurs across the whole run (a real
`process.on('unhandledRejection')` listener scoped to the test, matching this codebase's own existing
"catch what previously escaped uncaught" discipline from the M7 SDK-transport fix). `packages/tui/test/
replay/` — feeds each of several recorded `fixtures/events/*.ndjson` runs (happy-path completion,
a failure/retry, an abort, a gate-blocked run) through `EngineClient` end to end and asserts the final
rendered frame of the relevant screen matches a golden file.

**Checks:**
- The fuzz test survives all 10,000 iterations with zero crashes and zero unhandled rejections on a
  real, seeded run — and a deliberately-reintroduced known bug (a mutation-tested negative control)
  actually fails it, proving the harness would catch a real regression, not merely "ran without
  incident because it never touched the broken path."
- Each of the ≥4 recorded event-replay fixtures reproduces its own golden frame exactly, byte-for-byte
  (modulo the `--ascii` fallback rendering the identical fixture a second time, per P15).
- A resume/restart mid-replay (an `EngineClient` `'gap'` notification injected partway through a
  fixture) is handled without the fuzz/replay harness itself crashing — the real path P1's own
  gap-handling built, exercised here under the same adversarial harness as everything else.

**Depends on:** P1, P6, P15 (every degradation mode must survive the fuzz pass too, not just the happy
render path).

---

## Milestone exit tests (per `specs/22` M9, translated to this repo's real tooling — `--grep` is not a
real flag on the installed `vitest@4.1.11`, the identical `SPEC-QUESTIONS.md` Q114/Q122 finding this
build has already recorded twice; `--testNamePattern` is the real equivalent)

```
node scripts/run-tests.mjs run packages/tui
node scripts/run-tests.mjs run --testNamePattern "tui fuzz"
node scripts/run-tests.mjs run --testNamePattern "tui degradation"
```
