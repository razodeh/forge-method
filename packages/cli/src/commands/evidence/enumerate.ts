/**
 * `enumerateEvidence` — every real store `forge evidence prune` must read before it can decide
 * anything safely.
 *
 * `process/SPEC-QUESTIONS.md` Q294 Decision 9: "the enumeration of every store that can hold an
 * evidence id (a surviving bundle, a gate approval or waiver under `10` §10.3's evidence resolution,
 * a story field, and whatever else the enumeration finds, each tested)." This piece's own report
 * names, with file:line, every store that was actually checked and what each was found to hold (or
 * not hold) today:
 *
 * - `EvidenceBundle.bindingEvidence`/`.parityEvidence` (`packages/schemas/src/artifacts/
 *   evidence-bundle.ts`): the only real, currently-registered field anywhere that cites another
 *   retention-managed evidence id. Scanned below from every `EvidenceBundle` document this function
 *   finds.
 * - A gate definition's own `evidence:` block (`.forge/checks/*.gate.yaml`, `10` §10.3,
 *   `packages/engine/src/gates/types.ts`'s `GateDefinition.evidence`): a `Type(id)` entry naming a
 *   SPECIFIC id of one of the three retention-managed types is a live dependency `forge gate
 *   approve`/`waive` would need to resolve (`gate-commands.ts`'s own `resolveGateEvidence`) — scanned
 *   below via the existing, unmodified `loadGateRegistry`. A `Type(*)`/bare-type WILDCARD reference
 *   names no single id and is not collected here (see `types.ts`'s own doc comment on
 *   `GateEvidenceCitation`).
 * - `GateReport` (`packages/schemas/src/artifacts/gate-report.ts`) and `Waiver`
 *   (`packages/schemas/src/artifacts/waiver.ts`): read directly, in full, before writing this function
 *   — neither schema has a field shaped to hold another artifact's id at all (`GateReport` carries
 *   `gate`/`outcome`/`evaluatedAt`; `Waiver` carries `id`/`reason`/`owner`/`expiry`). A WRITTEN gate
 *   report or waiver file can therefore never be the "approval or waiver" store Decision 9 names; the
 *   live mechanism that CAN cite a specific id is the gate DEFINITION's own `evidence:` block above,
 *   which an approve or a waive both resolve against identically (`gate-commands.ts`'s two real call
 *   sites of `resolveGateEvidence`) — this is a DECISION, not an oversight, stated in this piece's own
 *   report.
 * - `Story` (`packages/schemas/src/artifacts/story.ts`) and `AcceptanceCriterion`
 *   (`acceptance-criterion.ts`): read directly, in full, before writing this function — neither has a
 *   field shaped to hold a `MutationEvidence`/`EvidenceBundle`/`ParityEvidence` id (`tests` names TEST
 *   ids, not evidence ids). No "story field" exists today; this is reported as a finding, not assumed.
 * - `MutationEvidence`/`ParityEvidence` themselves: read directly — neither cites another evidence id
 *   (only `story`, a cross-reference to a DIFFERENT type entirely). `references` is always `[]` for
 *   them (`types.ts`).
 * - The event log (`GateApproved`/`GateWaived`'s own recorded `evidence: string[]`,
 *   `packages/engine/src/gates/approve.ts`'s `GateApprovalSummary.evidence`): read (by grep) and
 *   deliberately NOT enumerated here — `18` §18.7 states the event log is never pruned, and a repo-wide
 *   check of every real consumer (`report.ts`, `resume/reconstruct.ts`) found none that ever reads a
 *   past approval's own recorded ids back to re-resolve or re-depend on them; the log is write-once
 *   history, not a live dependency a future prune could break. Protecting every id any approval has
 *   EVER cited, forever, would also directly defeat `--keep`'s own retention purpose. See this piece's
 *   own report for the full reasoning.
 *
 * A file that is not an artifact document at all, or fails to parse as one, is skipped — the identical
 * best-effort-per-file stance `@forge/core/ids/scan.ts`'s own `countIdsFromFiles` already takes, for
 * the identical reason (an unrelated spec page or README must not disable retention project-wide). A
 * file whose own front matter claims `type: MutationEvidence`/`EvidenceBundle`/`ParityEvidence` and
 * then fails that type's own registered schema is different: this function cannot trust what it finds
 * there (its id, its subject, or — for `EvidenceBundle` — what it references), so it refuses the whole
 * enumeration (`RUN-145`) rather than silently treating the record as absent, which could let `--apply`
 * remove something that document still, genuinely, references.
 *
 * @see specs/18-persistence-config-and-schemas.md §18.7
 * @see process/plans/PLAN-M16.md P14
 * @see process/SPEC-QUESTIONS.md Q294 Decision 9
 */
import { createHash } from 'node:crypto';

import { ArtifactDocument, ForgeError, listArtifactFiles, readTextFile } from '@forge/core';
import type { ProjectPaths } from '@forge/core/fs';
import { parseEvidenceRef } from '@forge/engine/gates';
import {
  definitionForType,
  evidenceBundleSchema,
  mutationEvidenceSchema,
  parityEvidenceSchema,
} from '@forge/schemas';

import { loadGateRegistry } from '../run/gates.ts';
import {
  RETENTION_TYPES,
  type EvidenceEnumeration,
  type EvidenceRecordInfo,
  type GateEvidenceCitation,
  type RetentionType,
} from './types.ts';

/** sha256 of `text`'s raw UTF-8 bytes, hex-encoded — the identical algorithm/encoding every other
 * content hash in this codebase uses (`parity-evidence.ts`'s own `SHA256_HEX` doc comment), applied
 * here to a record's own on-disk bytes for its tombstone's `recordSha256` field. */
function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/** The numeric part of a retention-managed `id` (e.g. `7` from `"MUT-007"`), parsed against `type`'s
 * own registered `idPrefix` — never a bare regex re-derived at each call site, so a future `idPrefix`
 * change (there is none planned; `18` §18.7's registry is append-only) could not silently desync this
 * from the real registry. `undefined` when `id` does not actually match `type`'s own prefix — this
 * function trusts the CALLER to have already confirmed `type` via the document's own validated schema
 * (`checkIdMatchesRegisteredType`, which every one of the three schemas already enforces), so this is
 * truly unreachable in production and exists only so the function has a total, honest return type. */
function numericIdOf(id: string, type: RetentionType): number | undefined {
  const prefix = definitionForType(type).idPrefix;
  if (!id.startsWith(`${prefix}-`)) return undefined;
  const digits = id.slice(prefix.length + 1);
  return /^\d+$/.test(digits) ? Number(digits) : undefined;
}

/** The single shared subject every story-less `ParityEvidence` record groups under (`18` §18.7,
 * `process/SPEC-QUESTIONS.md` Q294 Decision 5/A4) — the identical literal the parity-check command
 * itself uses for a `forge parity check` invocation given no `--story`. */
const PROJECT_SUBJECT = 'project';

/** Parses one already-read document as `type`, or throws `RUN-145` naming exactly why it could not be
 * trusted — the one real throw site every "a store failed to parse" claim in this piece's own report
 * traces back to. Branches on `type` so each record's own `subject`/`references` are read off its OWN
 * schema's real shape rather than a generic, widened cast across all three (`MutationEvidence.story`
 * and `EvidenceBundle.story` are both REQUIRED, non-optional fields; only `ParityEvidence.story` is
 * genuinely optional — collapsing the three into one shape would need a dead `?? ''` fallback for the
 * first two that could only ever hide a real schema-validation bug rather than a legitimate state). */
function parseRecordOrRefuse(
  type: RetentionType,
  relPath: string,
  frontMatter: Record<string, unknown>,
): Omit<EvidenceRecordInfo, 'sha256'> | undefined {
  if (type === 'MutationEvidence') {
    const result = mutationEvidenceSchema.safeParse(frontMatter);
    if (!result.success) throw refusal(type, relPath, result.error.issues[0]?.message);
    const numericId = numericIdOf(result.data.id, type);
    if (numericId === undefined) return undefined;
    return {
      id: result.data.id,
      type,
      subject: result.data.story,
      numericId,
      relPath,
      references: [],
    };
  }
  if (type === 'EvidenceBundle') {
    const result = evidenceBundleSchema.safeParse(frontMatter);
    if (!result.success) throw refusal(type, relPath, result.error.issues[0]?.message);
    const numericId = numericIdOf(result.data.id, type);
    if (numericId === undefined) return undefined;
    const references = [...result.data.bindingEvidence, ...(result.data.parityEvidence ?? [])];
    return { id: result.data.id, type, subject: result.data.story, numericId, relPath, references };
  }
  const result = parityEvidenceSchema.safeParse(frontMatter);
  if (!result.success) throw refusal(type, relPath, result.error.issues[0]?.message);
  const numericId = numericIdOf(result.data.id, type);
  if (numericId === undefined) return undefined;
  return {
    id: result.data.id,
    type,
    subject: result.data.story ?? PROJECT_SUBJECT,
    numericId,
    relPath,
    references: [],
  };
}

/** `RUN-145`, built once rather than at each of `parseRecordOrRefuse`'s three branches. */
function refusal(type: RetentionType, relPath: string, issue: string | undefined): ForgeError {
  return new ForgeError('RUN-145', {
    path: relPath,
    detail: `claims type ${type} but does not validate against its own schema (${issue ?? 'unknown issue'})`,
  });
}

/** Every `MutationEvidence`/`EvidenceBundle`/`ParityEvidence` record currently on disk, plus every
 * specific-id citation a committed gate definition makes of one of them. Throws `RUN-145` (a record
 * store) or lets `GATE-506` (`loadGateRegistry`, an unmodified existing function) propagate if either
 * cannot be trusted — see this module's own file header for the full, tested store list. */
export async function enumerateEvidence(
  paths: ProjectPaths,
  checksRoot: string,
): Promise<EvidenceEnumeration> {
  const records: EvidenceRecordInfo[] = [];
  for (const relPath of await listArtifactFiles(paths)) {
    let text: string;
    try {
      text = await readTextFile(paths.resolveWithin(relPath));
    } catch {
      continue;
    }
    let doc: ArtifactDocument;
    try {
      doc = ArtifactDocument.parse(text, relPath);
    } catch {
      continue;
    }
    const frontMatter = doc.frontMatter as Record<string, unknown>;
    const type = frontMatter['type'];
    if (typeof type !== 'string' || !RETENTION_TYPES.includes(type as RetentionType)) continue;
    const parsed = parseRecordOrRefuse(type as RetentionType, relPath, frontMatter);
    if (parsed === undefined) continue;
    records.push({ ...parsed, sha256: sha256Hex(text) });
  }

  const gateCitations: GateEvidenceCitation[] = [];
  const registry = await loadGateRegistry(paths, checksRoot);
  for (const definition of registry.values()) {
    for (const entry of definition.evidence ?? []) {
      const { type, id } = parseEvidenceRef(entry.artifact);
      if (id === '*' || !RETENTION_TYPES.includes(type as RetentionType)) continue;
      gateCitations.push({
        gateId: definition.id,
        ref: entry.artifact,
        type: type as RetentionType,
        id,
      });
    }
  }

  return { records, gateCitations };
}
