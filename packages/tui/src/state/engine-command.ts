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
 * either (`SPEC-QUESTIONS.md` Q141).
 *
 * @see specs/04 §4.3 S2, S3
 * @see PLAN-M9.md P8, P9
 * @see SPEC-QUESTIONS.md Q140, Q141
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
  | { readonly type: 'spec.validate'; readonly artifactId: string };
