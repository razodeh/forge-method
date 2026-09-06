/**
 * `IdAllocator` — `18` §18.8: allocate the next id for a type from a scan, never reuse one, and
 * serialise concurrent allocation through one queue so two callers never claim the same id.
 *
 * @see specs/18 §18.8
 * @see specs/09 §9.2
 * @see PLAN-M1.md P13
 */
import type { ArtifactTypeId } from '@forge/schemas';

import type { Clock } from '../clock.ts';
import { ForgeError } from '../errors/forge-error.ts';
import type { ProjectPaths } from '../fs/paths.ts';
import { computeValidityHash, readIdCache, writeIdCache, type IdIndex } from './cache.ts';
import { DEFAULT_ID_REGISTRY, type IdRegistry } from './registry.ts';
import { countIdsFromFiles, listArtifactFiles } from './scan.ts';

/** A registered artifact's id, e.g. `"STORY-014"` — its own type, per `18` §18.7, names its shape. */
export type ArtifactId = string;

export interface IdAllocatorDeps {
  readonly paths: ProjectPaths;
  readonly clock: Clock;
  /** Defaults to the real 21-type registry; a test overrides one entry to exercise `CFG-010`. */
  readonly registry?: IdRegistry;
}

/** Zero-padded to `idWidth` digits — `entry.idWidth` digits exactly, per the id regex every schema enforces. */
function formatId(entry: { idPrefix: string; idWidth: number }, numeric: number): string {
  return `${entry.idPrefix}-${String(numeric).padStart(entry.idWidth, '0')}`;
}

export class IdAllocator {
  private readonly paths: ProjectPaths;
  private readonly clock: Clock;
  private readonly registry: IdRegistry;

  /** Every public operation runs after this promise settles, and replaces it with its own —
   * a strict FIFO queue, so two `allocate()` calls started concurrently never read the same
   * "current" counter before either has written its own increment back. */
  private queue: Promise<unknown> = Promise.resolve();

  /** Set once per allocator lifetime, by whichever queued operation resolves it first. */
  private cachedIndex: IdIndex | undefined;

  constructor(deps: IdAllocatorDeps) {
    this.paths = deps.paths;
    this.clock = deps.clock;
    this.registry = deps.registry ?? DEFAULT_ID_REGISTRY;
  }

  /**
   * Returns the current `IdIndex` — from the on-disk cache if a cheap directory listing shows the
   * scanned file set has not changed since that cache was written, otherwise from a fresh, full scan
   * (`18` §18.8: "truth is a scan of existing artifacts"). Queued like every other operation, so it
   * cannot race a concurrent `allocate`.
   */
  async scan(): Promise<IdIndex> {
    return this.enqueue(() => this.refreshIndex());
  }

  /** Allocates one new id for `type`. */
  async allocate(type: ArtifactTypeId): Promise<ArtifactId> {
    const ids = await this.allocateMany(type, 1);
    const id = ids[0];
    if (id === undefined) {
      // allocateMany(type, 1) always returns exactly one id or throws; there is no path that
      // returns a shorter array. A RangeError, not a ForgeError: this would be a bug in this
      // class, not a caller-facing failure with a remedy to offer.
      throw new RangeError('IdAllocator.allocateMany(type, 1) returned no id.');
    }
    return id;
  }

  /**
   * Allocates `count` new ids for `type`, contiguous and in order.
   *
   * @throws {ForgeError} `CFG-010` if any of the `count` ids would need more digits than the type's
   * `idWidth` allows — see `SPEC-QUESTIONS.md` Q30.
   */
  async allocateMany(type: ArtifactTypeId, count: number): Promise<readonly ArtifactId[]> {
    return this.enqueue(async () => {
      const index = await this.currentIndex();
      const entry = this.registry[type];
      const start = (index.counters[type] ?? 0) + 1;

      const ids: ArtifactId[] = [];
      for (let numeric = start; numeric < start + count; numeric++) {
        if (String(numeric).length > entry.idWidth) {
          throw new ForgeError('CFG-010', { type, idWidth: entry.idWidth });
        }
        ids.push(formatId(entry, numeric));
      }

      const nextIndex: IdIndex = {
        validityHash: index.validityHash,
        writtenAt: this.clock.now(),
        counters: { ...index.counters, [type]: start + count - 1 },
      };
      await writeIdCache(this.paths, nextIndex);
      this.cachedIndex = nextIndex;
      return ids;
    });
  }

  /** Runs `operation` after every previously-enqueued one has settled, in call order. */
  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation, operation);
    // A failed operation must not stall every operation queued after it — only its own caller
    // needs to see the rejection, which `result` (returned below) still carries.
    this.queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  /** The in-memory index from earlier in this allocator's lifetime, or a fresh `refreshIndex()`. */
  private async currentIndex(): Promise<IdIndex> {
    return this.cachedIndex ?? this.refreshIndex();
  }

  private async refreshIndex(): Promise<IdIndex> {
    const scannedFiles = await listArtifactFiles(this.paths);
    const validityHash = computeValidityHash(scannedFiles);

    const cached = await readIdCache(this.paths);
    if (cached.kind === 'corrupt') {
      // eslint-disable-next-line no-console -- PLAN-M1.md P13's Check: discarded with a warning.
      console.warn(`IdAllocator: discarding corrupt .forge/state/ids.json (${cached.reason}).`);
    }
    if (cached.kind === 'ok' && cached.index.validityHash === validityHash) {
      this.cachedIndex = cached.index;
      return cached.index;
    }

    const counters = await countIdsFromFiles(this.paths, scannedFiles, this.registry);
    const index: IdIndex = { validityHash, writtenAt: this.clock.now(), counters };
    await writeIdCache(this.paths, index);
    this.cachedIndex = index;
    return index;
  }
}
