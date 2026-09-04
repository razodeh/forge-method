/**
 * Enforces the coverage ratchet.
 *
 * `specs/13` F-TEST-5 and `QUALITY-BAR.md` §3 make coverage ratchet-only: it may rise and may never
 * fall. The per-file thresholds in `vitest.config.ts` are a *floor* — they stop coverage dropping
 * below 90/85, and do nothing about a package sliding from 99% to 91%. This closes that, by
 * recording what each package actually achieved and failing when a later run comes in under it.
 *
 * Until this existed the ratchet was a sentence in a comment. `QUALITY-BAR.md` §3 names lowering a
 * threshold as a review failure in itself, which is only meaningful if something detects it.
 *
 * Usage:
 *   node scripts/check-coverage-ratchet.mjs           # verify, exit 1 on a regression
 *   node scripts/check-coverage-ratchet.mjs --update  # raise the marks to what this run achieved
 *
 * @see specs/13 F-TEST-5
 */
import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { evaluateRatchet, packageTotals } from './lib/coverage-ratchet.mjs';

// The working directory, not the script's location: pnpm always runs a script from the workspace
// root, and resolving from `import.meta.url` would make this command untestable against a fixture
// tree — which is how its plumbing went unexercised.
// `realpathSync` because the coverage summary records real paths while `cwd()` may be a symlink —
// on macOS `/var` is a link to `/private/var`, and the mismatch silently produced `../../..` keys
// that matched no package, so every regression went unreported.
const repoRoot = realpathSync(process.cwd());
const summaryPath = path.join(repoRoot, 'coverage', 'coverage-summary.json');
const marksPath = path.join(repoRoot, 'coverage-ratchet.json');

/** @returns {Record<string, Record<string, number>>} */
function readMarks() {
  if (!existsSync(marksPath)) return {};
  return JSON.parse(readFileSync(marksPath, 'utf8'));
}

function main() {
  const update = process.argv.includes('--update');

  if (!existsSync(summaryPath)) {
    // The suite runs without coverage in watch mode and for single-file runs. Doing nothing is right
    // there; failing would make the ordinary inner loop unusable.
    return 0;
  }

  const achieved = packageTotals(JSON.parse(readFileSync(summaryPath, 'utf8')), repoRoot);
  const { regressions, raised, next } = evaluateRatchet(achieved, readMarks());

  if (regressions.length > 0) {
    console.error('Coverage ratchet: coverage went backwards (specs/13 F-TEST-5).\n');
    for (const regression of regressions) console.error(`  - ${regression}`);
    console.error(
      '\nAdd tests for what you changed. If the drop is legitimate — code deleted, a package ' +
        'split — re-run with --update and say why in the commit message.',
    );
    return 1;
  }

  if (update) {
    writeFileSync(marksPath, `${JSON.stringify(next, null, 2)}\n`);
    return 0;
  }

  // Not written without --update: a check that edits the file it checks against always passes.
  if (raised.length > 0) {
    console.error(
      `Coverage ratchet: ${String(raised.length)} mark(s) can be raised. ` +
        'Run `pnpm coverage:ratchet -- --update` and commit the result.',
    );
  }
  return 0;
}

process.exitCode = main();
