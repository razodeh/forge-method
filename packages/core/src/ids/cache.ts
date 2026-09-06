/**
 * `IdIndex`, `readIdCache`, `writeIdCache` — `.forge/state/ids.json`, per `18` §18.8.
 *
 * @see specs/18 §18.8
 * @see PLAN-M1.md P13
 */
import { createHash } from 'node:crypto';

import { writeFileAtomic } from '../fs/atomic.ts';
import { readTextFile } from '../fs/operations.ts';
import type { ProjectPaths } from '../fs/paths.ts';
import type { ArtifactTypeId } from '@forge/schemas';

/**
 * A `18` §18.8 id cache: the highest claimed numeric id per type, the hash of the file set the scan
 * that produced it walked, and when that scan ran. `createHash`, not a random source —
 * `QUALITY-BAR.md` R10 forbids an uninjected *random* value, not a deterministic pure function of
 * known input; `writtenAt` comes from an injected `Clock` (`../clock.ts`), never `Date.now()`.
 */
export interface IdIndex {
  readonly validityHash: string;
  readonly writtenAt: string;
  readonly counters: Readonly<Partial<Record<ArtifactTypeId, number>>>;
}

/** The validity hash for a given scanned file set — order-independent, since the input is sorted. */
export function computeValidityHash(scannedFiles: readonly string[]): string {
  const hash = createHash('sha256');
  for (const file of [...scannedFiles].sort()) {
    hash.update(file);
    hash.update('\n');
  }
  return hash.digest('hex');
}

function isIdIndex(value: unknown): value is IdIndex {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  if (typeof record['validityHash'] !== 'string') return false;
  if (typeof record['writtenAt'] !== 'string') return false;
  const counters = record['counters'];
  if (typeof counters !== 'object' || counters === null || Array.isArray(counters)) return false;
  return Object.values(counters).every((count) => typeof count === 'number');
}

export type IdCacheReadResult =
  | { readonly kind: 'missing' }
  | { readonly kind: 'corrupt'; readonly reason: string }
  | { readonly kind: 'ok'; readonly index: IdIndex };

/**
 * Reads `.forge/state/ids.json`. A missing file is `'missing'`, not an error — the first scan of a
 * fresh project has no cache yet. A file that exists but is not valid JSON, or not shaped like an
 * `IdIndex`, is `'corrupt'` — per `PLAN-M1.md` P13's Check, discarded by the caller with a warning,
 * not fatal: a damaged cache is exactly what a fresh scan exists to recover from.
 */
export async function readIdCache(paths: ProjectPaths): Promise<IdCacheReadResult> {
  let text: string;
  try {
    text = await readTextFile(paths.resolveState('ids.json'));
  } catch {
    return { kind: 'missing' };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (cause) {
    // Cast, not a runtime check: `JSON.parse` is specified to always throw a `SyntaxError` — a real
    // `Error` instance — for malformed input, never anything else, so there is no path here where
    // `cause` needs a fallback rendering.
    return { kind: 'corrupt', reason: (cause as SyntaxError).message };
  }

  if (!isIdIndex(parsed)) {
    return { kind: 'corrupt', reason: 'not shaped like an IdIndex (validityHash + counters)' };
  }
  return { kind: 'ok', index: parsed };
}

/** Writes `index` to `.forge/state/ids.json`, atomically (P4). */
export async function writeIdCache(paths: ProjectPaths, index: IdIndex): Promise<void> {
  // No two entries ever tie: `Object.entries` never repeats a key, so the equal-keys case a
  // three-way comparator would need is dead code no real input can reach.
  const sortedCounters = Object.fromEntries(
    Object.entries(index.counters).sort(([a], [b]) => (a < b ? -1 : 1)),
  );
  const canonical: IdIndex = {
    validityHash: index.validityHash,
    writtenAt: index.writtenAt,
    counters: sortedCounters,
  };
  await writeFileAtomic(paths.resolveState('ids.json'), `${JSON.stringify(canonical, null, 2)}\n`);
}
