/**
 * `KbIdIndex`, `readKbIdCache`, `writeKbIdCache` — `.forge/state/kb-ids.json`, `08` §8.6's "IDs are
 * allocated centrally and monotonically; never reused," this package's own cache for that.
 *
 * A separate file from `@forge/core/ids`'s own `.forge/state/ids.json`: that cache is keyed by
 * `ArtifactTypeId` (the 21-type registry), this one by `KbSection` — a genuinely different key space,
 * per `SPEC-QUESTIONS.md` Q18's own note that `08` §8.3's id scheme sits outside that registry.
 * Otherwise the identical shape and the identical "provenance, not a skip-the-scan signal" contract
 * `@forge/core/ids/cache.ts` already established (`SPEC-QUESTIONS.md` Q29's own implementation note).
 *
 * @see specs/08 §8.6
 * @see PLAN-M3.md P7
 */
import { createHash } from 'node:crypto';

import { readTextFile, writeFileAtomic, type ProjectPaths } from '@forge/core/fs';

import type { KbSection } from '../schema/sections.ts';

export interface KbIdIndex {
  readonly validityHash: string;
  readonly writtenAt: string;
  readonly counters: Readonly<Partial<Record<KbSection, number>>>;
}

/** The validity hash for a given scanned file set — order-independent, since the input is sorted. */
export function computeKbValidityHash(scannedFiles: readonly string[]): string {
  const hash = createHash('sha256');
  for (const file of [...scannedFiles].sort()) {
    hash.update(file);
    hash.update('\n');
  }
  return hash.digest('hex');
}

function isKbIdIndex(value: unknown): value is KbIdIndex {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  if (typeof record['validityHash'] !== 'string') return false;
  if (typeof record['writtenAt'] !== 'string') return false;
  const counters = record['counters'];
  if (typeof counters !== 'object' || counters === null || Array.isArray(counters)) return false;
  return Object.values(counters).every((count) => typeof count === 'number');
}

export type KbIdCacheReadResult =
  | { readonly kind: 'missing' }
  | { readonly kind: 'corrupt'; readonly reason: string }
  | { readonly kind: 'ok'; readonly index: KbIdIndex };

/** Reads `.forge/state/kb-ids.json`. A missing file is `'missing'`, not an error — the first KB write
 * in a fresh project has no cache yet. A file that exists but does not parse, or is not shaped like a
 * `KbIdIndex`, is `'corrupt'` — discarded by the caller with a warning, not fatal. */
export async function readKbIdCache(paths: ProjectPaths): Promise<KbIdCacheReadResult> {
  let text: string;
  try {
    text = await readTextFile(paths.resolveState('kb-ids.json'));
  } catch {
    return { kind: 'missing' };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (cause) {
    // Cast, not a runtime check: `JSON.parse` is specified to always throw a `SyntaxError` for
    // malformed input, never anything else.
    return { kind: 'corrupt', reason: (cause as SyntaxError).message };
  }

  if (!isKbIdIndex(parsed)) {
    return { kind: 'corrupt', reason: 'not shaped like a KbIdIndex (validityHash + counters)' };
  }
  return { kind: 'ok', index: parsed };
}

/** Writes `index` to `.forge/state/kb-ids.json`, atomically. */
export async function writeKbIdCache(paths: ProjectPaths, index: KbIdIndex): Promise<void> {
  // No two entries ever tie: `Object.entries` never repeats a key, so the equal-keys case a
  // three-way comparator would need is dead code no real input can reach.
  const sortedCounters = Object.fromEntries(
    Object.entries(index.counters).sort(([a], [b]) => (a < b ? -1 : 1)),
  );
  const canonical: KbIdIndex = {
    validityHash: index.validityHash,
    writtenAt: index.writtenAt,
    counters: sortedCounters,
  };
  await writeFileAtomic(
    paths.resolveState('kb-ids.json'),
    `${JSON.stringify(canonical, null, 2)}\n`,
  );
}
