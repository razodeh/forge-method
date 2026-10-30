/**
 * `detectTestRunners` (`13` F-TEST-11's "Detection" paragraph) -- real fixture projects on disk, one
 * per recognised runner/language, proposing the expected structured config; an unrecognised or
 * hand-off-only ecosystem hands off (`confident: false`) rather than guessing.
 *
 * @see specs/13 F-TEST-11
 * @see specs/22 M17 P6
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { ProjectPaths } from '@forge/core/fs';
import { afterEach, describe, expect, it } from 'vitest';

import { detectTestRunners } from '../../../../src/commands/loop/test/detect.ts';

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'forge-detect-'));
  dirs.push(dir);
  return dir;
}

async function write(dir: string, relative: string, content: string): Promise<void> {
  const target = path.join(dir, relative);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content, 'utf8');
}

describe('detectTestRunners -- JavaScript/TypeScript, package.json (specs/22 M17 P6)', () => {
  it('a real vitest devDependency proposes vitest-json over stdout', async () => {
    const dir = await tempDir();
    await write(
      dir,
      'package.json',
      JSON.stringify({ name: 'fixture', devDependencies: { vitest: '^2.0.0' } }),
    );
    const [candidate] = await detectTestRunners(new ProjectPaths(dir));
    expect(candidate).toMatchObject({
      ecosystem: 'javascript',
      runner: 'vitest',
      confident: true,
      layer: 'unit',
    });
    expect(candidate?.command).toMatchObject({
      run: 'npx vitest run --reporter=json',
      output: { source: 'stdout' },
      format: 'vitest-json',
    });
  });

  it('a real jest devDependency proposes jest-json over stdout', async () => {
    const dir = await tempDir();
    await write(
      dir,
      'package.json',
      JSON.stringify({ name: 'fixture', devDependencies: { jest: '29' } }),
    );
    const [candidate] = await detectTestRunners(new ProjectPaths(dir));
    expect(candidate).toMatchObject({ runner: 'jest', confident: true });
    expect(candidate?.command).toMatchObject({ run: 'npx jest --json', format: 'jest-json' });
  });

  it('a real mocha devDependency proposes its own built-in tap reporter', async () => {
    const dir = await tempDir();
    await write(
      dir,
      'package.json',
      JSON.stringify({ name: 'fixture', devDependencies: { mocha: '10' } }),
    );
    const [candidate] = await detectTestRunners(new ProjectPaths(dir));
    expect(candidate).toMatchObject({ runner: 'mocha', confident: true });
    expect(candidate?.command).toMatchObject({ run: 'npx mocha --reporter tap', format: 'tap' });
  });

  it('a "scripts.test" that already runs "node --test" proposes it with --test-reporter=tap pinned explicitly, needing no dependency', async () => {
    const dir = await tempDir();
    await write(
      dir,
      'package.json',
      JSON.stringify({ name: 'fixture', scripts: { test: 'node --test test/' } }),
    );
    const [candidate] = await detectTestRunners(new ProjectPaths(dir));
    expect(candidate).toMatchObject({ runner: 'node-test', confident: true });
    // `--test-reporter=tap` is pinned explicitly, never left to Node's own default-reporter
    // auto-selection -- a real investigation confirmed live that this default is version-dependent
    // (Node 22 defaults to TAP against a non-TTY stdout; Node 24 defaults to the human-readable
    // "spec" reporter instead), which this repo's own TAP parser cannot read at all.
    expect(candidate?.command).toMatchObject({
      run: 'node --test --test-reporter=tap',
      format: 'tap',
    });
  });

  it('vitest wins over jest when both are declared -- the first checked, deterministically', async () => {
    const dir = await tempDir();
    await write(
      dir,
      'package.json',
      JSON.stringify({ name: 'fixture', devDependencies: { vitest: '2', jest: '29' } }),
    );
    const [candidate] = await detectTestRunners(new ProjectPaths(dir));
    expect(candidate?.runner).toBe('vitest');
  });

  it('a real "scripts.test" naming jest wins over a vitest devDependency when both are installed (a mid-migration project) -- a fresh critic round\'s own repro', async () => {
    const dir = await tempDir();
    await write(
      dir,
      'package.json',
      JSON.stringify({
        name: 'fixture',
        devDependencies: { vitest: '2', jest: '29' },
        scripts: { test: 'jest --coverage' },
      }),
    );
    const [candidate] = await detectTestRunners(new ProjectPaths(dir));
    expect(candidate).toMatchObject({ runner: 'jest', confident: true });
    expect(candidate?.reason).toContain('scripts.test');
  });

  it('"scripts.test" naming a tool with no matching dependency falls back to dependency presence, not a guess', async () => {
    const dir = await tempDir();
    await write(
      dir,
      'package.json',
      JSON.stringify({
        name: 'fixture',
        devDependencies: { vitest: '2' },
        // "jest" appears in the script text, but nothing actually installed it -- proposing a jest
        // command here would be a guess that cannot run.
        scripts: { test: 'jest --coverage' },
      }),
    );
    const [candidate] = await detectTestRunners(new ProjectPaths(dir));
    expect(candidate).toMatchObject({ runner: 'vitest', confident: true });
  });

  it('a package.json naming no recognised runner hands off, naming what it checked', async () => {
    const dir = await tempDir();
    await write(
      dir,
      'package.json',
      JSON.stringify({ name: 'fixture', devDependencies: { tape: '5' } }),
    );
    const [candidate] = await detectTestRunners(new ProjectPaths(dir));
    expect(candidate).toMatchObject({ ecosystem: 'javascript', confident: false });
    expect(candidate?.reason).toContain('no recognised test runner');
  });

  it('malformed package.json JSON hands off rather than throwing', async () => {
    const dir = await tempDir();
    await write(dir, 'package.json', '{ not valid json');
    const [candidate] = await detectTestRunners(new ProjectPaths(dir));
    expect(candidate).toMatchObject({ ecosystem: 'javascript', confident: false });
    expect(candidate?.reason).toContain('not valid JSON');
  });

  it('a workspaces monorepo root with no usable root test command hands off by that specific name, not "none"', async () => {
    const dir = await tempDir();
    await write(
      dir,
      'package.json',
      JSON.stringify({ name: 'fixture', workspaces: ['packages/*'] }),
    );
    const [candidate] = await detectTestRunners(new ProjectPaths(dir));
    expect(candidate).toMatchObject({ ecosystem: 'workspace-no-root-command', confident: false });
  });

  it('a workspaces monorepo whose OWN root script aggregates a real runner is still detected directly', async () => {
    const dir = await tempDir();
    await write(
      dir,
      'package.json',
      JSON.stringify({
        name: 'fixture',
        workspaces: ['packages/*'],
        devDependencies: { vitest: '2' },
      }),
    );
    const [candidate] = await detectTestRunners(new ProjectPaths(dir));
    expect(candidate).toMatchObject({ runner: 'vitest', confident: true });
  });
});

describe('detectTestRunners -- Python (specs/22 M17 P21)', () => {
  // `13` F-TEST-11's own live-discovered gap (`specs/22` M17 P21): a real, fresh `pyproject.toml`
  // with ONLY `[project]`/`[build-system]` packaging boilerplate -- standard metadata every modern
  // Python package needs, regardless of whether it has a single test -- used to be staged
  // `confident: true` for pytest on the marker's bare existence alone. A real run of the exact
  // detected command against that exact fixture collected 0 items; this describe block proves the
  // fix, not just asserts it.
  it.each(['pyproject.toml', 'setup.cfg', 'tox.ini'])(
    '%s existing ALONE, with no real pytest evidence, hands off rather than staging a false-confident match (specs/22 M17 P21)',
    async (marker) => {
      const dir = await tempDir();
      await write(dir, marker, '# fixture -- no pytest config, dependency, or test file at all\n');
      const [candidate] = await detectTestRunners(new ProjectPaths(dir));
      expect(candidate).toMatchObject({ ecosystem: 'python', confident: false });
      expect(candidate?.runner).toBeUndefined();
      expect(candidate?.command).toBeUndefined();
      expect(candidate?.reason).toContain('declares no real pytest configuration');
    },
  );

  it('pyproject.toml\'s own "[tool.pytest.ini_options]" table is real evidence -- confident pytest (specs/22 M17 P21)', async () => {
    const dir = await tempDir();
    await write(
      dir,
      'pyproject.toml',
      '[project]\nname = "fixture"\n\n[tool.pytest.ini_options]\ntestpaths = ["tests"]\n',
    );
    const [candidate] = await detectTestRunners(new ProjectPaths(dir));
    expect(candidate).toMatchObject({ ecosystem: 'python', runner: 'pytest', confident: true });
    expect(candidate?.command).toMatchObject({ format: 'junit-xml', output: { source: 'file' } });
    expect(candidate?.reason).toContain('pyproject.toml itself declares pytest');
  });

  it('pyproject.toml declaring a real "pytest" dependency under "[project.optional-dependencies]" is real evidence (specs/22 M17 P21)', async () => {
    const dir = await tempDir();
    await write(
      dir,
      'pyproject.toml',
      '[project]\nname = "fixture"\ndependencies = []\n\n[project.optional-dependencies]\ndev = ["pytest>=7.0", "black"]\n',
    );
    const [candidate] = await detectTestRunners(new ProjectPaths(dir));
    expect(candidate).toMatchObject({ ecosystem: 'python', runner: 'pytest', confident: true });
  });

  it('a "pytest" substring inside ordinary prose (an unquoted mention, e.g. a "description" field) is never read as a dependency declaration (specs/22 M17 P21)', async () => {
    const dir = await tempDir();
    await write(
      dir,
      'pyproject.toml',
      '[project]\nname = "fixture"\ndescription = "Uses pytest for testing, allegedly"\n',
    );
    const [candidate] = await detectTestRunners(new ProjectPaths(dir));
    expect(candidate).toMatchObject({ ecosystem: 'python', confident: false });
  });

  // A critic round live-reproduced a real regression into the exact defect class this fix exists to
  // close: the dependency-token regex, applied to the WHOLE raw file instead of a real
  // dependency-array body, matched a standalone quoted "pytest" token anywhere at all, including
  // inside a "description" string and inside "keywords" (PyPI classifier metadata, never a
  // dependency list). Both are fixed by scoping the regex to real dependency-array bodies only
  // (`pyprojectDependencyArrayBodies`); these two cases prove it, byte-for-byte against the critic's
  // own repro strings.
  it('a QUOTED "pytest" token inside a "description" string is never read as a dependency declaration, even quoted (specs/22 M17 P21, critic-found regression)', async () => {
    const dir = await tempDir();
    await write(
      dir,
      'pyproject.toml',
      '[project]\nname = "fixture"\ndescription = "A tool that integrates with pytest-like frameworks and \'pytest\' ecosystems"\n',
    );
    const [candidate] = await detectTestRunners(new ProjectPaths(dir));
    expect(candidate).toMatchObject({ ecosystem: 'python', confident: false });
  });

  it('"keywords" (PyPI classifier metadata, never a dependency list) naming "pytest" is never read as a dependency declaration (specs/22 M17 P21, critic-found regression)', async () => {
    const dir = await tempDir();
    await write(
      dir,
      'pyproject.toml',
      '[project]\nname = "fixture"\nkeywords = ["pytest", "plugin"]\n',
    );
    const [candidate] = await detectTestRunners(new ProjectPaths(dir));
    expect(candidate).toMatchObject({ ecosystem: 'python', confident: false });
  });

  it('a same-prefix package ("pytest-mock") in a real "dependencies" array is never mistaken for "pytest" itself (specs/22 M17 P21)', async () => {
    const dir = await tempDir();
    await write(
      dir,
      'pyproject.toml',
      '[project]\nname = "fixture"\ndependencies = ["pytest-mock>=3.0"]\n',
    );
    const [candidate] = await detectTestRunners(new ProjectPaths(dir));
    expect(candidate).toMatchObject({ ecosystem: 'python', confident: false });
  });

  it('pyproject.toml declaring a real "pytest" dependency under "[dependency-groups]" (PEP 735) is real evidence (specs/22 M17 P21)', async () => {
    const dir = await tempDir();
    await write(
      dir,
      'pyproject.toml',
      '[project]\nname = "fixture"\n\n[dependency-groups]\ntest = ["pytest>=7.0"]\n',
    );
    const [candidate] = await detectTestRunners(new ProjectPaths(dir));
    expect(candidate).toMatchObject({ ecosystem: 'python', runner: 'pytest', confident: true });
  });

  // Poetry's own native TOML table syntax (pre-PEP-621, still one of the two dominant real-world
  // Python dependency styles) was a real false negative before this: `pyprojectDependencyArrayBodies`
  // only ever looks for PEP 621's ARRAY form (`dependencies = [...]`), never Poetry's own TABLE form
  // (`pytest = "^7.4.0"` as a bare key), so a real, working Poetry+pytest project with no
  // `[tool.pytest.ini_options]` table got handed off to `--agent` unnecessarily.
  it('Poetry\'s own "[tool.poetry.dependencies]" table naming pytest is real evidence (specs/22 M17 P21, critic-found MAJOR)', async () => {
    const dir = await tempDir();
    await write(
      dir,
      'pyproject.toml',
      '[tool.poetry]\nname = "fixture"\nversion = "0.1.0"\n\n[tool.poetry.dependencies]\npython = "^3.9"\npytest = "^7.4.0"\n',
    );
    const [candidate] = await detectTestRunners(new ProjectPaths(dir));
    expect(candidate).toMatchObject({ ecosystem: 'python', runner: 'pytest', confident: true });
  });

  it('Poetry\'s own "[tool.poetry.group.dev.dependencies]" table naming pytest is real evidence (specs/22 M17 P21, critic-found MAJOR)', async () => {
    const dir = await tempDir();
    await write(
      dir,
      'pyproject.toml',
      '[tool.poetry]\nname = "fixture"\nversion = "0.1.0"\n\n[tool.poetry.dependencies]\npython = "^3.9"\n\n[tool.poetry.group.dev.dependencies]\npytest = "^7.4.0"\nblack = "^24.0"\n',
    );
    const [candidate] = await detectTestRunners(new ProjectPaths(dir));
    expect(candidate).toMatchObject({ ecosystem: 'python', runner: 'pytest', confident: true });
  });

  it('Poetry\'s legacy "[tool.poetry.dev-dependencies]" table naming pytest is also real evidence (specs/22 M17 P21)', async () => {
    const dir = await tempDir();
    await write(
      dir,
      'pyproject.toml',
      '[tool.poetry]\nname = "fixture"\n\n[tool.poetry.dependencies]\npython = "^3.9"\n\n[tool.poetry.dev-dependencies]\npytest = "^6.0"\n',
    );
    const [candidate] = await detectTestRunners(new ProjectPaths(dir));
    expect(candidate).toMatchObject({ ecosystem: 'python', runner: 'pytest', confident: true });
  });

  it('a Poetry project naming no pytest dependency at all still correctly hands off (specs/22 M17 P21)', async () => {
    const dir = await tempDir();
    await write(
      dir,
      'pyproject.toml',
      '[tool.poetry]\nname = "fixture"\n\n[tool.poetry.dependencies]\npython = "^3.9"\nrequests = "^2.31"\n',
    );
    const [candidate] = await detectTestRunners(new ProjectPaths(dir));
    expect(candidate).toMatchObject({ ecosystem: 'python', confident: false });
  });

  it('Poetry\'s own "pytest-mock" (a same-prefix dev dependency, not pytest itself) is never mistaken for pytest (specs/22 M17 P21)', async () => {
    const dir = await tempDir();
    await write(
      dir,
      'pyproject.toml',
      '[tool.poetry]\nname = "fixture"\n\n[tool.poetry.group.dev.dependencies]\npytest-mock = "^3.0"\n',
    );
    const [candidate] = await detectTestRunners(new ProjectPaths(dir));
    expect(candidate).toMatchObject({ ecosystem: 'python', confident: false });
  });

  it('a "[tool.pytest.ini_options]" header with internal whitespace ("[ tool.pytest.ini_options ]") is still recognised (specs/22 M17 P21)', async () => {
    const dir = await tempDir();
    await write(
      dir,
      'pyproject.toml',
      '[project]\nname = "fixture"\n\n[ tool.pytest.ini_options ]\ntestpaths = ["tests"]\n',
    );
    const [candidate] = await detectTestRunners(new ProjectPaths(dir));
    expect(candidate).toMatchObject({ ecosystem: 'python', runner: 'pytest', confident: true });
  });

  it('setup.cfg\'s own "[tool:pytest]" section is real evidence -- confident pytest (specs/22 M17 P21)', async () => {
    const dir = await tempDir();
    await write(
      dir,
      'setup.cfg',
      '[metadata]\nname = fixture\n\n[tool:pytest]\ntestpaths = tests\n',
    );
    const [candidate] = await detectTestRunners(new ProjectPaths(dir));
    expect(candidate).toMatchObject({ ecosystem: 'python', runner: 'pytest', confident: true });
    expect(candidate?.reason).toContain('setup.cfg itself declares pytest');
  });

  it('tox.ini\'s own "[pytest]" section is real evidence -- confident pytest (specs/22 M17 P21)', async () => {
    const dir = await tempDir();
    await write(dir, 'tox.ini', '[tox]\nenvlist = py311\n\n[pytest]\ntestpaths = tests\n');
    const [candidate] = await detectTestRunners(new ProjectPaths(dir));
    expect(candidate).toMatchObject({ ecosystem: 'python', runner: 'pytest', confident: true });
    expect(candidate?.reason).toContain('tox.ini itself declares pytest');
  });

  it('a real "conftest.py" at the project root is real evidence even when the matched marker declares nothing itself (specs/22 M17 P21)', async () => {
    const dir = await tempDir();
    await write(dir, 'pyproject.toml', '[project]\nname = "fixture"\n');
    await write(dir, 'conftest.py', 'import pytest\n');
    const [candidate] = await detectTestRunners(new ProjectPaths(dir));
    expect(candidate).toMatchObject({ ecosystem: 'python', runner: 'pytest', confident: true });
    expect(candidate?.reason).toContain('conftest.py exists');
  });

  it('a real "pytest.ini" at the project root is real evidence (specs/22 M17 P21)', async () => {
    const dir = await tempDir();
    await write(dir, 'setup.cfg', '[metadata]\nname = fixture\n');
    await write(dir, 'pytest.ini', '[pytest]\ntestpaths = tests\n');
    const [candidate] = await detectTestRunners(new ProjectPaths(dir));
    expect(candidate).toMatchObject({ ecosystem: 'python', runner: 'pytest', confident: true });
    expect(candidate?.reason).toContain('pytest.ini exists');
  });

  it('a real "test_*.py" file under the conventional "tests/" directory is real evidence, with no config section at all (specs/22 M17 P21)', async () => {
    const dir = await tempDir();
    await write(dir, 'pyproject.toml', '[project]\nname = "fixture"\n');
    await write(dir, 'tests/test_sample.py', 'def test_ok():\n    assert True\n');
    const [candidate] = await detectTestRunners(new ProjectPaths(dir));
    expect(candidate).toMatchObject({ ecosystem: 'python', runner: 'pytest', confident: true });
    expect(candidate?.reason).toContain('tests/');
  });

  it('a real "*_test.py" file at the project root is also recognised (the other half of pytest\'s own default glob) (specs/22 M17 P21)', async () => {
    const dir = await tempDir();
    await write(dir, 'pyproject.toml', '[project]\nname = "fixture"\n');
    await write(dir, 'sample_test.py', 'def test_ok():\n    assert True\n');
    const [candidate] = await detectTestRunners(new ProjectPaths(dir));
    expect(candidate).toMatchObject({ ecosystem: 'python', runner: 'pytest', confident: true });
  });

  it('an unrelated file that merely contains "test" in its name is not mistaken for a pytest-convention test file (specs/22 M17 P21)', async () => {
    const dir = await tempDir();
    await write(dir, 'pyproject.toml', '[project]\nname = "fixture"\n');
    await write(dir, 'latest_release.py', '# not a test file\n');
    const [candidate] = await detectTestRunners(new ProjectPaths(dir));
    expect(candidate).toMatchObject({ ecosystem: 'python', confident: false });
  });

  it('JavaScript takes precedence over Python when a project has both markers', async () => {
    const dir = await tempDir();
    await write(
      dir,
      'package.json',
      JSON.stringify({ name: 'fixture', devDependencies: { vitest: '2' } }),
    );
    await write(dir, 'pyproject.toml', '# fixture\n');
    const [candidate] = await detectTestRunners(new ProjectPaths(dir));
    expect(candidate?.ecosystem).toBe('javascript');
  });
});

describe('detectTestRunners -- Go (specs/22 M17 P21)', () => {
  // `13` F-TEST-11's own live-discovered gap closed for Python above applies the identical way to
  // Go: `go.mod` alone is module packaging metadata every real Go module needs, whether or not it
  // has a single test -- confirmed live on a real fixture (a bare go.mod, zero "_test.go" files)
  // that used to stage `confident: true` for "go test -json" before this fix.
  it('go.mod ALONE, with no real "_test.go" file anywhere near the root, hands off rather than staging a false-confident match (specs/22 M17 P21)', async () => {
    const dir = await tempDir();
    await write(dir, 'go.mod', 'module example.com/fixture\n\ngo 1.22\n');
    const [candidate] = await detectTestRunners(new ProjectPaths(dir));
    expect(candidate).toMatchObject({ ecosystem: 'go', confident: false });
    expect(candidate?.runner).toBeUndefined();
    expect(candidate?.command).toBeUndefined();
    expect(candidate?.reason).toContain('no real "_test.go" file was found');
  });

  it('a real "_test.go" file at the project root is real evidence -- confident "go test -json" (specs/22 M17 P21)', async () => {
    const dir = await tempDir();
    await write(dir, 'go.mod', 'module example.com/fixture\n\ngo 1.22\n');
    await write(
      dir,
      'main_test.go',
      'package main\n\nimport "testing"\n\nfunc TestMain(t *testing.T) {}\n',
    );
    const [candidate] = await detectTestRunners(new ProjectPaths(dir));
    expect(candidate).toMatchObject({ ecosystem: 'go', runner: 'go-test', confident: true });
    expect(candidate?.command).toMatchObject({
      run: 'go test -json ./...',
      format: 'go-test-json',
    });
  });

  it('a real "_test.go" file in an IMMEDIATE subdirectory (the real-world, multi-package layout) is also real evidence (specs/22 M17 P21)', async () => {
    const dir = await tempDir();
    await write(dir, 'go.mod', 'module example.com/fixture\n\ngo 1.22\n');
    await write(dir, 'foo/foo.go', 'package foo\n');
    await write(
      dir,
      'foo/foo_test.go',
      'package foo\n\nimport "testing"\n\nfunc TestFoo(t *testing.T) {}\n',
    );
    const [candidate] = await detectTestRunners(new ProjectPaths(dir));
    expect(candidate).toMatchObject({ ecosystem: 'go', runner: 'go-test', confident: true });
  });

  it('excludes "vendor/" from the near-root scan -- a vendored dependency\'s own test file is never mistaken for this project\'s own evidence (specs/22 M17 P21)', async () => {
    const dir = await tempDir();
    await write(dir, 'go.mod', 'module example.com/fixture\n\ngo 1.22\n');
    await write(dir, 'vendor/pkg/pkg_test.go', 'package pkg\n');
    const [candidate] = await detectTestRunners(new ProjectPaths(dir));
    expect(candidate).toMatchObject({ ecosystem: 'go', confident: false });
  });

  it('a "_test.go" file two or more directories deep (outside the near-root scan) correctly still hands off -- a disclosed, safe-direction boundary (specs/22 M17 P21)', async () => {
    const dir = await tempDir();
    await write(dir, 'go.mod', 'module example.com/fixture\n\ngo 1.22\n');
    await write(dir, 'internal/foo/foo.go', 'package foo\n');
    await write(
      dir,
      'internal/foo/foo_test.go',
      'package foo\n\nimport "testing"\n\nfunc TestFoo(t *testing.T) {}\n',
    );
    const [candidate] = await detectTestRunners(new ProjectPaths(dir));
    expect(candidate).toMatchObject({ ecosystem: 'go', confident: false });
  });
});

describe('detectTestRunners -- PHP (specs/22 M17 P6)', () => {
  it('composer.json requiring phpunit/phpunit proposes its own zero-dependency --log-junit', async () => {
    const dir = await tempDir();
    await write(
      dir,
      'composer.json',
      JSON.stringify({ name: 'fixture/app', 'require-dev': { 'phpunit/phpunit': '^10' } }),
    );
    const [candidate] = await detectTestRunners(new ProjectPaths(dir));
    expect(candidate).toMatchObject({ ecosystem: 'php', runner: 'phpunit', confident: true });
    expect(candidate?.command).toMatchObject({ format: 'junit-xml', output: { source: 'file' } });
  });

  it('composer.json without phpunit hands off rather than guessing', async () => {
    const dir = await tempDir();
    await write(dir, 'composer.json', JSON.stringify({ name: 'fixture/app', require: {} }));
    const [candidate] = await detectTestRunners(new ProjectPaths(dir));
    expect(candidate).toMatchObject({ ecosystem: 'php', confident: false });
  });
});

describe('detectTestRunners -- hands off rather than guessing (specs/22 M17 P6)', () => {
  it.each([
    ['Cargo.toml', 'rust'],
    ['pom.xml', 'java'],
    ['build.gradle', 'java'],
    ['Gemfile', 'ruby'],
  ])(
    'a real %s is recognised as %s but no built-in format fits -- hand-off, not a guess',
    async (manifest, ecosystem) => {
      const dir = await tempDir();
      await write(dir, manifest, 'fixture\n');
      const [candidate] = await detectTestRunners(new ProjectPaths(dir));
      expect(candidate).toMatchObject({ ecosystem, confident: false });
      expect(candidate?.command).toBeUndefined();
    },
  );

  it('a ".csproj" file is recognised as .NET but TRX has no built-in parser -- hand-off', async () => {
    const dir = await tempDir();
    await write(dir, 'Fixture.csproj', '<Project />\n');
    const [candidate] = await detectTestRunners(new ProjectPaths(dir));
    expect(candidate).toMatchObject({ ecosystem: 'dotnet', confident: false });
  });

  it('nothing recognised at all hands off naming the agent-driven workflow', async () => {
    const dir = await tempDir();
    const [candidate] = await detectTestRunners(new ProjectPaths(dir));
    expect(candidate).toMatchObject({ ecosystem: 'none', confident: false });
    expect(candidate?.reason).toContain('specs/22 M17 P7');
  });
});

describe('detectTestRunners -- Makefile (specs/22 M17 P6)', () => {
  it('a "test:" target whose recipe invokes pytest proposes the identical pytest command', async () => {
    const dir = await tempDir();
    await write(dir, 'Makefile', 'test:\n\tpytest -v\n');
    const [candidate] = await detectTestRunners(new ProjectPaths(dir));
    expect(candidate).toMatchObject({ ecosystem: 'python', runner: 'pytest', confident: true });
  });

  it('a Makefile with no "test:" target at all hands off by that specific reason', async () => {
    const dir = await tempDir();
    await write(dir, 'Makefile', 'build:\n\tgo build ./...\n');
    const [candidate] = await detectTestRunners(new ProjectPaths(dir));
    expect(candidate).toMatchObject({ ecosystem: 'makefile-only', confident: false });
    expect(candidate?.reason).toContain('no "test:" target');
  });

  it('a "test:" target whose recipe names no recognised runner hands off, quoting the real recipe', async () => {
    const dir = await tempDir();
    await write(dir, 'Makefile', 'test:\n\t./run-our-own-weird-test-harness.sh\n');
    const [candidate] = await detectTestRunners(new ProjectPaths(dir));
    expect(candidate).toMatchObject({ ecosystem: 'makefile-only', confident: false });
    expect(candidate?.reason).toContain('run-our-own-weird-test-harness.sh');
  });

  it('a manifest-based detection (package.json) takes precedence over a Makefile in the same directory', async () => {
    const dir = await tempDir();
    await write(
      dir,
      'package.json',
      JSON.stringify({ name: 'fixture', devDependencies: { jest: '29' } }),
    );
    await write(dir, 'Makefile', 'test:\n\tpytest\n');
    const [candidate] = await detectTestRunners(new ProjectPaths(dir));
    expect(candidate?.runner).toBe('jest');
  });

  it('a runner keyword inside "echo"\'s own printed text is never read as a real invocation -- a fresh critic round\'s own repro', async () => {
    const dir = await tempDir();
    await write(
      dir,
      'Makefile',
      'test:\n\t@echo "Note: this project no longer uses pytest; see custom_runner.sh"\n\t./custom_runner.sh --format=json\n',
    );
    const [candidate] = await detectTestRunners(new ProjectPaths(dir));
    expect(candidate).toMatchObject({ ecosystem: 'makefile-only', confident: false });
  });

  it('a runner keyword inside a bare "#" comment line is never read as a real invocation', async () => {
    const dir = await tempDir();
    await write(
      dir,
      'Makefile',
      'test:\n\t# this used to run pytest, before we switched\n\t./custom_runner.sh\n',
    );
    const [candidate] = await detectTestRunners(new ProjectPaths(dir));
    expect(candidate).toMatchObject({ ecosystem: 'makefile-only', confident: false });
  });

  it('a real invocation scoped behind "cd dir &&" is still detected, but the proposal is hedged in "reason"', async () => {
    const dir = await tempDir();
    await write(dir, 'Makefile', 'test:\n\tcd subdir && pytest\n');
    const [candidate] = await detectTestRunners(new ProjectPaths(dir));
    expect(candidate).toMatchObject({ ecosystem: 'python', runner: 'pytest', confident: true });
    expect(candidate?.reason).toContain('scoped or guarded');
  });

  it('a real invocation guarded behind "if ...; then ... fi" is still detected, hedged the same way', async () => {
    const dir = await tempDir();
    await write(dir, 'Makefile', 'test:\n\tif [ -f setup.py ]; then pytest; fi\n');
    const [candidate] = await detectTestRunners(new ProjectPaths(dir));
    expect(candidate).toMatchObject({ ecosystem: 'python', runner: 'pytest', confident: true });
    expect(candidate?.reason).toContain('scoped or guarded');
  });

  it('a bare, unscoped invocation on its own line is NOT hedged', async () => {
    const dir = await tempDir();
    await write(dir, 'Makefile', 'test:\n\tpytest -v\n');
    const [candidate] = await detectTestRunners(new ProjectPaths(dir));
    expect(candidate?.reason).not.toContain('scoped or guarded');
  });
});

describe('detectTestRunners -- CI configuration enriches the reason, never decides it (specs/22 M17 P6)', () => {
  it('a known GitHub Actions workflow file is named in the reason alongside a confident detection', async () => {
    const dir = await tempDir();
    await write(
      dir,
      'package.json',
      JSON.stringify({ name: 'fixture', devDependencies: { vitest: '2' } }),
    );
    await write(dir, '.github/workflows/ci.yml', 'name: CI\non: push\njobs: {}\n');
    const [candidate] = await detectTestRunners(new ProjectPaths(dir));
    expect(candidate?.reason).toContain('.github/workflows/');
  });

  it('no known CI configuration leaves the reason exactly as the detector itself produced it', async () => {
    const dir = await tempDir();
    await write(
      dir,
      'package.json',
      JSON.stringify({ name: 'fixture', devDependencies: { vitest: '2' } }),
    );
    const [candidate] = await detectTestRunners(new ProjectPaths(dir));
    expect(candidate?.reason).not.toContain('CI configuration');
  });
});
