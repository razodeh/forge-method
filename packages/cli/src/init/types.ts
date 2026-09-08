/**
 * Types for `@forge/cli/init` — `03` §3.3's greenfield wizard, driven non-interactively.
 *
 * @see specs/03 §3.3
 */
import type { PlatformAdapter } from '@forge/adapter-kit/types';
import type { ProjectLevel } from '@forge/methods/level';

import type { AutonomyLevel } from '../entry/types.ts';

/** `03` §3.3's own worked flag example, typed. Every field is optional except `name`: the rest of
 * the wizard's steps all have a documented default (`DEFAULT_CONFIG`, a preset, `proposeLevel`'s own
 * fallback) that non-interactive `--yes` falls back to, matching "Accept all defaults" (`03` §3.2's
 * own `--yes` row). */
export interface InitOptions {
  readonly name: string;
  readonly slug?: string;
  readonly description?: string;
  readonly repoUrl?: string;
  /** `--idea-file`: a path to free-text product-idea content, read verbatim. `03` §3.3 step 2 also
   * names an optional URL attachment form; no real fetch-and-summarise pipeline exists anywhere in
   * this codebase yet (a real gap, not a stub this piece invents) — see `SPEC-QUESTIONS.md` Q101. */
  readonly ideaFile?: string;
  readonly mode?: 'guided' | 'express';
  /** An explicit override for `03` §3.3 step 4. Omitted, `runInit` calls `@forge/methods/level`'s own
   * `proposeLevel` against a conservative, real (not fabricated) default `LevelSignals` — see
   * `resolveInitLevel`'s own doc comment for exactly what "conservative" means and why. */
  readonly level?: ProjectLevel;
  /** Candidate platform ids to prefer, in order — `03` §3.3 step 5's "pick primary + optional
   * fallback." Matched against `candidateAdapters`' own `id`s (see `RunInitDeps`); the first
   * unspecified candidate whose `preflight()` succeeds is used when omitted. */
  readonly platform?: string;
  readonly fallbackPlatform?: string;
  readonly autonomy?: AutonomyLevel;
  readonly budget?: number;
  readonly modules?: readonly string[];
  readonly preset?: string;
  readonly overlay?: readonly string[];
  readonly kbRoot?: string;
  /** `03` §3.3 step 9: init git if absent. Default `true`, matching the worked example's own
   * `--git-init`. */
  readonly gitInit?: boolean;
  readonly allowCommits?: boolean;
  /** `--yes`: accept all defaults. `runInit` itself is always non-interactive (`03` §3.3's own "no
   * TUI interaction" mandate for this piece) — this flag exists on `InitOptions` only so
   * `parseInitFlags` can reject a missing `--yes` the same way an interactive-shaped command's
   * non-TTY refusal does elsewhere in `@forge/cli`, per `03` §3.1's "every interactive flow MUST have
   * a --yes-able non-interactive equivalent" rule. */
  readonly yes: boolean;
}

/** `runInit`'s own required collaborators, injected rather than constructed — this project's own
 * determinism/boundary discipline: `@forge/cli` has no way to discover which platforms are installed
 * without a concrete `PlatformAdapter` (`07` §7.1's own "nothing above `@forge/adapter-kit` may
 * reference Claude Code, CodeMachine..." rule), and none exists in this codebase yet (a real,
 * documented gap — see `SPEC-QUESTIONS.md` Q101). A real caller supplies whatever adapters it has
 * once one exists; tests supply `@forge/testkit`'s `FakeAdapter`. */
export interface RunInitDeps {
  readonly candidateAdapters: readonly PlatformAdapter[];
  /** Passed through verbatim to each candidate's `preflight()` — `PreflightContext.env`'s own doc
   * comment requires this be injected, never read from `process.env` ambiently inside this package. */
  readonly env: Readonly<Record<string, string>>;
  /** The directory containing `<module>/agents/*.agent.yaml` roster content (`05` §5.3's own
   * canonical layout) — this monorepo's own `modules/` at the repository root today. Injected rather
   * than discovered: unlike `@forge/templates`' own content (shipped *inside* that npm package, real
   * `import.meta.resolve('@forge/templates/...')` reads it directly), `modules/` is a bare workspace
   * directory with no publishing/distribution mechanism of its own yet — a real, open gap a future
   * installer piece has to solve, not one this piece can paper over with a guessed default. See
   * `SPEC-QUESTIONS.md` Q101. */
  readonly modulesDir: string;
}

export interface WrittenFile {
  readonly path: string;
  /** Whether this file carries the `forge:generated` header (`03` §3.3's own idempotency rule) —
   * `false` for hand-owned files (`overrides/**`, `FORGE.md`, `config.local.yaml`) that are never
   * regenerated. */
  readonly generated: boolean;
}

export type InitResult =
  | {
      readonly kind: 'initialized';
      readonly projectRoot: string;
      readonly level: ProjectLevel;
      readonly levelReasoning: string;
      readonly platform: string | undefined;
      readonly files: readonly WrittenFile[];
    }
  /** `03` §3.3's own idempotency rule: re-running `init` on an existing project "MUST detect it and
   * switch to `upgrade` semantics" — real `upgrade` semantics are `@forge/cli` C7's own surface
   * (`runUpgrade`), not yet built (`PLAN-M6.md` orders C7 well after C2). `runInit` detects the
   * existing project and stops here rather than either silently re-writing over it or fabricating an
   * upgrade this piece has no real implementation for — see `SPEC-QUESTIONS.md` Q101. */
  | { readonly kind: 'already-initialized'; readonly projectRoot: string };
