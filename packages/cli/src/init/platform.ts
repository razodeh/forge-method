/**
 * `selectPlatform` — `03` §3.3 step 5: "detect installed platforms ... pick primary + optional
 * fallback; run a connectivity smoke test and show the result before continuing."
 *
 * "Detect installed platforms" is real `preflight()` calls against real, injected
 * `PlatformAdapter`s (`RunInitDeps.candidateAdapters`) — never a probe for a named binary/env var by
 * this package itself. `07` §7.1's own boundary rule ("nothing above `@forge/adapter-kit` may
 * reference Claude Code, CodeMachine... by name") applies here exactly as it does inside
 * `adapter-kit` itself: this function only ever calls the interface, never asks what platform it is.
 *
 * @see specs/03 §3.3
 * @see specs/07 §7.1
 */
import type { PlatformAdapter } from '@forge/adapter-kit/types';
import { ForgeError } from '@forge/core/errors';

import type { InitOptions, RunInitDeps } from './types.ts';

export interface PlatformSelection {
  readonly primary: PlatformAdapter;
  readonly fallback: PlatformAdapter | undefined;
}

function findById(candidates: readonly PlatformAdapter[], id: string): PlatformAdapter | undefined {
  return candidates.find((candidate) => candidate.id === id);
}

/**
 * Picks the primary and (optional) fallback adapter, running each candidate's real `preflight()`
 * before it can be chosen as primary — "run a connectivity smoke test ... before continuing" applies
 * to whichever adapter is actually selected, not to every candidate regardless of whether it is used.
 *
 * @throws {ForgeError} `ENV-004` when `options.platform` names an id not in `candidateAdapters`, when
 * no candidates are supplied at all, or when the selected primary's own `preflight()` reports it is
 * not usable.
 */
export async function selectPlatform(
  dir: string,
  options: InitOptions,
  deps: RunInitDeps,
): Promise<PlatformSelection> {
  if (deps.candidateAdapters.length === 0) {
    throw new ForgeError('ENV-004', { tool: options.platform ?? 'a platform adapter' });
  }

  const primary = await resolvePrimary(dir, options, deps);
  const fallback = resolveFallback(options, deps.candidateAdapters);

  return { primary, fallback };
}

/** Unlike `resolvePrimary`, this never runs `preflight()` on the fallback — `03` §3.3 step 5 only
 * requires the smoke test for the platform actually being used right now. An unknown id is still a
 * real error, the same as an unknown `--platform`: silently dropping a fallback the user explicitly
 * named would leave `config.platform.fallback` at `null` with no indication the flag did nothing. */
function resolveFallback(
  options: InitOptions,
  candidates: readonly PlatformAdapter[],
): PlatformAdapter | undefined {
  if (options.fallbackPlatform === undefined) return undefined;
  const named = findById(candidates, options.fallbackPlatform);
  if (named === undefined) {
    throw new ForgeError('ENV-004', { tool: options.fallbackPlatform });
  }
  return named;
}

async function resolvePrimary(
  dir: string,
  options: InitOptions,
  deps: RunInitDeps,
): Promise<PlatformAdapter> {
  if (options.platform !== undefined) {
    const named = findById(deps.candidateAdapters, options.platform);
    if (named === undefined) {
      throw new ForgeError('ENV-004', { tool: options.platform });
    }
    await preflightOrThrow(dir, named, deps.env);
    return named;
  }

  for (const candidate of deps.candidateAdapters) {
    const result = await candidate.preflight({ projectRoot: dir, env: deps.env });
    if (result.ok) return candidate;
  }
  throw new ForgeError('ENV-004', { tool: 'a usable platform adapter' });
}

async function preflightOrThrow(
  dir: string,
  adapter: PlatformAdapter,
  env: Readonly<Record<string, string>>,
): Promise<void> {
  const result = await adapter.preflight({ projectRoot: dir, env });
  if (!result.ok) {
    throw new ForgeError('ENV-004', { tool: adapter.id });
  }
}
