/**
 * Global test setup, applied to every test file in the workspace.
 *
 * Everything here removes a source of non-determinism `specs/21` §21.1 names: timezone, locale, git
 * behaviour, and outbound network. Every statement is top-level rather than in a `beforeAll` hook,
 * because a hook runs *after* the test file and its transitive imports have been evaluated — a
 * module that fetches at import time would slip past a hook-installed guard, and that is precisely
 * the class of accidental network dependency §21.1 exists to catch.
 *
 * @see specs/21 §21.1
 */
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// The guard installs itself on load in whichever realm loads it; `hasGuardImport` is reused here so
// the entry-point rail and the injection check cannot drift apart.
import { hasGuardImport } from './network-guard.mjs';

/**
 * A fixed instant used for git author and committer dates. Chosen to match the spec pack's own
 * example dates so fixtures and documentation agree; any fixed value would do, a moving one would
 * not.
 */
const PINNED_GIT_DATE = '2026-03-04T00:00:00+0000';

process.env['TZ'] = 'UTC';

// Locale is deliberately not asserted here. `scripts/run-tests.mjs` sets LC_ALL/LANG, which works on
// POSIX but not on Windows, where ICU reads the system locale and ignores both — so an assertion
// would pass on the CI Windows legs by luck and throw on a non-English developer machine with a
// message pointing at the wrong cause. The actual guarantee is that nothing depends on ambient
// locale: `eslint.config.js` forbids `localeCompare`, `toLocale*` and `Intl.*` without an explicit
// locale, and `test/lint-rules.test.ts` proves those rules fire. See SPEC-QUESTIONS.md Q10.

process.env['GIT_AUTHOR_NAME'] = 'FORGE Test';
process.env['GIT_AUTHOR_EMAIL'] = 'test@forge.invalid';
process.env['GIT_AUTHOR_DATE'] = PINNED_GIT_DATE;
process.env['GIT_COMMITTER_NAME'] = 'FORGE Test';
process.env['GIT_COMMITTER_EMAIL'] = 'test@forge.invalid';
process.env['GIT_COMMITTER_DATE'] = PINNED_GIT_DATE;

// Supplied by `test/global-setup.ts`, which owns the file's lifetime: this module runs inside a pool
// fork that vitest terminates, so a cleanup registered here would never run.
const emptyGitConfig = process.env['FORGE_TEST_GITCONFIG'];
if (emptyGitConfig === undefined) {
  throw new Error('FORGE_TEST_GITCONFIG is unset; test/global-setup.ts did not run.');
}
process.env['GIT_CONFIG_GLOBAL'] = emptyGitConfig;
process.env['GIT_CONFIG_SYSTEM'] = emptyGitConfig;
process.env['GIT_CONFIG_NOSYSTEM'] = '1';

// A non-Node child — git is one — is outside the in-process guard, which covers Node children.
// Denying git every credential source means a test that accidentally addresses a remote fails
// immediately instead of blocking on a password prompt until the CI job's timeout.
// See SPEC-QUESTIONS.md Q12.
process.env['GIT_TERMINAL_PROMPT'] = '0';
process.env['GIT_ASKPASS'] = 'echo';
process.env['GIT_SSH_COMMAND'] = 'ssh -o BatchMode=yes -o StrictHostKeyChecking=no';

// `scripts/run-tests.mjs` is the only supported entry point: worker threads and child processes are
// only guarded because it puts the guard into NODE_OPTIONS before Node starts, which no setup file
// can do. Failing here turns "one confusing test failure" into one actionable message for the run.
// Uses the guard's own check rather than a second copy: the weaker copies here and there drifted,
// and a `--title <guardUrl>` in NODE_OPTIONS suppressed this rail while leaving workers and child
// processes unguarded.
const guardUrl = pathToFileURL(path.join(import.meta.dirname, 'network-guard.mjs')).href;
if (!hasGuardImport(process.env['NODE_OPTIONS'], guardUrl)) {
  throw new Error(
    'Run the suite with `pnpm test`, not `vitest` directly: the network guard (specs/21 §21.1) is ' +
      'delivered to worker threads and child processes through NODE_OPTIONS by ' +
      'scripts/run-tests.mjs, and cannot be installed from a setup file.',
  );
}
