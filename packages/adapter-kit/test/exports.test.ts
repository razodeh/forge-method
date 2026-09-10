/**
 * Every subpath `package.json` declares under `exports` resolves to a file that actually exists — a
 * gauntlet critic found three dangling entries (`./grants`, `./control-tokens`, `./conformance`,
 * pre-declared for P2/P3/P4 before those pieces existed) that `tsc`/`eslint` do not catch, since
 * neither checks `package.json` against the filesystem. Mirrors the identical check
 * `@forge/core/test/errors.test.ts` already established ("declares every exports subpath as a file
 * that exists") — not invented fresh here, the same shape reused for the same reason (`SPEC-QUESTIONS.md`
 * Q58).
 *
 * @see SPEC-QUESTIONS.md Q58
 * @see PLAN-M4.md P1
 */
import { describe, expect, it } from 'vitest';

describe('package.json exports', () => {
  it('declares every exports subpath as a file that exists', async () => {
    const manifest = (await import('../package.json', { with: { type: 'json' } })).default as {
      exports: Record<string, string>;
    };
    const { existsSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const packageDir = fileURLToPath(new URL('..', import.meta.url));

    expect(Object.keys(manifest.exports).length).toBeGreaterThan(0);
    for (const [subpath, target] of Object.entries(manifest.exports)) {
      expect(existsSync(new URL(target, `file://${packageDir}`)), `${subpath} -> ${target}`).toBe(
        true,
      );
    }
  });
});
