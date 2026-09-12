/**
 * `extractNpmTarball` — `PLAN-M11.md` P2's own literal Checks: a real tarball round-trips, and every
 * adversarial shape the npm channel's own critic round is expected to probe for is refused outright
 * rather than mis-handled — a symlink/hard-link/device entry, an absolute path, a `../`-escaping
 * path, an unsupported GNU-longname/PAX/base-256-size entry, and a decompression bomb.
 *
 * Built entirely against hand-crafted `.tar.gz` buffers (a small, local USTAR writer below) rather
 * than a real `npm pack` output for every case — the adversarial shapes this file tests (a symlink
 * entry, a `../` path) are not shapes a well-formed `npm pack` output could ever itself contain, so
 * they must be constructed directly to be tested at all; `fetch-npm.test.ts` covers the real,
 * end-to-end `npm pack` round trip this module is actually fed in production.
 *
 * @see specs/19 §19.5
 * @see PLAN-M11.md P2
 */
import { isForgeError } from '@forge/core';
import { readFile, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';

import { afterEach, describe, expect, it } from 'vitest';

import { extractNpmTarball } from '../../src/install/tar-extract.ts';

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function freshDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'forge-extensions-tar-extract-'));
  dirs.push(dir);
  return dir;
}

interface RawTarEntry {
  readonly name: string;
  readonly typeflag?: string;
  readonly content?: Buffer;
}

/** A minimal, deliberately literal USTAR block writer — writes exactly the header fields
 * `tar-extract.ts` itself reads, including a real header checksum, so the fixtures this file builds
 * are genuine, parseable tar archives rather than a format only this test's own reader understands. */
function ustarHeader(entry: RawTarEntry, size: number): Buffer {
  const block = Buffer.alloc(512);
  const writeField = (value: string, offset: number, length: number): void => {
    block.write(value, offset, length, 'utf8');
  };
  writeField(entry.name.slice(0, 100), 0, 100);
  writeField('0000644\0', 100, 8); // mode
  writeField('0000000\0', 108, 8); // uid
  writeField('0000000\0', 116, 8); // gid
  writeField(`${size.toString(8).padStart(11, '0')}\0`, 124, 12);
  writeField(`${'0'.repeat(11)}\0`, 136, 12); // mtime
  block.fill(0x20, 148, 156); // checksum field, spaces during computation
  block[156] = (entry.typeflag ?? '0').charCodeAt(0);
  writeField('ustar\0', 257, 8); // magic + version ("ustar\0" + "00")
  block.write('00', 263, 2, 'utf8');
  let checksum = 0;
  for (const byte of block) checksum += byte;
  writeField(`${checksum.toString(8).padStart(6, '0')}\0 `, 148, 8);
  return block;
}

function padTo512(buf: Buffer): Buffer {
  const remainder = buf.length % 512;
  if (remainder === 0) return buf;
  return Buffer.concat([buf, Buffer.alloc(512 - remainder)]);
}

/** Builds a real, gzip-compressed tar archive from `entries`, in order. */
function buildTarGz(entries: readonly RawTarEntry[]): Buffer {
  const blocks: Buffer[] = [];
  for (const entry of entries) {
    const content = entry.content ?? Buffer.alloc(0);
    blocks.push(ustarHeader(entry, content.length));
    if (content.length > 0) blocks.push(padTo512(content));
  }
  blocks.push(Buffer.alloc(1024)); // two zero blocks mark end-of-archive
  return zlib.gzipSync(Buffer.concat(blocks));
}

async function expectRefused(promise: Promise<unknown>, code: string): Promise<void> {
  try {
    await promise;
    expect.unreachable('extractNpmTarball should have thrown');
  } catch (error) {
    expect(isForgeError(error)).toBe(true);
    if (isForgeError(error)) expect(error.code).toBe(code);
  }
}

async function writeTarball(dir: string, buffer: Buffer): Promise<string> {
  const tarballPath = path.join(dir, 'fixture.tgz');
  const { writeFile } = await import('node:fs/promises');
  await writeFile(tarballPath, buffer);
  return tarballPath;
}

describe('extractNpmTarball', () => {
  it('reports a real local filesystem conflict (a file entry then a directory entry at the same path) as CFG-035, not CFG-034', async () => {
    const src = await freshDir();
    const dest = await freshDir();
    // A crafted archive where `package/conflict` is first written as a regular file, then a later
    // entry (`package/conflict/nested.txt`) needs `conflict` to be a directory — a real `ENOTDIR`
    // from `mkdir(..., { recursive: true })`, distinct from archive corruption, that a second critic
    // round found the original catch-all mislabelled as "corrupted or truncated" (`CFG-034`).
    const tarball = buildTarGz([
      { name: 'package/conflict', content: Buffer.from('i am a file') },
      { name: 'package/conflict/nested.txt', content: Buffer.from('i want to be nested') },
    ]);
    const tarballPath = await writeTarball(src, tarball);

    await expectRefused(extractNpmTarball(tarballPath, dest, { stripComponents: 1 }), 'CFG-035');
  });

  it('round-trips a real archive with nested directories and files, stripping the npm "package/" root', async () => {
    const src = await freshDir();
    const dest = await freshDir();
    const tarball = buildTarGz([
      { name: 'package/', typeflag: '5' },
      { name: 'package/overlay.yaml', content: Buffer.from('name: acme\nversion: 1.0.0\n') },
      { name: 'package/skills/', typeflag: '5' },
      { name: 'package/skills/example.md', content: Buffer.from('# Example\n') },
    ]);
    const tarballPath = await writeTarball(src, tarball);

    await extractNpmTarball(tarballPath, dest, { stripComponents: 1 });

    expect((await readFile(path.join(dest, 'overlay.yaml'))).toString('utf8')).toBe(
      'name: acme\nversion: 1.0.0\n',
    );
    expect((await readFile(path.join(dest, 'skills', 'example.md'))).toString('utf8')).toBe(
      '# Example\n',
    );
  });

  it('drops an entry that has no path segments left after stripComponents', async () => {
    const src = await freshDir();
    const dest = await freshDir();
    const tarball = buildTarGz([{ name: 'package/', typeflag: '5' }]);
    const tarballPath = await writeTarball(src, tarball);

    await extractNpmTarball(tarballPath, dest, { stripComponents: 1 });

    expect(await readdir(dest)).toEqual([]);
  });

  it('refuses a symlink entry', async () => {
    const src = await freshDir();
    const dest = await freshDir();
    const tarball = buildTarGz([{ name: 'package/evil', typeflag: '2' }]);
    const tarballPath = await writeTarball(src, tarball);

    await expectRefused(extractNpmTarball(tarballPath, dest, { stripComponents: 1 }), 'CFG-032');
  });

  it('refuses a hard-link entry', async () => {
    const src = await freshDir();
    const dest = await freshDir();
    const tarball = buildTarGz([{ name: 'package/evil', typeflag: '1' }]);
    const tarballPath = await writeTarball(src, tarball);

    await expectRefused(extractNpmTarball(tarballPath, dest, { stripComponents: 1 }), 'CFG-032');
  });

  it('refuses a device-file entry', async () => {
    const src = await freshDir();
    const dest = await freshDir();
    const tarball = buildTarGz([{ name: 'package/evil', typeflag: '3' }]);
    const tarballPath = await writeTarball(src, tarball);

    await expectRefused(extractNpmTarball(tarballPath, dest, { stripComponents: 1 }), 'CFG-032');
  });

  it("refuses a GNU longname ('L') extension entry", async () => {
    const src = await freshDir();
    const dest = await freshDir();
    const tarball = buildTarGz([{ name: 'ignored', typeflag: 'L', content: Buffer.from('x') }]);
    const tarballPath = await writeTarball(src, tarball);

    await expectRefused(extractNpmTarball(tarballPath, dest, { stripComponents: 0 }), 'CFG-032');
  });

  it("refuses a PAX extended-header ('x') entry", async () => {
    const src = await freshDir();
    const dest = await freshDir();
    const tarball = buildTarGz([{ name: 'ignored', typeflag: 'x', content: Buffer.from('x') }]);
    const tarballPath = await writeTarball(src, tarball);

    await expectRefused(extractNpmTarball(tarballPath, dest, { stripComponents: 0 }), 'CFG-032');
  });

  it('refuses an entry with an absolute path ("tar slip" via a rooted name)', async () => {
    const src = await freshDir();
    const dest = await freshDir();
    const outsideMarker = path.join(tmpdir(), 'forge-tar-slip-marker-should-not-exist.txt');
    const tarball = buildTarGz([{ name: outsideMarker, content: Buffer.from('pwned') }]);
    const tarballPath = await writeTarball(src, tarball);

    await expectRefused(extractNpmTarball(tarballPath, dest, { stripComponents: 0 }), 'CFG-032');
    await expect(readFile(outsideMarker)).rejects.toThrow();
  });

  it('refuses an entry with a Windows-shaped absolute path (drive letter)', async () => {
    const src = await freshDir();
    const dest = await freshDir();
    const tarball = buildTarGz([{ name: 'C:\\Windows\\evil.txt', content: Buffer.from('pwned') }]);
    const tarballPath = await writeTarball(src, tarball);

    await expectRefused(extractNpmTarball(tarballPath, dest, { stripComponents: 0 }), 'CFG-032');
  });

  it('refuses an entry with a Windows-shaped absolute path (UNC share)', async () => {
    const src = await freshDir();
    const dest = await freshDir();
    const tarball = buildTarGz([
      { name: '\\\\server\\share\\evil.txt', content: Buffer.from('pwned') },
    ]);
    const tarballPath = await writeTarball(src, tarball);

    await expectRefused(extractNpmTarball(tarballPath, dest, { stripComponents: 0 }), 'CFG-032');
  });

  it('refuses an entry whose "../" path would resolve outside the extraction directory', async () => {
    const src = await freshDir();
    const dest = await freshDir();
    const tarball = buildTarGz([
      { name: 'package/../../escaped.txt', content: Buffer.from('pwned') },
    ]);
    const tarballPath = await writeTarball(src, tarball);

    await expectRefused(extractNpmTarball(tarballPath, dest, { stripComponents: 1 }), 'CFG-032');
    await expect(readFile(path.join(dest, '..', 'escaped.txt'))).rejects.toThrow();
  });

  it('refuses an entry whose "../" path is disguised inside a deeper subdirectory', async () => {
    const src = await freshDir();
    const dest = await freshDir();
    const tarball = buildTarGz([
      { name: 'package/sub/../../../escaped.txt', content: Buffer.from('pwned') },
    ]);
    const tarballPath = await writeTarball(src, tarball);

    await expectRefused(extractNpmTarball(tarballPath, dest, { stripComponents: 1 }), 'CFG-032');
  });

  it('refuses an archive containing more entries than maxEntries', async () => {
    const src = await freshDir();
    const dest = await freshDir();
    const entries: RawTarEntry[] = [];
    for (let i = 0; i < 5; i += 1)
      entries.push({ name: `package/f${String(i)}`, content: Buffer.from('x') });
    const tarballPath = await writeTarball(src, buildTarGz(entries));

    await expectRefused(
      extractNpmTarball(tarballPath, dest, { stripComponents: 1, maxEntries: 3 }),
      'CFG-032',
    );
  });

  it('refuses a decompression bomb once decompressed content exceeds maxDecompressedBytes', async () => {
    const src = await freshDir();
    const dest = await freshDir();
    // A highly compressible 8 MiB payload — tiny on disk, large once decompressed, well over a
    // deliberately low test-only cap so the guard is exercised without allocating a realistic bomb's
    // full ratio (the guard itself streams and checks incrementally, so the cap is what makes this
    // representative, not the payload's real-world compression ratio).
    const bigContent = Buffer.alloc(8 * 1024 * 1024, 0);
    const tarballPath = await writeTarball(
      src,
      buildTarGz([{ name: 'package/big.bin', content: bigContent }]),
    );

    await expectRefused(
      extractNpmTarball(tarballPath, dest, {
        stripComponents: 1,
        maxDecompressedBytes: 1024 * 1024,
      }),
      'CFG-033',
    );
  });

  it('refuses a corrupted (not-even-valid-gzip) archive with a named error, not a raw exception', async () => {
    const src = await freshDir();
    const dest = await freshDir();
    const full = buildTarGz([
      { name: 'package/overlay.yaml', content: Buffer.from('name: acme\nversion: 1.0.0\n') },
    ]);
    // Corrupt the gzip stream itself so decompression fails outright — a real, hostile "not even a
    // valid gzip file" input, distinct from a well-formed-but-truncated tar body below.
    const corrupted = Buffer.from(full);
    const lastIndex = corrupted.length - 1;
    corrupted[lastIndex] = (corrupted[lastIndex] ?? 0) ^ 0xff;
    const tarballPath = await writeTarball(src, corrupted);

    await expectRefused(extractNpmTarball(tarballPath, dest, { stripComponents: 1 }), 'CFG-034');
  });

  it('refuses a well-formed-gzip archive whose tar body is truncated mid-entry', async () => {
    const src = await freshDir();
    const dest = await freshDir();
    const full = buildTarGz([
      {
        name: 'package/overlay.yaml',
        content: Buffer.from('name: acme\nversion: 1.0.0\n'.repeat(40)),
      },
    ]);
    // Re-gzip only the header block plus a partial first data block — a genuinely truncated archive,
    // distinct from the corrupted-gzip-stream case above: this is a well-formed gzip stream whose
    // *tar content* ends before an entry's declared size is satisfied.
    const decompressed = zlib.gunzipSync(full);
    const truncated = zlib.gzipSync(decompressed.subarray(0, 512 + 100));
    const tarballPath = await writeTarball(src, truncated);

    await expectRefused(extractNpmTarball(tarballPath, dest, { stripComponents: 1 }), 'CFG-034');
  });

  it('refuses a header whose size field has a valid leading octal digit followed by an invalid one', async () => {
    const src = await freshDir();
    const dest = await freshDir();
    // Hand-built rather than via `buildTarGz`/`ustarHeader`, since a legitimately-encoded size can
    // never itself be malformed — this constructs the exact byte shape a critic round found silently
    // mis-parsed (`Number.parseInt` stops at the first invalid digit rather than failing).
    const block = Buffer.alloc(512);
    block.write('package/evil.txt', 0, 100, 'utf8');
    block.write('0000644\0', 100, 8, 'utf8');
    block.write('0000000\0', 108, 8, 'utf8');
    block.write('0000000\0', 116, 8, 'utf8');
    block.write('19999999999\0', 124, 12, 'utf8'); // valid leading octal digit, then invalid digits
    block.write(`${'0'.repeat(11)}\0`, 136, 12, 'utf8');
    block[156] = '0'.charCodeAt(0);
    block.write('ustar\0', 257, 8, 'utf8');
    block.write('00', 263, 2, 'utf8');
    block.fill(0x20, 148, 156);
    let checksum = 0;
    for (const byte of block) checksum += byte;
    block.write(`${checksum.toString(8).padStart(6, '0')}\0 `, 148, 8, 'utf8');
    const tarball = zlib.gzipSync(Buffer.concat([block, Buffer.alloc(1024)]));
    const tarballPath = await writeTarball(src, tarball);

    await expectRefused(extractNpmTarball(tarballPath, dest, { stripComponents: 1 }), 'CFG-032');
  });

  it('reconstructs a path split across the USTAR "prefix" and "name" fields (the >100-byte-path shape real npm tarballs actually use)', async () => {
    const src = await freshDir();
    const dest = await freshDir();
    // Hand-built rather than via `buildTarGz`/`ustarHeader` (which only ever writes the `name`
    // field): a real path longer than 100 bytes — an entirely ordinary shape for a scoped package
    // with nested directories — is split by real npm tarballs across USTAR's `prefix` (offset 345,
    // 155 bytes) and `name` (offset 0, 100 bytes) fields, joined as `${prefix}/${name}` by
    // `parseHeader`. This module's own header comment cites this split (confirmed empirically
    // against a real `npm pack` output) as the reason GNU longname/PAX extensions are refused rather
    // than supported — this test proves the join itself round-trips, not merely that longer formats
    // are refused.
    const prefix =
      'package/some/really/quite/deeply/nested/directory/structure/that/is/long/enough/to/' +
      'exceed/the/classic/ustar/one/hundred/byte/name/field/limit/for/sure';
    const name = 'definitely/yes/file.txt';
    const content = Buffer.from('deeply nested content\n');
    const block = Buffer.alloc(512);
    block.write(name, 0, 100, 'utf8');
    block.write('0000644\0', 100, 8, 'utf8');
    block.write('0000000\0', 108, 8, 'utf8');
    block.write('0000000\0', 116, 8, 'utf8');
    block.write(`${content.length.toString(8).padStart(11, '0')}\0`, 124, 12, 'utf8');
    block.write(`${'0'.repeat(11)}\0`, 136, 12, 'utf8');
    block[156] = '0'.charCodeAt(0);
    block.write('ustar\0', 257, 8, 'utf8');
    block.write('00', 263, 2, 'utf8');
    block.write(prefix, 345, 155, 'utf8');
    block.fill(0x20, 148, 156);
    let checksum = 0;
    for (const byte of block) checksum += byte;
    block.write(`${checksum.toString(8).padStart(6, '0')}\0 `, 148, 8, 'utf8');
    const dataBlock = padTo512(content);
    const tarball = zlib.gzipSync(Buffer.concat([block, dataBlock, Buffer.alloc(1024)]));
    const tarballPath = await writeTarball(src, tarball);

    await extractNpmTarball(tarballPath, dest, { stripComponents: 1 });

    expect(
      (
        await readFile(
          path.join(
            dest,
            'some/really/quite/deeply/nested/directory/structure/that/is/long/enough/to/exceed/' +
              'the/classic/ustar/one/hundred/byte/name/field/limit/for/sure/definitely/yes/file.txt',
          ),
        )
      ).toString('utf8'),
    ).toBe('deeply nested content\n');
  });

  it('extracts with every option left at its default (no options object at all)', async () => {
    const src = await freshDir();
    const dest = await freshDir();
    const tarball = buildTarGz([{ name: 'no-strip.txt', content: Buffer.from('root-level file') }]);
    const tarballPath = await writeTarball(src, tarball);

    await extractNpmTarball(tarballPath, dest);

    expect((await readFile(path.join(dest, 'no-strip.txt'))).toString('utf8')).toBe(
      'root-level file',
    );
  });

  it('extracts correctly when destDir is passed with a trailing path separator', async () => {
    const src = await freshDir();
    const dest = await freshDir();
    const destWithTrailingSep = `${dest}${path.sep}`;
    const tarball = buildTarGz([
      { name: 'package/overlay.yaml', content: Buffer.from('name: acme\n') },
    ]);
    const tarballPath = await writeTarball(src, tarball);

    await extractNpmTarball(tarballPath, destWithTrailingSep, { stripComponents: 1 });

    expect((await readFile(path.join(dest, 'overlay.yaml'))).toString('utf8')).toBe('name: acme\n');
  });

  it('treats a fully blank (no digits at all) size field as zero, not as an error', async () => {
    const src = await freshDir();
    const dest = await freshDir();
    // A hand-built header whose size field is entirely spaces — a real, legal ustar shape for a
    // zero-size entry some tar writers produce (as opposed to `buildTarGz`'s own always-digits
    // `"00000000000\0"` encoding), exercising `readOctalField`'s `trimmed === ''` early return.
    const block = Buffer.alloc(512);
    block.write('package/empty.txt', 0, 100, 'utf8');
    block.write('0000644\0', 100, 8, 'utf8');
    block.write('0000000\0', 108, 8, 'utf8');
    block.write('0000000\0', 116, 8, 'utf8');
    block.write(' '.repeat(12), 124, 12, 'utf8'); // fully blank size field
    block.write(`${'0'.repeat(11)}\0`, 136, 12, 'utf8');
    block[156] = '0'.charCodeAt(0);
    block.write('ustar\0', 257, 8, 'utf8');
    block.write('00', 263, 2, 'utf8');
    block.fill(0x20, 148, 156);
    let checksum = 0;
    for (const byte of block) checksum += byte;
    block.write(`${checksum.toString(8).padStart(6, '0')}\0 `, 148, 8, 'utf8');
    const tarball = zlib.gzipSync(Buffer.concat([block, Buffer.alloc(1024)]));
    const tarballPath = await writeTarball(src, tarball);

    await extractNpmTarball(tarballPath, dest, { stripComponents: 1 });

    expect((await readFile(path.join(dest, 'empty.txt'))).toString('utf8')).toBe('');
  });

  it('reads a name field that fills the full 100 bytes with no NUL terminator', async () => {
    const src = await freshDir();
    const dest = await freshDir();
    // `readStringField`'s `nul === -1` branch: a name exactly 100 bytes long, with no trailing NUL
    // padding at all — legal ustar (the field simply has no room left for one), as opposed to every
    // other fixture in this file, whose shorter names always leave room for a NUL.
    const nameBody = 'package/'; // 8 bytes
    const filler = 'x'.repeat(100 - nameBody.length); // exactly fills the remaining 92 bytes
    const name = nameBody + filler;
    expect(name.length).toBe(100);
    const content = Buffer.from('full-width name');
    const block = Buffer.alloc(512);
    block.write(name, 0, 100, 'utf8');
    block.write('0000644\0', 100, 8, 'utf8');
    block.write('0000000\0', 108, 8, 'utf8');
    block.write('0000000\0', 116, 8, 'utf8');
    block.write(`${content.length.toString(8).padStart(11, '0')}\0`, 124, 12, 'utf8');
    block.write(`${'0'.repeat(11)}\0`, 136, 12, 'utf8');
    block[156] = '0'.charCodeAt(0);
    block.write('ustar\0', 257, 8, 'utf8');
    block.write('00', 263, 2, 'utf8');
    block.fill(0x20, 148, 156);
    let checksum = 0;
    for (const byte of block) checksum += byte;
    block.write(`${checksum.toString(8).padStart(6, '0')}\0 `, 148, 8, 'utf8');
    const tarball = zlib.gzipSync(Buffer.concat([block, padTo512(content), Buffer.alloc(1024)]));
    const tarballPath = await writeTarball(src, tarball);

    await extractNpmTarball(tarballPath, dest, { stripComponents: 1 });

    expect((await readFile(path.join(dest, filler))).toString('utf8')).toBe('full-width name');
  });

  it('refuses an archive that ends with a clean EOF immediately after a header declaring content', async () => {
    const src = await freshDir();
    const dest = await freshDir();
    // Distinct from the "truncated mid-block" fixture above: here the stream ends *exactly* at a
    // block boundary (right after the header, with zero bytes of the declared content available at
    // all), exercising `extractInner`'s own `dataBlock === undefined` check rather than
    // `ChunkReader.read`'s "ends in the middle of a block" throw.
    const header = buildTarGz([{ name: 'package/overlay.yaml', content: Buffer.from('x') }]);
    const decompressed = zlib.gunzipSync(header);
    const headerOnly = zlib.gzipSync(decompressed.subarray(0, 512));
    const tarballPath = await writeTarball(src, headerOnly);

    await expectRefused(extractNpmTarball(tarballPath, dest, { stripComponents: 1 }), 'CFG-034');
  });

  it('skips a regular-file entry that has no path segments left after stripComponents', async () => {
    const src = await freshDir();
    const dest = await freshDir();
    // `package` itself as a *regular file* entry (not the directory-typeflag case another test
    // already covers) — stripping its one component leaves nothing to write, exercising the
    // `target === undefined` branch on the regular-file path specifically.
    const tarball = buildTarGz([{ name: 'package', content: Buffer.from('ignored') }]);
    const tarballPath = await writeTarball(src, tarball);

    await extractNpmTarball(tarballPath, dest, { stripComponents: 1 });

    expect(await readdir(dest)).toEqual([]);
  });
});
