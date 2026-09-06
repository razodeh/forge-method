/**
 * A shared `erDiagram` renderer — backs `datamodel-to-er` and `schema-introspect-to-er`.
 *
 * @see PLAN-M3.md P3
 */
import { ForgeError } from '@forge/core';

import { buildSanitizedIdMap, sanitizeMermaidLabel } from './sanitize.ts';

/**
 * One entity block. `name` is the domain entity name — sanitized internally, and, unlike
 * `FlowNode`/`SequenceStep`, *displayed* as its own sanitized form when sanitization changes it:
 * Mermaid's `erDiagram` grammar has no alias mechanism separating an entity's identifier from its
 * on-screen name the way `flowchart` (`id["label"]`) and `sequenceDiagram`
 * (`participant id as name`) both do — verified empirically (`SPEC-QUESTIONS.md` Q46) that a
 * bracket-quoted label after an entity id parses without error but has no effect on the displayed
 * name. A real-world entity/attribute name needing sanitization (a reserved word, invalid
 * characters) is the one case this renderer cannot show its original spelling for.
 */
export interface ErEntity {
  readonly name: string;
  /** Attribute names only — this generic input carries no real column-type information, so every
   * attribute renders with the placeholder Mermaid ER type `string`. */
  readonly attributes?: readonly string[];
}

/** Mermaid ER crow's-foot notation's own two-sided grammar — a left cardinality token, `--`, a right
 * cardinality token. All 16 combinations are valid Mermaid syntax; this type generates the full set
 * from the two small closed alphabets rather than enumerating it by hand. */
type ErCardinalityLeft = '|o' | '||' | '}o' | '}|';
type ErCardinalityRight = 'o|' | '||' | 'o{' | '|{';
export type ErCardinality = `${ErCardinalityLeft}--${ErCardinalityRight}`;

const ER_CARDINALITY_LEFT: readonly ErCardinalityLeft[] = ['|o', '||', '}o', '}|'];
const ER_CARDINALITY_RIGHT: readonly ErCardinalityRight[] = ['o|', '||', 'o{', '|{'];

/** Every valid `ErCardinality`, derived from the same two alphabets `ErCardinality`'s own type is
 * derived from — so the runtime check and the type can never drift apart. */
export const VALID_ER_CARDINALITIES: ReadonlySet<string> = new Set(
  ER_CARDINALITY_LEFT.flatMap((left) => ER_CARDINALITY_RIGHT.map((right) => `${left}--${right}`)),
);

/** One relationship line between two `ErEntity.name`s. */
export interface ErRelationship {
  readonly from: string;
  readonly to: string;
  readonly label: string;
  /** Mermaid's own crow's-foot notation, e.g. `||--o{` (one-to-many). Defaults to one-to-many — the
   * shape a foreign-key relationship takes far more often than any other in a relational schema. */
  readonly cardinality?: ErCardinality;
}

const DEFAULT_CARDINALITY: ErCardinality = '||--o{';

function compareStrings(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/**
 * Renders `entities`/`relationships` as a Mermaid `erDiagram`. Deterministic regardless of input
 * order (R10): both lists are sorted before rendering. Every entity/relationship-endpoint id shares
 * one `buildSanitizedIdMap` call (collision- and reserved-word-safe, `SPEC-QUESTIONS.md` Q46); each
 * entity's own attribute names get their own such map, scoped to that entity alone — an attribute
 * name only has to be unique within its own entity block, never across entities.
 */
export function renderErDiagram(
  entities: readonly ErEntity[],
  relationships: readonly ErRelationship[],
): string {
  const allIds = [
    ...entities.map((entity) => entity.name),
    ...relationships.flatMap((relationship) => [relationship.from, relationship.to]),
  ];
  const idFor = buildSanitizedIdMap(allIds);

  const lines = ['erDiagram'];

  for (const entity of [...entities].sort((a, b) => compareStrings(a.name, b.name))) {
    const attributes = entity.attributes ?? [];
    if (attributes.length === 0) continue;
    const attributeIdFor = buildSanitizedIdMap(attributes);
    lines.push(`  ${idFor(entity.name)} {`);
    for (const attribute of [...attributes].sort(compareStrings)) {
      lines.push(`    string ${attributeIdFor(attribute)}`);
    }
    lines.push('  }');
  }

  const sortedRelationships = [...relationships].sort(
    (a, b) =>
      compareStrings(a.from, b.from) ||
      compareStrings(a.to, b.to) ||
      compareStrings(a.label, b.label),
  );
  for (const relationship of sortedRelationships) {
    const cardinality = relationship.cardinality ?? DEFAULT_CARDINALITY;
    // `ErCardinality` closes this at the type level for a caller with real type-checking; a caller
    // reaching this through `runGenerator`'s `unknown`-typed dynamic dispatch does not, so this is
    // re-checked at runtime too — the same boundary `KB-002` already exists for.
    if (!VALID_ER_CARDINALITIES.has(cardinality)) {
      throw new ForgeError('KB-002', {
        generator: 'render-er',
        detail: `"${cardinality}" is not a valid Mermaid ER cardinality`,
      });
    }
    lines.push(
      `  ${idFor(relationship.from)} ${cardinality} ${idFor(relationship.to)} : ${sanitizeMermaidLabel(relationship.label)}`,
    );
  }

  return lines.join('\n');
}
