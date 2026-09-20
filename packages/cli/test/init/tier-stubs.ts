/**
 * Minimal `PlatformAdapter` stand-ins for the tier-map tests, built on the real `FakePlatformAdapter` so
 * nothing in `packages/cli` has to name a platform model: what is under test is the *contract*
 * (`PlatformAdapter.defaultTierModels` vs `listModels()`), not any one platform's table.
 */
import type { ModelInfo, PlatformAdapter, TierModelMap } from '@forge/adapter-kit/types';
import { FakePlatformAdapter } from '@forge/testkit';

export interface StubOptions {
  readonly id?: string;
  readonly models?: readonly string[] | Error;
  /** `undefined` = the adapter declares no defaults at all (no method). */
  readonly defaults?: TierModelMap | (() => never) | 'omit' | 'not-an-object';
}

export function stubAdapter(options: StubOptions): PlatformAdapter {
  const base = new FakePlatformAdapter();
  const models = options.models ?? ['m-small', 'm-mid', 'm-big'];
  const adapter: Record<string, unknown> = {
    id: options.id ?? 'stub',
    displayName: 'Stub',
    capabilities: () => base.capabilities(),
    preflight: () => base.preflight(),
    startSession: () => Promise.reject(new Error('unused')),
    resumeSession: () => Promise.reject(new Error('unused')),
    listModels: (): Promise<readonly ModelInfo[]> =>
      models instanceof Error
        ? Promise.reject(models)
        : Promise.resolve(models.map((id) => ({ id, displayName: id }))),
  };
  const defaults = options.defaults ?? { frugal: 'm-small', balanced: 'm-mid', max: 'm-big' };
  if (defaults !== 'omit') {
    adapter['defaultTierModels'] = typeof defaults === 'function' ? defaults : () => defaults;
  }
  return adapter as unknown as PlatformAdapter;
}
