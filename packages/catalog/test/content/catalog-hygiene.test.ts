/**
 * Every shipped catalog entry, across the whole `12` §12.2 catalog, validates cleanly against
 * `validateEntry`, `fits_when`/`avoid_when` each name at least two real *distinct* conditions (a
 * mechanical non-emptiness/length/distinctness floor, not a subjective quality bar), and no list field
 * contains an accidental exact or near-duplicate item.
 *
 * `KNOWN_FUTURE_IDS` held the explicit allowlist of ids `12` §12.2's own scope table promised but this
 * milestone hadn't shipped content for yet, while C2/C3/C4 were still landing -- as of C4 (the last
 * content piece), every row is shipped, so this is now empty and any dangling `pairs_with`/`alternatives`
 * reference is unconditionally a real authoring bug. Left as an explicit empty set, not deleted, so a
 * future catalog kind added beyond the current 18 rows has an obvious place to reintroduce the allowlist
 * pattern rather than reinventing it.
 *
 * The near-duplicate check exists because of a real bug C2 shipped and a fresh critic round caught
 * (`SPEC-QUESTIONS.md` Q89): a mechanical `length >= 2` count floor does not itself prove two *distinct*
 * conditions -- 33 of C2's own 56 files initially padded a list with a copy or near-copy of its only real
 * point. This test is that lesson made permanent, not just fixed once by hand.
 *
 * @see specs/12 §12.2
 * @see PLAN-M6.md C2, C3, C4
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { loadCatalogEntry } from '../../src/schema/load.ts';
import { CatalogRegistry } from '../../src/registry/registry.ts';
import { validateEntry } from '../../src/registry/validate.ts';
import type { CatalogEntry } from '../../src/schema/types.ts';

const catalogRoot = path.resolve(import.meta.dirname, '../../catalog');

const KNOWN_FUTURE_IDS = new Set<string>([]);

function loadAllShippedEntries(): readonly CatalogEntry[] {
  const entries: CatalogEntry[] = [];
  for (const kindDir of readdirSync(catalogRoot)) {
    const kindPath = path.join(catalogRoot, kindDir);
    for (const fileName of readdirSync(kindPath)) {
      const source = readFileSync(path.join(kindPath, fileName), 'utf8');
      const result = loadCatalogEntry(source, `${kindDir}/${fileName}`);
      if (!result.success)
        throw new Error(`${kindDir}/${fileName} failed to load: ${JSON.stringify(result.issues)}`);
      entries.push(result.entry);
    }
  }
  return entries;
}

/** Word-overlap (Jaccard) similarity -- deliberately coarse: this only needs to catch "these two list
 * items say basically the same thing," not do real semantic comparison. 0.4 was chosen empirically
 * against the real C2 near-duplicates Q89 found (all scored 0.42-0.73) while not flagging genuinely
 * distinct conditions that happen to share a few common words. */
function jaccardSimilarity(a: string, b: string): number {
  const wordsOf = (text: string) => new Set(text.toLowerCase().split(/\W+/).filter(Boolean));
  const wa = wordsOf(a);
  const wb = wordsOf(b);
  const intersection = [...wa].filter((word) => wb.has(word)).length;
  const union = new Set([...wa, ...wb]).size;
  return union === 0 ? 0 : intersection / union;
}

const LIST_FIELDS = [
  'strengths',
  'weaknesses',
  'fits_when',
  'avoid_when',
  'notes_for_agents',
] as const;

describe('every shipped catalog entry', () => {
  const entries = loadAllShippedEntries();
  const registry = new CatalogRegistry(entries);

  it.each(entries.map((entry) => [entry.id, entry] as const))(
    '%s: validates cleanly, beyond references to a not-yet-shipped future catalog id',
    (_id, entry) => {
      const issues = validateEntry(entry, registry).filter((issue) => {
        if (!issue.message.includes('not a real entry id')) return true;
        const match = /"([^"]+)"/.exec(issue.message);
        const referencedId = match?.[1];
        return referencedId === undefined || !KNOWN_FUTURE_IDS.has(referencedId);
      });
      expect(issues).toEqual([]);
    },
  );

  it.each(entries.map((entry) => [entry.id, entry] as const))(
    '%s: fits_when and avoid_when each name at least two real conditions',
    (_id, entry) => {
      expect(entry.fits_when.length).toBeGreaterThanOrEqual(2);
      expect(entry.avoid_when.length).toBeGreaterThanOrEqual(2);
    },
  );

  it.each(entries.map((entry) => [entry.id, entry] as const))(
    '%s: no list field contains an exact or near-duplicate item',
    (_id, entry) => {
      const duplicates: string[] = [];
      for (const field of LIST_FIELDS) {
        const items = entry[field];
        for (let i = 0; i < items.length; i += 1) {
          for (let j = i + 1; j < items.length; j += 1) {
            if (jaccardSimilarity(items[i]!, items[j]!) > 0.4) {
              duplicates.push(`${field}[${String(i)}] ~= ${field}[${String(j)}]`);
            }
          }
        }
      }
      expect(duplicates).toEqual([]);
    },
  );
});
