/**
 * `selectPlatform` — `03` §3.3 step 5: real `preflight()` calls against injected candidate adapters,
 * never a probe for a named binary by this package itself.
 *
 * @see specs/03 §3.3
 * @see specs/07 §7.1
 */
import { describe, expect, it } from 'vitest';

import { ForgeError } from '@forge/core/errors';
import { FakePlatformAdapter } from '@forge/testkit';
import type { PlatformAdapter, PreflightResult } from '@forge/adapter-kit/types';

import { selectPlatform } from '../../src/init/platform.ts';
import type { InitOptions, RunInitDeps } from '../../src/init/types.ts';

const BASE: InitOptions = { name: 'Acme Billing', yes: true };

/** A minimal, hand-built adapter whose `preflight()` always reports the given result — used to prove
 * the "not usable" and "named but missing" branches `FakePlatformAdapter` (always `ok: true`) cannot
 * exercise on its own. */
function adapterWith(id: string, result: PreflightResult): PlatformAdapter {
  return {
    id,
    displayName: id,
    capabilities: () => {
      throw new Error('not used in this test');
    },
    preflight: () => Promise.resolve(result),
    listModels: () => Promise.resolve([]),
    startSession: () => {
      throw new Error('not used in this test');
    },
    resumeSession: () => {
      throw new Error('not used in this test');
    },
  };
}

function deps(candidateAdapters: readonly PlatformAdapter[]): RunInitDeps {
  return { candidateAdapters, env: {}, modulesDir: '/unused' };
}

describe('selectPlatform', () => {
  it('picks the first candidate whose real preflight() succeeds, when --platform is omitted', async () => {
    const failing = adapterWith('broken', { ok: false, issues: [] });
    const working = new FakePlatformAdapter();
    const selection = await selectPlatform('/tmp/project', BASE, deps([failing, working]));
    expect(selection.primary.id).toBe(working.id);
    expect(selection.fallback).toBeUndefined();
  });

  it('honors an explicit --platform id, running its own real preflight() first', async () => {
    const working = new FakePlatformAdapter();
    const selection = await selectPlatform(
      '/tmp/project',
      { ...BASE, platform: working.id },
      deps([working]),
    );
    expect(selection.primary).toBe(working);
  });

  it('throws ENV-004 when --platform names an id not among the candidates', async () => {
    const working = new FakePlatformAdapter();
    await expect(
      selectPlatform('/tmp/project', { ...BASE, platform: 'nonexistent' }, deps([working])),
    ).rejects.toMatchObject({ code: 'ENV-004' });
  });

  it('throws ENV-004 when the explicitly-named platform fails its own real preflight()', async () => {
    const broken = adapterWith('broken', { ok: false, issues: [] });
    await expect(
      selectPlatform('/tmp/project', { ...BASE, platform: 'broken' }, deps([broken])),
    ).rejects.toBeInstanceOf(ForgeError);
  });

  it('throws ENV-004 when no candidate is usable at all', async () => {
    const broken = adapterWith('broken', { ok: false, issues: [] });
    await expect(selectPlatform('/tmp/project', BASE, deps([broken]))).rejects.toMatchObject({
      code: 'ENV-004',
    });
  });

  it('throws ENV-004 when no candidates are supplied', async () => {
    await expect(selectPlatform('/tmp/project', BASE, deps([]))).rejects.toMatchObject({
      code: 'ENV-004',
    });
  });

  it('resolves an explicit --fallback-platform by id, independent of its own preflight result', async () => {
    const primary = new FakePlatformAdapter();
    const fallback = adapterWith('fallback-broken', { ok: false, issues: [] });
    const selection = await selectPlatform(
      '/tmp/project',
      { ...BASE, platform: primary.id, fallbackPlatform: 'fallback-broken' },
      deps([primary, fallback]),
    );
    expect(selection.fallback).toBe(fallback);
  });

  it('throws ENV-004 when --fallback-platform names an id not among the candidates, rather than silently dropping it', async () => {
    const primary = new FakePlatformAdapter();
    await expect(
      selectPlatform(
        '/tmp/project',
        { ...BASE, platform: primary.id, fallbackPlatform: 'nonexistent' },
        deps([primary]),
      ),
    ).rejects.toMatchObject({ code: 'ENV-004' });
  });
});
