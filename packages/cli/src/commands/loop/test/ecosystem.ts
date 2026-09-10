/**
 * `detectEcosystem` — a real filesystem probe deciding which of the two `09` §9.5 AC-binding
 * conventions/reporter formats `runAndNormalize` (`reporter.ts`) should use. Never guesses from a
 * source-file extension alone: a real project can have `.ts` fixtures inside a Python-tooled repo or
 * vice versa, but `package.json`/`pyproject.toml`/`pytest.ini`/`setup.cfg` are each a real,
 * unambiguous declaration of which test tooling the project itself actually runs.
 *
 * @see specs/09 §9.5
 * @see PLAN-M8.md P3
 */
import { pathExists } from '@forge/core/fs';
import type { ProjectPaths } from '@forge/core/fs';

/** `'unknown'` is a real, honest outcome — a project using a third test runner (Jest, `go test`, a
 * shell script) this probe cannot classify. `runAndNormalize` (`reporter.ts`) deliberately does not
 * accept it: resolving what to do about an unrecognised ecosystem is this type's own caller's
 * decision (the `forge test run` CLI layer, `PLAN-M8.md` P4), not something to guess through. */
export type Ecosystem = 'js' | 'python' | 'unknown';

const PYTHON_MARKERS = ['pyproject.toml', 'pytest.ini', 'setup.cfg'];

/** `js` wins when both a `package.json` and a Python marker exist (a monorepo with a small Python
 * tool alongside its own real JS/TS test suite is real and ordinary; the reverse — a Python project
 * with an incidental `package.json` for, say, a linter config — is not this probe's problem to
 * solve, since `testCommands` is what actually decides which command runs regardless). */
export async function detectEcosystem(paths: ProjectPaths): Promise<Ecosystem> {
  if (await pathExists(paths.resolveWithin('package.json'))) return 'js';
  for (const marker of PYTHON_MARKERS) {
    if (await pathExists(paths.resolveWithin(marker))) return 'python';
  }
  return 'unknown';
}
