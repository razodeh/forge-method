/**
 * `@forge/cli` — `03`'s CLI, npx experience and installer.
 *
 * `specs/02` §2.2 places this package's own boundary edge as `cli ← everything`: every command
 * piece is, by design, a thin dispatch/formatting layer over already-built package functions. `C1`
 * (`PLAN-M6.md`) is the first of those pieces: the entry-point resolution logic and the four output
 * modes every later command renders through.
 *
 * @see specs/02 §2.2
 * @see specs/03
 */
export * from './entry/index.ts';
export * from './output/index.ts';
