/**
 * `fetchNpmOverlay` — the third `19` §19.5 distribution channel: `npm:@scope/name` or
 * `npm:@scope/name@version`, resolved by shelling out to the real, already-installed `npm` CLI
 * (`PLAN-M11.md` P2's own recorded Surface deviation) rather than adding a new dependency
 * (`pacote`/`tar`) this workspace does not otherwise need.
 *
 * The registry itself is never chosen by this module: `npm pack` runs with `cwd: options.cwd`, so
 * npm's own real config resolution (a project `.npmrc`, then the user's, then the global one) governs
 * which registry — including a scoped, private one (`@scope:registry=...`) — a given spec resolves
 * against, exactly as it would for any other real `npm` invocation from that directory. Reimplementing
 * `.npmrc` parsing here would duplicate a format the already-shelled-to `npm` binary already parses
 * correctly (including credential/auth-token handling this module has no business touching), which is
 * the same "reuse the real tool" reasoning `PLAN-M11.md` P2's own Surface deviation already gives for
 * shelling out to `npm pack` in the first place.
 *
 * @see specs/19 §19.5
 * @see PLAN-M11.md P2
 */
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';

import { ForgeError, isForgeError } from '@forge/core';
import { computeContentChecksum } from '@forge/vcs';
import { execa } from 'execa';

import { findManifestKind, type OverlayManifestKind } from './manifest.ts';
import { DEFAULT_MAX_DECOMPRESSED_BYTES, extractNpmTarball } from './tar-extract.ts';
import { vcsFailureDetails } from './vcs-error.ts';

const NPM_PREFIX = 'npm:';

/** `@scope`/`name` segments: lowercase letters, digits, `.`, `_`, `-`, matching real npm package-name
 * rules closely enough for this parser's own purpose (refusing an obviously-malformed spec before it
 * ever reaches `execa`) without re-deriving npm's full, considerably longer validation. */
const NAME_SEGMENT = /^[a-z0-9][a-z0-9._-]*$/;

export interface NpmOverlaySpec {
  readonly scope: string;
  readonly name: string;
  /** `undefined` selects whatever `dist-tags.latest` resolves to at the configured registry — `19`
   * §19.5's own literal format makes the version segment optional. */
  readonly version: string | undefined;
}

/** Reads capture group `index` from `match`, for a group that is mandatory (no `?`) in the pattern
 * that produced the match — safe by construction, but `RegExpExecArray`'s own type marks every
 * group `string | undefined` regardless, with no way to express "this one always matches" in the
 * type of a regex literal. `as string`, not `!`: `!` is banned (`no-non-null-assertion`) in this
 * codebase's own `src/**`, with an explicit, commented `as` cast used instead at the identical
 * "the pattern guarantees this, the type checker cannot see it" shape —
 * `packages/kb/src/adopt/inventory.ts`'s own `requiredGroup` precedent, followed here rather than
 * reinvented. */
function requiredGroup(match: RegExpExecArray, index: number): string {
  // eslint-disable-next-line @typescript-eslint/non-nullable-type-assertion-style -- `!` is banned; see doc comment above.
  return match[index] as string;
}

/** A caller-supplied version shaped like a CLI flag (leading `-`) is not safely rejected by `npm`
 * itself once concatenated into one `<name>@<version>` argv token (the identical, empirically
 * established hazard `@forge/vcs`'s own `assertSafeSpecPart` already guards for a different call
 * site) — rejected here, once, before it is ever joined into that token. */
function assertSafeVersion(version: string, spec: string): void {
  if (version === '' || version.startsWith('-') || /\s/.test(version)) {
    throw new ForgeError('CFG-029', { spec });
  }
}

/**
 * Parses `19` §19.5's own literal `npm:@scope/name` / `npm:@scope/name@version` format.
 *
 * @throws {ForgeError} `CFG-029` if `spec` does not match either literal form.
 */
export function parseNpmOverlaySpec(spec: string): NpmOverlaySpec {
  if (!spec.startsWith(NPM_PREFIX)) {
    throw new ForgeError('CFG-029', { spec });
  }
  const rest = spec.slice(NPM_PREFIX.length);
  const match = /^(@[^/\s@]+)\/([^@\s]+)(?:@(.+))?$/.exec(rest);
  if (match === null) {
    throw new ForgeError('CFG-029', { spec });
  }
  // Groups 1 (`@scope`) and 2 (`name`) are both mandatory in the pattern above (neither sits inside
  // a `(?:...)?`), so they are always defined once `match` is non-null — only group 3 (`version`) is
  // genuinely optional, read directly rather than through `requiredGroup`.
  const rawScope = requiredGroup(match, 1);
  const name = requiredGroup(match, 2);
  const version = match[3];
  const scope = rawScope.slice(1); // drop the leading "@" for the charset check below
  if (!NAME_SEGMENT.test(scope) || !NAME_SEGMENT.test(name)) {
    throw new ForgeError('CFG-029', { spec });
  }
  if (version !== undefined) assertSafeVersion(version, spec);
  return { scope, name, version };
}

function toNpmPackArg(parsed: NpmOverlaySpec): string {
  const base = `@${parsed.scope}/${parsed.name}`;
  return parsed.version === undefined ? base : `${base}@${parsed.version}`;
}

export interface NpmPackJsonEntry {
  readonly filename: string;
  readonly integrity: string;
}

/** `npm pack --json`'s own documented, but not itself type-checked, stdout shape — validated here
 * rather than trusted, since this function's own contract is "never leak a raw parse/shape failure
 * past a typed `ForgeError`." */
export function parseNpmPackJson(stdout: string, spec: string): NpmPackJsonEntry {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch (cause) {
    throw new ForgeError(
      'CFG-030',
      { spec, detail: 'npm pack produced output that is not valid JSON' },
      { cause },
    );
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new ForgeError('CFG-030', { spec, detail: 'npm pack produced no packed entries' });
  }
  const rawEntry: unknown = parsed[0];
  // A critic round found the first draft indexed `parsed[0]` as a `Record<string, unknown>` without
  // checking it is even an object first — a real, malformed `npm pack --json` output whose first
  // array element is `null` (or any other non-object primitive) would throw a raw `TypeError` here,
  // reaching past this function's own documented "throws only `ForgeError`" contract.
  if (typeof rawEntry !== 'object' || rawEntry === null) {
    throw new ForgeError('CFG-030', {
      spec,
      detail: 'npm pack produced a packed entry that is not an object',
    });
  }
  const entry = rawEntry as Record<string, unknown>;
  const filename = entry['filename'];
  const integrity = entry['integrity'];
  if (typeof filename !== 'string' || typeof integrity !== 'string') {
    throw new ForgeError('CFG-030', {
      spec,
      detail: 'npm pack output is missing a filename or integrity field',
    });
  }
  return { filename, integrity };
}

/** Parses an SRI string (`<algorithm>-<base64-digest>`, e.g. `sha512-abcd...==`) into its two parts. */
function parseIntegrity(integrity: string, spec: string): { algorithm: string; digest: string } {
  const match = /^([a-z0-9]+)-(.+)$/i.exec(integrity);
  if (match === null) {
    throw new ForgeError('CFG-030', {
      spec,
      detail: `npm pack reported an unparseable integrity value (${JSON.stringify(integrity)})`,
    });
  }
  // Both groups are mandatory in the pattern above — read via `requiredGroup`, the identical
  // "pattern guarantees it, the type checker cannot see it" shape `parseNpmOverlaySpec` uses.
  const algorithm = requiredGroup(match, 1).toLowerCase();
  const digest = requiredGroup(match, 2);
  return { algorithm, digest };
}

/** Hashes `filePath`'s real on-disk bytes without ever buffering the whole file into memory at once
 * — a critic round found the first draft's plain `readFile` gave up exactly the guarantee
 * `tar-extract.ts`'s own decompression-bomb guard was built to provide, one step earlier in the same
 * pipeline: a hostile or compromised registry serving an oversized (or outright bomb-shaped) tarball
 * would be read into one unbounded `Buffer` here, before any of the size checks downstream ever ran.
 * `maxBytes` defaults to `DEFAULT_MAX_DECOMPRESSED_BYTES` (the packed tarball for a real overlay/
 * module bundle is always tiny) but is overridable so a test can exercise the cap without needing to
 * construct a file anywhere near the real, generous default. */
async function hashFileCapped(
  filePath: string,
  algorithm: string,
  maxBytes: number,
  spec: string,
): Promise<string> {
  const hash = createHash(algorithm);
  let total = 0;
  try {
    for await (const chunk of createReadStream(filePath)) {
      total += (chunk as Buffer).length;
      if (total > maxBytes) {
        throw new ForgeError('CFG-033', { limit: maxBytes });
      }
      hash.update(chunk as Buffer);
    }
  } catch (cause) {
    // A second critic round found this loop had no `try`/`catch` at all: a missing/deleted/
    // unreadable tarball (`ENOENT`, `EACCES`, a `filename` `npm pack --json` reported that does not
    // actually exist on disk) surfaced as a raw Node stream error, reaching past this function's own
    // (and `verifyTarballIntegrity`'s) documented "throws only `ForgeError`" contract — the identical
    // bug class the first round already fixed in `parseNpmPackJson`, just in a sibling function that
    // fix did not touch.
    if (isForgeError(cause)) throw cause;
    const detail = cause instanceof Error ? cause.message : String(cause);
    throw new ForgeError(
      'CFG-030',
      { spec, detail: `could not read the packed tarball: ${detail}` },
      {
        cause,
      },
    );
  }
  return hash.digest('base64');
}

/**
 * Recomputes the SRI hash of the real, on-disk `tarballPath` and compares it against `integrity` —
 * `npm pack --json`'s own reported checksum for the tarball it just wrote — rather than trusting the
 * pack step succeeded silently. This is independent of, and in addition to, whatever verification
 * `npm` itself already performed while resolving/downloading the package from the registry: it
 * guards against a corrupted write, a TOCTOU race, or an outright compromised `npm` binary producing
 * a tarball that does not actually match its own claimed hash.
 *
 * @throws {ForgeError} `CFG-030` if `integrity` uses an unsupported hash algorithm, or `tarballPath`
 * cannot be read (missing, deleted concurrently, or a permission error).
 * @throws {ForgeError} `CFG-031` if the on-disk tarball does not hash to `integrity`.
 * @throws {ForgeError} `CFG-033` if the tarball is larger than `maxBytes`.
 */
export async function verifyTarballIntegrity(
  tarballPath: string,
  integrity: string,
  spec: string,
  maxBytes: number = DEFAULT_MAX_DECOMPRESSED_BYTES,
): Promise<void> {
  const { algorithm, digest } = parseIntegrity(integrity, spec);
  // `sha1` is deliberately not accepted, even though some very old registries report it: this check
  // only ever re-verifies npm's own already-reported hash against the local on-disk bytes (it is not
  // a trust boundary against a malicious registry, which could report any hash for its own tarball
  // regardless), but there is no reason to accept a broken, deprecated digest here when npm's own
  // real output always reports `sha512` in practice.
  if (!['sha256', 'sha384', 'sha512'].includes(algorithm)) {
    throw new ForgeError('CFG-030', {
      spec,
      detail: `npm pack reported an unsupported integrity algorithm (${JSON.stringify(algorithm)})`,
    });
  }
  const actual = await hashFileCapped(tarballPath, algorithm, maxBytes, spec);
  if (actual !== digest) {
    throw new ForgeError('CFG-031', { spec, expected: integrity });
  }
}

export interface FetchNpmOverlayOptions {
  /** The base directory the disposable pack/extract directories are created under (`mkdtemp`'d,
   * never the raw value itself, and never `os.tmpdir()` directly — the identical caller-supplied-base
   * discipline `fetchGitOverlay`'s own `workDir` already establishes for the git channel). */
  readonly workDir: string;
  /** The directory whose own `.npmrc` (merged with the user's and the global one, exactly as any
   * real `npm` invocation from that directory would resolve it) governs which registry this fetch
   * resolves against — required, rather than defaulting to `process.cwd()`, so this module never
   * reads that host fact itself (`QUALITY-BAR.md` R10). */
  readonly cwd: string;
}

export interface NpmOverlayFetchResult {
  /** The extracted content root — npm's own `package/` wrapper directory already stripped. */
  readonly path: string;
  readonly manifestKind: OverlayManifestKind;
  readonly checksum: string;
  readonly integrity: string;
}

/**
 * Fetches `spec` (`npm:@scope/name` or `npm:@scope/name@version`) via a real `npm pack --json`,
 * verifies the packed tarball's own reported integrity against its actual on-disk bytes, extracts it
 * into a fresh directory under `options.workDir`, and validates the extracted content is a real,
 * installable overlay/module.
 *
 * @throws {ForgeError} `CFG-029` if `spec` is not a valid npm overlay/module spec.
 * @throws {ForgeError} `CFG-030` if the `npm pack` invocation itself fails, or its output is
 * malformed.
 * @throws {ForgeError} `CFG-031` if the packed tarball fails its own integrity check.
 * @throws {ForgeError} `CFG-032` if the tarball contains an unsafe or unsupported entry.
 * @throws {ForgeError} `CFG-033` if the tarball is unreasonably large (compressed or decompressed).
 * @throws {ForgeError} `CFG-034` if the tarball is corrupted or truncated.
 * @throws {ForgeError} `CFG-035` if a real local filesystem operation fails while extracting.
 * @throws {ForgeError} `CFG-027` if the extracted content has no `overlay.yaml`/`module.yaml`.
 * @throws {ForgeError} `VCS-009` if computing the extracted content's checksum fails.
 */
export async function fetchNpmOverlay(
  spec: string,
  options: FetchNpmOverlayOptions,
): Promise<NpmOverlayFetchResult> {
  const parsedSpec = parseNpmOverlaySpec(spec);
  const npmArg = toNpmPackArg(parsedSpec);

  await mkdir(options.workDir, { recursive: true });
  const packDir = await mkdtemp(path.join(options.workDir, 'npm-pack-'));

  // `packDir` (the raw `.tgz` `npm pack` wrote) is purely transient — never the returned result —
  // so it is always removed once this function is done with it, success or failure alike, the same
  // "no leaked scratch directory" discipline `fetchGitOverlay`'s own gauntlet round established for
  // its disposable git checkout (`GAUNTLET-LOG.md`'s M11 P1 entry, finding 1).
  try {
    let stdout: string;
    try {
      ({ stdout } = await execa(
        'npm',
        ['pack', npmArg, '--json', `--pack-destination=${packDir}`],
        { cwd: options.cwd },
      ));
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : String(cause);
      throw new ForgeError('CFG-030', { spec, detail }, { cause });
    }

    const { filename, integrity } = parseNpmPackJson(stdout, spec);
    const tarballPath = path.join(packDir, filename);
    await verifyTarballIntegrity(tarballPath, integrity, spec);

    const contentDir = await mkdtemp(path.join(options.workDir, 'npm-content-'));
    try {
      await extractNpmTarball(tarballPath, contentDir, { stripComponents: 1 });

      const manifestKind = await findManifestKind(contentDir);
      if (manifestKind === undefined) {
        throw new ForgeError('CFG-027', { source: spec });
      }

      let checksum: string;
      try {
        checksum = await computeContentChecksum(contentDir);
      } catch (cause) {
        throw new ForgeError(
          'VCS-009',
          { path: contentDir, ...vcsFailureDetails(cause) },
          { cause },
        );
      }

      return { path: contentDir, manifestKind, checksum, integrity };
    } catch (cause) {
      // The extracted content directory is this function's own returned result on success — on any
      // failure past this point it is disposable, and left behind it would be the identical orphaned-
      // directory leak the git channel's own gauntlet round already found and fixed one milestone
      // earlier for the adjacent "fetch succeeded, the next step failed" shape.
      await rm(contentDir, { recursive: true, force: true });
      throw cause;
    }
  } finally {
    await rm(packDir, { recursive: true, force: true });
  }
}
