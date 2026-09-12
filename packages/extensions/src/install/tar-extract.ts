/**
 * `extractNpmTarball` — a minimal, deliberately narrow, safety-first `.tar.gz` extractor for
 * `fetch-npm.ts`'s own npm channel (`19` §19.5, `PLAN-M11.md` P2).
 *
 * `PLAN-M11.md` P2's own recorded Surface deviation is "shell out to the real `npm` CLI rather than
 * add a new dependency" — extraction is the one remaining step that CLI does not do for us (`npm
 * pack` only *creates* a tarball; it never unpacks one), and no `tar`/`pacote` dependency exists in
 * this workspace to reach for either. Rather than shelling out to the *system* `tar` binary (whose
 * own symlink/path-traversal protections vary by platform and vendor — GNU tar vs. BSD tar vs.
 * whatever a CI image happens to ship), this hand-rolls the small, well-documented USTAR subset real
 * npm tarballs actually use (confirmed empirically: a scoped package's own long paths split across
 * USTAR's `name`+`prefix` fields, never GNU longname or PAX extensions, for every real `npm pack`
 * output this piece's own investigation produced) — giving this codebase, not an external binary,
 * full control over what an adversarial tarball is allowed to do to the filesystem.
 *
 * Deliberately refused, fail-closed, rather than attempted: symlinks, hard links, device/FIFO
 * entries, GNU longname/PAX-extended entries (a real but rare shape this piece's own budget does not
 * cover — refused with a named error rather than silently mis-parsed), and any entry whose path would
 * resolve outside the extraction directory ("tar slip"). A decompression-bomb guard counts bytes as
 * they stream out of `zlib`, not the compressed file size, which a bomb makes trivially small.
 *
 * @see specs/19 §19.5
 * @see PLAN-M11.md P2
 */
import { createReadStream } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';

import { ForgeError, isForgeError } from '@forge/core';

const BLOCK_SIZE = 512;

/** A real overlay/module bundle is a handful of YAML/Markdown/template files — this is a generous
 * ceiling with headroom, not a tuned-to-fit limit, so a legitimate bundle never brushes it. */
export const DEFAULT_MAX_DECOMPRESSED_BYTES = 64 * 1024 * 1024;

/** Guards against a bomb built from many tiny entries rather than one huge one (each entry still
 * costs at least one 512-byte header block even at zero content size). */
export const DEFAULT_MAX_ENTRIES = 20_000;

export interface ExtractTarballOptions {
  /** How many leading path components to drop from every entry before writing it — npm's own
   * tarballs always wrap content in one `package/` directory; `1` (the default for this module's one
   * real caller) strips exactly that. An entry left with no path segments after stripping is
   * dropped, matching plain `tar --strip-components`'s own behaviour. */
  readonly stripComponents?: number;
  readonly maxDecompressedBytes?: number;
  readonly maxEntries?: number;
}

/** Pulls fixed-size chunks out of an async byte stream, buffering only as much as the next read
 * needs (never the whole decompressed stream at once) — the streaming half of the decompression-bomb
 * guard: `totalBytes` is checked, and the stream is allowed to error out early, before more of a
 * bomb's own expansion is ever pulled through `zlib`. */
class ChunkReader {
  private readonly iterator: AsyncIterator<Buffer>;
  private readonly maxBytes: number;
  // A list of not-yet-consumed chunks plus their combined length, rather than one running `Buffer`
  // re-concatenated on every incoming chunk — a critic round found the original single-buffer
  // version copied the whole buffered region again on every `fill` iteration, up to O(cap²) total
  // copying as `buffered` grows toward `maxBytes`. Each incoming chunk is now concatenated at most
  // once, when a `read()` finally consumes it, bounding total copying to O(stream size).
  private pending: Buffer[] = [];
  private pendingLength = 0;
  private done = false;
  totalBytes = 0;

  constructor(source: AsyncIterable<Buffer>, maxBytes: number) {
    this.iterator = source[Symbol.asyncIterator]();
    this.maxBytes = maxBytes;
  }

  private async fill(target: number): Promise<void> {
    while (this.pendingLength < target && !this.done) {
      const next = await this.iterator.next();
      if (next.done === true) {
        this.done = true;
        break;
      }
      this.totalBytes += next.value.length;
      if (this.totalBytes > this.maxBytes) {
        throw new ForgeError('CFG-033', { limit: this.maxBytes });
      }
      this.pending.push(next.value);
      this.pendingLength += next.value.length;
    }
  }

  /** Reads exactly `n` bytes, or `undefined` at a clean end-of-stream with nothing buffered — any
   * other short read (a stream ending mid-block) is a malformed tarball, not end-of-stream. */
  async read(n: number): Promise<Buffer | undefined> {
    await this.fill(n);
    if (this.pendingLength === 0 && this.done) return undefined;
    if (this.pendingLength < n) {
      throw new ForgeError('CFG-034', {
        detail: 'the archive ends in the middle of a block — it is truncated or corrupted.',
      });
    }
    // Always concatenated, even for a single pending chunk — `Buffer.concat` on a one-element array
    // is cheap, and special-casing that shape only to satisfy `noUncheckedIndexedAccess`'s
    // `Buffer | undefined` index type (via a `?? Buffer.alloc(0)` fallback that can never actually
    // trigger, since `pending[0]` is guaranteed present here) traded real coverage for no real gain.
    const merged = Buffer.concat(this.pending);
    const block = merged.subarray(0, n);
    const rest = merged.subarray(n);
    this.pending = rest.length > 0 ? [rest] : [];
    this.pendingLength = rest.length;
    return Buffer.from(block);
  }
}

interface TarHeader {
  readonly name: string;
  readonly typeflag: string;
  readonly size: number;
}

function readOctalField(block: Buffer, offset: number, length: number): number {
  const raw = block.subarray(offset, offset + length).toString('latin1');
  // Octal fields are NUL- and/or space-padded; a plain string `indexOf` (not a regex) truncates at
  // the first NUL without tripping `no-control-regex` over a literal control character in a pattern.
  const nulIndex = raw.indexOf(String.fromCharCode(0));
  const trimmed = (nulIndex === -1 ? raw : raw.slice(0, nulIndex)).trim();
  if (trimmed === '') return 0;
  // A leading 0x80 byte marks GNU tar's base-256 large-size extension — refused rather than
  // mis-parsed as octal (which would silently read a wildly wrong, attacker-influenced size).
  // `Buffer.prototype.readUInt8` (a real method, not indexed access) returns a plain `number`,
  // avoiding the `Buffer[i]: number | undefined` type `noUncheckedIndexedAccess` gives bracket
  // access — `offset` is always a valid in-bounds header-field offset, so a `?? 0` fallback here
  // would be exactly the same "can never actually trigger" dead branch removed elsewhere in this
  // file.
  if (block.readUInt8(offset) >= 0x80) {
    throw new ForgeError('CFG-032', {
      entry: '(header)',
      reason: 'uses an unsupported base-256 size field',
    });
  }
  // `Number.parseInt(str, 8)` stops at the first character invalid for the radix and returns
  // whatever it parsed up to that point rather than failing — it is `NaN` only when the *very
  // first* character is invalid. A critic round found a field like `"19999999999"` (a valid leading
  // octal digit followed by an invalid one) would silently parse as `1`, desynchronising this
  // parser's notion of where the entry's content ends and the next header begins, rather than being
  // refused as the malformed field it actually is. Every character is validated as a real octal
  // digit before `parseInt` ever runs, so a partially-valid field is refused outright instead of
  // silently truncated — which also makes `parseInt`'s own result provably safe afterwards (an
  // all-`[0-7]` string of at most 12 characters parses to a finite, non-negative value well inside
  // `Number.MAX_SAFE_INTEGER`, so no further validation of the parsed value itself is needed).
  if (!/^[0-7]+$/.test(trimmed)) {
    throw new ForgeError('CFG-032', { entry: '(header)', reason: 'has an unparseable size field' });
  }
  return Number.parseInt(trimmed, 8);
}

function readStringField(block: Buffer, offset: number, length: number): string {
  const raw = block.subarray(offset, offset + length);
  const nul = raw.indexOf(0);
  return (nul === -1 ? raw : raw.subarray(0, nul)).toString('utf8');
}

function parseHeader(block: Buffer): TarHeader {
  const name = readStringField(block, 0, 100);
  const typeflag = String.fromCharCode(block.readUInt8(156));
  const size = readOctalField(block, 124, 12);
  const prefix = readStringField(block, 345, 155);
  const fullName = prefix === '' ? name : `${prefix}/${name}`;
  return { name: fullName, typeflag, size };
}

/** Refuses an entry whose resolved path would land outside `destDir` — the tar-slip guard — and
 * refuses an entry that no longer has any path segments after `stripComponents` is applied. Returns
 * `undefined` for the latter (a legitimate "nothing to write" case, e.g. npm's own top-level
 * `package/` directory entry itself once its one component is stripped), never for the former (which
 * always throws). */
function resolveEntryPath(
  rawName: string,
  destDir: string,
  stripComponents: number,
): string | undefined {
  if (rawName === '' || rawName.startsWith('/') || path.win32.isAbsolute(rawName)) {
    throw new ForgeError('CFG-032', {
      entry: rawName,
      reason: 'has an absolute path',
    });
  }
  const segments = rawName.split('/').filter((segment) => segment !== '');
  const stripped = segments.slice(stripComponents);
  if (stripped.length === 0) return undefined;
  const relative = stripped.join('/');
  const resolved = path.resolve(destDir, relative);
  const destWithSep = destDir.endsWith(path.sep) ? destDir : `${destDir}${path.sep}`;
  if (resolved !== destDir && !resolved.startsWith(destWithSep)) {
    throw new ForgeError('CFG-032', {
      entry: rawName,
      reason: 'resolves outside the extraction directory',
    });
  }
  return resolved;
}

const REGULAR_FILE_TYPEFLAGS = new Set(['0', '\0', '7']);
const DIRECTORY_TYPEFLAG = '5';

/** Node's real fs-syscall error codes this extractor can plausibly hit while writing (`mkdir`/
 * `writeFile`) — a full disk, a permission error, or a crafted tarball whose entries conflict (a
 * file at a path a later entry also wants to use as a directory). A `zlib` stream error (e.g.
 * `Z_DATA_ERROR`) and this module's own truncation checks never use these codes, so checking this
 * set is enough to separate "the local filesystem failed" from "the archive itself is broken"
 * without needing to catch each call site individually. */
const FS_ERROR_CODES = new Set([
  'ENOSPC',
  'EACCES',
  'EPERM',
  'ENOTDIR',
  'EISDIR',
  'EEXIST',
  'EROFS',
  'EMFILE',
  'ENFILE',
  'ELOOP',
  'ENAMETOOLONG',
  'EDQUOT',
  'EBUSY',
]);

function isFsErrorCode(cause: unknown): boolean {
  return (
    typeof cause === 'object' &&
    cause !== null &&
    'code' in cause &&
    typeof cause.code === 'string' &&
    FS_ERROR_CODES.has(cause.code)
  );
}

/**
 * Extracts `tarballPath` (a real `.tar.gz`) into `destDir`, which must already exist.
 *
 * @throws {ForgeError} `CFG-032` for a symlink, hard link, device/FIFO entry, an unsupported GNU
 * longname/PAX-extended entry, or any entry whose path would resolve outside `destDir`.
 * @throws {ForgeError} `CFG-033` if the decompressed content exceeds `options.maxDecompressedBytes`.
 * @throws {ForgeError} `CFG-034` if the archive is truncated/corrupted (including a non-gzip file).
 * @throws {ForgeError} `CFG-035` if a real local filesystem operation fails while extracting (a
 * full disk, a permission error, or a conflicting entry pair in the archive).
 */
export async function extractNpmTarball(
  tarballPath: string,
  destDir: string,
  options: ExtractTarballOptions = {},
): Promise<void> {
  const stripComponents = options.stripComponents ?? 0;
  const maxBytes = options.maxDecompressedBytes ?? DEFAULT_MAX_DECOMPRESSED_BYTES;
  const maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;

  try {
    await extractInner(tarballPath, destDir, stripComponents, maxBytes, maxEntries);
  } catch (cause) {
    // Every genuine refusal above already throws a `ForgeError` directly; anything else reaching
    // here is wrapped rather than leaked past this function's own documented "throws only
    // `ForgeError`" contract — but not all into the same code. A second critic round found the
    // first draft's blanket `CFG-034` ("corrupted or truncated") also caught real local filesystem
    // failures (`ENOSPC`, `EACCES`, `ENOTDIR` from a crafted tarball with conflicting entries),
    // giving the exact "wrong remedy for an unrelated failure class" defect `CFG-030`/`CFG-034` were
    // already split apart to fix, one layer further down. A Node fs syscall error always carries a
    // recognisable `.code` (unlike a `zlib` stream error, e.g. `Z_DATA_ERROR`, or this module's own
    // truncation checks, neither of which use these codes) — checked here to route the two classes
    // to the code whose remedy actually matches the failure.
    if (isForgeError(cause)) throw cause;
    const detail = cause instanceof Error ? cause.message : String(cause);
    if (isFsErrorCode(cause)) {
      throw new ForgeError('CFG-035', { detail }, { cause });
    }
    throw new ForgeError('CFG-034', { detail }, { cause });
  }
}

async function extractInner(
  tarballPath: string,
  destDir: string,
  stripComponents: number,
  maxBytes: number,
  maxEntries: number,
): Promise<void> {
  const gunzip = createReadStream(tarballPath).pipe(zlib.createGunzip());
  const reader = new ChunkReader(gunzip, maxBytes);

  let entryCount = 0;
  for (;;) {
    const headerBlock = await reader.read(BLOCK_SIZE);
    if (headerBlock === undefined) break;
    if (headerBlock.every((byte) => byte === 0)) continue; // end-of-archive padding block

    entryCount += 1;
    if (entryCount > maxEntries) {
      throw new ForgeError('CFG-032', {
        entry: '(archive)',
        reason: `contains more than ${String(maxEntries)} entries`,
      });
    }

    const header = parseHeader(headerBlock);
    const paddedSize = Math.ceil(header.size / BLOCK_SIZE) * BLOCK_SIZE;
    const dataBlock = paddedSize > 0 ? await reader.read(paddedSize) : Buffer.alloc(0);
    if (dataBlock === undefined) {
      throw new ForgeError('CFG-034', {
        detail: `entry ${JSON.stringify(header.name)} declares ${String(header.size)} bytes but the archive ends first.`,
      });
    }
    const content = dataBlock.subarray(0, header.size);

    if (header.typeflag === DIRECTORY_TYPEFLAG) {
      const target = resolveEntryPath(header.name, destDir, stripComponents);
      if (target !== undefined) await mkdir(target, { recursive: true });
      continue;
    }
    if (REGULAR_FILE_TYPEFLAGS.has(header.typeflag)) {
      const target = resolveEntryPath(header.name, destDir, stripComponents);
      if (target === undefined) continue;
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, content);
      continue;
    }
    throw new ForgeError('CFG-032', {
      entry: header.name,
      reason:
        `has an unsupported entry type (${JSON.stringify(header.typeflag)}) — only regular ` +
        'files and directories are extracted; symlinks, hard links, device/FIFO entries, and GNU ' +
        'longname/PAX extensions are all refused',
    });
  }
}
