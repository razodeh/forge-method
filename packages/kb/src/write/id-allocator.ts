/**
 * `KbIdAllocator` — `08` §8.6: "IDs are allocated centrally and monotonically; never reused." Same
 * shape as `@forge/core/ids`'s `IdAllocator` (scan real files as truth; queue every operation; the
 * on-disk cache is provenance, never a skip-the-scan signal — `SPEC-QUESTIONS.md` Q29's own lesson) —
 * not a subclass or a fork of it, a new, small class for a genuinely different key space (`KbSection`,
 * not `ArtifactTypeId`; `SPEC-QUESTIONS.md` Q18).
 *
 * @see specs/08 §8.6
 * @see PLAN-M3.md P7
 */
import type { Clock } from '@forge/core';
import { ForgeError } from '@forge/core';
import type { ProjectPaths } from '@forge/core/fs';

import { sectionIdToken, type KbSection } from '../schema/sections.ts';
import { DEFAULT_KB_ROOT } from '../schema/tree.ts';
import {
  computeKbValidityHash,
  readKbIdCache,
  writeKbIdCache,
  type KbIdIndex,
} from './id-cache.ts';
import { countKbIdsFromFiles, listKbMdFiles } from './scan.ts';

const KB_ID_WIDTH = 4;

export interface KbIdAllocatorDeps {
  readonly paths: ProjectPaths;
  readonly clock: Clock;
  readonly kbRoot?: string;
}

function formatKbId(section: KbSection, numeric: number): string {
  return `KB-${sectionIdToken(section)}-${String(numeric).padStart(KB_ID_WIDTH, '0')}`;
}

export class KbIdAllocator {
  private readonly paths: ProjectPaths;
  private readonly clock: Clock;
  private readonly kbRoot: string;

  /** Every public operation runs after this promise settles, and replaces it with its own — a strict
   * FIFO queue, so two `allocate()` calls started concurrently never read the same "current" counter
   * before either has written its own increment back. */
  private queue: Promise<unknown> = Promise.resolve();

  private cachedIndex: KbIdIndex | undefined;

  constructor(deps: KbIdAllocatorDeps) {
    this.paths = deps.paths;
    this.clock = deps.clock;
    this.kbRoot = deps.kbRoot ?? DEFAULT_KB_ROOT;
  }

  /** Returns the current `KbIdIndex`, from a fresh, full scan. Queued like every other operation, so
   * it cannot race a concurrent `allocate`. */
  async scan(): Promise<KbIdIndex> {
    return this.enqueue(() => this.refreshIndex());
  }

  /** Allocates one new id for `section`. */
  async allocate(section: KbSection): Promise<string> {
    const ids = await this.allocateMany(section, 1);
    const id = ids[0];
    if (id === undefined) {
      // allocateMany(section, 1) always returns exactly one id or throws.
      throw new RangeError('KbIdAllocator.allocateMany(section, 1) returned no id.');
    }
    return id;
  }

  /**
   * Allocates `count` new ids for `section`, contiguous and in order.
   *
   * @throws {ForgeError} `CFG-010` if any of the `count` ids would need more than 4 digits.
   */
  async allocateMany(section: KbSection, count: number): Promise<readonly string[]> {
    return this.enqueue(async () => {
      const index = await this.currentIndex();
      const start = (index.counters[section] ?? 0) + 1;

      const ids: string[] = [];
      for (let numeric = start; numeric < start + count; numeric++) {
        if (String(numeric).length > KB_ID_WIDTH) {
          throw new ForgeError('CFG-010', { type: section, idWidth: KB_ID_WIDTH });
        }
        ids.push(formatKbId(section, numeric));
      }

      const nextIndex: KbIdIndex = {
        validityHash: index.validityHash,
        writtenAt: this.clock.now(),
        counters: { ...index.counters, [section]: start + count - 1 },
      };
      await writeKbIdCache(this.paths, nextIndex);
      this.cachedIndex = nextIndex;
      return ids;
    });
  }

  /** Runs `operation` after every previously-enqueued one has settled, in call order. A failed
   * operation must not stall every operation queued after it — only its own caller needs to see the
   * rejection, which `result` (returned below) still carries. */
  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation, operation);
    this.queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private async currentIndex(): Promise<KbIdIndex> {
    return this.cachedIndex ?? this.refreshIndex();
  }

  private async refreshIndex(): Promise<KbIdIndex> {
    const cached = await readKbIdCache(this.paths);
    if (cached.kind === 'corrupt') {
      // eslint-disable-next-line no-console -- mirrors IdAllocator's own corrupt-cache handling.
      console.warn(
        `KbIdAllocator: discarding corrupt .forge/state/kb-ids.json (${cached.reason}).`,
      );
    }

    const scannedFiles = await listKbMdFiles(this.paths, this.kbRoot);
    const counters = await countKbIdsFromFiles(this.paths, this.kbRoot, scannedFiles);
    const index: KbIdIndex = {
      validityHash: computeKbValidityHash(scannedFiles),
      writtenAt: this.clock.now(),
      counters,
    };
    await writeKbIdCache(this.paths, index);
    this.cachedIndex = index;
    return index;
  }
}
