/**
 * `writeFileAtomic`/`writeNewFileAtomic` — the two ways `@forge/core/fs` puts bytes on disk.
 *
 * `specs/18` §18.10: "Atomic writes: temp file in the same directory → `fsync` → `rename`. Never
 * partial artifacts." A reader can only ever observe the file at its previous content or its new
 * content — the destination path itself is never opened for writing, only atomically renamed (or, for
 * `writeNewFileAtomic`, linked) onto.
 *
 * @see specs/18 §18.10
 * @see specs/18 §18.7 (post-v1.0, M15 P2: `writeNewFileAtomic`'s own append-only refusal)
 */
import fsp from 'node:fs/promises';
import path from 'node:path';

import { ForgeError } from '../errors/forge-error.ts';
import type { AbsolutePath } from './paths.ts';

/** A per-process counter, not a random suffix — see the note on `tempPathFor`. */
let tempSequence = 0;

/**
 * Builds a temp path in the same directory as `target`, guaranteed unique within this process.
 *
 * Uses `process.pid` and a monotonic counter rather than `crypto.randomUUID()` or `Math.random()`:
 * QUALITY-BAR.md R10 forbids an uninjected random source in production code, and nothing about this
 * name needs to be unpredictable — it only needs to not collide with a concurrent write in this
 * process or with a leftover temp file from a different process's crashed run, and a PID a previous
 * crash cannot have reused while this process is still alive achieves that.
 */
function tempPathFor(target: AbsolutePath): string {
  const dir = path.dirname(target);
  const base = path.basename(target);
  tempSequence += 1;
  return path.join(dir, `.${base}.tmp-${String(process.pid)}-${String(tempSequence)}`);
}

/**
 * Attempts to fsync `dirPath` for extra durability of the rename's metadata, swallowing the
 * attempt if the platform does not support it.
 *
 * POSIX crash-safety wants the containing directory fsync'd after a rename, so the rename itself
 * survives a crash and not only the file's data. Windows does not support opening a directory the
 * same way, and NTFS's own journalling covers the metadata differently — the file-level `fsync`
 * already guarantees the *data* is durable regardless, so a platform that cannot do this extra step
 * must not fail the write over it.
 */
async function fsyncDirectoryBestEffort(dirPath: string): Promise<void> {
  let handle;
  try {
    handle = await fsp.open(dirPath, 'r');
  } catch {
    return;
  }
  try {
    await handle.sync();
  } catch {
    // Opened but couldn't be fsync'd — same "not supported here" case, handled the same way.
  }
  try {
    await handle.close();
  } catch {
    // A failure here (e.g. a disconnected network share between open and close) must not turn a
    // successful write+rename into a thrown error — this whole function is best-effort durability,
    // not a step the write's success depends on.
  }
}

/**
 * Writes `contents` to `path`, atomically.
 *
 * `path` must come from `ProjectPaths.resolveWithin` — the `AbsolutePath` type is not otherwise
 * constructible, which is what makes "every write is contained" a property the compiler checks
 * rather than a convention callers might forget.
 *
 * @throws {ForgeError} `RUN-034` if any step fails. The temp file is not left behind: a failure
 * after the temp write attempts to remove it before re-throwing.
 */
export async function writeFileAtomic(
  target: AbsolutePath,
  contents: string | Uint8Array,
): Promise<void> {
  const dir = path.dirname(target);
  const tempPath = tempPathFor(target);

  try {
    await fsp.mkdir(dir, { recursive: true });

    const handle = await fsp.open(tempPath, 'wx');
    try {
      await handle.writeFile(contents);
      // fsync before rename, per specs/18 §18.10 — the ordering this module exists to guarantee.
      await handle.sync();
    } finally {
      await handle.close();
    }

    await fsp.rename(tempPath, target);
  } catch (cause) {
    // Best-effort cleanup: if the temp file was created but something later failed, do not leave it
    // behind. Ignored if it never existed or was already consumed by a successful rename. Wrapped in
    // its own try/catch so a *second*, unrelated failure here (e.g. the temp file's permissions
    // changed underneath this call) cannot replace the original `cause` with a raw, non-ForgeError
    // exception — the write's real failure reason is what must reach the caller.
    try {
      await fsp.rm(tempPath, { force: true });
    } catch {
      // The original `cause` below is what matters; a failed cleanup attempt is not itself fatal.
    }
    throw new ForgeError('RUN-034', { operation: 'writeFileAtomic', path: target }, { cause });
  }

  await fsyncDirectoryBestEffort(dir);
}

/**
 * Writes `contents` to `target`, atomically, the identical way {@link writeFileAtomic} does — except
 * that landing on an already-existing `target` is a refusal (`RUN-114`), never a silent overwrite.
 *
 * `18` §18.7 (post-v1.0, M15 P2): `MutationEvidence`/`EvidenceBundle` are append-only — every instance
 * gets its own, newly-allocated id/timestamp-bearing path, so a second write to the same path can only
 * mean a collision, never a legitimate revision (a Story-style same-file edit uses `writeFileAtomic`
 * directly instead; this function is for the append-only family specifically).
 *
 * Uses `fsp.link` (a hard link), not `fsp.rename`, for the final step: `link` fails atomically with
 * `EEXIST` when `target` already exists, closing the check-then-write race a separate `pathExists`
 * check before `writeFileAtomic` would leave open (two concurrent callers could both pass the check
 * before either renames). The temp file is still fully written and `fsync`'d first, so a crash between
 * the write and the link leaves `target` untouched either way, identically to `writeFileAtomic`'s own
 * crash-safety.
 *
 * @throws {ForgeError} `RUN-114` if `target` already exists.
 * @throws {ForgeError} `RUN-034` if any other step fails. The temp file is not left behind.
 */
export async function writeNewFileAtomic(
  target: AbsolutePath,
  contents: string | Uint8Array,
): Promise<void> {
  const dir = path.dirname(target);
  const tempPath = tempPathFor(target);

  try {
    await fsp.mkdir(dir, { recursive: true });

    const handle = await fsp.open(tempPath, 'wx');
    try {
      await handle.writeFile(contents);
      await handle.sync();
    } finally {
      await handle.close();
    }

    try {
      await fsp.link(tempPath, target);
    } catch (cause) {
      if (errorCode(cause) === 'EEXIST') {
        throw new ForgeError('RUN-114', { path: target });
      }
      throw cause;
    }
  } catch (cause) {
    try {
      await fsp.rm(tempPath, { force: true });
    } catch {
      // The original `cause` below is what matters; a failed cleanup attempt is not itself fatal.
    }
    if (cause instanceof ForgeError) throw cause;
    throw new ForgeError('RUN-034', { operation: 'writeNewFileAtomic', path: target }, { cause });
  }

  await fsp.rm(tempPath, { force: true });
  await fsyncDirectoryBestEffort(dir);
}

/** Narrows a caught value to a Node error code, without asserting anything about the rest of it —
 * the identical helper `@forge/core/fs`'s own `operations.ts` declares separately for its own
 * `pathExists`, duplicated here rather than imported: two small, single-file-local copies of a
 * three-line type guard, not a shared dependency either file's own public contract needs. */
function errorCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String(error.code)
    : undefined;
}
