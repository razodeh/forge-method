/**
 * `emitJsonSchemas` — a committed, byte-stable JSON Schema for every registry artifact type and for
 * `configSchema`, per `specs/02` §2.1 (`zod-to-json-schema` as the emitter).
 *
 * Deliberately does not emit `baseFrontMatterSchema` or `acceptanceCriterionSchema` as their own
 * files: `PLAN-M1.md` P9's Check names "every registry type and the config schema," and neither of
 * those two is a registry type or the config schema — they are shared shapes already reflected
 * *inside* every artifact type's own emitted schema (zod-to-json-schema inlines a non-recursive
 * reused schema at every place it is used, rather than `$ref`-ing a shared definition, since none of
 * `@forge/schemas`'s schemas reference themselves).
 *
 * A `.superRefine()` cross-field rule (ADR's supersedes/superseded_by consistency, Story's
 * size-vs-status rule, NFR's numeric-target check, ...) has no JSON Schema representation — JSON
 * Schema can express structure, not arbitrary predicates over sibling fields — so the emitted files
 * describe shape only. This is inherent to the target format, not a gap in this piece.
 *
 * @see specs/02 §2.1
 * @see specs/22 M1 exit test
 * @see PLAN-M1.md P9
 */
import { zodToJsonSchema } from 'zod-to-json-schema';
import type { z } from 'zod';

import { ARTIFACT_TYPES, type ArtifactTypeId } from '../registry/artifact-types.ts';
import {
  adrSchema,
  assumptionSchema,
  capabilitySchema,
  dataModelSchema,
  defectSchema,
  diagramSchema,
  environmentSchema,
  epicSchema,
  gateReportSchema,
  handoffRecordSchema,
  interfaceContractSchema,
  nfrSchema,
  openQuestionSchema,
  rcaSchema,
  riskSchema,
  runbookSchema,
  sessionRecordSchema,
  storySchema,
  taskSchema,
  visionSchema,
  waiverSchema,
} from '../artifacts/index.ts';
import { configSchema } from '../config/schema.ts';

/** A committed schema file's name — always the `.schema.json` convention this piece establishes. */
export type SchemaFileName = `${string}.schema.json`;

/**
 * The file-name stem for each artifact type — matching `packages/schemas/src/artifacts/*.ts`'s own
 * file names exactly, so a reader who already knows one naming convention gets the other for free.
 * Hand-written rather than derived from `ArtifactTypeId` mechanically (e.g. splitting on capitals)
 * because several ids are all-caps acronyms (`ADR`, `NFR`, `RCA`) that a mechanical PascalCase-to-
 * kebab-case split would mangle (`ADR` -> `a-d-r`).
 */
/**
 * Exported (not module-private) so a per-type zod schema is available without a second, hand-kept
 * `ArtifactTypeId -> schema` map elsewhere — `PLAN-M2.md` P6's `requiredFieldsFor` reads `.schema`
 * off this same table rather than re-importing and re-listing all 21 artifact schemas itself.
 */
export const ARTIFACT_SCHEMAS: Record<ArtifactTypeId, { fileStem: string; schema: z.ZodTypeAny }> =
  {
    Vision: { fileStem: 'vision', schema: visionSchema },
    Capability: { fileStem: 'capability', schema: capabilitySchema },
    NFR: { fileStem: 'nfr', schema: nfrSchema },
    Epic: { fileStem: 'epic', schema: epicSchema },
    Story: { fileStem: 'story', schema: storySchema },
    Task: { fileStem: 'task', schema: taskSchema },
    ADR: { fileStem: 'adr', schema: adrSchema },
    InterfaceContract: { fileStem: 'interface-contract', schema: interfaceContractSchema },
    DataModel: { fileStem: 'data-model', schema: dataModelSchema },
    Diagram: { fileStem: 'diagram', schema: diagramSchema },
    Risk: { fileStem: 'risk', schema: riskSchema },
    Assumption: { fileStem: 'assumption', schema: assumptionSchema },
    OpenQuestion: { fileStem: 'open-question', schema: openQuestionSchema },
    Waiver: { fileStem: 'waiver', schema: waiverSchema },
    SessionRecord: { fileStem: 'session-record', schema: sessionRecordSchema },
    RCA: { fileStem: 'rca', schema: rcaSchema },
    Defect: { fileStem: 'defect', schema: defectSchema },
    Environment: { fileStem: 'environment', schema: environmentSchema },
    Runbook: { fileStem: 'runbook', schema: runbookSchema },
    GateReport: { fileStem: 'gate-report', schema: gateReportSchema },
    HandoffRecord: { fileStem: 'handoff-record', schema: handoffRecordSchema },
  };

/**
 * Recursively sorts every plain object's keys, leaving array element order untouched (a JSON
 * Schema's `required` array is meaningful data, not a set of keys to canonicalize).
 */
function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (typeof value === 'object' && value !== null) {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      sorted[key] = sortKeysDeep((value as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return value;
}

/** Deep-sorted, 2-space-indented, `\n`-terminated JSON — byte-stable across runs and processes. */
function canonicalize(schema: unknown): string {
  return `${JSON.stringify(sortKeysDeep(schema), null, 2)}\n`;
}

/**
 * Emits one JSON Schema per registered artifact type, plus one for `configSchema` — sorted by file
 * name, so the `Map`'s own iteration order is as deterministic as each entry's content.
 */
export function emitJsonSchemas(): ReadonlyMap<SchemaFileName, string> {
  const entries: [SchemaFileName, string][] = ARTIFACT_TYPES.map((type) => {
    const { fileStem, schema } = ARTIFACT_SCHEMAS[type.id];
    // `zodToJsonSchema` takes `ZodSchema<any>` (= `ZodType<any, ZodTypeDef, any>`), not `ZodTypeAny`
    // (= `ZodType<any, any, any>`) — the middle type parameter differs, which
    // `@typescript-eslint/no-unsafe-argument` treats as an unsafe `any`-for-a-concrete-type swap
    // without this cast to the exact parameter type it declares.
    return [`${fileStem}.schema.json`, canonicalize(zodToJsonSchema(schema as z.ZodSchema))];
  });
  entries.push(['config.schema.json', canonicalize(zodToJsonSchema(configSchema))]);
  // No two entries ever tie: `ARTIFACT_SCHEMAS`'s file stems and the literal 'config' are all
  // distinct, so an equality branch here would be dead code no real input can reach.
  entries.sort(([a], [b]) => (a < b ? -1 : 1));
  return new Map(entries);
}
