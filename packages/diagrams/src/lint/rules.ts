/**
 * `08` §8.11.7's per-diagram checks — each a pure function of one diagram's parsed structure plus its
 * front matter, returning the findings it alone is responsible for.
 *
 * @see specs/08 §8.11.7
 * @see PLAN-M3.md P2
 */
import type { Diagram } from '@forge/schemas';

import type { DiagramNode, ParsedDiagram } from '../parse/index.ts';
import type { ComplexityBudget, DiagramFinding } from './types.ts';

/**
 * `08` §8.11.7's own `foo` example, plus the handful of other words that are never a legitimate
 * domain label in any casing — checked case-insensitively. Deliberately excludes ordinary English
 * words a real diagram is likely to need genuinely (`test`, a required CI/CD pipeline stage per `08`
 * §8.11.3's own taxonomy; `temp`, a plausible short name for temporary storage) — a gauntlet critic
 * caught `test` here originally flagging exactly that CI/CD stage as an error.
 */
const PLACEHOLDER_WORDS = new Set([
  'foo',
  'bar',
  'baz',
  'tbd',
  'xxx',
  'lorem',
  'placeholder',
  'dummy',
]);

/**
 * `08` §8.11.7's own two scaffold-marker placeholder words — checked in their all-capitals spelling
 * only, not case-insensitively: written in capitals they are unambiguous scaffold markers, but their
 * title-case spellings collide with ordinary domain nouns (one of them is the canonical entity name
 * in the taxonomy's own required `erDiagram` example domain) in a way the all-capitals spelling never
 * does.
 */
const SHOUTING_PLACEHOLDER_WORDS = new Set(['TODO', 'FIXME']);

/** A generic noun immediately followed by a digit (an optional `_`/`-` separator allowed) — `08`
 * §8.11.7's own `Component1` example is exactly this shape, and the same complaint applies to
 * `Node1`/`Item2`/`Thing3`/`Node-2`/`Component_1` alike. The *bare* noun with no digit at all
 * (`Object`, `Entity`, `Widget`) is deliberately not matched — those are ordinary domain nouns a real
 * diagram (an `erDiagram`'s "Entity", a storage diagram's "Object") legitimately needs, and the
 * spec's own example is never bare, only noun-plus-digit. */
const GENERIC_NOUN_WITH_DIGIT_SUFFIX =
  /^(component|node|item|thing|object|box|entity|element|shape|widget)[\s_-]?\d+$/i;

function isPlaceholderLabel(label: string): boolean {
  const trimmed = label.trim();
  if (trimmed.length === 0) return true;
  if (trimmed.length === 1) return true;
  if (PLACEHOLDER_WORDS.has(trimmed.toLowerCase())) return true;
  if (SHOUTING_PLACEHOLDER_WORDS.has(trimmed)) return true;
  return GENERIC_NOUN_WITH_DIGIT_SUFFIX.test(trimmed);
}

/** `diagram:refs` — every `depicts` id must resolve. Skipped entirely (returns `[]`) when the caller
 * supplies no `knownIds`, per `SPEC-QUESTIONS.md` Q44: this package never decides what "exists". */
export function checkRefs(
  diagram: Diagram,
  knownIds: ReadonlySet<string> | undefined,
): DiagramFinding[] {
  if (knownIds === undefined) return [];
  return diagram.depicts
    .filter((id) => !knownIds.has(id))
    .map((id) => ({
      checkId: 'diagram:refs' as const,
      severity: 'error' as const,
      message: `Diagram ${diagram.id} depicts ${id}, which does not resolve to a known component, datastore, entity or actor.`,
      nodeId: id,
    }));
}

/** `diagram:orphan-nodes` — a node with no incident edge (usually a typo, `08` §8.11.7). Only
 * meaningful for a diagram with at least one edge; a single-node diagram or a kind with no edge model
 * at all (`08` §8.11.10) never has an "orphan" in the sense this rule means. */
export function checkOrphanNodes(diagram: Diagram, parsed: ParsedDiagram): DiagramFinding[] {
  if (parsed.edges.length === 0) return [];
  const connected = new Set<string>();
  for (const edge of parsed.edges) {
    connected.add(edge.from);
    connected.add(edge.to);
  }
  return parsed.nodes
    .filter((node: DiagramNode) => !connected.has(node.id))
    .map((node) => ({
      checkId: 'diagram:orphan-nodes' as const,
      severity: 'warn' as const,
      message: `Diagram ${diagram.id}: node ${node.id} is not referenced by any edge.`,
      nodeId: node.id,
    }));
}

/** `diagram:complexity` — `08` §8.11.7's own three-tier boundary: clean at or under the budget, `warn`
 * one step past it, `error` at or past the hard maximum. */
export function checkComplexity(
  diagram: Diagram,
  parsed: ParsedDiagram,
  budget: ComplexityBudget,
): DiagramFinding[] {
  const findings: DiagramFinding[] = [];
  const nodeCount = parsed.nodes.length;
  const edgeCount = parsed.edges.length;

  if (nodeCount > budget.maxNodes) {
    findings.push({
      checkId: 'diagram:complexity',
      severity: nodeCount >= budget.hardMaxNodes ? 'error' : 'warn',
      message: `Diagram ${diagram.id} has ${String(nodeCount)} nodes, over the budget of ${String(budget.maxNodes)}; split into layered views.`,
    });
  }
  if (edgeCount > budget.maxEdges) {
    findings.push({
      checkId: 'diagram:complexity',
      severity: 'warn',
      message: `Diagram ${diagram.id} has ${String(edgeCount)} edges, over the budget of ${String(budget.maxEdges)}; split into layered views.`,
    });
  }
  return findings;
}

/** `diagram:label-quality` — no empty, single-letter, or placeholder labels. */
export function checkLabelQuality(diagram: Diagram, parsed: ParsedDiagram): DiagramFinding[] {
  return parsed.nodes
    .filter((node) => isPlaceholderLabel(node.label))
    .map((node) => ({
      checkId: 'diagram:label-quality' as const,
      severity: 'error' as const,
      message: `Diagram ${diagram.id}: node ${node.id} has a placeholder or empty label (${JSON.stringify(node.label)}).`,
      nodeId: node.id,
    }));
}

/** Below this length, a single space-free run in a non-Latin script is assumed too short to be a
 * real caption; at or above it, a script that packs meaning into few characters with no inter-word
 * spacing (Chinese, Japanese, ...) is not penalised for lacking a signal that only applies to
 * space-delimited scripts. Plain ASCII text gets no such exemption at any length — see
 * `isTrivialCaptionText`'s own doc comment for why a length shortcut alone is not enough. */
const MIN_TRIVIAL_LABEL_LENGTH = 12;

/** Whether `text` contains a character outside the printable ASCII range — the signal that it may be
 * in a script that does not use inter-word spaces at all, where "no spaces" cannot be read as "too
 * short." A character-code check rather than a regex: an ASCII-range character class trips this
 * repo's own `no-control-regex` lint rule (the printable range's lower bound is a control code). */
function hasNonAsciiText(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    if ((text.codePointAt(i) ?? 0) > 0x7f) return true;
  }
  return false;
}

/**
 * Whether `text` reads as a real caption/alt-text rather than a single perfunctory word.
 *
 * More than one whitespace-separated word is never trivial. A single space-free run *is* trivial
 * unless it also contains non-ASCII characters and meets `MIN_TRIVIAL_LABEL_LENGTH` — the length
 * shortcut is deliberately gated on non-ASCII content, not applied unconditionally: an earlier
 * version of this function applied the length exemption to any long single word regardless of
 * script, which a gauntlet verify pass caught silently accepting an ordinary long single *English*
 * word (`"TopologyDiagram"`, `"asdfasdfasdf"`) as a real caption.
 */
function isTrivialCaptionText(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.split(/\s+/).length >= 2) return false;
  return !(trimmed.length >= MIN_TRIVIAL_LABEL_LENGTH && hasNonAsciiText(trimmed));
}

/** `diagram:caption` — `caption`/`alt_text` present is already enforced by `diagramSchema` itself;
 * this rule catches the "non-trivial" half `08` §8.11.7 also names — a single word is not a caption. */
export function checkCaption(diagram: Diagram, requireCaptions: boolean): DiagramFinding[] {
  if (!requireCaptions) return [];
  const findings: DiagramFinding[] = [];
  if (isTrivialCaptionText(diagram.caption)) {
    findings.push({
      checkId: 'diagram:caption',
      severity: 'error',
      message: `Diagram ${diagram.id}'s caption is a single word; a caption must actually explain the diagram.`,
    });
  }
  if (isTrivialCaptionText(diagram.alt_text)) {
    findings.push({
      checkId: 'diagram:caption',
      severity: 'error',
      message: `Diagram ${diagram.id}'s alt_text is a single word; alt text must stand in for the diagram when it cannot be shown.`,
    });
  }
  return findings;
}

/** `diagram:staleness` — `review_by` in the past is a warning, per `08` §8.11.7. No `review_by` at
 * all is not a staleness violation (nothing to compare `now` against); neither is an absent `now` —
 * a caller with no injected clock gets no wall-clock fallback (R10), just a skipped check, the same
 * shape `checkRefs` already uses for a missing `knownIds`. */
export function checkStaleness(diagram: Diagram, now: Date | undefined): DiagramFinding[] {
  if (diagram.review_by === undefined || now === undefined) return [];
  if (diagram.review_by >= now.toISOString().slice(0, 10)) return [];
  return [
    {
      checkId: 'diagram:staleness',
      severity: 'warn',
      message: `Diagram ${diagram.id} passed its review date of ${diagram.review_by}.`,
    },
  ];
}
