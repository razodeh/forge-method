/**
 * The three `forge doctor --rule <name>` checks `G-Foundation` names for a clean clone (`10` §10.3: "Clean clone
 * doesn't build; no reproducible install; CI skeleton absent"): `clean-build`, `reproducible-install`,
 * `ci-skeleton` (`PLAN-M13.md` P25, Q219).
 *
 * All three read the COMMITTED project (what a clean clone would contain), never the working tree, and never run
 * a build or install. Every fixture is a real temp git repository. Each rule has passing and failing fixtures,
 * malformed-input cases, and a determinism check; a check that cannot read its input is a violation, not a skip.
 *
 * @see specs/10 §10.3
 * @see specs/11 F-INIT-3
 * @see specs/14 §14.3
 * @see PLAN-M13.md P25
 */
import { mkdtemp, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { ProjectPaths } from '@forge/core/fs';
import { execa } from 'execa';
import { afterEach, describe, expect, it } from 'vitest';

import { doctorRule, type DoctorRuleId } from '../../../src/commands/doctor/rules.ts';
import {
  KB_ROOT,
  cleanupAll,
  createTestProject,
  registerCleanup,
  writeAndCommit,
  writeUncommitted,
} from './helpers.ts';

afterEach(cleanupAll);

async function violations(dir: string, rule: DoctorRuleId) {
  const result = await doctorRule(
    {
      paths: new ProjectPaths(dir),
      projectRoot: dir,
      kbRoot: KB_ROOT,
      reportsRoot: 'docs/forge/reports',
      env: {},
    },
    rule,
  );
  return result.violations;
}

async function project(files: Readonly<Record<string, string>> = {}): Promise<string> {
  const { dir } = await createTestProject();
  await writeAndCommit(dir, files);
  return dir;
}

const PKG = (extra: Record<string, unknown> = {}): string =>
  JSON.stringify({ name: 'x', version: '1.0.0', ...extra });

describe('clean-build', () => {
  it('passes when a committed package.json declares scripts.build', async () => {
    const dir = await project({ 'package.json': PKG({ scripts: { build: 'tsc -b' } }) });
    expect(await violations(dir, 'clean-build')).toEqual([]);
  });

  it('passes for a committed Makefile, justfile, Taskfile, pyproject build-system, Cargo.toml, go.mod', async () => {
    const cases: Record<string, Record<string, string>> = {
      make: { Makefile: 'build:\n\tgo build ./...\n' },
      makeWithDeps: { Makefile: '.PHONY: build\nbuild: gen\n\tgo build\n' },
      just: { justfile: 'build:\n  cargo build\n' },
      justArgs: { justfile: 'build target="all":\n  make {{target}}\n' },
      task: { 'Taskfile.yml': 'version: "3"\ntasks:\n  build:\n    cmds: [go build]\n' },
      py: { 'pyproject.toml': '[build-system]\nrequires = ["hatchling"]\n' },
      rust: { 'Cargo.toml': '[package]\nname = "x"\nversion = "0.1.0"\n' },
      go: { 'go.mod': 'module x\n\ngo 1.22\n' },
    };
    for (const [name, files] of Object.entries(cases)) {
      const dir = await project(files);
      expect(await violations(dir, 'clean-build'), name).toEqual([]);
    }
  });

  it('fails an empty repository, naming what would satisfy it', async () => {
    const dir = await project();
    const found = await violations(dir, 'clean-build');
    expect(found).toHaveLength(1);
    expect(found[0]?.subject).toBe('build');
    expect(found[0]?.message).toContain('package.json');
    expect(found[0]?.remedy).toMatch(/^Add /);
  });

  it('fails a package.json with no scripts.build, or a blank or non-string one', async () => {
    for (const scripts of [undefined, {}, { build: '' }, { build: '   ' }, { build: 7 }]) {
      const dir = await project({ 'package.json': PKG(scripts === undefined ? {} : { scripts }) });
      const found = await violations(dir, 'clean-build');
      expect(found.length, JSON.stringify(scripts)).toBe(1);
      expect(found[0]?.subject).toBe('build');
    }
  });

  it('a Makefile variable or .PHONY line named build is not a build target', async () => {
    for (const makefile of ['build := 1\nall:\n\ttrue\n', '.PHONY: build\nall:\n\ttrue\n']) {
      const dir = await project({ Makefile: makefile });
      expect((await violations(dir, 'clean-build')).length).toBe(1);
    }
  });

  it('a malformed package.json is a violation naming the file, even when another file declares a build', async () => {
    const dir = await project({ 'package.json': '{ not json', Makefile: 'build:\n\ttrue\n' });
    const found = await violations(dir, 'clean-build');
    expect(found).toHaveLength(1);
    expect(found[0]?.subject).toBe('package.json');
    expect(found[0]?.message).toContain('could not be read');
  });

  it('a manifest that exists only in the working tree is not part of a clean clone', async () => {
    const { dir } = await createTestProject();
    await writeUncommitted(dir, { 'package.json': PKG({ scripts: { build: 'tsc' } }) });
    const found = await violations(dir, 'clean-build');
    expect(found).toHaveLength(1);
    expect(found[0]?.message).toContain('not committed');
    expect(found[0]?.message).toContain('package.json');
  });

  it('staged but uncommitted is still not committed', async () => {
    const { dir } = await createTestProject();
    await writeUncommitted(dir, { Makefile: 'build:\n\ttrue\n' });
    await execa('git', ['add', 'Makefile'], { cwd: dir });
    expect((await violations(dir, 'clean-build')).length).toBe(1);
  });

  it('reads the committed content: an uncommitted edit that adds a build script does not pass', async () => {
    const dir = await project({ 'package.json': PKG() });
    await writeUncommitted(dir, { 'package.json': PKG({ scripts: { build: 'tsc' } }) });
    expect((await violations(dir, 'clean-build')).length).toBe(1);
  });

  it('a directory that is not a git repository fails with a git violation, not a crash', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'forge-rule-nogit-'));
    registerCleanup(dir);
    await writeUncommitted(dir, { 'package.json': PKG({ scripts: { build: 'tsc' } }) });
    const found = await violations(dir, 'clean-build');
    expect(found).toHaveLength(1);
    expect(found[0]?.subject).toBe('git');
    expect(found[0]?.remedy).toMatch(/^Run `git init`/);
  });

  it('a repository with no commit fails with a git violation', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'forge-rule-nocommit-'));
    registerCleanup(dir);
    await execa('git', ['init', '--quiet', '-b', 'main'], { cwd: dir });
    await writeUncommitted(dir, { Makefile: 'build:\n\ttrue\n' });
    const found = await violations(dir, 'clean-build');
    expect(found).toHaveLength(1);
    expect(found[0]?.subject).toBe('git');
  });

  it('works for a project rooted below the git root, and reads only that subtree', async () => {
    const { dir } = await createTestProject();
    await writeAndCommit(dir, {
      'package.json': PKG({ scripts: { build: 'tsc' } }),
      'sub/README.md': 'no manifest here',
    });
    expect(await violations(path.join(dir, 'sub'), 'clean-build')).toHaveLength(1);
    await writeAndCommit(dir, { 'sub/Makefile': 'build:\n\ttrue\n' });
    expect(await violations(path.join(dir, 'sub'), 'clean-build')).toEqual([]);
  });

  it('is deterministic: two runs over the same repository give identical output', async () => {
    const dir = await project({ 'package.json': '{ bad', 'Cargo.toml': '[package]\n' });
    expect(JSON.stringify(await violations(dir, 'clean-build'))).toBe(
      JSON.stringify(await violations(dir, 'clean-build')),
    );
  });
});

describe('stubs that only look like the thing (a rule that passes them proves nothing)', () => {
  it('clean-build: a no-op build script, and zero-byte implied manifests, are not a build', async () => {
    for (const build of ['true', ':', 'exit 0', 'echo done', 'noop']) {
      const dir = await project({ 'package.json': PKG({ scripts: { build } }) });
      const found = await violations(dir, 'clean-build');
      expect(found.length, build).toBe(1);
      expect(found[0]?.message, build).toContain('no-op');
    }
    for (const file of ['setup.py', 'Cargo.toml', 'go.mod', 'pom.xml']) {
      const found = await violations(await project({ [file]: '' }), 'clean-build');
      expect(found.length, file).toBe(1);
      expect(found[0]?.message, file).toContain(`${file} is empty`);
    }
  });

  it('reproducible-install: a lockfile that is `{}`, or a symlink, or an empty rust-toolchain, pins nothing', async () => {
    const emptyJson = await project({
      'package.json': PKG(),
      'package-lock.json': '{}',
      '.nvmrc': '22',
    });
    const found = await violations(emptyJson, 'reproducible-install');
    expect(found).toHaveLength(1);
    expect(found[0]?.message).toContain('lockfileVersion');

    const { dir } = await createTestProject();
    await writeUncommitted(dir, { 'package.json': PKG(), '.nvmrc': '22' });
    await symlink('/dev/null', path.join(dir, 'pnpm-lock.yaml'));
    await execa('git', ['add', '-A'], { cwd: dir });
    await execa('git', ['commit', '--quiet', '-m', 'symlinked lock'], { cwd: dir });
    expect((await violations(dir, 'reproducible-install')).length).toBe(1);

    const rust = await project({
      'Cargo.toml': '[package]\nname="x"\n',
      'Cargo.lock': '# l\n',
      'rust-toolchain': '',
    });
    expect((await violations(rust, 'reproducible-install')).length).toBe(1);
  });

  it('ci-skeleton: a workflow with a null trigger, a step that runs nothing, a hidden GitLab template or an empty Jenkins pipeline is not a pipeline', async () => {
    const stubs: Record<string, Record<string, string>> = {
      nullOn: {
        '.github/workflows/ci.yml':
          'on:\njobs:\n  a:\n    runs-on: x\n    steps:\n      - run: make\n',
      },
      blankRun: {
        '.github/workflows/ci.yml':
          'on: push\njobs:\n  a:\n    runs-on: x\n    steps:\n      - run: ""\n',
      },
      gitlabHidden: { '.gitlab-ci.yml': '.template:\n  script: [make]\n' },
      gitlabNullInclude: { '.gitlab-ci.yml': 'include:\n' },
      jenkinsEmpty: { Jenkinsfile: 'pipeline { }\n' },
      jenkinsComment: { Jenkinsfile: '// node ( stage steps sh )\n' },
    };
    for (const [name, files] of Object.entries(stubs)) {
      expect(
        (await violations(await project(files), 'ci-skeleton')).length,
        name,
      ).toBeGreaterThanOrEqual(1);
    }
  });
});

describe('legitimate projects that a strict reading could fail', () => {
  it('a valid package-lock.json far larger than the stub check reads passes', async () => {
    const packages: Record<string, unknown> = { '': { name: 'x' } };
    for (let i = 0; i < 12_000; i += 1)
      packages[`node_modules/p${String(i)}`] = { version: '1.0.0', resolved: 'x'.repeat(400) };
    const big = JSON.stringify({ name: 'x', lockfileVersion: 3, packages });
    expect(big.length).toBeGreaterThan(4 * 1024 * 1024);
    const dir = await project({
      'package.json': PKG({ dependencies: { p0: '1.0.0' } }),
      'package-lock.json': big,
      '.nvmrc': '22',
    });
    expect(await violations(dir, 'reproducible-install')).toEqual([]);
  });

  it('a package.json with a byte order mark is read, not "not valid JSON"', async () => {
    const dir = await project({
      'package.json': `\uFEFF${PKG({ scripts: { build: 'tsc -b' } })}`,
      'yarn.lock': '# yarn lockfile v1\n',
      '.nvmrc': '22',
    });
    expect(await violations(dir, 'clean-build')).toEqual([]);
    expect(await violations(dir, 'reproducible-install')).toEqual([]);
  });

  it('a pyproject.toml that only configures tools does not make a JavaScript project a Python one', async () => {
    const dir = await project({
      'package.json': PKG(),
      'pnpm-lock.yaml': "lockfileVersion: '9.0'\n",
      '.nvmrc': '22',
      'pyproject.toml': '[tool.ruff]\nline-length = 100\n',
    });
    expect(await violations(dir, 'reproducible-install')).toEqual([]);
  });

  it('Dart/Flutter, .NET, Ruby and PHP projects are recognised, with their own lock and toolchain', async () => {
    const good: Record<string, Record<string, string>> = {
      dart: {
        'pubspec.yaml': 'name: x\nenvironment:\n  sdk: ">=3.0.0 <4.0.0"\n',
        'pubspec.lock': 'packages: {}\n',
      },
      dotnet: {
        'App.csproj': '<Project Sdk="Microsoft.NET.Sdk"/>',
        'packages.lock.json': '{"version":1}',
        'global.json': '{"sdk":{"version":"8.0.100"}}',
      },
      ruby: {
        Gemfile: 'source "https://rubygems.org"\n',
        'Gemfile.lock': 'GEM\n',
        '.ruby-version': '3.3.0\n',
      },
      php: { 'composer.json': '{"require":{"php":">=8.2"}}', 'composer.lock': '{}' },
    };
    for (const [name, files] of Object.entries(good)) {
      expect(await violations(await project(files), 'reproducible-install'), name).toEqual([]);
    }
    const bad = await project({ 'pubspec.yaml': 'name: x\n' });
    expect((await violations(bad, 'reproducible-install')).map((v) => v.subject)).toEqual([
      'dart',
      'dart',
    ]);
    expect(await violations(await project({ 'pubspec.yaml': 'name: x\n' }), 'clean-build')).toEqual(
      [],
    );
    expect(await violations(await project({ 'App.csproj': '<Project/>' }), 'clean-build')).toEqual(
      [],
    );
  });
});

describe('round 3: verdicts, and hostile inputs judged in bounded time', () => {
  it('a build that starts with echo but goes on to build is a build; a step likewise', async () => {
    const dir = await project({
      'package.json': PKG({ scripts: { build: 'echo Building && tsc -p .' } }),
      '.github/workflows/ci.yml':
        'on: push\njobs:\n  a:\n    runs-on: x\n    steps:\n      - run: echo "starting" && npm test\n',
    });
    expect(await violations(dir, 'clean-build')).toEqual([]);
    expect(await violations(dir, 'ci-skeleton')).toEqual([]);
  });

  it('files made of whitespace, unterminated openers or one long token are each judged in under 2 s', async () => {
    const big = 200_000;
    const dir = await project({
      Jenkinsfile: '\n'.repeat(big),
      'pyproject.toml': `[project]\nname = "x"\n${'\n'.repeat(big)}`,
      'requirements.txt': `${'a'.repeat(big)}\n`,
      'pubspec.yaml': `environment:\n${'\n'.repeat(big)}`,
      'Cargo.toml': '\n'.repeat(big),
      Gemfile: ' \n'.repeat(big / 2),
    });
    const jenkins = await project({ Jenkinsfile: '/*'.repeat(big / 2) });
    const started = Date.now();
    for (const rule of ['clean-build', 'reproducible-install', 'ci-skeleton'] as const) {
      await violations(dir, rule);
      await violations(jenkins, rule);
    }
    expect(Date.now() - started).toBeLessThan(8_000);
  });

  it('stubs and weak declarations: a small pnpm lock beside dependencies, engines "*", a branch URL, a Flutter-only environment', async () => {
    const smallLock = await project({
      'package.json': PKG({ dependencies: { left: '1.0.0' } }),
      'pnpm-lock.yaml': "lockfileVersion: '9.0'\n",
      '.nvmrc': '22',
    });
    expect((await violations(smallLock, 'reproducible-install'))[0]?.message).toContain(
      'too small',
    );
    const star = await project({
      'package.json': PKG({ engines: { node: '*' } }),
      'yarn.lock': '# yarn lockfile v1\n'.repeat(3),
    });
    expect((await violations(star, 'reproducible-install')).map((v) => v.message).join()).toContain(
      'toolchain',
    );
    const branch = await project({
      'requirements.txt':
        'pkg @ git+https://github.com/x/y.git@main\nother @ https://example.com/o.whl#sha256=abc\n',
      '.python-version': '3.12',
    });
    const found = await violations(branch, 'reproducible-install');
    expect(found[0]?.message).toContain('git+https://github.com/x/y.git@main');
    expect(found[0]?.message).not.toContain('other @');
    const flutter = await project({
      'pubspec.yaml':
        'name: x\ndependencies:\n  flutter:\n    sdk: flutter\nenvironment:\n  flutter: ">=3"\n',
      'pubspec.lock': 'packages: {}\n',
    });
    expect((await violations(flutter, 'reproducible-install'))[0]?.subject).toBe('dart');
  });

  it('a byte order mark on the first line does not hide the file from a line-anchored pattern', async () => {
    const dir = await project({
      'pyproject.toml': '\uFEFF[project]\nname = "x"\n',
      Makefile: '\uFEFFbuild:\n\ttrue\n',
    });
    expect(
      (await violations(dir, 'reproducible-install')).some((v) => v.subject === 'python'),
    ).toBe(true);
    expect(await violations(dir, 'clean-build')).toEqual([]);
  });

  it('legitimate inputs a strict reading fails: `-e .`, GitLab extends, a Jenkins shared library', async () => {
    const req = await project({
      'requirements.txt': '-e .\nflask==3.0.0\n',
      '.python-version': '3.12',
    });
    expect(await violations(req, 'reproducible-install')).toEqual([]);
    const gitlab = await project({
      '.gitlab-ci.yml': '.base:\n  script: [make]\nverify:\n  extends: .base\n',
    });
    expect(await violations(gitlab, 'ci-skeleton')).toEqual([]);
    const jenkins = await project({ Jenkinsfile: "@Library('shared') _\nbuildPlugin()\n" });
    expect(await violations(jenkins, 'ci-skeleton')).toEqual([]);
  });
});

describe('stubs that only look like the thing (2)', () => {
  it('whitespace-only lock and toolchain files, a dependency-less lock beside declared dependencies, `on: []` and a runner-less job', async () => {
    const empty = await project({ 'package.json': PKG(), 'pnpm-lock.yaml': '\n', '.nvmrc': ' \n' });
    expect((await violations(empty, 'reproducible-install')).length).toBe(2);
    const noEntries = await project({
      'package.json': PKG({ dependencies: { left: '1.0.0' } }),
      'package-lock.json': '{"lockfileVersion":3}',
      '.nvmrc': '22',
    });
    expect((await violations(noEntries, 'reproducible-install'))[0]?.message).toContain(
      'too small',
    );
    const padded = await project({
      'package.json': PKG({ dependencies: { left: '1.0.0' } }),
      'package-lock.json': JSON.stringify({
        lockfileVersion: 3,
        name: 'x'.repeat(60),
        version: '1.0.0',
        requires: true,
        packages: {},
      }),
      '.nvmrc': '22',
    });
    expect((await violations(padded, 'reproducible-install'))[0]?.message).toContain(
      'locks no package',
    );
    const cases: Record<string, string> = {
      emptyOnList: 'on: []\njobs:\n  a:\n    runs-on: x\n    steps:\n      - run: make\n',
      noRunsOn: 'on: push\njobs:\n  a:\n    steps:\n      - run: make\n',
      noOpRun: 'on: push\njobs:\n  a:\n    runs-on: x\n    steps:\n      - run: "true"\n',
    };
    for (const [name, text] of Object.entries(cases)) {
      expect(
        (await violations(await project({ '.github/workflows/ci.yml': text }), 'ci-skeleton'))
          .length,
        name,
      ).toBe(1);
    }
    expect(
      (
        await violations(
          await project({ 'package.json': PKG({ scripts: { build: 'node -e 0' } }) }),
          'clean-build',
        )
      ).length,
    ).toBe(1);
  });

  it('a hostile Jenkinsfile of a million repeated openers is judged in bounded time', async () => {
    const dir = await project({ Jenkinsfile: 'pipeline {'.repeat(120_000) });
    const started = Date.now();
    expect((await violations(dir, 'ci-skeleton')).length).toBe(1);
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  it('more than 200 violations are counted and listed only up to 200, with one line saying so', async () => {
    const files: Record<string, string> = {};
    for (let i = 0; i < 205; i += 1)
      files[`.github/workflows/w${String(i).padStart(3, '0')}.yml`] = 'jobs: [x';
    const found = await violations(await project(files), 'ci-skeleton');
    expect(found).toHaveLength(201);
    expect(found[200]?.message).toContain('205 violations in all');
  });
});

describe('reproducible-install', () => {
  const NODE_OK = {
    'package.json': PKG({ scripts: { build: 'tsc' } }),
    'pnpm-lock.yaml': "lockfileVersion: '9.0'\n",
    '.nvmrc': '22\n',
  };

  it('passes a JS project with a committed lockfile and a declared toolchain version', async () => {
    expect(await violations(await project(NODE_OK), 'reproducible-install')).toEqual([]);
  });

  it('accepts each lockfile npm, pnpm, yarn and bun write, and each toolchain declaration', async () => {
    for (const lock of ['package-lock.json', 'npm-shrinkwrap.json', 'yarn.lock', 'bun.lock']) {
      const dir = await project({
        'package.json': PKG(),
        [lock]: '{"lockfileVersion":3}\n',
        '.node-version': '22',
      });
      expect(await violations(dir, 'reproducible-install'), lock).toEqual([]);
    }
    const toolchains: Record<string, Record<string, string>> = {
      engines: { 'package.json': PKG({ engines: { node: '>=20.19' } }) },
      volta: { 'package.json': PKG({ volta: { node: '22.1.0' } }) },
      toolVersions: { 'package.json': PKG(), '.tool-versions': 'nodejs 22.1.0\n' },
    };
    for (const [name, files] of Object.entries(toolchains)) {
      const dir = await project({ 'yarn.lock': '# yarn\n', ...files });
      expect(await violations(dir, 'reproducible-install'), name).toEqual([]);
    }
  });

  it('fails a JS project with no lockfile', async () => {
    const dir = await project({ 'package.json': PKG(), '.nvmrc': '22' });
    const found = await violations(dir, 'reproducible-install');
    expect(found).toHaveLength(1);
    expect(found[0]?.subject).toBe('javascript');
    expect(found[0]?.message).toContain('lockfile');
    expect(found[0]?.remedy).toMatch(/^Commit /);
  });

  it('fails an empty lockfile, and one that is only in the working tree', async () => {
    const empty = await project({ 'package.json': PKG(), 'pnpm-lock.yaml': '', '.nvmrc': '22' });
    expect((await violations(empty, 'reproducible-install')).length).toBe(1);
    const { dir } = await createTestProject();
    await writeAndCommit(dir, { 'package.json': PKG(), '.nvmrc': '22' });
    await writeUncommitted(dir, { 'pnpm-lock.yaml': "lockfileVersion: '9.0'\n" });
    const found = await violations(dir, 'reproducible-install');
    expect(found).toHaveLength(1);
    expect(found[0]?.message).toContain('not committed');
  });

  it('fails a JS project that declares no toolchain version, and a .tool-versions with no node entry', async () => {
    const none = await project({ 'package.json': PKG(), 'yarn.lock': '# y\n' });
    const found = await violations(none, 'reproducible-install');
    expect(found).toHaveLength(1);
    expect(found[0]?.message).toContain('toolchain');
    const other = await project({
      'package.json': PKG(),
      'yarn.lock': '# y\n',
      '.tool-versions': 'python 3.12\n',
    });
    expect((await violations(other, 'reproducible-install')).length).toBe(1);
  });

  it('a malformed package.json is a violation naming the file', async () => {
    const dir = await project({ 'package.json': '{ nope', 'yarn.lock': '# y\n' });
    const found = await violations(dir, 'reproducible-install');
    expect(found.some((v) => v.subject === 'package.json')).toBe(true);
  });

  it('Python: a lock file plus a declared version passes; unpinned requirements fail, naming the line', async () => {
    const locked = await project({
      'pyproject.toml': '[project]\nname = "x"\nrequires-python = ">=3.11"\n',
      'uv.lock': 'version = 1\n',
    });
    expect(await violations(locked, 'reproducible-install')).toEqual([]);

    const pinned = await project({
      'requirements.txt':
        '# pins\nflask==3.0.0 \\\n  --hash=sha256:abc\nrequests===2.31.0\n-r base.txt\n',
      '.python-version': '3.12\n',
    });
    expect(await violations(pinned, 'reproducible-install')).toEqual([]);

    const loose = await project({
      'requirements.txt': 'flask==3.0.0\nrequests>=2\n',
      '.python-version': '3.12\n',
    });
    const found = await violations(loose, 'reproducible-install');
    expect(found).toHaveLength(1);
    expect(found[0]?.subject).toBe('python');
    expect(found[0]?.message).toContain('requests>=2');
  });

  it('Python: no lock and no pinned requirements fails; no declared interpreter version fails', async () => {
    const noLock = await project({ 'pyproject.toml': '[project]\nrequires-python = ">=3.11"\n' });
    expect((await violations(noLock, 'reproducible-install')).length).toBe(1);
    const noVersion = await project({
      'pyproject.toml': '[project]\nname = "x"\n',
      'uv.lock': 'v\n',
    });
    const found = await violations(noVersion, 'reproducible-install');
    expect(found).toHaveLength(1);
    expect(found[0]?.message).toContain('toolchain');
  });

  it('Rust: Cargo.lock and rust-toolchain(.toml) or rust-version; without them it fails', async () => {
    const ok = await project({
      'Cargo.toml': '[package]\nname="x"\n',
      'Cargo.lock': '# lock\n',
      'rust-toolchain.toml': '[toolchain]\nchannel = "1.80"\n',
    });
    expect(await violations(ok, 'reproducible-install')).toEqual([]);
    const withVersion = await project({
      'Cargo.toml': '[package]\nname="x"\nrust-version = "1.80"\n',
      'Cargo.lock': '# lock\n',
    });
    expect(await violations(withVersion, 'reproducible-install')).toEqual([]);
    const bare = await project({ 'Cargo.toml': '[package]\nname="x"\n' });
    expect((await violations(bare, 'reproducible-install')).length).toBe(2);
  });

  it('Go: a go directive always; go.sum only when go.mod requires something', async () => {
    const noDeps = await project({ 'go.mod': 'module x\n\ngo 1.22\n' });
    expect(await violations(noDeps, 'reproducible-install')).toEqual([]);
    const deps = await project({
      'go.mod': 'module x\n\ngo 1.22\n\nrequire github.com/a/b v1.0.0\n',
    });
    const found = await violations(deps, 'reproducible-install');
    expect(found).toHaveLength(1);
    expect(found[0]?.message).toContain('go.sum');
  });

  it('Go: a go.mod with no go directive declares no toolchain version', async () => {
    const found = await violations(
      await project({ 'go.mod': 'module x\n' }),
      'reproducible-install',
    );
    expect(found).toHaveLength(1);
    expect(found[0]?.message).toContain('go directive');
  });

  it('a recognised ecosystem with no lock convention we can verify (Maven) fails rather than passing', async () => {
    const dir = await project({ 'pom.xml': '<project/>' });
    const found = await violations(dir, 'reproducible-install');
    expect(found).toHaveLength(1);
    expect(found[0]?.subject).toBe('maven');
  });

  it('every ecosystem present must be reproducible: JS fine, Python missing its lock fails only Python', async () => {
    const dir = await project({
      ...NODE_OK,
      'pyproject.toml': '[project]\nrequires-python=">=3.11"\n',
    });
    const found = await violations(dir, 'reproducible-install');
    expect(found.map((v) => v.subject)).toEqual(['python']);
  });

  it('a repository with no recognised dependency manifest fails', async () => {
    const found = await violations(await project({ 'README.md': 'hi' }), 'reproducible-install');
    expect(found).toHaveLength(1);
    expect(found[0]?.subject).toBe('install');
  });

  it('is deterministic', async () => {
    const dir = await project({ 'package.json': PKG(), 'pyproject.toml': '[project]\nname="x"\n' });
    expect(JSON.stringify(await violations(dir, 'reproducible-install'))).toBe(
      JSON.stringify(await violations(dir, 'reproducible-install')),
    );
  });
});

describe('ci-skeleton', () => {
  const GITHUB_OK = `name: ci
on:
  pull_request:
  push:
    branches: [main]
jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@0000000000000000000000000000000000000000
      - run: make verify
`;

  it('passes a committed GitHub Actions workflow with a job that has steps', async () => {
    const dir = await project({ '.github/workflows/ci.yml': GITHUB_OK });
    expect(await violations(dir, 'ci-skeleton')).toEqual([]);
  });

  it('passes a job that calls a reusable workflow, and the .yaml extension', async () => {
    const dir = await project({
      '.github/workflows/ci.yaml':
        'on: push\njobs:\n  call:\n    uses: ./.github/workflows/reusable.yml\n',
    });
    expect(await violations(dir, 'ci-skeleton')).toEqual([]);
  });

  it('passes the other platforms minimal valid pipeline files', async () => {
    const cases: Record<string, Record<string, string>> = {
      gitlab: {
        '.gitlab-ci.yml': 'stages: [test]\ntest:\n  stage: test\n  script:\n    - make verify\n',
      },
      circle: {
        '.circleci/config.yml': 'version: 2.1\njobs:\n  build:\n    docker: []\n    steps: []\n',
      },
      azure: { 'azure-pipelines.yml': 'trigger: [main]\nsteps:\n  - script: make verify\n' },
      bitbucket: {
        'bitbucket-pipelines.yml':
          'pipelines:\n  default:\n    - step:\n        script: [make verify]\n',
      },
      buildkite: { '.buildkite/pipeline.yml': 'steps:\n  - command: make verify\n' },
      jenkins: {
        Jenkinsfile:
          'pipeline {\n  agent any\n  stages { stage("v") { steps { sh "make verify" } } }\n}\n',
      },
    };
    for (const [name, files] of Object.entries(cases)) {
      expect(await violations(await project(files), 'ci-skeleton'), name).toEqual([]);
    }
  });

  it('fails when there is no pipeline definition, and ci/ scripts alone are not one', async () => {
    const found = await violations(await project({ 'ci/sbom.sh': '#!/bin/sh\n' }), 'ci-skeleton');
    expect(found).toHaveLength(1);
    expect(found[0]?.subject).toBe('ci');
    expect(found[0]?.message).toContain('.github/workflows');
    expect(found[0]?.remedy).toMatch(/^Add /);
  });

  it('fails a workflow that is not valid YAML, is empty, or has no jobs or no steps', async () => {
    const bad: Record<string, string> = {
      notYaml: 'jobs: [unclosed',
      empty: '',
      noJobs: 'on: push\nname: x\n',
      emptyJobs: 'on: push\njobs: {}\n',
      noSteps: 'on: push\njobs:\n  a:\n    runs-on: x\n',
      emptySteps: 'on: push\njobs:\n  a:\n    runs-on: x\n    steps: []\n',
      list: '- a\n- b\n',
    };
    for (const [name, text] of Object.entries(bad)) {
      const found = await violations(
        await project({ '.github/workflows/ci.yml': text }),
        'ci-skeleton',
      );
      expect(found.length, name).toBeGreaterThanOrEqual(1);
      expect(found[0]?.subject, name).toBe('.github/workflows/ci.yml');
    }
  });

  it('one valid workflow does not excuse a broken one beside it', async () => {
    const dir = await project({
      '.github/workflows/ci.yml': GITHUB_OK,
      '.github/workflows/deploy.yml': 'jobs: [oops',
    });
    const found = await violations(dir, 'ci-skeleton');
    expect(found.map((v) => v.subject)).toEqual(['.github/workflows/deploy.yml']);
  });

  it('a workflow present only in the working tree is not part of a clean clone', async () => {
    const { dir } = await createTestProject();
    await writeUncommitted(dir, { '.github/workflows/ci.yml': GITHUB_OK });
    const found = await violations(dir, 'ci-skeleton');
    expect(found).toHaveLength(1);
    expect(found[0]?.message).toContain('not committed');
  });

  it('a Jenkinsfile that is not a pipeline fails', async () => {
    const dir = await project({ Jenkinsfile: '// nothing\n' });
    expect((await violations(dir, 'ci-skeleton')).length).toBe(1);
  });

  it('a directory that is not a git repository fails with a git violation', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'forge-rule-nogit-'));
    registerCleanup(dir);
    await writeUncommitted(dir, { '.github/workflows/ci.yml': GITHUB_OK });
    const found = await violations(dir, 'ci-skeleton');
    expect(found.map((v) => v.subject)).toEqual(['git']);
  });

  it('is deterministic', async () => {
    const dir = await project({
      '.github/workflows/b.yml': 'jobs: [x',
      '.github/workflows/a.yml': '',
    });
    const found = await violations(dir, 'ci-skeleton');
    expect(JSON.stringify(found)).toBe(JSON.stringify(await violations(dir, 'ci-skeleton')));
    expect(found.map((v) => v.subject)).toEqual([
      '.github/workflows/a.yml',
      '.github/workflows/b.yml',
    ]);
  });
});
