/**
 * `fetchNpmOverlay` — `19` §19.5's npm channel. `PLAN-M11.md` P2's own literal Checks: a real
 * `npm pack` round-trips correctly against a real (fixture) registry; a tampered/corrupted tarball
 * fails the integrity check with a named error; a private-registry config is read and respected, not
 * silently ignored.
 *
 * @see specs/19 §19.5
 * @see PLAN-M11.md P2
 */
import { isForgeError } from '@forge/core';
import { execa } from 'execa';
import { readdir, readFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  fetchNpmOverlay,
  parseNpmOverlaySpec,
  parseNpmPackJson,
  verifyTarballIntegrity,
} from '../../src/install/fetch-npm.ts';
import { startNpmFixtureRegistry, type NpmFixtureRegistry } from './npm-fixture-registry.ts';

const dirs: string[] = [];
const registries: NpmFixtureRegistry[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  await Promise.all(registries.splice(0).map((registry) => registry.close()));
});

async function freshDir(prefix = 'forge-extensions-fetch-npm-'): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

async function projectWithNpmrc(npmrcContent: string): Promise<string> {
  const dir = await freshDir('forge-extensions-fetch-npm-project-');
  await writeFile(path.join(dir, '.npmrc'), npmrcContent);
  return dir;
}

async function expectForgeError(promise: Promise<unknown>, code: string): Promise<void> {
  try {
    await promise;
    expect.unreachable('fetchNpmOverlay should have thrown');
  } catch (error) {
    expect(isForgeError(error)).toBe(true);
    if (isForgeError(error)) expect(error.code).toBe(code);
  }
}

describe('parseNpmOverlaySpec', () => {
  it('parses npm:@scope/name with no version', () => {
    expect(parseNpmOverlaySpec('npm:@acme/forge-standards')).toEqual({
      scope: 'acme',
      name: 'forge-standards',
      version: undefined,
    });
  });

  it('parses npm:@scope/name@version', () => {
    expect(parseNpmOverlaySpec('npm:@acme/forge-standards@1.2.3')).toEqual({
      scope: 'acme',
      name: 'forge-standards',
      version: '1.2.3',
    });
  });

  it.each([
    ['missing the npm: prefix', '@acme/forge-standards'],
    ['missing a scope entirely', 'npm:forge-standards'],
    ['an empty scope', 'npm:@/forge-standards'],
    ['an uppercase name', 'npm:@acme/Forge-Standards'],
    ['a version shaped like a CLI flag', 'npm:@acme/forge-standards@--evil'],
    ['a version containing whitespace', 'npm:@acme/forge-standards@1 2 3'],
    ['no name after the scope', 'npm:@acme/'],
  ])('rejects a spec %s (%s)', (_label, spec) => {
    expect(() => parseNpmOverlaySpec(spec)).toThrow();
    try {
      parseNpmOverlaySpec(spec);
    } catch (error) {
      expect(isForgeError(error)).toBe(true);
      if (isForgeError(error)) expect(error.code).toBe('CFG-029');
    }
  });
});

describe('verifyTarballIntegrity', () => {
  it('refuses a missing tarball with a named error, not a raw fs exception', async () => {
    const dir = await freshDir();
    await expectForgeError(
      verifyTarballIntegrity(path.join(dir, 'does-not-exist.tgz'), 'sha512-AAAA', 'npm:@x/y'),
      'CFG-030',
    );
  });

  it('accepts a real tarball against its own real npm-reported integrity', async () => {
    const srcDir = await freshDir();
    const outDir = await freshDir();
    await writeFile(
      path.join(srcDir, 'package.json'),
      JSON.stringify({ name: 'integrity-check-fixture', version: '1.0.0' }),
    );
    const { stdout } = await execa('npm', ['pack', '.', '--json', '--pack-destination', outDir], {
      cwd: srcDir,
    });
    const [{ filename, integrity }] = JSON.parse(stdout) as [
      { filename: string; integrity: string },
    ];
    await expect(
      verifyTarballIntegrity(path.join(outDir, filename), integrity, 'npm:@x/y'),
    ).resolves.toBeUndefined();
  });

  it('refuses a tarball whose on-disk bytes were tampered with after npm reported its integrity', async () => {
    const srcDir = await freshDir();
    const outDir = await freshDir();
    await writeFile(
      path.join(srcDir, 'package.json'),
      JSON.stringify({ name: 'integrity-check-fixture', version: '1.0.0' }),
    );
    const { stdout } = await execa('npm', ['pack', '.', '--json', '--pack-destination', outDir], {
      cwd: srcDir,
    });
    const [{ filename, integrity }] = JSON.parse(stdout) as [
      { filename: string; integrity: string },
    ];
    const tarballPath = path.join(outDir, filename);
    const bytes = await readFile(tarballPath);
    bytes[0] = (bytes[0] ?? 0) ^ 0xff; // a single flipped byte — a corrupted write, or tampering
    await writeFile(tarballPath, bytes);

    await expectForgeError(verifyTarballIntegrity(tarballPath, integrity, 'npm:@x/y'), 'CFG-031');
  });

  it('refuses an integrity value using an unsupported algorithm', async () => {
    const srcDir = await freshDir();
    const outDir = await freshDir();
    await writeFile(
      path.join(srcDir, 'package.json'),
      JSON.stringify({ name: 'integrity-check-fixture', version: '1.0.0' }),
    );
    await execa('npm', ['pack', '.', '--pack-destination', outDir], { cwd: srcDir });
    const [filename] = await readdir(outDir);
    await expectForgeError(
      verifyTarballIntegrity(path.join(outDir, filename!), 'md5-deadbeef', 'npm:@x/y'),
      'CFG-030',
    );
  });

  it('refuses a tarball larger than a caller-supplied byte cap without reading it unbounded', async () => {
    const srcDir = await freshDir();
    const outDir = await freshDir();
    await writeFile(
      path.join(srcDir, 'package.json'),
      JSON.stringify({ name: 'integrity-check-fixture', version: '1.0.0' }),
    );
    // A real, valid tarball that just happens to exceed a deliberately tiny test-only cap — proving
    // the cap fires on a genuinely oversized file, not only a bomb-shaped one (`tar-extract.ts`'s own
    // decompression-bomb guard already covers the "small on disk, huge decompressed" shape; this is
    // the sibling guard over the compressed file this function reads directly).
    // Random, incompressible bytes — a highly-compressible payload (e.g. all zeros) could pack down
    // to less than the test's own byte cap even at 4 KiB, since `npm pack` gzips its output.
    const { randomBytes } = await import('node:crypto');
    await writeFile(path.join(srcDir, 'padding.bin'), randomBytes(4096));
    const { stdout } = await execa('npm', ['pack', '.', '--json', '--pack-destination', outDir], {
      cwd: srcDir,
    });
    const [{ filename, integrity }] = JSON.parse(stdout) as [
      { filename: string; integrity: string },
    ];
    await expectForgeError(
      verifyTarballIntegrity(path.join(outDir, filename), integrity, 'npm:@x/y', 1024),
      'CFG-033',
    );
  });
});

describe('parseNpmPackJson', () => {
  it('refuses a packed entry that is not an object (e.g. null) rather than crashing on property access', () => {
    expect(() => parseNpmPackJson(JSON.stringify([null]), 'npm:@x/y')).toThrow();
    try {
      parseNpmPackJson(JSON.stringify([null]), 'npm:@x/y');
      expect.unreachable('parseNpmPackJson should have thrown');
    } catch (error) {
      expect(isForgeError(error)).toBe(true);
      if (isForgeError(error)) expect(error.code).toBe('CFG-030');
    }
  });

  it('refuses a packed entry that is a primitive (e.g. a string)', () => {
    try {
      parseNpmPackJson(JSON.stringify(['oops']), 'npm:@x/y');
      expect.unreachable('parseNpmPackJson should have thrown');
    } catch (error) {
      expect(isForgeError(error)).toBe(true);
      if (isForgeError(error)) expect(error.code).toBe('CFG-030');
    }
  });

  it('refuses a top-level value that is not an array', () => {
    try {
      parseNpmPackJson(JSON.stringify({ filename: 'x.tgz', integrity: 'sha512-a' }), 'npm:@x/y');
      expect.unreachable('parseNpmPackJson should have thrown');
    } catch (error) {
      expect(isForgeError(error)).toBe(true);
      if (isForgeError(error)) expect(error.code).toBe('CFG-030');
    }
  });

  it('refuses a genuinely empty array', () => {
    try {
      parseNpmPackJson(JSON.stringify([]), 'npm:@x/y');
      expect.unreachable('parseNpmPackJson should have thrown');
    } catch (error) {
      expect(isForgeError(error)).toBe(true);
      if (isForgeError(error)) expect(error.code).toBe('CFG-030');
    }
  });

  it('parses a real filename/integrity pair', () => {
    const stdout = JSON.stringify([{ filename: 'pkg-1.0.0.tgz', integrity: 'sha512-abcd' }]);
    expect(parseNpmPackJson(stdout, 'npm:@x/y')).toEqual({
      filename: 'pkg-1.0.0.tgz',
      integrity: 'sha512-abcd',
    });
  });
});

describe('fetchNpmOverlay', () => {
  it('round-trips a real npm pack against a real fixture registry configured via the project .npmrc', async () => {
    const registry = await startNpmFixtureRegistry([
      {
        scope: 'fixture',
        name: 'overlay-fixture',
        version: '1.0.0',
        files: {
          'overlay.yaml': 'name: fixture-overlay\nversion: 1.0.0\n',
          'skills/example.md': '# Example\n',
        },
      },
    ]);
    registries.push(registry);
    const projectDir = await projectWithNpmrc(`registry=${registry.url}\n`);
    const workDir = await freshDir();

    const result = await fetchNpmOverlay('npm:@fixture/overlay-fixture@1.0.0', {
      workDir,
      cwd: projectDir,
    });

    expect(result.manifestKind).toBe('overlay');
    expect((await readFile(path.join(result.path, 'overlay.yaml'))).toString('utf8')).toBe(
      'name: fixture-overlay\nversion: 1.0.0\n',
    );
    expect((await readFile(path.join(result.path, 'skills', 'example.md'))).toString('utf8')).toBe(
      '# Example\n',
    );
    expect(result.checksum).toMatch(/^[0-9a-f]{64}$/);
    expect(result.integrity).toMatch(/^sha\d+-/);
  });

  it('resolves an unversioned spec to dist-tags.latest', async () => {
    const registry = await startNpmFixtureRegistry([
      {
        scope: 'fixture',
        name: 'latest-fixture',
        version: '2.5.0',
        files: { 'module.yaml': 'id: fm-fixture\nversion: 2.5.0\n' },
      },
    ]);
    registries.push(registry);
    const projectDir = await projectWithNpmrc(`registry=${registry.url}\n`);
    const workDir = await freshDir();

    const result = await fetchNpmOverlay('npm:@fixture/latest-fixture', {
      workDir,
      cwd: projectDir,
    });

    expect(result.manifestKind).toBe('module');
  });

  it('reads and respects a scoped, private-registry .npmrc entry — not the project default registry', async () => {
    const defaultRegistry = await startNpmFixtureRegistry([]); // hosts nothing at all
    const privateRegistry = await startNpmFixtureRegistry([
      {
        scope: 'priv',
        name: 'internal-standards',
        version: '3.0.0',
        files: { 'overlay.yaml': 'name: internal-standards\nversion: 3.0.0\n' },
      },
    ]);
    registries.push(defaultRegistry, privateRegistry);
    const projectDir = await projectWithNpmrc(
      `registry=${defaultRegistry.url}\n@priv:registry=${privateRegistry.url}\n`,
    );
    const workDir = await freshDir();

    const result = await fetchNpmOverlay('npm:@priv/internal-standards@3.0.0', {
      workDir,
      cwd: projectDir,
    });

    expect(result.manifestKind).toBe('overlay');
    // The scoped registry's own request log actually saw this fetch...
    expect(
      privateRegistry.requestLog.some(
        (entry) => decodeURIComponent(entry) === '/@priv/internal-standards',
      ),
    ).toBe(true);
    // ...and the default registry (which hosts nothing) never did — proving the scoped `.npmrc`
    // entry was read and respected, not silently ignored in favour of the project default.
    expect(defaultRegistry.requestLog.length).toBe(0);
  });

  it('fails with a named error when the configured registry does not host the package', async () => {
    const registry = await startNpmFixtureRegistry([]); // hosts nothing
    registries.push(registry);
    const projectDir = await projectWithNpmrc(`registry=${registry.url}\n`);
    const workDir = await freshDir();

    await expectForgeError(
      fetchNpmOverlay('npm:@nope/does-not-exist@1.0.0', { workDir, cwd: projectDir }),
      'CFG-030',
    );
  });

  it('refuses a fetched package with no overlay.yaml/module.yaml, leaving no leaked scratch directory', async () => {
    const registry = await startNpmFixtureRegistry([
      {
        scope: 'fixture',
        name: 'no-manifest',
        version: '1.0.0',
        files: { 'README.md': 'not a manifest\n' },
      },
    ]);
    registries.push(registry);
    const projectDir = await projectWithNpmrc(`registry=${registry.url}\n`);
    const workDir = await freshDir();

    await expectForgeError(
      fetchNpmOverlay('npm:@fixture/no-manifest@1.0.0', { workDir, cwd: projectDir }),
      'CFG-027',
    );

    // No `npm-pack-*`/`npm-content-*` scratch directory left behind under `workDir` — the identical
    // "clean up on any failure past mkdtemp" discipline the git channel's own gauntlet round
    // established (`GAUNTLET-LOG.md`'s M11 P1 entry, finding 1).
    expect(await readdir(workDir)).toEqual([]);
  });
});
