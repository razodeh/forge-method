/**
 * `ARTIFACT_TYPES` against an independent transcription of `specs/18` §18.7's table.
 *
 * The transcription below is written fresh from the spec text, not copied from
 * `src/registry/artifact-types.ts` — the point is to catch a transcription error in either direction,
 * the same pattern `tools/eslint-plugin-forge-boundaries/test/boundaries.test.ts` uses for
 * `PACKAGE_GRAPH`.
 *
 * @see specs/18 §18.7
 */
import { describe, expect, it } from 'vitest';

import {
  ARTIFACT_TYPES,
  artifactTypeById,
  artifactTypeByPrefix,
  definitionForType,
  type ArtifactTypeDefinition,
} from '../../src/registry/artifact-types.ts';

/** `specs/18` §18.7's table, row for row, transcribed independently of the production source. */
const SPEC_TABLE: readonly Omit<ArtifactTypeDefinition, 'requiredSections'>[] = [
  {
    id: 'Vision',
    idPrefix: 'VIS',
    pathTemplate: 'specs/vision.md',
    idWidth: 3,
    cardinality: 'one',
  },
  {
    id: 'Capability',
    idPrefix: 'CAP',
    pathTemplate: 'specs/capabilities/{id}.md',
    idWidth: 3,
    parent: 'Vision',
  },
  { id: 'NFR', idPrefix: 'NFR', pathTemplate: 'specs/nfr/{id}.md', idWidth: 4 },
  {
    id: 'Epic',
    idPrefix: 'EPIC',
    pathTemplate: 'specs/epics/{id}.md',
    idWidth: 3,
    parent: 'Capability',
  },
  {
    id: 'Story',
    idPrefix: 'STORY',
    pathTemplate: 'specs/stories/{id}-{slug}.md',
    idWidth: 3,
    parent: 'Epic',
  },
  {
    id: 'Task',
    idPrefix: 'TASK',
    pathTemplate: 'specs/tasks/{id}.md',
    idWidth: 3,
    parent: 'Story',
  },
  { id: 'ADR', idPrefix: 'ADR', pathTemplate: 'kb/decisions/{id}-{slug}.md', idWidth: 4 },
  {
    id: 'InterfaceContract',
    idPrefix: 'INT',
    pathTemplate: 'specs/interfaces/{name}.yaml',
    idWidth: 3,
  },
  { id: 'DataModel', idPrefix: 'DM', pathTemplate: 'specs/data/{id}-{slug}.md', idWidth: 3 },
  { id: 'Diagram', idPrefix: 'DIAG', pathTemplate: '{section}/views/{slug}.mmd', idWidth: 3 },
  { id: 'Risk', idPrefix: 'RISK', pathTemplate: 'kb/risks.md', idWidth: 3, collection: true },
  {
    id: 'Assumption',
    idPrefix: 'ASM',
    pathTemplate: 'kb/assumptions.md',
    idWidth: 3,
    collection: true,
  },
  {
    id: 'OpenQuestion',
    idPrefix: 'OQ',
    pathTemplate: 'kb/open-questions.md',
    idWidth: 3,
    collection: true,
  },
  {
    id: 'Waiver',
    idPrefix: 'WAIVER',
    pathTemplate: 'reports/waivers.md',
    idWidth: 3,
    collection: true,
  },
  { id: 'SessionRecord', idPrefix: 'SESSION', pathTemplate: 'sessions/{id}-{slug}.md', idWidth: 3 },
  { id: 'RCA', idPrefix: 'RCA', pathTemplate: 'sessions/rca/{id}-{slug}.md', idWidth: 3 },
  { id: 'Defect', idPrefix: 'DEF', pathTemplate: 'reports/defects/{id}.md', idWidth: 3 },
  {
    id: 'Environment',
    idPrefix: 'ENV',
    pathTemplate: 'kb/delivery/environments.md',
    idWidth: 3,
    collection: true,
  },
  { id: 'Runbook', idPrefix: 'RUN', pathTemplate: 'kb/ops/runbooks/{id}-{slug}.md', idWidth: 3 },
  { id: 'GateReport', idPrefix: 'GATE', pathTemplate: 'reports/gates/{gate}-{ts}.md', idWidth: 3 },
  {
    id: 'HandoffRecord',
    idPrefix: 'HO',
    pathTemplate: 'reports/handoffs.md',
    idWidth: 4,
    collection: true,
  },
  // Added post-v1.0, not part of the original 21 -- see `artifact-types.ts`'s own trailing entry.
  { id: 'ReviewReport', idPrefix: 'REVIEW', pathTemplate: 'sessions/reviews/{id}.md', idWidth: 3 },
];

describe('specs/18 §18.7 — the registry table', () => {
  it('has exactly 22 types (21 original + ReviewReport, added post-v1.0)', () => {
    expect(SPEC_TABLE).toHaveLength(22);
    expect(ARTIFACT_TYPES).toHaveLength(22);
  });

  it('matches the spec table row-for-row, in order', () => {
    const withoutRequiredSections = ARTIFACT_TYPES.map((type) => {
      const copy: Partial<Record<keyof ArtifactTypeDefinition, unknown>> = { ...type };
      delete copy.requiredSections;
      return copy;
    });
    expect(withoutRequiredSections).toEqual(SPEC_TABLE);
  });

  it('has no row with a key the spec table does not declare', () => {
    const allowedKeys = new Set([
      'id',
      'idPrefix',
      'pathTemplate',
      'idWidth',
      'parent',
      'cardinality',
      'collection',
      'requiredSections',
    ]);
    for (const type of ARTIFACT_TYPES) {
      for (const key of Object.keys(type)) {
        expect(allowedKeys.has(key), `${type.id} has an unexpected key "${key}"`).toBe(true);
      }
    }
  });

  it('every parent reference names a real registered type', () => {
    const ids = new Set(ARTIFACT_TYPES.map((type) => type.id));
    for (const type of ARTIFACT_TYPES) {
      if (type.parent !== undefined) {
        expect(ids.has(type.parent), `${type.id}'s parent "${type.parent}"`).toBe(true);
      }
    }
  });

  it('has a unique idPrefix per type', () => {
    const prefixes = ARTIFACT_TYPES.map((type) => type.idPrefix);
    expect(new Set(prefixes).size).toBe(prefixes.length);
  });

  it('has a unique id per type', () => {
    // Explicit, rather than relying only on the row-for-row transcription check above: that test
    // would also catch a duplicate id (either the count would exceed 21, or the affected row would
    // no longer match the independent transcription), but only indirectly — a direct assertion here
    // is what actually documents the invariant, and it is what `definitionForType`'s `Record` (built
    // via `Object.fromEntries`, which silently drops a duplicate key) depends on for correctness.
    const ids = ARTIFACT_TYPES.map((type) => type.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('defaults idWidth to 3, except ADR, NFR and HandoffRecord at 4 (SPEC-QUESTIONS.md Q21, Q24)', () => {
    const fourDigitTypes = new Set(['ADR', 'NFR', 'HandoffRecord']);
    for (const type of ARTIFACT_TYPES) {
      expect(type.idWidth, type.id).toBe(fourDigitTypes.has(type.id) ? 4 : 3);
    }
  });

  it('only Vision declares a cardinality', () => {
    const withCardinality = ARTIFACT_TYPES.filter((type) => type.cardinality !== undefined);
    expect(withCardinality.map((type) => type.id)).toEqual(['Vision']);
    expect(withCardinality[0]?.cardinality).toBe('one');
  });

  it('only ADR and SessionRecord declare requiredSections; every other type is [] (SPEC-QUESTIONS.md Q28)', () => {
    const withSections = new Map(
      ARTIFACT_TYPES.filter((type) => type.requiredSections.length > 0).map((type) => [
        type.id,
        type.requiredSections,
      ]),
    );
    expect([...withSections.keys()]).toEqual(['ADR', 'SessionRecord']);
    expect(withSections.get('ADR')).toEqual([
      'Context',
      'Options considered',
      'Decision',
      'Diagram',
      'Consequences',
      'Reversal plan',
    ]);
    expect(withSections.get('SessionRecord')).toEqual([
      'Frame',
      'Diverge',
      'Converge',
      'Decisions',
      'Non-decisions',
      'Actions',
      'KB write-back',
    ]);
  });

  it('marks exactly the six collection types the spec table declares', () => {
    const collections = ARTIFACT_TYPES.filter((type) => type.collection === true).map(
      (type) => type.id,
    );
    expect(collections.sort()).toEqual(
      ['Risk', 'Assumption', 'OpenQuestion', 'Waiver', 'Environment', 'HandoffRecord'].sort(),
    );
  });
});

describe('artifactTypeById', () => {
  it('finds a registered type by its exact id', () => {
    expect(artifactTypeById('Story')?.idPrefix).toBe('STORY');
  });

  it('returns undefined for an unregistered id', () => {
    expect(artifactTypeById('NotARealType')).toBeUndefined();
  });

  it('is case-sensitive: the registry ids are exact strings, not a folded comparison', () => {
    expect(artifactTypeById('story')).toBeUndefined();
  });
});

describe('artifactTypeByPrefix', () => {
  it('finds a registered type by its idPrefix', () => {
    expect(artifactTypeByPrefix('STORY')?.id).toBe('Story');
  });

  it('returns undefined for an unregistered prefix', () => {
    expect(artifactTypeByPrefix('NOPE')).toBeUndefined();
  });
});

describe('definitionForType', () => {
  it('returns a definite definition for every registered type, with no undefined case to guard', () => {
    for (const type of ARTIFACT_TYPES) {
      expect(definitionForType(type.id)).toEqual(type);
    }
  });
});
