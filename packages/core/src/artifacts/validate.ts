/**
 * `validateArtifact` — `18` §18.6's two-phase validation: front matter against the type's schema,
 * then body structure against its `requiredSections`.
 *
 * @see specs/18 §18.6
 * @see PLAN-M1.md P12
 */
import {
  adrSchema,
  ARTIFACT_TYPES,
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
  type ArtifactTypeId,
} from '@forge/schemas';
import type { z } from 'zod';

import { ForgeError } from '../errors/forge-error.ts';
import type { ArtifactDocument } from './document.ts';

export interface ArtifactTypeRegistryEntry {
  readonly schema: z.ZodTypeAny;
  readonly requiredSections: readonly string[];
}

export type ArtifactSchemaRegistry = Readonly<Record<ArtifactTypeId, ArtifactTypeRegistryEntry>>;

export type ValidationOutcome =
  { readonly valid: true } | { readonly valid: false; readonly errors: readonly ForgeError[] };

const SCHEMA_BY_TYPE: Record<ArtifactTypeId, z.ZodTypeAny> = {
  Vision: visionSchema,
  Capability: capabilitySchema,
  NFR: nfrSchema,
  Epic: epicSchema,
  Story: storySchema,
  Task: taskSchema,
  ADR: adrSchema,
  InterfaceContract: interfaceContractSchema,
  DataModel: dataModelSchema,
  Diagram: diagramSchema,
  Risk: riskSchema,
  Assumption: assumptionSchema,
  OpenQuestion: openQuestionSchema,
  Waiver: waiverSchema,
  SessionRecord: sessionRecordSchema,
  RCA: rcaSchema,
  Defect: defectSchema,
  Environment: environmentSchema,
  Runbook: runbookSchema,
  GateReport: gateReportSchema,
  HandoffRecord: handoffRecordSchema,
};

/** The real registry: every type's real schema and its real `requiredSections`. */
export const DEFAULT_ARTIFACT_REGISTRY: ArtifactSchemaRegistry = Object.fromEntries(
  ARTIFACT_TYPES.map((type) => [
    type.id,
    { schema: SCHEMA_BY_TYPE[type.id], requiredSections: type.requiredSections },
  ]),
) as ArtifactSchemaRegistry;

/**
 * The `## `-level headings in `body`, in order. `###`+ subsections are excluded, and so is a
 * `## `-prefixed line inside a ` ``` ` fenced code block — a document quoting another artifact's
 * structure as an example is not itself declaring a section.
 *
 * Every ` ``` ` line toggles fence state, strictly in document order, with no attempt to guess which
 * markers "really" pair up — CommonMark itself has no such concept; a fence marker always toggles,
 * and an unclosed one really does extend to end-of-file. An earlier version of this function tried to
 * detect and ignore a single "stray" unclosed fence so a later real heading would still be found, but
 * that heuristic mis-paired markers the moment a document had *more than one* fence issue, both
 * hiding a genuine heading and letting fenced content leak through as one — worse than the problem it
 * tried to solve. A document with a genuinely unclosed fence is malformed; every heading after that
 * point is, correctly, invisible to this check, the same as it would be to a real Markdown renderer.
 */
function topLevelHeadings(body: string): string[] {
  const headings: string[] = [];
  let inFence = false;
  for (const line of body.split('\n')) {
    if (line.startsWith('```')) {
      inFence = !inFence;
      continue;
    }
    if (!inFence && line.startsWith('## ')) headings.push(line.slice('## '.length).trim());
  }
  return headings;
}

function isArtifactTypeId(
  value: unknown,
  registry: ArtifactSchemaRegistry,
): value is ArtifactTypeId {
  return typeof value === 'string' && Object.hasOwn(registry, value);
}

/**
 * `registry` defaults to the real 21-type registry; a caller (a test, mainly) may pass a smaller one.
 */
export function validateArtifact(
  doc: ArtifactDocument,
  registry: ArtifactSchemaRegistry = DEFAULT_ARTIFACT_REGISTRY,
): ValidationOutcome {
  const frontMatter = doc.frontMatter as Readonly<Record<string, unknown>>;
  const type: unknown = frontMatter['type'];

  if (!isArtifactTypeId(type, registry)) {
    return {
      valid: false,
      errors: [
        new ForgeError('CFG-008', {
          path: doc.path,
          issues: `type: ${JSON.stringify(type)} is not a registered artifact type.`,
        }),
      ],
    };
  }

  const entry = registry[type];
  const result = entry.schema.safeParse(frontMatter);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ');
    return { valid: false, errors: [new ForgeError('CFG-008', { path: doc.path, issues })] };
  }

  const headings = topLevelHeadings(doc.body);
  const missingSections = entry.requiredSections.filter((section) => !headings.includes(section));
  if (missingSections.length > 0) {
    return {
      valid: false,
      errors: missingSections.map(
        (section) => new ForgeError('CFG-009', { path: doc.path, section }),
      ),
    };
  }

  return { valid: true };
}
