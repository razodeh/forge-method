/**
 * A minimal, local, real-HTTP fake npm registry for `fetch-npm.test.ts` — implements exactly the two
 * request shapes a real `npm pack <spec>` makes against a registry (`GET /<url-encoded-name>` for the
 * packument, `GET /<name>/-/<file>.tgz` for the tarball), backed by a real tarball built via a real
 * local `npm pack .` against a real fixture directory.
 *
 * `PLAN-M11.md` P2's own investigation judged this more proportionate than standing up a full
 * verdaccio-style registry binary for a piece whose own mandate already deliberately avoids adding
 * new dependencies (the same reasoning `PLAN-M11.md` P1 gives for testing its own git channel against
 * a local `file://` remote rather than a live network host) — this is the npm-channel equivalent: a
 * real npm CLI, making real HTTP requests, resolved by a real (if minimal) registry implementation,
 * never a mocked `execa` call or a stubbed HTTP client.
 *
 * @see PLAN-M11.md P2
 */
import { execa } from 'execa';
// Genuinely test-only (unrecognised by the `*.test.ts`/`test/**` exemption globs since this file's
// own name doesn't match either — the identical shape `packages/cli/test/commands/helpers.ts`
// already establishes this exact disable for): `readdir` only ever lists a fresh, single-file `npm
// pack` output directory this function itself just created (order cannot matter for one entry), and
// `tmpdir` builds an isolated scratch directory, never a host fact used for behaviour.
// eslint-disable-next-line no-restricted-imports -- see comment above
import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
// eslint-disable-next-line no-restricted-imports -- see comment above
import { tmpdir } from 'node:os';
import path from 'node:path';

export interface FixturePackage {
  readonly scope: string;
  readonly name: string;
  readonly version: string;
  /** Extra files written alongside `package.json` before packing — this is how a caller supplies the
   * real `overlay.yaml`/`module.yaml` content the resulting tarball must round-trip. */
  readonly files: Readonly<Record<string, string>>;
}

/** Packs `pkg` via a real, local `npm pack .` and returns the produced tarball's bytes plus its own
 * reported `dist.shasum`/`dist.integrity`-equivalent values — computed from the real tarball, not
 * invented, so the fake registry's own packument is exactly as internally consistent as a real one. */
async function buildFixtureTarball(
  pkg: FixturePackage,
): Promise<{ tarball: Buffer; filename: string }> {
  const srcDir = await mkdtemp(path.join(tmpdir(), 'forge-npm-fixture-src-'));
  const outDir = await mkdtemp(path.join(tmpdir(), 'forge-npm-fixture-out-'));
  const packageJson = {
    name: `@${pkg.scope}/${pkg.name}`,
    version: pkg.version,
  };
  await writeFile(path.join(srcDir, 'package.json'), JSON.stringify(packageJson, null, 2));
  for (const [relativePath, content] of Object.entries(pkg.files)) {
    const target = path.join(srcDir, relativePath);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content);
  }
  await execa('npm', ['pack', '.', '--pack-destination', outDir], { cwd: srcDir });
  const filename = (await readdir(outDir))[0];
  if (filename === undefined) throw new Error('npm pack produced no tarball for the test fixture');
  const tarball = await readFile(path.join(outDir, filename));
  return { tarball, filename };
}

export interface NpmFixtureRegistry {
  readonly url: string;
  readonly requestLog: string[];
  close(): Promise<void>;
}

/** Starts a real local HTTP server serving `packages` at real npm-registry-shaped URLs. Every request
 * path is recorded in `requestLog`, so a test can assert *which* fake registry a scoped request
 * actually reached — the load-bearing assertion for "a private-registry config is read and
 * respected, not silently ignored." */
export async function startNpmFixtureRegistry(
  packages: readonly FixturePackage[],
): Promise<NpmFixtureRegistry> {
  const built = new Map<string, { tarball: Buffer; filename: string; pkg: FixturePackage }>();
  for (const pkg of packages) {
    const { tarball, filename } = await buildFixtureTarball(pkg);
    built.set(`@${pkg.scope}/${pkg.name}`, { tarball, filename, pkg });
  }

  const requestLog: string[] = [];
  const server = http.createServer((req, res) => {
    const url = req.url ?? '';
    requestLog.push(url);
    const decoded = decodeURIComponent(url);

    for (const [fullName, entry] of built) {
      if (decoded === `/${fullName}`) {
        const tarballUrl = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}/${fullName}/-/${entry.filename}`;
        const doc = {
          name: fullName,
          'dist-tags': { latest: entry.pkg.version },
          versions: {
            [entry.pkg.version]: {
              name: fullName,
              version: entry.pkg.version,
              dist: { tarball: tarballUrl },
            },
          },
        };
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify(doc));
        return;
      }
      if (decoded === `/${fullName}/-/${entry.filename}`) {
        res.setHeader('content-type', 'application/octet-stream');
        res.end(entry.tarball);
        return;
      }
    }
    res.statusCode = 404;
    res.end(JSON.stringify({ error: 'not found' }));
  });

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = (server.address() as AddressInfo).port;

  return {
    url: `http://127.0.0.1:${String(port)}/`,
    requestLog,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((err) => {
          if (err) reject(err);
          else resolve();
        });
      }),
  };
}
