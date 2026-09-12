/**
 * Real fixture-repository *content* for `adopt`'s own tests. Deliberately holds no temp-directory or
 * cleanup logic itself — `QUALITY-BAR.md` R10 restricts `node:os`'s `tmpdir` to files the test harness
 * itself pins (this is not one: it is imported by several `*.test.ts` files, so it is not covered by
 * the repo-wide "test files may reach the real clock/host/FS ordering directly" exemption, which
 * matches only `*.test.ts`/`*.spec.ts` filenames). Every `*.test.ts` file that uses this module
 * creates and tears down its own temp directory locally — the same `mkdtemp`-per-test pattern
 * `@forge/vcs`'s own `test/git.test.ts`/`test/commit.test.ts` already establish (`createTempRepo`,
 * duplicated per file there too) — and calls `populateFixture` to write these files into it. No git
 * repository is created anywhere in this module: `survey.ts`/`inventory.ts` never call git themselves
 * (see `survey.ts`'s own module doc comment and `SPEC-QUESTIONS.md` Q152), so a fixture exercising
 * them needs only real files on disk. The one signal that genuinely comes from git history
 * (`GitProfileFacts`) is supplied as a literal stub matching `@forge/vcs`'s own `GitProfile` shape;
 * that shape's *production* correctness against a real git history is `@forge/vcs`'s own
 * `test/git-profile.test.ts` responsibility, not this package's.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { GitProfileFacts } from '../../src/adopt/survey.ts';

export const STUB_GIT_PROFILE: GitProfileFacts = {
  hasCommits: true,
  ageDays: 42,
  commitCount: 7,
  contributorCount: 2,
  churnHotspots: [{ path: 'src/index.ts', commitCount: 5 }],
  filesChangedTogether: [{ paths: ['src/index.ts', 'src/routes.ts'], count: 3 }],
};

export const NO_COMMITS_GIT_PROFILE: GitProfileFacts = {
  hasCommits: false,
  ageDays: undefined,
  commitCount: 0,
  contributorCount: 0,
  churnHotspots: [],
  filesChangedTogether: [],
};

/** Writes `files` (a relative-path → contents map) under `dir`, which must already exist, creating
 * any parent directories the paths need. */
export async function populateFixture(
  dir: string,
  files: Readonly<Record<string, string>>,
): Promise<void> {
  for (const [relPath, contents] of Object.entries(files)) {
    const absPath = path.join(dir, relPath);
    await mkdir(path.dirname(absPath), { recursive: true });
    await writeFile(absPath, contents, 'utf8');
  }
}

/**
 * A real, small Node/Express-shaped fixture's file content, with deliberately known facts: exactly
 * the files listed below, at the byte-for-byte content given here, so every SURVEY/INVENTORY
 * assertion in the tests that use it is checkable by inspection of this one function.
 *
 * Known, load-bearing facts a test may assert against:
 * - `package.json`: `main: "src/index.js"`, `bin.fixture-cli: "src/cli.js"`,
 *   `scripts.start: "node src/index.js"`, one runtime dependency (`express`), one dev dependency
 *   (`vitest`).
 * - `src/index.ts` imports `./routes.ts` and `./cycle-a.ts`.
 * - `src/cycle-a.ts` and `src/cycle-b.ts` import each other — a genuine, deliberate cycle.
 * - `src/routes.ts` declares one `GET /health` route, one `POST /webhooks/stripe` route (named to
 *   trigger the `webhook` classification), reads `process.env.PORT` and
 *   `process.env['DATABASE_URL']`, and exports one symbol, `registerRoutes`.
 * - `src/db.ts` contains one real Postgres connection-string literal and exports `connect`.
 * - `migrations/0001_init.sql` — one migration file under a `migrations/` directory.
 * - `test/index.test.ts` — one file under a `test/` directory (an empty placeholder).
 * - `Dockerfile` — one `CMD` entry point.
 * - `.github/workflows/ci.yml` — two jobs, `build` (a `npm test` step) and `deploy` (a step whose
 *   `run` line does not match `/test/i`, so it contributes no `ciTestCommands` entry, only the
 *   `deploy`-named job itself, which the `ci-deploy-job` deployable-unit signal picks up).
 * - `README.md` — one doc signal.
 */
export function nodeFixtureFiles(): Readonly<Record<string, string>> {
  return {
    'package.json': JSON.stringify(
      {
        name: 'fixture-app',
        version: '1.0.0',
        main: 'src/index.js',
        bin: { 'fixture-cli': 'src/cli.js' },
        scripts: { start: 'node src/index.js', test: 'vitest' },
        dependencies: { express: '^4.18.0' },
        devDependencies: { vitest: '^1.0.0' },
      },
      null,
      2,
    ),
    'src/index.ts': [
      "import { registerRoutes } from './routes.ts';",
      "import { valueFromA } from './cycle-a.ts';",
      '',
      'export function startServer(): void {',
      '  registerRoutes();',
      '  valueFromA();',
      '}',
      '',
    ].join('\n'),
    'src/routes.ts': [
      "import { connect } from './db.ts';",
      '',
      'export function registerRoutes(): void {',
      "  app.get('/health', () => connect());",
      "  app.post('/webhooks/stripe', () => undefined);",
      '  const port = process.env.PORT;',
      "  const dbUrl = process.env['DATABASE_URL'];",
      '  void port;',
      '  void dbUrl;',
      '}',
      '',
    ].join('\n'),
    'src/db.ts': [
      "const CONNECTION_STRING = 'postgres://user:pass@localhost:5432/fixture_db';",
      '',
      'export function connect(): string {',
      '  return CONNECTION_STRING;',
      '}',
      '',
    ].join('\n'),
    'src/cycle-a.ts': [
      "import { valueFromB } from './cycle-b.ts';",
      '',
      'export function valueFromA(): number {',
      '  return valueFromB() + 1;',
      '}',
      '',
    ].join('\n'),
    'src/cycle-b.ts': [
      "import { valueFromA } from './cycle-a.ts';",
      '',
      'export function valueFromB(): number {',
      '  return 1;',
      '}',
      '',
      '// A real, deliberate reference back to cycle-a.ts, guarded so it never actually recurses at',
      '// runtime -- the point of this fixture is a real import edge, not a real infinite loop.',
      'export function unusedCallsA(flag: boolean): number {',
      '  return flag ? valueFromA() : 0;',
      '}',
      '',
    ].join('\n'),
    'migrations/0001_init.sql': 'CREATE TABLE users (id SERIAL PRIMARY KEY);\n',
    'test/index.test.ts': '// placeholder test file\n',
    Dockerfile: ['FROM node:20', 'CMD ["node", "src/index.js"]', ''].join('\n'),
    '.github/workflows/ci.yml': [
      'name: CI',
      'jobs:',
      '  build:',
      '    runs-on: ubuntu-latest',
      '    steps:',
      '      - run: npm test',
      '  deploy:',
      '    runs-on: ubuntu-latest',
      '    steps:',
      '      - run: npm run publish-release',
      '',
    ].join('\n'),
    'README.md': '# fixture-app\n',
  };
}

/**
 * A real, small Python fixture's file content — the "one other" toolchain `PLAN-M10.md` P15's own
 * Checks text requires alongside the Node fixture. Known facts: `pyproject.toml` names the `python`
 * toolchain; `app/main.py` is a plausible Flask-shaped entry point (not parsed for routes —
 * INVENTORY's public-API-surface extractor is JS/TS-only in this piece, see `inventory.ts`'s own
 * module doc comment); `requirements.txt` is intentionally absent so this fixture also proves
 * `pyproject.toml` alone is sufficient for manifest detection.
 */
export function pythonFixtureFiles(): Readonly<Record<string, string>> {
  return {
    'pyproject.toml': ['[project]', 'name = "fixture-py-app"', 'version = "0.1.0"', ''].join('\n'),
    'app/main.py': [
      'import os',
      '',
      'DATABASE_URL = os.environ.get("DATABASE_URL")',
      '',
      'def main():',
      '    print("hello")',
      '',
    ].join('\n'),
    'tests/test_main.py': '# placeholder\n',
  };
}
