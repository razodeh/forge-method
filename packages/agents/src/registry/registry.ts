/**
 * `AgentRegistry` — an in-memory registry of `AgentDefinition` values, keyed by `id`. Mirrors
 * `@forge/catalog`'s own `CatalogRegistry` shape (M6 C1) for the identical reason: a small, in-memory
 * lookup a loader populates and later pieces (`resolveExtends` here; prompt compilation, handoff, and
 * interaction-mode pieces later in this same package) consume.
 *
 * @see specs/05 §5.3
 * @see PLAN-M6.md A1
 */
import type { AgentDefinition } from '../schema/types.ts';

export class AgentRegistry {
  readonly #entries = new Map<string, AgentDefinition>();

  constructor(entries: readonly AgentDefinition[] = []) {
    for (const entry of entries) this.add(entry);
  }

  /** Adds or replaces the entry at `entry.id` -- a later entry with the same id (e.g. a project
   * override loaded after the base roster) wins. */
  add(entry: AgentDefinition): void {
    this.#entries.set(entry.id, entry);
  }

  get(id: string): AgentDefinition | undefined {
    return this.#entries.get(id);
  }

  all(): readonly AgentDefinition[] {
    return [...this.#entries.values()];
  }
}
