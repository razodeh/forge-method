/**
 * Types for `@forge/cli/entry` — `03` §3.1's resolution logic and §3.2's global-flags table.
 *
 * @see specs/03 §3.1
 * @see specs/03 §3.2
 */

/** `03` §3.2's `--model-tier` enum. */
export type ModelTier = 'frugal' | 'balanced' | 'max';

/** `03` §3.2's `--autonomy` enum; the full meaning of each level is `03` §3.6. */
export type AutonomyLevel = 'supervised' | 'guided' | 'autonomous';

/**
 * Every row of `03` §3.2's global-flags table, parsed once and shared by every command.
 *
 * `positionals` is everything `parseGlobalFlags` did not recognise as a global flag or its value —
 * the subcommand name and its own arguments, left untouched for a later command piece to parse.
 */
export interface GlobalFlags {
  readonly project?: string;
  readonly config?: string;
  /** Default `'default'` per the table's own default column. */
  readonly profile: string;
  readonly platform?: string;
  readonly modelTier?: ModelTier;
  readonly autonomy?: AutonomyLevel;
  readonly concurrency?: number;
  readonly budget?: number;
  readonly dryRun: boolean;
  readonly yes: boolean;
  readonly json: boolean;
  readonly noTui: boolean;
  /** `-v` info (1), `-vv` debug (2), `-vvv` trace (3, includes prompts). 0 when absent. */
  readonly verbosity: number;
  readonly quiet: boolean;
  /** `undefined` means "auto" (respect `NO_COLOR`/`FORCE_COLOR`) — the table's own default. */
  readonly noColor?: boolean;
  readonly seed?: number;
  readonly positionals: readonly string[];
}

/** The three `03` §3.1 branches for a directory that is not a FORGE project, plus the one that is. */
export type EntryProjectBranch = 'init-wizard' | 'adopt-or-init' | 'dashboard';

/**
 * The result of `resolveEntryContext` — every outcome `03` §3.1's resolution logic can reach.
 *
 * `unsupported-node-version` and `non-tty-refusal` are terminal: neither launches anything. The
 * three project-branch kinds are what step 3 launches when neither terminal case applies.
 */
export type EntryResolution =
  | {
      readonly kind: 'unsupported-node-version';
      readonly required: string;
      readonly actual: string;
    }
  | { readonly kind: 'non-tty-refusal'; readonly underlying: EntryProjectBranch }
  | { readonly kind: 'init-wizard' }
  | { readonly kind: 'adopt-or-init'; readonly defaultHighlight: 'adopt' }
  | { readonly kind: 'dashboard'; readonly projectRoot: string };

/**
 * The ambient facts `resolveEntryContext` reads to classify an invocation, injected rather than
 * read from `process` directly — this project's own determinism discipline (an injected clock, not
 * an ambient global; see `@forge/telemetry`'s own `NewForgeEvent.ts` doc comment) applied to the
 * entry point. `resolveEntryContext(cwd, argv)` — the two-argument surface `PLAN-M6.md` C1 names —
 * still works standalone: every field here defaults from the real `process` when omitted, so the
 * common call form never has to construct one of these.
 */
export interface EntryEnv {
  readonly nodeVersion: string;
  readonly isStdinTty: boolean;
  readonly isStdoutTty: boolean;
}
