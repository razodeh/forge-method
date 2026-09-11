/**
 * `EngineCommand` — `04`'s own "the TUI is a view + command emitter, never a direct engine caller"
 * contract (`02` §2.2's "READ-ONLY on domain state" boundary) made concrete as a real, typed union: a
 * screen constructs one of these and hands it to whatever real dispatch mechanism a later, not-yet-built
 * integration piece wires up (no such dispatcher exists anywhere in this codebase yet, `PLAN-M9.md`'s own
 * recorded scope note) — never executes the underlying engine action itself. `PLAN-M9.md` P8 is the
 * first piece to need this; P9/P10's own "emits a command, never writes itself" text describes the same
 * discipline, so this union lives here (not inlined into `run-board.tsx`) for later pieces to extend with
 * their own variants, the same "one evolving type" shape `@forge/adapter-kit`'s own `AdapterCapabilities`
 * already establishes for a comparable cross-cutting contract.
 *
 * `lane.*` variants are scoped to exactly what `PLAN-M9.md` P8 (S2 Run board) actually needs — the six
 * lane keys with a real engine-side effect (`f`/`i`/`s`/`R`/`m`/`o`). `Enter` (select/inspect) and `d`
 * (jump to the Diff tab) are deliberately **not** commands: both are pure, local view concerns with no
 * real engine-side effect to name (`SPEC-QUESTIONS.md` Q140 has the full reasoning) — matching `v`'s own
 * already-established view-only tab-cycle, never in this union either. `spec.*` variants are `PLAN-M9.md`
 * P9's own addition (S3 Specs/Spec graph), for its `n`/`e` keys — `t` (traceability path to root) and `x`
 * (orphans-only filter) are, by the identical reasoning, pure local view concerns and never commands
 * either (`SPEC-QUESTIONS.md` Q141). `kb.*` variants are `PLAN-M9.md` P10's own addition (S4 Knowledge
 * Body browser), for its `/`/`v`/`a` keys — `c` (contradictions filter) and `s` (stale filter) are, by
 * the identical reasoning, pure local view concerns, never commands (`SPEC-QUESTIONS.md` Q142). `o`
 * (open diagrams in browser) is deliberately **not** a command either, but for a different reason: `04`
 * §4.3 S4's own text calls this a real, disclosed side effect (shelling out to open a URL), the one
 * deliberate exception to "the TUI never causes side effects itself" — routed through an injected
 * callback prop, not through this command union, since it has no real engine-side action to name at all.
 * `gate.*` variants are `PLAN-M9.md` P11's own addition (S5 Gates), for its `a`/`x`/`w`/`c` keys —
 * `Enter` (open question) is, by the identical reasoning, a pure local view concern and never a command
 * (`SPEC-QUESTIONS.md` Q143). `gate.approve` and `gate.waive` both carry `04` §4.3 S5's own hard MUSTs
 * as *UI-layer* refusals, not engine-trusting requests: `<GatesScreen>` itself never constructs a
 * `gate.approve` command at all when any deterministic check is failing, and never constructs a
 * `gate.waive` command at all for an `alwaysHuman` gate — both refusals happen before this union is ever
 * touched, so there is no "approve/waive, but invalid" variant to represent here; every `gate.approve`/
 * `gate.waive` this union can express is, structurally, one the UI itself already judged permissible.
 * `session.*` variants are `PLAN-M9.md` P12's own addition (S6 Sessions) — `[space]`/`c`/`s`/`Esc`
 * (advance step/converge/save-to-KB/end) and a session's own free-text contribution flow all emit
 * exactly one command each, never a direct write, matching the identical discipline `kb.search` (P10)
 * already established for its own free-text flow.
 *
 * @see specs/04 §4.3 S2, S3, S4, S5, S6
 * @see PLAN-M9.md P8, P9, P10, P11, P12
 * @see SPEC-QUESTIONS.md Q140, Q141, Q142, Q143, Q144
 */
export type EngineCommand =
  | { readonly type: 'lane.follow'; readonly laneId: string }
  | { readonly type: 'lane.interject'; readonly laneId: string; readonly message: string }
  | { readonly type: 'lane.stop'; readonly laneId: string }
  | { readonly type: 'lane.retryStep'; readonly laneId: string }
  | { readonly type: 'lane.requestMerge'; readonly laneId: string }
  | { readonly type: 'lane.openWorktree'; readonly laneId: string }
  | { readonly type: 'spec.newArtifactFromTemplate'; readonly parentId: string }
  | { readonly type: 'spec.edit'; readonly artifactId: string }
  | { readonly type: 'spec.validate'; readonly artifactId: string }
  | { readonly type: 'kb.search'; readonly query: string }
  | { readonly type: 'kb.markVerified'; readonly entryId: string }
  | { readonly type: 'kb.newAdr'; readonly contextEntryId: string }
  | { readonly type: 'gate.approve'; readonly gateId: string }
  | { readonly type: 'gate.reject'; readonly gateId: string }
  | { readonly type: 'gate.waive'; readonly gateId: string; readonly reason: string }
  | { readonly type: 'gate.rerunChecks'; readonly gateId: string }
  | { readonly type: 'session.start' }
  | { readonly type: 'session.contribute'; readonly sessionId: string; readonly message: string }
  | { readonly type: 'session.advanceStep'; readonly sessionId: string }
  | { readonly type: 'session.converge'; readonly sessionId: string }
  | { readonly type: 'session.saveToKb'; readonly sessionId: string }
  | { readonly type: 'session.end'; readonly sessionId: string };
