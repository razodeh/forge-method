/**
 * Shared types for `@forge/extensions/compile` — `15` §15.2 rules 1–3 and §15.12's library-function
 * halves of `forge compile [--check]` and `forge overlay explain <id>`.
 *
 * @see specs/15 §15.2
 * @see specs/15 §15.12
 * @see PLAN-M2.md P9
 * @see SPEC-QUESTIONS.md Q41
 * @see SPEC-QUESTIONS.md Q42
 */
import type { InvariantViolation } from '../invariants/index.ts';
import type { LayerContribution, Layer, ResolveWarning, ResolvedEntity } from '../resolve/index.ts';

/** `15` §15.2 rule 1's own list: the six document kinds a compile resolves into. */
export type DocumentKind =
  'agents' | 'workflows' | 'frameworks' | 'templates' | 'checks' | 'skills';

export const DOCUMENT_KINDS: readonly DocumentKind[] = [
  'agents',
  'workflows',
  'frameworks',
  'templates',
  'checks',
  'skills',
];

/** Every entity's raw layer contributions, per kind — `compile`'s own input. */
export type CompileSources = Readonly<
  Record<DocumentKind, Readonly<Record<string, readonly LayerContribution[]>>>
>;

/** One `ResolveWarning`, with which kind and entity it came from — `15` §15.2 rule 4. */
export interface CompileWarning extends ResolveWarning {
  readonly kind: DocumentKind;
  readonly entityId: string;
}

/** Every resolved entity, grouped by kind — see `SPEC-QUESTIONS.md` Q41 for why this is not
 * literally `@forge/extensions/invariants`' own `ResolvedSet`, despite the similar name. */
export type CompiledDocuments = Readonly<Record<DocumentKind, ReadonlyMap<string, ResolvedEntity>>>;

export interface CompileOptions {
  readonly check?: boolean;
}

export interface CompileResult {
  readonly documents: CompiledDocuments;
  readonly violations: readonly InvariantViolation[];
  readonly warnings: readonly CompileWarning[];
}

/** One field of a resolved entity, and which layer supplied it — `AC15-2`. */
export interface FieldProvenanceEntry {
  readonly path: string;
  readonly layer: Layer;
}
