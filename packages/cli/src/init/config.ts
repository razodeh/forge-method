/**
 * `buildForgeConfig` — the real `ForgeConfig` `.forge/config.yaml` gets written with: `02` §2.8's
 * lowest-precedence `DEFAULT_CONFIG` layer, overridden by exactly the wizard answers `03` §3.3's own
 * eleven steps actually collect.
 *
 * @see specs/18 §18.3
 * @see specs/02 §2.8
 */
import { DEFAULT_CONFIG, type ForgeConfig } from '@forge/schemas/config';

import type { ProjectLevel } from '@forge/methods/level';

import type { TierModelMap } from '@forge/adapter-kit/types';

import { withTierMap } from './tier-map.ts';
import type { InitOptions } from './types.ts';

function slugify(name: string): string {
  return (
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'project'
  );
}

/**
 * `03` §3.3 step 7 names `--kb-root` "KB root (default `docs/forge`)" — but `DEFAULT_CONFIG.paths.kb`
 * is `'docs/forge/kb'`, a *subdirectory* of that default, not the same string (`packages/schemas/src/
 * config/defaults.ts`). Read literally as "override only `paths.kb`," the worked flag example's own
 * `--kb-root docs/forge` would set `paths.kb` to the same directory `paths.specs`/`paths.plans`/etc.
 * already live under as siblings — the KB README and the specs/plans/sessions/reports directories
 * would collide in one flat directory instead of nesting under it. Rebasing all five `paths.*` under
 * `kbRoot` (each keeping its own `DEFAULT_CONFIG`-given subdirectory name) is the one reading under
 * which the default (`kbRoot` omitted) and the worked example (`kbRoot` given) produce the *same*
 * directory shape, differing only in where that shape is rooted — the only self-consistent
 * interpretation of "KB root" as a single flag governing all five. See `SPEC-QUESTIONS.md` Q103.
 */
function buildPaths(kbRoot: string | undefined): ForgeConfig['paths'] {
  if (kbRoot === undefined) return DEFAULT_CONFIG.paths;
  return {
    kb: `${kbRoot}/kb`,
    specs: `${kbRoot}/specs`,
    plans: `${kbRoot}/plans`,
    sessions: `${kbRoot}/sessions`,
    reports: `${kbRoot}/reports`,
    code: DEFAULT_CONFIG.paths.code,
  };
}

export interface BuildConfigInput {
  readonly options: InitOptions;
  readonly level: ProjectLevel;
  readonly platformId: string;
  readonly fallbackPlatformId: string | undefined;
  /** Per adapter id, the tier -> model entries already vetted against that adapter's own
   * `listModels()` (`deriveTierMap`); recorded under `models.tiers.<tier>.<adapter id>`. Omitted, the
   * tier table stays exactly `DEFAULT_CONFIG`'s (empty) one. */
  readonly tierModels?: ReadonlyMap<string, TierModelMap>;
}

export function buildForgeConfig({
  options,
  level,
  platformId,
  fallbackPlatformId,
  tierModels,
}: BuildConfigInput): ForgeConfig {
  let tiers = DEFAULT_CONFIG.models.tiers;
  for (const [adapterId, offered] of tierModels ?? [])
    tiers = withTierMap(tiers, adapterId, offered);

  return {
    ...DEFAULT_CONFIG,
    models: { ...DEFAULT_CONFIG.models, tiers },
    project: {
      ...DEFAULT_CONFIG.project,
      name: options.name,
      slug: options.slug ?? slugify(options.name),
      description: options.description ?? '',
      level,
      mode: options.mode ?? DEFAULT_CONFIG.project.mode,
      repoUrl: options.repoUrl ?? '',
    },
    paths: buildPaths(options.kbRoot),
    platform: {
      ...DEFAULT_CONFIG.platform,
      primary: platformId,
      fallback: fallbackPlatformId ?? null,
    },
    execution: {
      ...DEFAULT_CONFIG.execution,
      autonomy: options.autonomy ?? DEFAULT_CONFIG.execution.autonomy,
    },
    budget: {
      ...DEFAULT_CONFIG.budget,
      perRunUsd: options.budget ?? DEFAULT_CONFIG.budget.perRunUsd,
    },
    roster: {
      ...DEFAULT_CONFIG.roster,
      preset: options.preset ?? DEFAULT_CONFIG.roster.preset,
    },
    vcs: {
      ...DEFAULT_CONFIG.vcs,
      allowCommits: options.allowCommits ?? DEFAULT_CONFIG.vcs.allowCommits,
    },
  };
}
