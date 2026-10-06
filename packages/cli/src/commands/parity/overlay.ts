/**
 * The overlay-in, clean-around mechanics `13` F-TEST-9's observation bullets require:
 *
 * - {@link probeSourcePaths}: which file(s), under `.forge/parity/probes/`, a `library` surface's
 *   `run` (or `setup`) command line actually names — the probe is overlaid into whichever tree is
 *   observed "from the bytes the harness loaded", and this is how this piece decides WHICH bytes that
 *   is, without re-digesting the whole declaration's own join algorithm.
 * - {@link writeOverlayFile}: writes already-loaded bytes to a declared destination, mode 0644,
 *   refusing (never overwriting) an existing one (`13` F-TEST-9: "a destination that already exists
 *   in that tree makes the case `error`; it is never overwritten").
 * - {@link cleanDeclaredOutputs}/{@link readDeclaredOutputContent}: delete a case's own declared
 *   `file` outputs before and after it runs (so a stale file from a previous case or run cannot leak
 *   into the observation), examining every path component without following a symlink first.
 *
 * @see specs/13-frameworks-testing-and-debugging.md F-TEST-9
 * @see process/plans/PLAN-M16.md P3
 */
import { createHash } from 'node:crypto';
import { chmod, lstat, readFile, rm } from 'node:fs/promises';

import { ForgeError, isForgeError } from '@forge/core/errors';
import { ProjectPaths, writeFileAtomic, writeNewFileAtomic } from '@forge/core/fs';
import { commandWords } from '@forge/engine/dispatch';

import type { DeclaredOutput } from './declaration-types.ts';
import type { RawFileEntryContent } from './observe-types.ts';

function sha256Hex(data: Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

function isNodeErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}

const PROBE_PREFIX = '.forge/parity/probes/';

/**
 * Every word of `commandLine` (a surface's `run` or one of its `setup` entries) that names a file
 * under `.forge/parity/probes/` — the probe(s) a `library` surface's command actually runs, by
 * literal convention (`13` F-TEST-9's own vetting transcript, `process/SPEC-QUESTIONS.md` Q294
 * Decision 7, shows exactly this shape passing vetting: `node .forge/parity/probes/x.mjs`).
 *
 * Uses `commandWords` (`@forge/engine/dispatch`), the identical quote-aware splitter
 * `vetStoredCommand` already uses to decide what counts as one argument, rather than a bespoke
 * tokenizer this module would have to keep in sync with that one by hand — so a probe path quoted to
 * hold a space is found exactly the same way vetting itself would see it as one word. Returns `[]`,
 * never throws, for a line `commandWords` itself cannot parse (a surface whose `run` reaches this
 * function has already been vetted by `declaration.ts`'s own loader, so this is a defensive fallback,
 * not an expected path).
 *
 * A leading `./` is stripped before the prefix match, so `./.forge/parity/probes/x.mjs` and
 * `.forge/parity/probes/x.mjs` are treated identically — DECISION: the spec names no other spelling a
 * reviewer might reasonably write, and this is the one normalisation that costs nothing to apply.
 */
export function probeSourcePaths(commandLine: string): readonly string[] {
  const words = commandWords(commandLine) ?? [];
  return words
    .map((word) => word.replace(/^\.\//, ''))
    .filter((word) => word.startsWith(PROBE_PREFIX));
}

/**
 * Walks every path component of `relativePath` under `root`, `lstat`-ing each (never following a
 * link), and reports whether any of them is a symlink. Stops, reporting `false`, the moment a
 * component does not exist at all — nothing further down a path that is not there yet can itself be
 * a symlink.
 */
async function containsSymlinkComponent(root: string, relativePath: string): Promise<boolean> {
  const segments = relativePath.split('/').filter((segment) => segment !== '');
  let current = root;
  for (const segment of segments) {
    current = `${current}/${segment}`;
    let stats;
    try {
      stats = await lstat(current);
    } catch (cause) {
      if (isNodeErrnoException(cause) && cause.code === 'ENOENT') return false;
      throw cause;
    }
    if (stats.isSymbolicLink()) return true;
  }
  return false;
}

/**
 * Writes `bytes` to `destination` (relative to `root`, already shown safe by P2's own
 * `unsafeDeclaredPathReason` at load time), mode 0644 whatever `bytes`' own source mode was (`13`
 * F-TEST-9: "written from the bytes the harness loaded as a plain file with mode 0644"), through
 * `@forge/core/fs` (`QUALITY-BAR.md` R12): contained, atomic, and — via {@link writeNewFileAtomic}
 * rather than `writeFileAtomic` — refusing an existing target outright rather than overwriting it.
 *
 * Checked for a symlink component first, identically to {@link cleanDeclaredOutputs}/
 * {@link readDeclaredOutputContent} — `ProjectPaths.resolveWithin`'s own containment check alone is
 * NOT enough here: it refuses a symlink whose target lies outside the project, but a symlink that
 * stays INSIDE the project (`subdir -> safe-dir`, both inside) resolves clean and would let a write
 * land at the symlink's real target with no error at all, never actually landing at the declared
 * `destination` a reviewer read. `13` F-TEST-9's own output-path rule ("a case whose output path
 * passes through a symlink is `error`") applies to an overlay destination exactly as it does to a
 * declared output — a round-2 critic found this gap live, with exactly that in-project symlink.
 *
 * @throws {ForgeError} `RUN-125` if any component of `destination` is a symlink.
 * @throws {ForgeError} `RUN-120` if `destination` already exists — a RUNTIME fact the declaration
 * loader cannot know at load time (`declaration.ts`'s own doc comment): never overwritten.
 */
export async function writeOverlayFile(
  root: string,
  destination: string,
  bytes: Uint8Array,
): Promise<void> {
  if (await containsSymlinkComponent(root, destination)) {
    throw new ForgeError('RUN-125', { path: destination });
  }
  const absolute = new ProjectPaths(root).resolveWithin(destination);
  try {
    await writeNewFileAtomic(absolute, bytes);
  } catch (cause) {
    if (isForgeError(cause) && cause.code === 'RUN-114') {
      throw new ForgeError('RUN-120', { path: destination }, { cause });
    }
    throw cause;
  }
  // `writeNewFileAtomic` does not accept a mode (it exists for the append-only evidence family, which
  // has no such requirement); the spec's own mode is enforced as an explicit second step rather than
  // left to the platform's umask-dependent default.
  await chmod(absolute, 0o644);
}

/**
 * Writes `bytes` to the probe path `destination` (relative to `root`), OVERWRITING whatever is
 * already there — unlike {@link writeOverlayFile}, never refusing an existing target. This is the
 * one real difference between a probe and a declared case `input`: a probe's destination is always
 * its OWN source path under `.forge/parity/probes/` (`probeSourcePaths`'s own doc comment), which is
 * expected to already exist on the candidate side (it is the project's own real, tracked file) and
 * may or may not exist yet in the reference's scratch worktree — either way, ensuring the exact
 * reviewed bytes are present there is safe and correct, never a collision with an unrelated file the
 * way an arbitrary declared `to` destination elsewhere in the tree would be.
 *
 * Deliberately NOT cleaned up afterwards by this piece's own per-case cleanup (`observe.ts`): unlike
 * a case's own `inputs`, which `13` F-TEST-9 says are "removed after the case", the probe is not a
 * case input with a `to` destination — removing it would delete the candidate's own real, tracked
 * probe file from its working tree, which is never this harness's job.
 *
 * Checked for a symlink component first, identically to {@link writeOverlayFile} — see that
 * function's own doc comment for why `ProjectPaths.resolveWithin`'s containment check alone does
 * not catch an in-project symlink.
 *
 * @throws {ForgeError} `RUN-125` if any component of `destination` is a symlink.
 */
export async function writeProbeOverlay(
  root: string,
  destination: string,
  bytes: Uint8Array,
): Promise<void> {
  if (await containsSymlinkComponent(root, destination)) {
    throw new ForgeError('RUN-125', { path: destination });
  }
  const absolute = new ProjectPaths(root).resolveWithin(destination);
  await writeFileAtomic(absolute, bytes);
  await chmod(absolute, 0o644);
}

/**
 * Deletes every declared output in `outputs`, each relative to `root`, so a stale file from a
 * PREVIOUS case or a previous run cannot leak into the next observation (`13` F-TEST-9: "cleaned
 * before and after each case"). A path that does not exist is left untouched, no error. Checked for a
 * symlink component first, without following it — a case whose output path passes through one is
 * refused rather than cleaned (and so never read back) at all.
 *
 * @throws {ForgeError} `RUN-125` if any component of a declared output path is a symlink.
 */
export async function cleanDeclaredOutputs(
  root: string,
  outputs: readonly Pick<DeclaredOutput, 'path'>[],
): Promise<void> {
  for (const output of outputs) {
    if (await containsSymlinkComponent(root, output.path)) {
      throw new ForgeError('RUN-125', { path: output.path });
    }
    const absolute = new ProjectPaths(root).resolveWithin(output.path);
    await rm(absolute, { force: true });
  }
}

/**
 * Reads back one declared `file` output after a case ran: its full bytes (and lossy decode, the
 * identical reason {@link RawStream} in `observe-types.ts` keeps both) in `text` mode, only its
 * sha256 in `bytes` mode (`13` F-TEST-9: "only its sha256 is observed and stored, never its
 * content"), or `absent` when the case never wrote it at all — a real, comparable fact (this module's
 * own report; see `observe-types.ts`'s own doc comment on `RawFileEntryContent`), never an error.
 *
 * Checked for a symlink component first, identically to {@link cleanDeclaredOutputs} — a case cannot
 * make this function read through a link into a path the case's own declaration never named.
 *
 * @throws {ForgeError} `RUN-125` if any component of the output path is a symlink.
 */
export async function readDeclaredOutputContent(
  root: string,
  output: DeclaredOutput,
): Promise<RawFileEntryContent> {
  if (await containsSymlinkComponent(root, output.path)) {
    throw new ForgeError('RUN-125', { path: output.path });
  }
  const absolute = new ProjectPaths(root).resolveWithin(output.path);
  let bytes: Buffer;
  try {
    bytes = await readFile(absolute);
  } catch (cause) {
    if (isNodeErrnoException(cause) && cause.code === 'ENOENT') return { mode: 'absent' };
    throw cause;
  }
  if (output.mode === 'bytes') return { mode: 'bytes', sha256: sha256Hex(bytes) };
  return { mode: 'text', bytes, text: bytes.toString('utf8') };
}
