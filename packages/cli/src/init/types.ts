/**
 * Types for `@forge/cli/init` — `03` §3.3's greenfield wizard, driven non-interactively.
 *
 * @see specs/03 §3.3
 */
import type { PlatformAdapter } from '@forge/adapter-kit/types';
import type { ProjectLevel } from '@forge/methods/level';

import type { AutonomyLevel } from '../entry/types.ts';
import type { ConflictResolutionMode } from '../generated-header.ts';
import type { TierMapReport } from './tier-map.ts';

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
   * this codebase yet (a real gap, not a stub this piece invents) — see `SPEC-QUESTIONS.md` Q103. */
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
  /** `--on-conflict <mode>`: how a re-`init` on an existing project resolves a regenerable file whose
   * real, recorded hash no longer matches its current content (`03` §3.3's own "modified hash" rule)
   * — `keep-mine`/`take-theirs`/`merge`/`show-diff`. Omitted, `writeRegenerableContent` prompts
   * interactively (see `@forge/cli/generated-header`'s `resolveGeneratedConflict`). Ignored entirely
   * on a genuine first-time `init` (there is nothing to conflict with yet). */
  readonly onConflict?: ConflictResolutionMode;
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
 * reference Claude Code..." rule), and none exists in this codebase yet (a real,
 * documented gap — see `SPEC-QUESTIONS.md` Q103). A real caller supplies whatever adapters it has
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
   * `SPEC-QUESTIONS.md` Q103. */
  readonly modulesDir: string;
  /** Overrides the real terminal streams `resolveGeneratedConflict`'s own interactive prompt reads
   * from/writes to (default `process.stdin`/`process.stdout`) — the same "inject the real I/O, don't
   * read it ambiently" discipline this interface already follows for `env`, extended here so a test
   * can drive/observe a real re-`init` conflict prompt without a real TTY. */
  readonly conflictInput?: NodeJS.ReadableStream;
  readonly conflictOutput?: NodeJS.WritableStream;
}

export interface WrittenFile {
  readonly path: string;
  /** Whether this file carries the `forge:generated` header (`03` §3.3's own idempotency rule) —
   * `false` for hand-owned files (`overrides/**`, `FORGE.md`, `config.local.yaml`) that are never
   * regenerated. */
  readonly generated: boolean;
  /** Present only when this file went through real conflict resolution during a re-`init`/`upgrade`
   * (its recorded hash no longer matched its on-disk content) — the mode that was actually applied.
   * Absent for every ordinary write (nothing existed yet, or the existing file had not drifted). */
  readonly conflict?: ConflictResolutionMode;
}

export type InitResult =
  | {
      readonly kind: 'initialized';
      readonly projectRoot: string;
      readonly level: ProjectLevel;
      readonly levelReasoning: string;
      readonly platform: string | undefined;
      readonly files: readonly WrittenFile[];
      /** One report per adapter given a tier map (primary first, then the fallback when it is a
       * different adapter): which `models.tiers` entries now exist and which are still unmapped (agent
       * steps on an unmapped tier fail `RUN-078`). `PLAN-M13.md` P5b, `SPEC-QUESTIONS.md` Q204. */
      readonly modelTiers: readonly TierMapReport[];
    }
  /** `03` §3.3's own idempotency rule: re-running `init` on an existing project "MUST detect it and
   * switch to `upgrade` semantics" — real, as of `PLAN-M12.md` P3: the regenerable directories
   * (`.forge/{workflows,frameworks,checks,templates,skills,agents,briefs,prompts,techniques}` --
   * `techniques`, `PLAN-M14.md` P29) are regenerated for real, each
   * file going through `writeGenerated`'s own real hash-drift conflict resolution (`files[n].conflict`
   * names the mode actually applied wherever one triggered). See `run-init.ts`'s own doc comment for
   * exactly why this is scoped to the regenerable directories alone, not the full `runUpgrade`
   * pipeline. */
  | {
      readonly kind: 'reinitialized';
      readonly projectRoot: string;
      readonly files: readonly WrittenFile[];
      /** The same reports as a fresh init's, for the adapters `.forge/config.yaml` already records:
       * tiers with no entry were filled from the adapter's defaults; an entry that was already there —
       * hand-edited or not — was left exactly as it was. */
      readonly modelTiers: readonly TierMapReport[];
      /** Reasons the tier map could not be checked at all (unreadable or malformed config, a recorded
       * adapter not available here). Empty when the check ran. Never a silent skip. */
      readonly modelTierNotes: readonly string[];
    };
