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
  registryTail,
  type ArtifactTypeDefinition,
  type ArtifactTypeId,
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

/**
 * `registryTail` (`PLAN-M14.md` P33): `pathTemplate` with placeholders turned into glob fragments and
 * its leading section-root segment (`specs`, `kb`, `sessions`, `reports`) dropped wherever an interior
 * directory is left to keep the suffix specific -- kept, literally, where dropping it would leave a
 * bare file name. Pinned for EVERY registered type (not merely a sample) so the refactor this piece
 * makes to `outputGlob` (`@forge/engine`) has a full, independent ground truth to be built on top of;
 * `packages/engine/test/dispatch/outputs.test.ts`'s own `outputGlob` table asserts the composed result
 * (this tail plus a configured root) is unchanged for every one of these same 22 types.
 */
describe('registryTail (P33)', () => {
  const EXPECTED: Readonly<Record<ArtifactTypeId, string>> = {
    Vision: 'specs/vision.md',
    Capability: 'capabilities/CAP-*.md',
    NFR: 'nfr/NFR-*.md',
    Epic: 'epics/EPIC-*.md',
    Story: 'stories/STORY-*.md',
    Task: 'tasks/TASK-*.md',
    ADR: 'decisions/ADR-*.md',
    InterfaceContract: 'interfaces/*.yaml',
    DataModel: 'data/DM-*.md',
    Diagram: '*/views/*.mmd',
    Risk: 'kb/risks.md',
    Assumption: 'kb/assumptions.md',
    OpenQuestion: 'kb/open-questions.md',
    Waiver: 'reports/waivers.md',
    SessionRecord: 'sessions/SESSION-*.md',
    RCA: 'rca/RCA-*.md',
    Defect: 'defects/DEF-*.md',
    Environment: 'delivery/environments.md',
    Runbook: 'ops/runbooks/RUN-*.md',
    GateReport: 'gates/*-*.md',
    HandoffRecord: 'reports/handoffs.md',
    ReviewReport: 'reviews/REVIEW-*.md',
  };

  it('enumerates every registered type (a floor against a vacuous pass)', () => {
    expect(Object.keys(EXPECTED).sort()).toEqual(ARTIFACT_TYPES.map((type) => type.id).sort());
  });

  it.each(ARTIFACT_TYPES.map((type) => [type.id, EXPECTED[type.id]] as const))(
    'registryTail(%s) = %s',
    (id, expected) => {
      expect(registryTail(id)).toBe(expected);
    },
  );

  it('drops the literal section root when an interior directory is left, keeps it for a bare file name', () => {
    // The seven types whose pathTemplate is exactly "<root>/<file>" (no interior directory): the root
    // stays, so the tail still opens with that literal segment. Every other type either has an
    // interior directory after its root (dropped) or an unrecognised, placeholder root (Diagram,
    // never eligible for dropping): none of those repeats its own literal root segment as the tail's
    // leading segment.
    const rootKept: ReadonlySet<ArtifactTypeId> = new Set([
      'Vision',
      'Risk',
      'Assumption',
      'OpenQuestion',
      'Waiver',
      'SessionRecord',
      'HandoffRecord',
    ]);
    for (const type of ARTIFACT_TYPES) {
      const first = type.pathTemplate.split('/')[0] ?? '';
      expect(registryTail(type.id).startsWith(`${first}/`), type.id).toBe(rootKept.has(type.id));
    }
  });

  it('cardinality-many types (a "*" in the tail) and cardinality-absent types match the pathTemplate placeholder', () => {
    for (const type of ARTIFACT_TYPES) {
      const hasPlaceholder = /\{\w+\}/.test(type.pathTemplate);
      expect(registryTail(type.id).includes('*'), type.id).toBe(hasPlaceholder);
    }
  });
});
