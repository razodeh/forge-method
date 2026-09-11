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
 * Every variant is scoped to exactly what `PLAN-M9.md` P8 (S2 Run board) actually needs — `lane.*`
 * commands for the six lane keys with a real engine-side effect (`f`/`i`/`s`/`R`/`m`/`o`). `Enter`
 * (select/inspect) and `d` (jump to the Diff tab) are deliberately **not** commands: both are pure,
 * local view concerns with no real engine-side effect to name (`SPEC-QUESTIONS.md` Q140 has the full
 * reasoning) — matching `v`'s own already-established view-only tab-cycle, never in this union either.
 *
 * @see specs/04 §4.3 S2
 * @see PLAN-M9.md P8
 * @see SPEC-QUESTIONS.md Q140
 */
export type EngineCommand =
  | { readonly type: 'lane.follow'; readonly laneId: string }
  | { readonly type: 'lane.interject'; readonly laneId: string; readonly message: string }
  | { readonly type: 'lane.stop'; readonly laneId: string }
  | { readonly type: 'lane.retryStep'; readonly laneId: string }
  | { readonly type: 'lane.requestMerge'; readonly laneId: string }
  | { readonly type: 'lane.openWorktree'; readonly laneId: string };
