/**
 * `forge module <list|info|add|remove|update>` — `03` §3.2.8, `19` §19.5.
 *
 * `list`/`info` are read-only reports over the real, current manifest (`M10` origin). `add`/`remove`/
 * `update` were, until this piece, three literal `never`-returning `USR-003` stubs: `forge init`/
 * `forge upgrade` only ever (re)write the *whole* resolved built-in module set at once
 * (`buildManifest`/`writeRegenerableContent`), and no per-module install/uninstall mechanism existed
 * anywhere in this codebase. This piece is that mechanism, built on top of the three distribution
 * channels (`PLAN-M11.md` P1/P2), the capability consent screen (P3), the static safety scan (P4),
 * and P6's own module conformance runner — this same milestone already shipped all four — chaining
 * `19` §19.5's own installation flow end to end:
 *
 * 1. Fetch (`fetchInstallBundle`, dispatching on `source`'s own literal prefix to whichever of the
 *    three real channels applies).
 * 2. Parse `module.yaml` (M10 P2's real `parseModule`); check `forgeVersion` and `requires`/
 *    `conflicts` against the project's own currently-installed set.
 * 3. The capability consent screen (`describeRequestedCapabilities`/`promptForConsent`); nothing past
 *    this point runs on refusal.
 * 4. The static safety scan (`scanBundleForSafety`); nothing past this point runs on any finding.
 * 5. The module conformance suite (`runModuleConformance`, `PLAN-M11.md` P6): every `provides` entry
 *    re-validated against the fetched bundle's own real content, and every `tests/*.test.ts` file the
 *    module ships run for real against `@forge/testkit`'s `FakePlatformAdapter`; a module that fails
 *    either is refused here, before anything is written to `.forge/` (module-only — `overlay.ts`'s
 *    own `overlayAdd` never calls this, since an overlay has no `provides` concept, `19` §19.1).
 * 6. Install into `.forge/modules/<id>/`, record in `manifest.yaml` with version, checksum, and the
 *    real install `source` (so `moduleUpdate` can re-fetch from the same place, and so `moduleRemove`/
 *    `moduleUpdate` can tell a per-module-managed row apart from a built-in one — see `CFG-045`).
 * 7. Report what changed — a real `InstallChangeReport`, not a full `forge compile` re-run: `forge
 *    compile`'s own command (`compile.ts`) already documents, as a disclosed pre-existing gap, that no
 *    "gather this project's own real content into `CompileSources`" resolver exists anywhere in this
 *    codebase yet, so a `moduleAdd` that tried to actually invoke it would either fabricate a resolver
 *    out of this piece's own ~400-line budget or silently pass an empty/wrong `CompileSources`. What
 *    this step reports instead is real: `19` §19.1's own module-layer resolved set (which module ids
 *    are installed) plus, for `moduleUpdate`, the real diff of newly-requested capability grants versus
 *    the previously-installed version — exactly the two things `PLAN-M11.md` P5's own Checks line
 *    actually names ("shows exactly the new grants in the diff, not the whole resolved set"). Recorded
 *    as a disclosed scope decision, not a silent one — see `SPEC-QUESTIONS.md`.
 *
 * `moduleRemove` refuses a module another installed module's own `requires`, or an already-installed
 * overlay's own `requiresModules`, still names (`CFG-039`). `moduleAdd`/`moduleRemove`/`moduleUpdate`
 * all refuse a manifest row with no recorded `source` (`CFG-042`/`CFG-045`) — a built-in `fm-*` module
 * or the synthetic `@forge/templates` row is managed by `forge init`/`forge upgrade`'s own
 * whole-roster mechanism, not this one. `moduleAdd`/`overlayAdd` both refuse an id already claimed in
 * *either* namespace (`CFG-042`) — a module and an overlay sharing one id would leave every
 * id-keyed lookup unable to tell the two rows apart.
 *
 * All four operations (`moduleAdd`/`moduleRemove`/`moduleUpdate`/`overlay.ts`'s own `overlayAdd`) run
 * inside `withManifestLock` — a real, on-disk, per-project lock (`.forge/state/module-install.lock`).
 * A critic round on this piece's first draft found the read-manifest/fetch/write-manifest sequence
 * below unlocked: two concurrent installs against the same project could both read the same stale
 * `manifest.yaml`, and the second writer's own stale snapshot would silently clobber the first
 * writer's new row — the exact "concurrent access" failure mode this project's own quality bar names.
 *
 * Every gate above throws *before* any filesystem write for this install/update (`installBundleTree`/
 * `writeManifestDocument` are both the last two calls in every success path, and every early-return
 * path is a `throw`): a refusal at any gate leaves `manifest.yaml` and `.forge/modules/`/
 * `.forge/overlays/` exactly as they were. Both of those two calls, plus `moduleRemoveLocked`'s own
 * `rm(destAbs, ...)`, now also call `verifyFence()` immediately beforehand (a round-2 critic finding:
 * the write-time fence this file's own `withManifestLock` doc comment describes originally covered
 * only `writeManifestDocument`, leaving `installBundleTree`/`rm(destAbs, ...)` — real writes into this
 * same lock's own protected `.forge/modules/<id>/`/`.forge/overlays/<id>/` scope — unfenced).
 *
 * @see specs/03 §3.2.8
 * @see specs/19 §19.5
 * @see PLAN-M11.md P5
 * @see PLAN-M11.md P6
 */
import { cp, mkdir, open, rename, rm, stat } from 'node:fs/promises';
// `fsyncTreeBestEffort` below only ever uses this to decide whether to recurse/fsync each entry of an
// already-fully-copied staging tree -- unordered traversal cannot affect its result (every entry is
// visited regardless of order), the identical "order cannot matter" exemption `@forge/core/fs`'s own
// `listDirEntriesSorted` doc comment already establishes for the general case, applied here to a
// deliberately unsorted, durability-only walk this file's own `@forge/core/fs` import cannot serve
// (that helper requires an already-`resolveWithin`-checked `AbsolutePath`, which a disposable staging
// directory this function creates itself is not).
// eslint-disable-next-line no-restricted-imports -- see comment above
import { readdir } from 'node:fs/promises';
import path from 'node:path';

import * as YAML from 'yaml';

import { ForgeError, SYSTEM_CLOCK, readTextFile, type Clock, type ProjectPaths } from '@forge/core';
import {
  listDirEntriesSorted,
  pathExists,
  writeFileAtomic,
  type AbsolutePath,
} from '@forge/core/fs';
import {
  describeRequestedCapabilities,
  fetchGitOverlayBundle,
  fetchLocalOverlay,
  fetchNpmOverlay,
  promptForConsent,
  runModuleConformance,
  scanBundleForSafety,
  type ConsentPromptOptions,
  type OverlayManifestKind,
} from '@forge/extensions/install';
import {
  parseModule,
  satisfiesForgeVersionRange,
  type ModuleDefinition,
} from '@forge/extensions/module';

import type { ManifestModule } from '../init/index.ts';
import { isProcessAlive } from './run/lock.ts';

export interface ModuleCommandContext {
  readonly paths: ProjectPaths;
  readonly modulesDir: string;
}

const MANIFEST_REL_PATH = '.forge/manifest.yaml';

/** A `manifest.yaml` module row this piece's own per-item lifecycle actually manages: present only
 * when installed via `moduleAdd`/`moduleUpdate`, `undefined` for every built-in `fm-*` module and the
 * synthetic `@forge/templates` row (`buildManifest`'s own rows never set it). */
export type InstalledModuleRow = ManifestModule & { readonly source?: string };

/** A `manifest.yaml` overlay row (`overlay.ts`'s own `overlayAdd`) — every overlay is per-item-managed
 * (no built-in overlay concept exists), so `source` is always present, unlike `InstalledModuleRow`'s. */
export interface InstalledOverlayRow {
  readonly id: string;
  readonly version: string;
  readonly checksum: string;
  readonly source: string;
}

/** `manifest.yaml`'s own full real shape, as this piece reads and writes it — a strict superset of
 * `init/manifest.ts`'s own `{version, modules}` (that type is left unchanged: `forge upgrade`'s own
 * `buildManifest` has no concept of `overlays` or a module row's `source`, and extending its exported
 * type would force every existing reader to account for fields it never produces). Read generically
 * (via `YAML.parse` into `Partial<ManifestDoc>`, not this package's own narrower `Manifest`) so a
 * document already carrying an `overlays` key from a prior `overlayAdd` round-trips through a
 * `moduleAdd`/`moduleRemove`/`moduleUpdate` call untouched, and the reverse. */
export interface ManifestDoc {
  readonly version: 1;
  readonly modules: readonly InstalledModuleRow[];
  readonly overlays: readonly InstalledOverlayRow[];
}

async function readManifestDoc(paths: ProjectPaths): Promise<ManifestDoc> {
  const manifestPath = paths.resolveWithin(MANIFEST_REL_PATH);
  if (!(await pathExists(manifestPath))) {
    throw new ForgeError('CFG-017', undefined);
  }
  const raw = YAML.parse(await readTextFile(manifestPath)) as {
    readonly modules?: readonly InstalledModuleRow[];
    readonly overlays?: readonly InstalledOverlayRow[];
  };
  return { version: 1, modules: raw.modules ?? [], overlays: raw.overlays ?? [] };
}

/** Exported so `overlay.ts`'s own `overlayAdd` reads/writes the identical `manifest.yaml` shape rather
 * than re-deriving a second parser for the same file. */
export async function readManifestDocument(paths: ProjectPaths): Promise<ManifestDoc> {
  return readManifestDoc(paths);
}

export async function writeManifestDocument(paths: ProjectPaths, doc: ManifestDoc): Promise<void> {
  await writeFileAtomic(paths.resolveWithin(MANIFEST_REL_PATH), YAML.stringify(doc));
}

async function readManifestModules(paths: ProjectPaths): Promise<readonly ManifestModule[]> {
  return (await readManifestDoc(paths)).modules;
}

// ---------------------------------------------------------------------------------------------
// Serializing installs against one project (a critic round on this piece's own first draft found
// the read-modify-write sequence below unlocked: `moduleAdd`/`moduleRemove`/`moduleUpdate`/
// `overlayAdd` each read `manifest.yaml` once, then perform a slow fetch, then write a manifest
// computed from that now-stale read — two concurrent installs against the same project would let
// the second writer's stale snapshot silently clobber the first writer's own new row, exactly the
// "concurrent access" failure mode QUALITY-BAR.md names). `withManifestLock` below wraps every one
// of those four operations end to end, reusing `run/lock.ts`'s own proven exclusive-create-plus-
// stale-reclaim shape (`acquireRunLock`'s own doc comment) rather than re-deriving a second locking
// primitive — a lock this piece owns and releases itself, distinct from `run/lock.ts`'s own
// `CFG-002` run-supervisor lock (a different resource, a different lifetime), so a `forge run` in
// progress and a `forge module add` in progress never contend with each other's lock file.
// ---------------------------------------------------------------------------------------------

const INSTALL_LOCK_REL_PATH = 'module-install.lock';
const MAX_LOCK_ATTEMPTS = 100;

/** Thrown only by the `verifyFence` callback `withManifestLock` hands to every `fn` -- never by
 * anything else, and never expected to escape `withManifestLock` itself. See `withManifestLock`'s own
 * doc comment ("write-time fencing") and `collection-lock.ts`'s own identical mechanism (this file's
 * own sibling, same root cause, independently applied here since this lock shares no code with that
 * one). Exported so a test can assert a fence loss was genuinely detected. */
export class ManifestLockFenceLostError extends Error {
  constructor() {
    super(
      "module-install.lock's own fence check failed immediately before a write: this process can " +
        'no longer prove it holds the lock (another process now provably does). Aborting this write ' +
        'attempt; the full acquire loop will run again from scratch.',
    );
    this.name = 'ManifestLockFenceLostError';
  }
}

/** The identical, deliberately small and separate budget `collection-lock.ts`'s own
 * `MAX_FENCE_RETRIES` doc comment explains in full: bounds re-acquisitions after a CONFIRMED fence
 * loss specifically, never ordinary acquire contention (`MAX_LOCK_ATTEMPTS` above still governs
 * that). */
const MAX_FENCE_RETRIES = 10;

/** How long an AMBIGUOUS lock (`readLockPid` returning `undefined`: missing, unreadable, or
 * non-numeric content) may sit before this process reclaims it anyway -- the identical mechanism
 * and literal value already proven safe one commit later in this same round by `migrate/lock.ts`'s
 * own `acquireMigrateLock` (`AMBIGUOUS_LOCK_GRACE_MS`) and, before that, by `collection-lock.ts`'s
 * own `withCollectionLock` (`STALE_EMPTY_LOCK_MS`, `e2a42d5`). Gated on the lock FILE's own measured
 * `stat().mtime` age, never on content parseability: a genuine TOCTOU gap (the true owner releasing
 * one lock and creating its own next one) resolves on the very next retry well under this, while a
 * permanently malformed file (hand-edited, or real on-disk corruption -- `readLockPid`'s own doc
 * comment names exactly this case) still eventually self-heals instead of burning through every one
 * of `MAX_LOCK_ATTEMPTS` in milliseconds and throwing `CFG-047` forever, with no human remedy short
 * of deleting the file by hand.
 *
 * **Confirmed regression, fixed:** before this constant existed, the ambiguous branch below neither
 * delayed nor age-gated at all -- a permanently-malformed-but-stably-readable lock file (non-numeric
 * content) made every `withManifestLock` call burn through all `MAX_LOCK_ATTEMPTS` in ~7ms, every
 * time, forever, throwing `CFG-047` with zero backoff and zero self-heal path. See this file's own
 * `withManifestLock` doc comment for the full before/after measurement. */
const AMBIGUOUS_LOCK_GRACE_MS = 2000;

/** How long `withManifestLock` waits between retries while a lock is ambiguous but still within its
 * own grace window above -- avoids a hot, delay-free busy-loop spin while that window elapses.
 * Matches `migrate/lock.ts`'s own identical `POLL_INTERVAL_MS`. */
const AMBIGUOUS_LOCK_RETRY_DELAY_MS = 100;

/** `undefined` for every case this process cannot currently prove holds the lock — a genuinely
 * absent file, one removed by a concurrent reclaim in the TOCTOU gap between this function's own
 * existence check and its read (confirmed live: a real 28-process x 6-iteration contention run
 * crashed up to 20 of 28 workers outright on an uncaught `RUN-034` from exactly this gap before this
 * fix, `readTextFile` throwing ENOENT because `pathExists` and the read were two separate, non-atomic
 * steps), or unparseable content. Never throws: a single `readTextFile` catch covers both "missing"
 * and "existed a moment ago, gone by the time of the actual read" in one step, rather than `pathExists`
 * then a separate `readTextFile` leaving a gap a concurrent writer's own release/reclaim can land in. */
async function readLockPid(lockAbs: AbsolutePath): Promise<number | undefined> {
  let raw: string;
  try {
    raw = (await readTextFile(lockAbs)).trim();
  } catch {
    return undefined;
  }
  const pid = Number(raw);
  return Number.isInteger(pid) ? pid : undefined;
}

/**
 * Runs `fn` while holding the one real, on-disk install lock for `paths`' own project — refuses
 * outright (`CFG-047`) rather than queueing when another still-alive process already holds it,
 * matching `acquireRunLock`'s own identical "another live holder is a real, named refusal, never a
 * silent wait" stance. A lock naming a dead pid (a crashed `forge module add`) is reclaimed rather
 * than treated as held, the identical stale-lock reasoning `acquireRunLock`'s own doc comment gives.
 *
 * The one and only real acquisition write is `open(path, 'wx')` — exclusive create, atomic at the OS
 * level — never a separate "check, then write" pair, so two installs starting in the same instant
 * cannot both believe they hold the lock the way an unlocked read-then-write already proved they
 * could for the manifest itself.
 *
 * **Fixed bug class, identical to `@forge/telemetry`'s own `withEventLogLock` (`379eb26`) and this
 * package's own `withCollectionLock` (`e2a42d5`):** `readLockPid` returning `undefined` used to be
 * folded into "not a real, live holder, reclaim" alongside a genuinely dead pid. But `undefined` only
 * ever means "this process could not prove a holder exists a moment ago" — it says nothing about
 * whether one exists *right now*, at the actual instant of the `rm` call below. Unconditionally
 * reclaiming on that basis let this process delete a brand-new, genuinely live lock a different
 * process legitimately created in the gap between the ambiguous read and the reclaim. Only a lock
 * this process can actually read AND prove names a dead pid is real, positive evidence of staleness;
 * `undefined` is retried instead, never reclaimed.
 *
 * **Deeper, CONFIRMED bug underneath all of the above, closed here: write-time fencing.** A dedicated
 * investigation found that `open(path, 'wx')` itself -- the "exclusive, atomic at the OS level" create
 * this doc comment's own second paragraph relies on -- can, under dense, synchronous create/delete
 * churn against the identical lock-file path from many real processes at once, let TWO concurrent
 * creates BOTH report success, with neither ever seeing `EEXIST`. Confirmed identical in substance to
 * `collection-lock.ts`'s own `withCollectionLock` (closed the same way) and `@forge/telemetry`'s own
 * `withEventLogLock` (the sibling that cannot share code with either, across the package boundary):
 * see `collection-lock.ts`'s own top doc comment for the complete empirical repro and reasoning, not
 * re-derived a third time here. `fn` is now handed a `verifyFence` callback it must call immediately
 * before its own real write (`writeManifestDocument`) actually commits; `withManifestLock` is the only
 * thing that ever catches the `ManifestLockFenceLostError` it throws on a lost fence, and responds by
 * abandoning the attempt (never touching the lock file, which may now be a different process's own
 * legitimate lock) and re-entering the full acquire loop from scratch, including a fresh `fn` call
 * that re-reads `manifest.yaml` fresh before computing anything again. */
/** Exported so `overlay.ts`'s own `overlayAdd` serializes against the identical lock — one project
 * has one install lock regardless of whether the operation in flight is a module or an overlay one,
 * since both mutate the same `manifest.yaml`.
 *
 * **Round-2 critic fix, a real regression in the round-1 fix above:** the ambiguous (`undefined`)
 * branch below used to retry the exclusive create with no delay and no age-gate at all. `migrate/
 * lock.ts`'s own `acquireMigrateLock` is the sibling with the FULL fix this file's own
 * `AMBIGUOUS_LOCK_GRACE_MS` mirrors directly: a genuinely age-gated self-heal, reclaiming an ambiguous
 * lock only once it has measurably sat unreadable past a real grace window. `run/lock.ts`'s own
 * `AMBIGUOUS_LOCK_RETRY_DELAY_MS` is a narrower, DIFFERENT thing this file's own
 * `AMBIGUOUS_LOCK_RETRY_DELAY_MS` constant borrows only the delay-before-retry idea from, not the
 * self-heal mechanism itself — `run/lock.ts` deliberately has NO age-gate at all for its own ambiguous
 * case (a bounded retry, then a permanent, plain `Error`; see `acquireRunLock`'s own disclosure
 * comment for why `CFG-002`'s higher safety bar makes that a suspected-deliberate asymmetry, not a
 * gap this round also closed). A critic constructed a permanently-malformed-but-stably-readable
 * `module-install.lock` (non-numeric content — a realistic disk-corruption or hand-edit scenario) and
 * confirmed: before this fix, this burned through all `MAX_LOCK_ATTEMPTS` in ~7ms, every time,
 * throwing `CFG-047` with zero backoff and zero self-heal path — a permanent, misleading failure
 * needing a human to delete the lock file by hand. After this fix, the identical lock file self-heals
 * once it has genuinely sat unreadable for longer than `AMBIGUOUS_LOCK_GRACE_MS`, taking measurably
 * longer than an instant rather than either failing permanently or reclaiming unsafely with zero delay
 * (the original round-1 bug this whole lock exists to avoid repeating). `clock` is injected
 * (`QUALITY-BAR.md` R10) purely to compute that age deterministically in a test; production callers
 * never pass one, taking `SYSTEM_CLOCK`. */
/** The original acquire loop, unchanged in substance from before this fix -- extracted purely so
 * `withManifestLock` below can call it again, from scratch, after a confirmed write-time fence loss.
 * Returns `true` once genuinely acquired, `false` once `MAX_LOCK_ATTEMPTS` is exhausted while still
 * unacquired. */
async function acquireManifestLockOnce(lockAbs: AbsolutePath, clock: Clock): Promise<boolean> {
  for (let attempt = 0; attempt < MAX_LOCK_ATTEMPTS; attempt += 1) {
    try {
      const handle = await open(lockAbs, 'wx');
      try {
        await handle.writeFile(String(process.pid));
        await handle.sync();
      } finally {
        await handle.close();
      }
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      const existingPid = await readLockPid(lockAbs);
      if (existingPid === undefined) {
        // Ambiguous, not stale: this process cannot currently prove anything about who (if anyone)
        // holds the lock a moment ago. Age-gated on the lock FILE's own measured `mtime`, the
        // identical mechanism `migrate/lock.ts`'s own `acquireMigrateLock` already proved safe for
        // this exact "ambiguous, not stale" case -- see `AMBIGUOUS_LOCK_GRACE_MS`'s own doc comment
        // and `withManifestLock`'s own doc comment for the confirmed before/after this closes.
        const ageMs = await stat(lockAbs)
          .then((info) => Date.parse(clock.now()) - info.mtimeMs)
          .catch(() => undefined);
        if (ageMs !== undefined && ageMs > AMBIGUOUS_LOCK_GRACE_MS) {
          await rm(lockAbs, { force: true });
          continue;
        }
        await new Promise((resolve) => setTimeout(resolve, AMBIGUOUS_LOCK_RETRY_DELAY_MS));
        continue;
      }
      if (isProcessAlive(existingPid)) {
        throw new ForgeError('CFG-047', undefined);
      }
      // A genuinely dead pid is real, positive proof of staleness -- safe to reclaim outright.
      await rm(lockAbs, { force: true });
    }
  }
  return false;
}

/** Deletes `lockAbs` only once re-confirming it still names THIS process's own pid -- the identical
 * fail-closed "don't touch what might now be someone else's real lock" discipline `verifyFence`
 * below applies at write time, applied once more here at the one other moment this function ever
 * removes the lock file. */
async function releaseManifestLockIfStillOwned(lockAbs: AbsolutePath): Promise<void> {
  const pid = await readLockPid(lockAbs);
  if (pid === process.pid) {
    await rm(lockAbs, { force: true });
  }
}

export async function withManifestLock<T>(
  paths: ProjectPaths,
  // `verifyFence`: `fn` MUST call this immediately before its own real write (`writeManifestDocument`)
  // actually commits -- see this function's own doc comment above ("write-time fencing," the
  // identical mechanism and root cause `collection-lock.ts`'s own top doc comment explains in full;
  // this file's own version is independently implemented, not imported, since this lock shares no
  // code with that one). `verifyFence` re-reads `module-install.lock` fresh and throws
  // `ManifestLockFenceLostError` the instant it no longer names this process's own pid -- caught only
  // here, which responds by abandoning the attempt and re-entering the FULL acquire loop from
  // scratch (never a bare retry of the write with now-stale manifest data).
  fn: (verifyFence: () => Promise<void>) => Promise<T>,
  clock: Clock = SYSTEM_CLOCK,
): Promise<T> {
  const lockAbs = paths.resolveState(INSTALL_LOCK_REL_PATH);
  await mkdir(path.dirname(lockAbs), { recursive: true });

  for (let fenceRetry = 0; fenceRetry <= MAX_FENCE_RETRIES; fenceRetry += 1) {
    const acquired = await acquireManifestLockOnce(lockAbs, clock);
    if (!acquired) {
      throw new ForgeError('CFG-047', undefined);
    }

    const verifyFence = async (): Promise<void> => {
      const pid = await readLockPid(lockAbs);
      if (pid !== process.pid) {
        throw new ManifestLockFenceLostError();
      }
    };

    try {
      const result = await fn(verifyFence);
      await releaseManifestLockIfStillOwned(lockAbs);
      return result;
    } catch (error) {
      if (error instanceof ManifestLockFenceLostError) {
        continue;
      }
      await releaseManifestLockIfStillOwned(lockAbs);
      throw error;
    }
  }
  throw new ForgeError('CFG-047', undefined);
}

/** `list` — every real, installed module row from the real, current manifest. */
export async function moduleList(ctx: ModuleCommandContext): Promise<readonly ManifestModule[]> {
  return readManifestModules(ctx.paths);
}

export interface ModuleInfo {
  readonly manifest: ManifestModule;
  /** Every real `agents/*.agent.yaml` id this module's own real source directory ships, `[]` for the
   * synthetic `@forge/templates` row (which has no real `modulesDir` directory of its own). */
  readonly agentIds: readonly string[];
}

/** `info <id>` — the real manifest row plus the real module directory's own real agent id list. */
export async function moduleInfo(ctx: ModuleCommandContext, id: string): Promise<ModuleInfo> {
  const modules = await readManifestModules(ctx.paths);
  const manifest = modules.find((module) => module.id === id);
  if (manifest === undefined) {
    throw new ForgeError('KB-015', { id });
  }

  // `id` is concatenated into a real filesystem path and cast straight to `AbsolutePath`, bypassing
  // `resolveWithin`'s own containment check -- safe here specifically because `id` can only reach this
  // line already matching a real row in the trusted manifest (the `KB-015` throw above), never an
  // arbitrary caller-supplied traversal string; `init/content.ts:107`'s own identical `as
  // AbsolutePath` cast over a trusted `modulesDir` is the precedent this follows, extended to a value
  // gated by the same kind of trust rather than left implicit.
  const agentsDir = `${ctx.modulesDir}/${id}/agents` as AbsolutePath;
  if (!(await pathExists(agentsDir))) {
    return { manifest, agentIds: [] };
  }
  const entries = await listDirEntriesSorted(agentsDir);
  const agentIds = entries
    .filter((entry) => !entry.isDirectory && entry.name.endsWith('.agent.yaml'))
    .map((entry) => entry.name.replace(/\.agent\.yaml$/, ''));
  return { manifest, agentIds };
}

// ---------------------------------------------------------------------------------------------
// Shared install pipeline (`19` §19.5) — used by `moduleAdd`/`moduleUpdate` below and, via the
// exports at the bottom of this file, by `overlay.ts`'s own `overlayAdd`. Kept in this file rather
// than a third one: `PLAN-M11.md` P5's own declared Surface names only `module.ts` (replacing the
// stubs) and `overlay.ts` (new); a shared pipeline neither command's own public surface needs to
// re-derive lives naturally in whichever of the two files is the dependency-free one for the other
// to import from, and `overlay.ts` already imports `@forge/extensions/compile` from this package
// family, so this is not a new kind of cross-file dependency for it.
// ---------------------------------------------------------------------------------------------

export interface FetchedInstallBundle {
  readonly path: string;
  readonly manifestKind: OverlayManifestKind;
  readonly checksum: string;
  /** `[]` for a pinned git ref, the local channel, and the npm channel — one floating-ref warning
   * (`19` §19.5's own "floating refs warned about, never refused") for an unpinned git ref. */
  readonly warnings: readonly string[];
  /** Removes whatever this fetch itself created — a no-op for the local channel, which installs
   * directly from the caller's own directory and copies nothing of its own to clean up. */
  readonly cleanup: () => Promise<void>;
}

export interface FetchInstallBundleOptions {
  /** The base directory a disposable git checkout or npm pack/extract is created under (`mkdtemp`'d,
   * never used directly) — ignored for a local-path `source`. */
  readonly workDir: string;
  /** The directory whose own `.npmrc` governs which registry an `npm:` source resolves against —
   * ignored for a `git+`/local-path `source`. */
  readonly npmCwd: string;
}

/** Dispatches `source` to whichever of `19` §19.5's own three real channels its literal prefix names
 * (`git+`, `npm:`, or — falling through — a local filesystem path), and normalises all three real,
 * differently-shaped fetch results (`fetchGitOverlayBundle`/`fetchNpmOverlay`/`fetchLocalOverlay`,
 * `PLAN-M11.md` P1/P2) into one shape the rest of this pipeline operates on uniformly. */
export async function fetchInstallBundle(
  source: string,
  options: FetchInstallBundleOptions,
): Promise<FetchedInstallBundle> {
  if (source.startsWith('git+')) {
    const result = await fetchGitOverlayBundle(source, { workDir: options.workDir });
    return {
      path: result.path,
      manifestKind: result.manifestKind,
      checksum: result.checksum,
      warnings: result.warnings,
      cleanup: () => rm(result.path, { recursive: true, force: true }),
    };
  }
  if (source.startsWith('npm:')) {
    const result = await fetchNpmOverlay(source, { workDir: options.workDir, cwd: options.npmCwd });
    return {
      path: result.path,
      manifestKind: result.manifestKind,
      checksum: result.checksum,
      warnings: [],
      cleanup: () => rm(result.path, { recursive: true, force: true }),
    };
  }
  const result = await fetchLocalOverlay(source);
  return {
    path: result.path,
    manifestKind: result.manifestKind,
    checksum: result.checksum,
    warnings: [],
    cleanup: () => Promise.resolve(),
  };
}

/**
 * Refuses when `destAbs` and `bundlePath` overlap (either contains the other) — a round-2 critic
 * finding: the local channel's own `fetchLocalOverlay` installs directly from the caller's own
 * directory (no temp copy, by that module's own documented design), so a source path that happens to
 * sit inside — or to contain — the very `.forge/modules/<id>/`/`.forge/overlays/<id>/` this call is
 * about to `rm` and repopulate would either delete part of the content `cp` is still reading, or have
 * `cp` recurse into a destination nested inside its own source. Neither is a case this pipeline can
 * install correctly, so it is refused outright rather than attempted.
 *
 * @throws {ForgeError} `CFG-049` if the two paths overlap.
 */
function assertNoPathOverlap(destAbs: AbsolutePath, bundlePath: string): void {
  const dest = `${path.resolve(destAbs)}${path.sep}`;
  const source = `${path.resolve(bundlePath)}${path.sep}`;
  if (dest.startsWith(source) || source.startsWith(dest)) {
    throw new ForgeError('CFG-049', { destination: destAbs, source: bundlePath });
  }
}

/** A per-process counter, not `Date.now()` — the identical `QUALITY-BAR.md` R10 reasoning
 * `@forge/core/fs`'s own `writeFileAtomic`/`tempPathFor` already documents for its own temp-file
 * naming: nothing about this name needs to be unpredictable, only unique within this process, and a
 * round-3 critic round found the first version of this function's own `Date.now()`-based name was
 * exactly the uninjected wall-clock read R10 forbids in production code (`pnpm lint` fails on it). */
let installStagingSequence = 0;

/** Best-effort `fsync` of one directory handle — swallows a platform that cannot open a directory
 * this way (matching `@forge/core/fs`'s own `fsyncDirectoryBestEffort`, not exported from that
 * module, so duplicated here rather than reached via a cross-package private import). */
async function fsyncDirBestEffort(dirPath: string): Promise<void> {
  let handle;
  try {
    handle = await open(dirPath, 'r');
  } catch {
    return;
  }
  try {
    await handle.sync();
  } catch {
    // Not supported here — the file-level fsyncs below already guarantee the data itself.
  }
  try {
    await handle.close();
  } catch {
    // Best-effort durability only; a failed close must not turn a successful write into a thrown error.
  }
}

/**
 * Recursively `fsync`s every regular file (and, after them, every directory) under `dir` — best
 * effort, matching `fsyncDirBestEffort`'s own swallow-on-unsupported stance. `fs.promises.cp` gives no
 * per-file `fsync` hook of its own, so this walks the *already-copied* staged tree once, right before
 * the atomic `rename` that publishes it, giving the whole tree the identical "write-temp → fsync →
 * rename" durability `QUALITY-BAR.md` R12 requires — applied here to a directory tree rather than
 * `writeFileAtomic`'s single file, since a round-3 critic round found this function's own first draft
 * (the round-2 staging-then-rename fix) never fsync'd anything at all.
 */
async function fsyncTreeBestEffort(dir: string): Promise<void> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await fsyncTreeBestEffort(full);
    } else if (entry.isFile()) {
      let handle;
      try {
        handle = await open(full, 'r');
      } catch {
        continue;
      }
      try {
        await handle.sync();
      } catch {
        // Best-effort — see fsyncDirBestEffort's own doc comment.
      }
      try {
        await handle.close();
      } catch {
        // Best-effort — see fsyncDirBestEffort's own doc comment.
      }
    }
  }
  await fsyncDirBestEffort(dir);
}

/**
 * Copies `bundlePath`'s real content into `destAbs`, replacing whatever was there before (an update,
 * or a reinstall after a prior failed cleanup) — `.git` excluded, matching `computeContentChecksum`'s
 * own "not version-control bookkeeping" scope for the identical tree.
 *
 * Stages the copy in a sibling directory, `fsync`s every file in it, and only then `rename`s it into
 * `destAbs` — a round-2 critic finding fixed the original `rm`-then-`cp` (a `cp` failing partway left
 * `destAbs` a half-erased, half-new hybrid); a round-3 critic finding then added the `fsync` step
 * itself, which the round-2 fix had left out entirely (`QUALITY-BAR.md` R12). Staging and destination
 * share one parent directory, so the publishing `rename` is a single atomic filesystem operation — the
 * one narrow gap left is the `rm(destAbs)` immediately before it (two operations, not one), which
 * `moduleUpdate`'s own `CFG-048` existence check exists specifically to detect and recover from if a
 * crash ever lands in that exact window, rather than this function claiming a stronger guarantee than
 * it actually has.
 */
export async function installBundleTree(destAbs: AbsolutePath, bundlePath: string): Promise<void> {
  assertNoPathOverlap(destAbs, bundlePath);
  const parentDir = path.dirname(destAbs);
  await mkdir(parentDir, { recursive: true });

  installStagingSequence += 1;
  const stagingDir = path.join(
    parentDir,
    `.install-staging-${String(process.pid)}-${String(installStagingSequence)}`,
  );
  await rm(stagingDir, { recursive: true, force: true });
  try {
    await cp(bundlePath, stagingDir, {
      recursive: true,
      filter: (source) => path.basename(source) !== '.git',
    });
    await fsyncTreeBestEffort(stagingDir);
    await rm(destAbs, { recursive: true, force: true });
    await rename(stagingDir, destAbs);
    await fsyncDirBestEffort(parentDir);
  } catch (cause) {
    await rm(stagingDir, { recursive: true, force: true });
    throw cause;
  }
}

export interface InstallOptions {
  readonly workDir: string;
  readonly npmCwd: string;
  /** The FORGE version actually running, checked against the fetched bundle's own `forgeVersion`
   * range — caller-injected rather than read from a hidden global, the identical determinism
   * reasoning `ResolveInstalledModulesOptions.forgeVersion`'s own doc comment already gives (`@forge/
   * extensions/module`). */
  readonly forgeVersion: string;
  readonly consent?: ConsentPromptOptions;
}

/** What changed as a result of one `moduleAdd`/`moduleRemove`/`moduleUpdate`/`overlayAdd` call — `19`
 * §19.5 step 6's own "report what changed in the resolved set, as a diff," scoped to what this piece
 * can report for real (see this file's own top-of-file doc comment for the disclosed `forge compile`
 * gap this stops short of). */
export interface InstallChangeReport {
  readonly id: string;
  readonly action: 'installed' | 'updated' | 'removed';
  readonly version?: string;
  readonly previousVersion?: string;
  readonly resolvedSetDelta: {
    readonly added: readonly string[];
    readonly removed: readonly string[];
  };
  /** Every capability entry newly requested by this change: every entry for `installed`, only the
   * entries absent from the previously-installed version for `updated` (a real diff, never a blanket
   * re-list), `[]` for `removed`. */
  readonly newGrants: readonly string[];
  readonly warnings: readonly string[];
}

/** `parseModule`'s own signature requires an `AbsolutePath` — the brand `ProjectPaths.resolveWithin`
 * normally produces to prove a path is *contained in the project*. `bundlePath` is never that: it is
 * a fetched-but-not-yet-installed bundle's own temp directory (or, for the local channel, the user's
 * own source directory) — outside the project entirely, and read-only at this point in the pipeline.
 * The cast is safe here specifically because nothing downstream of `parseModule` treats this value as
 * a project-relative write target; every real write later in this pipeline goes through
 * `ctx.paths.resolveWithin` on its own destination path, never on this one. */
function moduleYamlAbsPath(bundlePath: string): AbsolutePath {
  return path.join(bundlePath, 'module.yaml') as AbsolutePath;
}

function checkModuleVersionAndDeps(
  moduleDef: ModuleDefinition,
  installedModules: readonly { readonly id: string }[],
  forgeVersion: string,
): void {
  if (!satisfiesForgeVersionRange(forgeVersion, moduleDef.forgeVersion)) {
    throw new ForgeError('CFG-024', {
      moduleId: moduleDef.id,
      forgeVersion,
      required: moduleDef.forgeVersion,
    });
  }
  const installedIds = new Set(installedModules.map((module) => module.id));
  for (const requires of moduleDef.requires) {
    if (!installedIds.has(requires)) {
      throw new ForgeError('CFG-022', { moduleId: moduleDef.id, requires });
    }
  }
  for (const conflictsWith of moduleDef.conflicts) {
    if (installedIds.has(conflictsWith)) {
      throw new ForgeError('CFG-023', { moduleId: moduleDef.id, conflictsWith });
    }
  }
}

/** `add <id> <source>` — `19` §19.5's full installation flow for the module channel. */
export async function moduleAdd(
  ctx: ModuleCommandContext,
  id: string,
  source: string,
  options: InstallOptions,
): Promise<InstallChangeReport> {
  return withManifestLock(ctx.paths, (verifyFence) =>
    moduleAddLocked(ctx, id, source, options, verifyFence),
  );
}

async function moduleAddLocked(
  ctx: ModuleCommandContext,
  id: string,
  source: string,
  options: InstallOptions,
  verifyFence: () => Promise<void>,
): Promise<InstallChangeReport> {
  const doc = await readManifestDoc(ctx.paths);
  // Ids are one shared namespace across modules and overlays (`overlayAdd`'s own identical check
  // treats them that way too) — a module and an overlay sharing one id would leave `moduleInfo`/
  // `overlayExplain`/any future id-keyed lookup unable to tell the two rows apart.
  if (
    doc.modules.some((module) => module.id === id) ||
    doc.overlays.some((overlay) => overlay.id === id)
  ) {
    throw new ForgeError('CFG-042', { id, kind: 'module' });
  }

  const bundle = await fetchInstallBundle(source, options);
  try {
    if (bundle.manifestKind !== 'module') {
      throw new ForgeError('CFG-043', {
        source,
        expectedKind: 'module',
        actualKind: bundle.manifestKind,
      });
    }
    const moduleDef = await parseModule(moduleYamlAbsPath(bundle.path));
    if (moduleDef.id !== id) {
      throw new ForgeError('CFG-044', { expectedId: id, actualId: moduleDef.id });
    }
    checkModuleVersionAndDeps(moduleDef, doc.modules, options.forgeVersion);

    const description = describeRequestedCapabilities({ kind: 'module', module: moduleDef });
    const granted = await promptForConsent(description.text, options.consent);
    if (!granted) {
      throw new ForgeError('CFG-040', { id });
    }

    await scanBundleForSafety(bundle.path);
    // `PLAN-M11.md` P6's own real, blocking pre-install gate: a module that fails its own declared
    // conformance suite (a `provides` entry with no real, matching content, or a failing
    // `tests/*.test.ts`) is refused here, before anything is written to `.forge/` — the identical
    // "every gate throws before the filesystem write" discipline every gate above already follows.
    // `bundle.path` cast the same way `moduleYamlAbsPath` casts it just above -- never a
    // project-relative write target here either: `runModuleConformance` only ever reads under
    // this path, and writes its own ephemeral work only under the separately-supplied `workDir`.
    await runModuleConformance(bundle.path as AbsolutePath, { workDir: options.workDir });

    const destAbs = ctx.paths.resolveWithin(`.forge/modules/${id}`);
    // Write-time fencing (see `withManifestLock`'s own doc comment): `installBundleTree` below is a
    // real write into `.forge/modules/<id>/`, this lock's own protected scope, just as much as
    // `writeManifestDocument` is -- a critic round found this earlier write unfenced, letting the
    // identical double-wx-create race this whole mechanism exists to close land here instead, just
    // relocated to a different write path within the same lock's own protected scope. A fence loss
    // here aborts BEFORE `installBundleTree` ever runs in this attempt, so the retry this triggers
    // (the full `withManifestLock` acquire-and-`fn()` loop, from scratch) starts clean rather than
    // needing `installBundleTree` itself to be idempotent against a half-finished prior attempt --
    // though it independently is: it stages into a fresh, uniquely-named directory and publishes via
    // `rm`-then-`rename`, so re-running it a second time against the same `destAbs` from a fresh
    // `bundle.path` fetch produces the identical result either way.
    await verifyFence();
    await installBundleTree(destAbs, bundle.path);

    const record: InstalledModuleRow = {
      id,
      version: moduleDef.version,
      checksum: bundle.checksum,
      source,
    };
    // Write-time fencing (see `withManifestLock`'s own doc comment): re-confirm, immediately before
    // this commits, that this process still, genuinely, holds the lock.
    await verifyFence();
    await writeManifestDocument(ctx.paths, {
      version: 1,
      modules: [...doc.modules, record],
      overlays: doc.overlays,
    });

    return {
      id,
      action: 'installed',
      version: moduleDef.version,
      resolvedSetDelta: { added: [id], removed: [] },
      newGrants: description.entries.map((entry) => entry.text),
      warnings: bundle.warnings,
    };
  } finally {
    await bundle.cleanup();
  }
}

/** Resolves the real `module.yaml` path for an already-installed manifest row — `.forge/modules/<id>/`
 * for a per-item-managed row (`row.source` present), `ctx.modulesDir/<id>/` for a built-in one,
 * `undefined` for the synthetic `@forge/templates` row (which has neither) or a row whose own
 * directory has since gone missing. */
async function moduleYamlPathFor(
  ctx: ModuleCommandContext,
  row: InstalledModuleRow,
): Promise<AbsolutePath | undefined> {
  if (row.id === '@forge/templates') return undefined;
  if (row.source !== undefined) {
    const candidate = ctx.paths.resolveWithin(`.forge/modules/${row.id}/module.yaml`);
    return (await pathExists(candidate)) ? candidate : undefined;
  }
  // `row.id` is a real id already present in the trusted manifest (never an arbitrary caller-supplied
  // string) and `ctx.modulesDir` is the caller-trusted built-in modules root -- the identical
  // "trusted value concatenated into a path, cast rather than re-derived through `resolveWithin`"
  // shape `moduleInfo`'s own `agentsDir` cast above already documents for this same `modulesDir`.
  const candidate = path.join(ctx.modulesDir, row.id, 'module.yaml') as AbsolutePath;
  return (await pathExists(candidate)) ? candidate : undefined;
}

async function findDependentModuleIds(
  ctx: ModuleCommandContext,
  modules: readonly InstalledModuleRow[],
  targetId: string,
): Promise<readonly string[]> {
  const dependents: string[] = [];
  for (const row of modules) {
    if (row.id === targetId) continue;
    const manifestPath = await moduleYamlPathFor(ctx, row);
    if (manifestPath === undefined) continue;
    const definition = await parseModule(manifestPath);
    if (definition.requires.includes(targetId)) dependents.push(row.id);
  }
  return dependents;
}

/** Every installed overlay whose own `overlay.yaml` `requiresModules` names `targetId` — the overlay
 * counterpart of `findDependentModuleIds` above. `overlayAdd` enforces `requiresModules` at install
 * time (`CFG-022`); a critic round on this piece found `moduleRemove` never checked the reverse
 * direction, so removing a module an already-installed overlay depends on silently left that overlay
 * in a state its own install-time gate would have refused. `requiresModules` is read directly off the
 * installed `overlay.yaml` (not re-validated against a full schema — this call site only needs the
 * one field, the identical "just enough" scope `overlay.ts`'s own `parseOverlayManifestDocument`
 * already takes for the same file). */
async function findDependentOverlayIds(
  ctx: ModuleCommandContext,
  overlays: readonly InstalledOverlayRow[],
  targetId: string,
): Promise<readonly string[]> {
  const dependents: string[] = [];
  for (const overlay of overlays) {
    const overlayYamlPath = ctx.paths.resolveWithin(`.forge/overlays/${overlay.id}/overlay.yaml`);
    if (!(await pathExists(overlayYamlPath))) continue;
    const raw = YAML.parse(await readTextFile(overlayYamlPath)) as {
      readonly requiresModules?: readonly unknown[];
    };
    const requiresModules = Array.isArray(raw.requiresModules) ? raw.requiresModules : [];
    if (requiresModules.includes(targetId)) dependents.push(overlay.id);
  }
  return dependents;
}

/** `remove <id>` — refuses a module another still-installed module's own `requires`, or an
 * already-installed overlay's own `requiresModules`, still names (`CFG-039`), and a manifest row this
 * per-item lifecycle does not manage (`CFG-045`). */
export async function moduleRemove(
  ctx: ModuleCommandContext,
  id: string,
): Promise<InstallChangeReport> {
  return withManifestLock(ctx.paths, (verifyFence) => moduleRemoveLocked(ctx, id, verifyFence));
}

async function moduleRemoveLocked(
  ctx: ModuleCommandContext,
  id: string,
  verifyFence: () => Promise<void>,
): Promise<InstallChangeReport> {
  const doc = await readManifestDoc(ctx.paths);
  const entry = doc.modules.find((module) => module.id === id);
  if (entry === undefined) {
    throw new ForgeError('KB-015', { id });
  }
  if (entry.source === undefined) {
    throw new ForgeError('CFG-045', { id });
  }

  const dependents = [
    ...(await findDependentModuleIds(ctx, doc.modules, id)),
    ...(await findDependentOverlayIds(ctx, doc.overlays, id)),
  ];
  if (dependents.length > 0) {
    throw new ForgeError('CFG-039', { id, requiredBy: dependents.join(', ') });
  }

  const destAbs = ctx.paths.resolveWithin(`.forge/modules/${id}`);
  // Write-time fencing (see `withManifestLock`'s own doc comment, and `moduleAddLocked`'s own
  // identical reasoning above): this `rm` is a real write into `.forge/modules/<id>/`, this lock's own
  // protected scope, unfenced before this fix. `force: true` already makes a second `rm` of the same
  // (now-absent) path a safe no-op, so a fresh `fn()` retry after a fence loss here re-runs this `rm`
  // without any inconsistency.
  await verifyFence();
  await rm(destAbs, { recursive: true, force: true });

  // Write-time fencing (see `withManifestLock`'s own doc comment): re-confirm, immediately before
  // this commits, that this process still, genuinely, holds the lock.
  await verifyFence();
  await writeManifestDocument(ctx.paths, {
    version: 1,
    modules: doc.modules.filter((module) => module.id !== id),
    overlays: doc.overlays,
  });

  return {
    id,
    action: 'removed',
    previousVersion: entry.version,
    resolvedSetDelta: { added: [], removed: [id] },
    newGrants: [],
    warnings: [],
  };
}

/** `update <id> <source>` — re-validates `forgeVersion`/`requires`/`conflicts` against the fetched
 * version exactly as `moduleAdd` does, but re-runs the consent screen only for capability entries
 * absent from the currently-installed version's own description (a real diff, never a blanket
 * re-prompt for grants the user already approved). */
export async function moduleUpdate(
  ctx: ModuleCommandContext,
  id: string,
  source: string,
  options: InstallOptions,
): Promise<InstallChangeReport> {
  return withManifestLock(ctx.paths, (verifyFence) =>
    moduleUpdateLocked(ctx, id, source, options, verifyFence),
  );
}

async function moduleUpdateLocked(
  ctx: ModuleCommandContext,
  id: string,
  source: string,
  options: InstallOptions,
  verifyFence: () => Promise<void>,
): Promise<InstallChangeReport> {
  const doc = await readManifestDoc(ctx.paths);
  const entry = doc.modules.find((module) => module.id === id);
  if (entry === undefined) {
    throw new ForgeError('KB-015', { id });
  }
  if (entry.source === undefined) {
    throw new ForgeError('CFG-045', { id });
  }

  // A round-2 critic finding: every other reader of an already-installed `module.yaml`
  // (`moduleYamlPathFor`, used by `findDependentModuleIds`) checks existence before parsing; this one
  // did not, so a manifest row surviving past a corrupted/partial install (or hand-tampering) made
  // every future `moduleUpdate` fail with a generic, unrelated `RUN-034` read failure and gave the
  // caller no real path forward (`moduleAdd` would itself refuse with `CFG-042`, the id already being
  // in the manifest). Checked here so that specific, recoverable situation gets its own named error
  // and remedy instead.
  const currentModuleYamlPath = ctx.paths.resolveWithin(`.forge/modules/${id}/module.yaml`);
  if (!(await pathExists(currentModuleYamlPath))) {
    throw new ForgeError('CFG-048', { id });
  }
  const currentDef = await parseModule(currentModuleYamlPath);
  const currentDescription = describeRequestedCapabilities({ kind: 'module', module: currentDef });

  const bundle = await fetchInstallBundle(source, options);
  try {
    if (bundle.manifestKind !== 'module') {
      throw new ForgeError('CFG-043', {
        source,
        expectedKind: 'module',
        actualKind: bundle.manifestKind,
      });
    }
    const newDef = await parseModule(moduleYamlAbsPath(bundle.path));
    if (newDef.id !== id) {
      throw new ForgeError('CFG-044', { expectedId: id, actualId: newDef.id });
    }
    checkModuleVersionAndDeps(newDef, doc.modules, options.forgeVersion);

    const newDescription = describeRequestedCapabilities({ kind: 'module', module: newDef });
    const newEntries = newDescription.entries.filter(
      (entry) =>
        !currentDescription.entries.some(
          (old) => old.kind === entry.kind && old.text === entry.text,
        ),
    );
    if (newEntries.length > 0) {
      const diffText = [
        `${newDescription.name} (${newDescription.id}) requests newly-widened capabilities versus ` +
          'the installed version:',
        ...newEntries.map((entry) => `  - ${entry.text}`),
      ].join('\n');
      const granted = await promptForConsent(diffText, options.consent);
      if (!granted) {
        throw new ForgeError('CFG-040', { id });
      }
    }

    await scanBundleForSafety(bundle.path);
    // See `moduleAddLocked`'s own identical call for why — the new version is refused, before any
    // write, the same way a first install of it would be.
    // `bundle.path` cast the same way `moduleYamlAbsPath` casts it just above -- never a
    // project-relative write target here either: `runModuleConformance` only ever reads under
    // this path, and writes its own ephemeral work only under the separately-supplied `workDir`.
    await runModuleConformance(bundle.path as AbsolutePath, { workDir: options.workDir });

    const destAbs = ctx.paths.resolveWithin(`.forge/modules/${id}`);
    // Write-time fencing (see `withManifestLock`'s own doc comment, and `moduleAddLocked`'s own
    // identical reasoning above): this write is unfenced the same way `moduleAddLocked`'s own call was.
    await verifyFence();
    await installBundleTree(destAbs, bundle.path);

    const record: InstalledModuleRow = {
      id,
      version: newDef.version,
      checksum: bundle.checksum,
      source,
    };
    // Write-time fencing (see `withManifestLock`'s own doc comment): re-confirm, immediately before
    // this commits, that this process still, genuinely, holds the lock.
    await verifyFence();
    await writeManifestDocument(ctx.paths, {
      version: 1,
      modules: doc.modules.map((module) => (module.id === id ? record : module)),
      overlays: doc.overlays,
    });

    return {
      id,
      action: 'updated',
      version: newDef.version,
      previousVersion: entry.version,
      resolvedSetDelta: { added: [], removed: [] },
      newGrants: newEntries.map((entry) => entry.text),
      warnings: bundle.warnings,
    };
  } finally {
    await bundle.cleanup();
  }
}
