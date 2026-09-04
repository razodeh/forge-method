/**
 * The compensating coverage check `SPEC-QUESTIONS.md` Q17 promises.
 *
 * `vitest.config.ts` excludes `tools/eslint-plugin-forge-boundaries/src/**` from coverage entirely,
 * because measuring it inside the full suite is non-deterministic — proven there with two identical
 * runs producing different numbers for identical code. But exclusion alone left a real hole: nothing
 * enforced coverage on this plugin *at all*, so a future change to it — the very rules that enforce
 * `specs/02` §2.2's boundaries on everyone else — could add an untested branch and nothing in
 * `pnpm test`, `pnpm lint` or `pnpm typecheck` would say so. Verified during review: a planted dead
 * function in `locate.mjs` passed every floor command.
 *
 * This file is the fix: a second, narrowly-scoped coverage run, isolated to exactly the tests and
 * source this plugin owns — the scope `vitest.config.ts`'s own investigation proved trustworthy
 * (92-100% coverage, repeatably, whenever these six test files ran without the rest of the suite's
 * hundreds of other tests competing for forks). Real 85/80 thresholds apply here; nothing is
 * exempted. Run via `pnpm coverage:boundaries`, and as a required step of `pnpm test`.
 *
 * Not a `vitest.config.ts` inside the package itself: `test/workspace-floor.test.ts` asserts no
 * workspace package ships its own vitest config, so every package inherits one shared floor by
 * construction. This lives at the repo root instead, as a second, additional entry point — the
 * package still inherits nothing of its own.
 *
 * @see SPEC-QUESTIONS.md Q17
 * @see PLAN-M1.md P2
 */
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    setupFiles: ['./test/setup.ts'],
    globalSetup: ['./test/global-setup.ts'],
    pool: 'forks',
    // Isolated to this plugin's own tests on purpose — see the file header. Including anything else
    // reintroduces the scale at which the measurement becomes unreliable.
    include: ['tools/eslint-plugin-forge-boundaries/test/**/*.{test,spec}.ts'],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    restoreMocks: true,
    unstubGlobals: true,
    unstubEnvs: true,
    coverage: {
      provider: 'v8',
      reporter: ['text-summary'],
      reportsDirectory: 'coverage-boundaries',
      include: ['tools/eslint-plugin-forge-boundaries/src/**'],
      exclude: ['**/*.d.ts', '**/*.{test,spec}.?(c|m)[jt]s?(x)'],
      thresholds: {
        perFile: true,
        lines: 85,
        branches: 80,
        functions: 85,
        statements: 85,
      },
    },
  },
});
