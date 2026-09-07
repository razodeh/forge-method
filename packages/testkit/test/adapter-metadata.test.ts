/**
 * The three `PlatformAdapter` methods with no real logic of their own — `preflight`, `listModels`,
 * `installAssets` — still have a return shape worth pinning down: a real caller reads `listModels()` to
 * discover `FAKE_MODEL_ID` without hardcoding it, for instance.
 *
 * @see specs/07 §7.2
 * @see PLAN-M4.md P5
 */
import { describe, expect, it } from 'vitest';

import { FAKE_MODEL_ID, FakePlatformAdapter } from '../src/fake-adapter.ts';

describe('FakePlatformAdapter metadata methods', () => {
  it('preflight() reports ok with no issues', async () => {
    const adapter = new FakePlatformAdapter();
    await expect(adapter.preflight()).resolves.toEqual({ ok: true, issues: [] });
  });

  it('listModels() reports exactly the one model id startSession accepts', async () => {
    const adapter = new FakePlatformAdapter();
    const models = await adapter.listModels();
    expect(models).toEqual([{ id: FAKE_MODEL_ID, displayName: 'FORGE Fake Model' }]);
  });

  it('installAssets() reports no assets installed', async () => {
    const adapter = new FakePlatformAdapter();
    await expect(adapter.installAssets()).resolves.toEqual([]);
  });
});
