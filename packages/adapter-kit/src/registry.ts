/**
 * `KNOWN_ADAPTER_MODULES`/`loadAdapterFactory` — the real, sanctioned dynamic-loading seam
 * `forge-boundaries/no-platform-concept`'s own doc comment names as the legitimate way for a package
 * above `adapter-kit` (concretely, `@forge/cli`'s own real dispatcher, `PLAN-M12.md` P1) to construct
 * a real, concrete `PlatformAdapter` without ever naming a platform by identifier or string literal in
 * its own source: "load it dynamically through `adapter-kit`'s registry (a specifier built from
 * configuration, never a literal)."
 *
 * This module is the one place that specifier is real, literal data — legitimate here because this
 * package (`adapter-kit`) is itself exempt from `no-platform-concept` (the rule's own scope check:
 * `location.pkg.startsWith('adapter-')`), the identical exemption `@forge/adapter-claude-code`'s own
 * source already relies on. A caller above this layer only ever sees `AdapterModuleSpec.packageName`
 * as an opaque string value flowing through a variable, never typed as a literal in its own source —
 * which is what keeps the rule satisfied there while still letting the real adapter get constructed.
 *
 * `@forge/adapter-generic` is deliberately not listed: it has no real, shipped default configuration
 * to construct from (`GenericAdapterOptions.config` needs a real, parsed `adapter.yaml`, and no
 * project template ships one) — see `SPEC-QUESTIONS.md` for the full record of this decision, made by
 * `@forge/cli`'s own real dispatcher wiring, not by this registry.
 *
 * @see specs/README §2 principle 8
 * @see specs/07 §7.1
 */
import type { PlatformAdapter } from './types/index.ts';

export interface AdapterModuleSpec {
  readonly id: string;
  readonly packageName: string;
}

export interface AdapterFactoryOptions {
  readonly env: Readonly<Record<string, string>>;
  /** `@forge/core`'s own `Clock` seam, applied — never `Date.now` directly (R10) — by whichever real
   * adapter module's own `createAdapter` factory receives this. */
  readonly now: () => number;
  /** The adapter's own opaque config blob (`platform.adapterConfig[id]`, `@forge/schemas/config`'s
   * own "each value is that platform's own adapter package's business" design) — parsed and defaulted
   * by the loaded module's own `createAdapter`, never by this registry, which has no schema for any
   * one platform's own config shape. */
  readonly config?: unknown;
}

export type AdapterFactory = (options: AdapterFactoryOptions) => PlatformAdapter;

/** Every real, installable adapter module this workspace ships that `createCandidateAdapters`-shaped
 * callers can construct with no further input beyond `AdapterFactoryOptions` — real, small, and
 * expected to grow only as real adapter packages ship a real `createAdapter` factory of their own. */
export const KNOWN_ADAPTER_MODULES: readonly AdapterModuleSpec[] = [
  { id: 'claude-code', packageName: '@forge/adapter-claude-code' },
];

interface AdapterModuleExports {
  readonly createAdapter?: AdapterFactory;
}

/**
 * Dynamically imports `packageName` (a real, non-literal, data-carried specifier — never write this
 * package name as a literal string above this layer) and returns its own real `createAdapter` export.
 * @throws {Error} when the module exists but does not export a real `createAdapter` factory function —
 * a genuine, real defect in that adapter module's own package, not a caller mistake.
 */
export async function loadAdapterFactory(packageName: string): Promise<AdapterFactory> {
  const loaded = (await import(packageName)) as AdapterModuleExports;
  if (typeof loaded.createAdapter !== 'function') {
    throw new Error(
      `Adapter module "${packageName}" does not export a real createAdapter factory.`,
    );
  }
  return loaded.createAdapter;
}
