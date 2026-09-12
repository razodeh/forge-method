/**
 * `@forge/sessions` — `16`'s collaboration sessions: pure facilitation logic only.
 *
 * No agent dispatch and no adapter calls live in this package (`specs/02` §2.2's own dependency
 * graph gives `sessions` no edge to `@forge/engine`, the same structural fact `Q104` already
 * established for `@forge/agents` -- see `PLAN-M10.md`'s own header). This package holds the
 * technique library (`16` §16.4), the FRAME → DIVERGE → CONVERGE → DECIDE → RECORD state machine
 * (`16` §16.3), and session-record assembly (`16` §16.5); driving real agent turns from its own
 * `PhaseDirective` values is `PLAN-M10.md` P10's job, in `@forge/engine`.
 *
 * @see specs/16
 * @see PLAN-M10.md P9
 */
export * from './technique/index.ts';
export * from './phase-machine/index.ts';
export * from './record/index.ts';
