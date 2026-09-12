/**
 * `runSurvey` against real fixture repositories — `PLAN-M10.md` P15's own Checks text: SURVEY's
 * output must match a fixture's real, known facts exactly, and the size-threshold gate must fire
 * against a synthetically oversized fixture.
 *
 * @see specs/17 §17.2
 * @see PLAN-M10.md P15
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { DEFAULT_SIZE_THRESHOLDS, runSurvey } from '../../src/adopt/survey.ts';
import { walkRepository } from '../../src/adopt/walk.ts';
import {
  NO_COMMITS_GIT_PROFILE,
  nodeFixtureFiles,
  populateFixture,
  pythonFixtureFiles,
  STUB_GIT_PROFILE,
} from './fixtures.ts';

const cleanupDirs: string[] = [];

afterEach(async () => {
  await Promise.all(cleanupDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

/** Creates a fresh temp directory and populates it with `files` — the same `mkdtemp`-per-test
 * pattern `@forge/vcs`'s own `test/git.test.ts`'s `createTempRepo` establishes, applied to a
 * fixture's source layout rather than its git state. */
async function makeFixtureDir(
  prefix: string,
  files: Readonly<Record<string, string>>,
): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  cleanupDirs.push(dir);
  await populateFixture(dir, files);
  return dir;
}

describe('runSurvey — Node fixture, exact known facts', () => {
  it('reports the exact file/language size profile', async () => {
    const rootDir = await makeFixtureDir('forge-kb-adopt-node-', nodeFixtureFiles());
    const { survey } = await runSurvey({ rootDir, gitProfile: STUB_GIT_PROFILE });

    expect(survey.size.totalFiles).toBe(11);
    // 6 `.ts` files: src/index.ts (8 lines), src/routes.ts (11), src/db.ts (6), src/cycle-a.ts (6),
    // src/cycle-b.ts (12), test/index.test.ts (2) — each derived from `fixtures.ts`'s own literal
    // content, split on '\n' (trailing newline counted, matching `runSurvey`'s own line-count rule).
    expect(survey.size.byLanguage).toEqual([{ language: 'TypeScript', files: 6, lines: 45 }]);
  });

  it('detects the node manifest and no others', async () => {
    const rootDir = await makeFixtureDir('forge-kb-adopt-node-', nodeFixtureFiles());
    const { survey } = await runSurvey({ rootDir, gitProfile: STUB_GIT_PROFILE });
    expect(survey.manifests).toEqual([{ toolchain: 'node', path: 'package.json' }]);
  });

  it('extracts package.json main/bin/start, and the Dockerfile CMD, as entry points', async () => {
    const rootDir = await makeFixtureDir('forge-kb-adopt-node-', nodeFixtureFiles());
    const { survey } = await runSurvey({ rootDir, gitProfile: STUB_GIT_PROFILE });

    expect(survey.entryPoints).toEqual(
      expect.arrayContaining([
        { kind: 'package-main', path: 'package.json', value: 'src/index.js' },
        { kind: 'package-bin', path: 'package.json', value: 'fixture-cli: src/cli.js' },
        { kind: 'package-script', path: 'package.json', value: 'node src/index.js' },
        { kind: 'dockerfile-cmd', path: 'Dockerfile', value: '["node", "src/index.js"]' },
      ]),
    );
    expect(survey.entryPoints).toHaveLength(4);
  });

  it('finds the Dockerfile and the CI deploy job as deployable units', async () => {
    const rootDir = await makeFixtureDir('forge-kb-adopt-node-', nodeFixtureFiles());
    const { survey } = await runSurvey({ rootDir, gitProfile: STUB_GIT_PROFILE });

    expect(survey.deployableUnits).toEqual(
      expect.arrayContaining([
        { kind: 'dockerfile', path: 'Dockerfile', name: 'Dockerfile' },
        { kind: 'ci-deploy-job', path: '.github/workflows/ci.yml', name: 'deploy' },
      ]),
    );
    expect(survey.deployableUnits).toHaveLength(2);
  });

  it('finds the real Postgres connection string and the migrations directory', async () => {
    const rootDir = await makeFixtureDir('forge-kb-adopt-node-', nodeFixtureFiles());
    const { survey } = await runSurvey({ rootDir, gitProfile: STUB_GIT_PROFILE });

    expect(survey.datastores).toEqual(
      expect.arrayContaining([
        {
          kind: 'connection-string',
          path: 'src/db.ts',
          evidence: 'postgres://user:pass@localhost:5432/fixture_db',
        },
        { kind: 'migrations-dir', path: 'migrations', evidence: 'migrations' },
      ]),
    );
    expect(survey.datastores).toHaveLength(2);
  });

  it('finds the test/ directory and the one CI step whose run line mentions "test"', async () => {
    const rootDir = await makeFixtureDir('forge-kb-adopt-node-', nodeFixtureFiles());
    const { survey } = await runSurvey({ rootDir, gitProfile: STUB_GIT_PROFILE });

    expect(survey.testSetup.testDirs).toEqual(['test']);
    expect(survey.testSetup.ciTestCommands).toEqual(['npm test']);
  });

  it('finds the GitHub Actions workflow with both real jobs', async () => {
    const rootDir = await makeFixtureDir('forge-kb-adopt-node-', nodeFixtureFiles());
    const { survey } = await runSurvey({ rootDir, gitProfile: STUB_GIT_PROFILE });

    expect(survey.ci).toEqual([
      { system: 'github-actions', path: '.github/workflows/ci.yml', jobs: ['build', 'deploy'] },
    ]);
  });

  it('finds the README as an existing doc', async () => {
    const rootDir = await makeFixtureDir('forge-kb-adopt-node-', nodeFixtureFiles());
    const { survey } = await runSurvey({ rootDir, gitProfile: STUB_GIT_PROFILE });
    expect(survey.existingDocs).toEqual([{ kind: 'readme', path: 'README.md' }]);
  });

  it('passes the supplied git profile through unchanged', async () => {
    const rootDir = await makeFixtureDir('forge-kb-adopt-node-', nodeFixtureFiles());
    const { survey } = await runSurvey({ rootDir, gitProfile: STUB_GIT_PROFILE });
    expect(survey.gitProfile).toEqual(STUB_GIT_PROFILE);
  });

  it('does not trigger the size gate for a small fixture', async () => {
    const rootDir = await makeFixtureDir('forge-kb-adopt-node-', nodeFixtureFiles());
    const { gate } = await runSurvey({ rootDir, gitProfile: STUB_GIT_PROFILE });
    expect(gate).toEqual({ triggered: false, proposal: undefined });
  });
});

describe('runSurvey — Python fixture (the second toolchain)', () => {
  it('detects the python manifest via pyproject.toml alone', async () => {
    const rootDir = await makeFixtureDir('forge-kb-adopt-python-', pythonFixtureFiles());
    const { survey } = await runSurvey({ rootDir, gitProfile: NO_COMMITS_GIT_PROFILE });
    expect(survey.manifests).toEqual([{ toolchain: 'python', path: 'pyproject.toml' }]);
    expect(survey.size.byLanguage).toEqual([{ language: 'Python', files: 2, lines: 9 }]);
    expect(survey.testSetup.testDirs).toEqual(['tests']);
  });

  it('reports a repository with no commits without throwing', async () => {
    const rootDir = await makeFixtureDir('forge-kb-adopt-python-', pythonFixtureFiles());
    const { survey } = await runSurvey({ rootDir, gitProfile: NO_COMMITS_GIT_PROFILE });
    expect(survey.gitProfile.hasCommits).toBe(false);
    expect(survey.gitProfile.ageDays).toBeUndefined();
  });
});

describe('runSurvey — serverless entry points, negative compose/k8s, and dedup', () => {
  it('finds every function in a real serverless.yml', async () => {
    const rootDir = await makeFixtureDir('forge-kb-adopt-serverless-', {
      'serverless.yml': [
        'service: fixture-service',
        'functions:',
        '  hello:',
        '    handler: handler.hello',
        '  goodbye:',
        '    handler: handler.goodbye',
        '',
      ].join('\n'),
    });
    const { survey } = await runSurvey({ rootDir, gitProfile: NO_COMMITS_GIT_PROFILE });

    expect(survey.entryPoints).toEqual(
      expect.arrayContaining([
        { kind: 'serverless-function', path: 'serverless.yml', value: 'hello' },
        { kind: 'serverless-function', path: 'serverless.yml', value: 'goodbye' },
      ]),
    );
  });

  it('finds no compose services in a compose file that declares none', async () => {
    const rootDir = await makeFixtureDir('forge-kb-adopt-compose-empty-', {
      'docker-compose.yml': 'version: "3"\n',
    });
    const { survey } = await runSurvey({ rootDir, gitProfile: NO_COMMITS_GIT_PROFILE });
    expect(survey.deployableUnits.filter((unit) => unit.kind === 'compose-service')).toEqual([]);
  });

  it('does not classify a yaml file with an unrelated "kind" as a k8s manifest', async () => {
    const rootDir = await makeFixtureDir('forge-kb-adopt-not-k8s-', {
      'thing.yaml': 'kind: SomethingElse\nname: not-a-k8s-object\n',
    });
    const { survey } = await runSurvey({ rootDir, gitProfile: NO_COMMITS_GIT_PROFILE });
    expect(survey.deployableUnits.filter((unit) => unit.kind === 'k8s-manifest')).toEqual([]);
  });

  it('records only one migrations-dir signal for a directory with two migration files', async () => {
    const rootDir = await makeFixtureDir('forge-kb-adopt-two-migrations-', {
      'migrations/0001_init.sql': 'CREATE TABLE a (id INT);\n',
      'migrations/0002_add_b.sql': 'CREATE TABLE b (id INT);\n',
    });
    const { survey } = await runSurvey({ rootDir, gitProfile: NO_COMMITS_GIT_PROFILE });
    expect(survey.datastores.filter((signal) => signal.kind === 'migrations-dir')).toEqual([
      { kind: 'migrations-dir', path: 'migrations', evidence: 'migrations' },
    ]);
  });

  it('skips a package.json and a Dockerfile too large to read, without crashing', async () => {
    const filler = `// ${'x'.repeat(210_000)}\n`;
    const rootDir = await makeFixtureDir('forge-kb-adopt-oversized-files-', {
      'package.json': `${filler}${JSON.stringify({ main: 'index.js' })}`,
      Dockerfile: `${filler}CMD ["node", "index.js"]\n`,
    });
    const { survey } = await runSurvey({ rootDir, gitProfile: NO_COMMITS_GIT_PROFILE });
    expect(survey.entryPoints).toEqual([]);
  });
});

describe('runSurvey — health signals', () => {
  it('detects unresolved-work marker density, lint config, and type-check config presence', async () => {
    const rootDir = await makeFixtureDir('forge-kb-adopt-health-', {
      'tsconfig.json': '{}\n',
      '.eslintrc.json': '{}\n',
      'src/a.ts': [
        '// TODO: fix this later',
        '// FIXME: also this',
        'export const x = 1;',
        '',
      ].join('\n'),
    });
    const { survey } = await runSurvey({ rootDir, gitProfile: NO_COMMITS_GIT_PROFILE });

    expect(survey.health).toEqual({
      todoFixmeCount: 2,
      lintConfigPresent: true,
      typeCheckConfigPresent: true,
    });
  });

  it('reports no lint/type-check config and zero markers for a fixture with neither', async () => {
    const rootDir = await makeFixtureDir('forge-kb-adopt-health-clean-', {
      'src/a.ts': 'export const x = 1;\n',
    });
    const { survey } = await runSurvey({ rootDir, gitProfile: NO_COMMITS_GIT_PROFILE });

    expect(survey.health).toEqual({
      todoFixmeCount: 0,
      lintConfigPresent: false,
      typeCheckConfigPresent: false,
    });
  });
});

describe('runSurvey — CI systems other than GitHub Actions', () => {
  it('detects each of the five other named CI systems by their real, distinct files', async () => {
    const rootDir = await makeFixtureDir('forge-kb-adopt-ci-systems-', {
      '.gitlab-ci.yml': 'jobs:\n  test:\n    script: npm test\n',
      '.circleci/config.yml': 'jobs:\n  build:\n    steps: []\n',
      Jenkinsfile: 'pipeline { agent any }\n',
      '.travis.yml': 'language: node_js\n',
      'azure-pipelines.yml': 'jobs:\n  - job: Build\n',
    });
    const { survey } = await runSurvey({ rootDir, gitProfile: NO_COMMITS_GIT_PROFILE });

    const bySystem = new Map(survey.ci.map((signal) => [signal.system, signal.path]));
    expect(bySystem.get('gitlab-ci')).toBe('.gitlab-ci.yml');
    expect(bySystem.get('circleci')).toBe('.circleci/config.yml');
    expect(bySystem.get('jenkins')).toBe('Jenkinsfile');
    expect(bySystem.get('travis')).toBe('.travis.yml');
    expect(bySystem.get('azure-pipelines')).toBe('azure-pipelines.yml');
    expect(survey.ci).toHaveLength(5);
  });
});

describe('runSurvey — test frameworks', () => {
  it('detects vitest, jest, pytest, go test, and rspec markers', async () => {
    const rootDir = await makeFixtureDir('forge-kb-adopt-frameworks-', {
      'vitest.config.ts': 'export default {};\n',
      'jest.config.js': 'module.exports = {};\n',
      'pytest.ini': '[pytest]\n',
      'pkg/thing_test.go': 'package pkg\n',
      '.rspec': '--color\n',
    });
    const { survey } = await runSurvey({ rootDir, gitProfile: NO_COMMITS_GIT_PROFILE });

    expect(survey.testSetup.frameworks).toEqual(['go-test', 'jest', 'pytest', 'rspec', 'vitest']);
  });
});

describe('runSurvey — deployable units: compose and k8s', () => {
  it('finds every compose service and a k8s Deployment manifest by its real kind/name', async () => {
    const rootDir = await makeFixtureDir('forge-kb-adopt-deploy-', {
      'docker-compose.yml': 'services:\n  web:\n    image: nginx\n  db:\n    image: postgres\n',
      'k8s/deployment.yaml': [
        'apiVersion: apps/v1',
        'kind: Deployment',
        'metadata:',
        '  name: my-app',
        'spec: {}',
        '',
      ].join('\n'),
    });
    const { survey } = await runSurvey({ rootDir, gitProfile: NO_COMMITS_GIT_PROFILE });

    expect(survey.deployableUnits).toEqual(
      expect.arrayContaining([
        { kind: 'compose-service', path: 'docker-compose.yml', name: 'web' },
        { kind: 'compose-service', path: 'docker-compose.yml', name: 'db' },
        { kind: 'k8s-manifest', path: 'k8s/deployment.yaml', name: 'my-app' },
      ]),
    );
  });
});

describe('runSurvey — docs: changelog and ADR directory', () => {
  it('finds CHANGELOG.md, a docs/ directory, and a docs/adr directory', async () => {
    const rootDir = await makeFixtureDir('forge-kb-adopt-docs-', {
      'CHANGELOG.md': '# Changelog\n',
      'docs/adr/0001-use-postgres.md': '# ADR 1\n',
    });
    const { survey } = await runSurvey({ rootDir, gitProfile: NO_COMMITS_GIT_PROFILE });

    expect(survey.existingDocs).toEqual(
      expect.arrayContaining([
        { kind: 'changelog', path: 'CHANGELOG.md' },
        { kind: 'docs-dir', path: 'docs' },
        { kind: 'adr', path: 'docs/adr' },
      ]),
    );
  });
});

describe('runSurvey — datastores: a literal .env file', () => {
  it('finds a connection string in a bare .env file, which extensionOf alone cannot classify', async () => {
    const rootDir = await makeFixtureDir('forge-kb-adopt-dotenv-datastore-', {
      '.env': 'DATABASE_URL=postgres://localhost:5432/app\n',
    });
    const { survey } = await runSurvey({ rootDir, gitProfile: NO_COMMITS_GIT_PROFILE });

    expect(survey.datastores).toEqual(
      expect.arrayContaining([
        { kind: 'connection-string', path: '.env', evidence: 'postgres://localhost:5432/app' },
      ]),
    );
  });
});

describe('runSurvey — accepts a pre-computed walk', () => {
  it('uses the supplied files list instead of walking rootDir again', async () => {
    const rootDir = await makeFixtureDir('forge-kb-adopt-shared-walk-', { 'README.md': '# hi\n' });
    const files = await walkRepository(rootDir);
    // Removed from disk *after* the walk: if runSurvey walked again itself, this fact would vanish.
    // Supplying the already-computed `files` list must make it survive.
    await rm(path.join(rootDir, 'README.md'));

    const { survey } = await runSurvey({ rootDir, gitProfile: NO_COMMITS_GIT_PROFILE, files });
    expect(survey.existingDocs).toEqual([{ kind: 'readme', path: 'README.md' }]);
  });
});

describe('runSurvey — size-threshold gate', () => {
  it('proposes a scoped adoption when a manifest-rooted subproject exists, using custom thresholds', async () => {
    const rootDir = await makeFixtureDir('forge-kb-adopt-scoped-', {
      'services/api/package.json': JSON.stringify({ name: 'api' }),
      'services/api/src/index.ts': 'export const a = 1;\n',
      'services/worker/package.json': JSON.stringify({ name: 'worker' }),
      'services/worker/src/index.ts': 'export const b = 1;\n',
    });

    const { gate } = await runSurvey({
      rootDir,
      gitProfile: NO_COMMITS_GIT_PROFILE,
      sizeThresholds: { maxFiles: 2 },
    });

    expect(gate.triggered).toBe(true);
    expect(gate.proposal?.suggestedScopes).toEqual(['services/api', 'services/worker']);
  });

  it('fires against a genuinely oversized fixture under the real default thresholds', async () => {
    const dir = await makeFixtureDir('forge-kb-adopt-oversized-', {});
    const fileCount = DEFAULT_SIZE_THRESHOLDS.maxFiles + 1;
    await mkdir(path.join(dir, 'many'), { recursive: true });
    await Promise.all(
      Array.from({ length: fileCount }, (_, i) =>
        writeFile(path.join(dir, 'many', `f${String(i)}.txt`), 'x'),
      ),
    );

    const { survey, gate } = await runSurvey({ rootDir: dir, gitProfile: NO_COMMITS_GIT_PROFILE });

    expect(survey.size.totalFiles).toBe(fileCount);
    expect(gate.triggered).toBe(true);
    expect(gate.proposal?.reason).toContain('exceeding the configured threshold');
    // No manifest anywhere in this fixture, so the fallback (largest top-level dirs) applies.
    expect(gate.proposal?.suggestedScopes).toEqual(['many']);
  }, 30_000);
});
