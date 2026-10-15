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

  it('a "scripts.test" that already runs "node --test" proposes it directly, needing no dependency', async () => {
    const dir = await tempDir();
    await write(
      dir,
      'package.json',
      JSON.stringify({ name: 'fixture', scripts: { test: 'node --test test/' } }),
    );
    const [candidate] = await detectTestRunners(new ProjectPaths(dir));
    expect(candidate).toMatchObject({ runner: 'node-test', confident: true });
    expect(candidate?.command).toMatchObject({ run: 'node --test', format: 'tap' });
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

describe('detectTestRunners -- Python (specs/22 M17 P6)', () => {
  it.each(['pyproject.toml', 'setup.cfg', 'tox.ini'])(
    '%s alone is confident pytest, the same marker convention the legacy ecosystem probe uses',
    async (marker) => {
      const dir = await tempDir();
      await write(dir, marker, '# fixture\n');
      const [candidate] = await detectTestRunners(new ProjectPaths(dir));
      expect(candidate).toMatchObject({ ecosystem: 'python', runner: 'pytest', confident: true });
      expect(candidate?.command).toMatchObject({ format: 'junit-xml', output: { source: 'file' } });
    },
  );

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

describe('detectTestRunners -- Go (specs/22 M17 P6)', () => {
  it('go.mod proposes "go test -json" over stdout, confidently', async () => {
    const dir = await tempDir();
    await write(dir, 'go.mod', 'module example.com/fixture\n\ngo 1.22\n');
    const [candidate] = await detectTestRunners(new ProjectPaths(dir));
    expect(candidate).toMatchObject({ ecosystem: 'go', runner: 'go-test', confident: true });
    expect(candidate?.command).toMatchObject({
      run: 'go test -json ./...',
      format: 'go-test-json',
    });
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
