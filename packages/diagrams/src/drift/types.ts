/**
 * Types for `@forge/diagrams/drift` — `08` §8.11.4 (transclusion) and §8.11.6 (drift).
 *
 * @see specs/08 §8.11.4
 * @see specs/08 §8.11.6
 * @see PLAN-M3.md P4
 */
import type { AbsolutePath } from '@forge/core/fs';
import type { Diagram } from '@forge/schemas';

import type { ComplexityBudget } from '../lint/index.ts';

/** The result of comparing one `generated: true` diagram's committed source against a fresh
 * regeneration. `expected`/`actual` are the full Mermaid source strings, not a diff — a caller
 * wanting a diff renders one from these two. */
export interface DriftResult {
  readonly diagramId: string;
  readonly hasDrift: boolean;
  readonly expected: string;
  readonly actual: string;
}

/** One `<!-- forge:diagram id=... src=... --> ... <!-- /forge:diagram -->` block found in a Markdown
 * document — `08` §8.11.4. */
export interface TransclusionBlock {
  readonly diagramId: string;
  readonly src: string;
  readonly fencedContent: string;
}

/** One diagram to validate: its front matter, its current committed source, and everything
 * `validateDiagrams` cannot fetch on its own (a resolver for `diagram:refs`, the input its own
 * generator would need to check drift, a real path to autofix to). Every optional field is skipped,
 * not failed, when absent — the same shape `@forge/diagrams/lint`'s own `LintDiagramOptions` uses. */
export interface DiagramToValidate {
  readonly diagram: Diagram;
  readonly actualSource: string;
  readonly knownIds?: ReadonlySet<string>;
  readonly generatorInput?: unknown;
  readonly target?: AbsolutePath;
  readonly now?: Date;
}

/** Everything `validateDiagrams` needs beyond the diagrams themselves.
 *
 * `markdownDocuments` — whole Markdown documents to scan for `08` §8.11.4 transclusion markers — is
 * how `diagram:transclusion` findings actually get produced: each marker's own `src` attribute is
 * resolved against the `diagrams` array's own `diagram.source`/`actualSource` pairs (the same path a
 * transclusion marker names is, by construction, the diagram's own committed `.mmd` path), so no
 * second source-lookup mechanism is needed beyond what `validateDiagrams` already has from its own
 * `diagrams` parameter. Omitted entirely (not `[]`) to skip transclusion checking altogether — the
 * caller has no Markdown documents to hand, not "there are none to find."
 */
export interface ValidateDiagramsOptions {
  readonly driftPolicy: 'fail' | 'autofix' | 'warn';
  readonly complexity?: ComplexityBudget;
  readonly requireCaptions?: boolean;
  readonly markdownDocuments?: readonly string[];
}
