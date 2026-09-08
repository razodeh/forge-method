/**
 * `CatalogRegistry` — an in-memory registry of `CatalogEntry` values, keyed by `(kind, id)`.
 *
 * @see specs/12 §12.2
 * @see PLAN-M6.md C1
 */
import type { CatalogEntry, CatalogKind } from '../schema/types.ts';

function registryKey(kind: string, id: string): string {
  return `${kind}/${id}`;
}

export class CatalogRegistry {
  readonly #entries = new Map<string, CatalogEntry>();

  constructor(entries: readonly CatalogEntry[] = []) {
    for (const entry of entries) this.add(entry);
  }

  /** Adds or replaces the entry at `(entry.kind, entry.id)` -- a later entry with the same key
   * (e.g. a project override loaded after the base catalog) wins. */
  add(entry: CatalogEntry): void {
    this.#entries.set(registryKey(entry.kind, entry.id), entry);
  }

  get(kind: string, id: string): CatalogEntry | undefined {
    return this.#entries.get(registryKey(kind, id));
  }

  /** Whether any entry, of any kind, has this `id` -- `pairs_with`/`alternatives` (`12` §12.2) name only
   * an id, never a `(kind, id)` pair, so validating those references needs an id-only lookup. */
  hasId(id: string): boolean {
    for (const entry of this.#entries.values()) {
      if (entry.id === id) return true;
    }
    return false;
  }

  byKind(kind: CatalogKind): readonly CatalogEntry[] {
    return [...this.#entries.values()].filter((entry) => entry.kind === kind);
  }

  all(): readonly CatalogEntry[] {
    return [...this.#entries.values()];
  }
}
