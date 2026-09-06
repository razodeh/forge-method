/**
 * `lintDiagram` — `08` §8.11.7: every check this package can run from one diagram's own parsed
 * structure and front matter alone.
 *
 * @see specs/08 §8.11.7
 * @see PLAN-M3.md P2
 */
import type { Diagram } from '@forge/schemas';

import type { ParsedDiagram } from '../parse/index.ts';
import {
  checkCaption,
  checkComplexity,
  checkLabelQuality,
  checkOrphanNodes,
  checkRefs,
  checkStaleness,
} from './rules.ts';
import {
  DEFAULT_COMPLEXITY_BUDGET,
  type DiagramFinding,
  type LintDiagramOptions,
} from './types.ts';

/**
 * Every `08` §8.11.7 finding for one diagram: `diagram:refs`, `diagram:orphan-nodes`,
 * `diagram:complexity`, `diagram:label-quality`, `diagram:caption`, `diagram:staleness`.
 * (`diagram:syntax` is `parseDiagram`'s own `ForgeError`, not a finding here; `diagram:drift`/
 * `diagram:transclusion`/`diagram:render` and the two KB-aware checks are later pieces — see
 * `SPEC-QUESTIONS.md` Q44.)
 *
 * Never throws over an adversarial `options`: a missing `knownIds` skips `diagram:refs`, and a
 * missing `now` skips `diagram:staleness` — no wall-clock fallback (R10) — rather than failing every
 * node or reading the real clock. `diagram` and `parsed` are not adversarial-input-hardened the same
 * way: both are expected to already be schema-valid (`diagramSchema`) and parser-produced
 * (`parseDiagram`) respectively, the same trust boundary every other piece in this milestone draws
 * between "a caller's optional configuration" and "a value this package itself already validated
 * upstream."
 */
export function lintDiagram(
  diagram: Diagram,
  parsed: ParsedDiagram,
  options: LintDiagramOptions = {},
): readonly DiagramFinding[] {
  const complexity = options.complexity ?? DEFAULT_COMPLEXITY_BUDGET;
  const requireCaptions = options.requireCaptions ?? true;

  return [
    ...checkRefs(diagram, options.knownIds),
    ...checkOrphanNodes(diagram, parsed),
    ...checkComplexity(diagram, parsed, complexity),
    ...checkLabelQuality(diagram, parsed),
    ...checkCaption(diagram, requireCaptions),
    ...checkStaleness(diagram, options.now),
  ];
}
