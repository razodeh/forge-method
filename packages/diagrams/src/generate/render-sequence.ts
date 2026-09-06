/**
 * A shared `sequenceDiagram` renderer — backs `interfaces-to-sequence`.
 *
 * @see PLAN-M3.md P3
 */
import { buildSanitizedIdMap, sanitizeMermaidLabel } from './sanitize.ts';

/** One message in a sequence — `from`/`to` are participant ids, sanitized internally. */
export interface SequenceStep {
  readonly from: string;
  readonly to: string;
  readonly message: string;
}

// Two distinct elements of a `Set` are never equal, so a two-way comparator (no `=== 0` branch to
// leave provably unreachable) is honest here, not merely simpler.
function compareStrings(a: string, b: string): number {
  return a < b ? -1 : 1;
}

/**
 * Renders `steps` as a Mermaid `sequenceDiagram`, in the given order, with an optional `title` line.
 *
 * Every participant is declared explicitly up front as `participant <sanitizedId> as <realName>` —
 * not left to Mermaid's own implicit-declaration-on-first-use, which shows the *identifier itself* as
 * the on-screen name. Sanitization (`buildSanitizedIdMap`, `SPEC-QUESTIONS.md` Q46) can and does
 * change that identifier (a reserved word, a collision, invalid characters); without an explicit
 * alias a viewer would see the mangled identifier — `n_end`, `component_api_2` — as if it were the
 * real name, exactly the "silent identity change with no signal" defect the sanitization work was
 * meant to close, resurfacing here instead. Declared in sorted order for determinism (R10), separate
 * from the steps themselves.
 *
 * Message order is deliberately not sorted, unlike `renderFlowchart`/`renderErDiagram`: a sequence is
 * inherently ordered (it depicts *when* each call happens), so the caller's own array order is the
 * meaningful, already-deterministic order — sorting it would destroy the one thing this diagram kind
 * exists to show. R10 is still satisfied: the input is a plain array, never a `Map`/`Set` whose own
 * iteration order this function would otherwise have to trust.
 */
export function renderSequenceDiagram(steps: readonly SequenceStep[], title?: string): string {
  const participantNames = [...new Set(steps.flatMap((step) => [step.from, step.to]))];
  const idFor = buildSanitizedIdMap(participantNames);
  const lines = ['sequenceDiagram'];
  if (title !== undefined && title !== '') lines.push(`  title ${sanitizeMermaidLabel(title)}`);
  for (const name of [...participantNames].sort(compareStrings)) {
    lines.push(`  participant ${idFor(name)} as ${sanitizeMermaidLabel(name)}`);
  }
  for (const step of steps) {
    lines.push(`  ${idFor(step.from)}->>${idFor(step.to)}: ${sanitizeMermaidLabel(step.message)}`);
  }
  return lines.join('\n');
}
