/**
 * `writeReconstruction` — `17` §17.2 phase 6 (RECONSTRUCTION): "the KB is written, matching the
 * greenfield layout (`08` §8.2) so brownfield and greenfield projects are indistinguishable
 * afterwards."
 *
 * This piece **assembles and writes**; it does not re-derive facts. Every value it writes traces back
 * to a real P15 (SURVEY/INVENTORY), P16 (CARTOGRAPHY/INFERENCE), or P17 (VERIFICATION) output. Every
 * assembly rule (which finding becomes which entry, at which confidence, which diagram gets which
 * input) is its own small, pure, exported function — `deriveComponents`, `architectureEntries`,
 * `dataEntries`, `deliveryEntries`, `engineeringStandardsEntry`, `productEntries`,
 * `deriveRetroactiveAdrCandidates` — so every rule is unit-tested without touching a filesystem at
 * all; `writeReconstruction` is the thin async shell that calls each in turn and then performs the
 * real I/O: the already-real `KbWriter` (`@forge/kb/write`, P7) and `@forge/diagrams`' own generators
 * (`componentsToC4`/`depsToGraph`/`schemaIntrospectToEr`, P3).
 *
 * **Retroactive ADRs** are a real, distinct creation path from the normal `forge adr new`
 * (`@forge/cli/commands/adr.ts`) one: `@forge/kb` has no boundary-graph edge to `@forge/cli` or to
 * `@forge/templates` (`tools/eslint-plugin-forge-boundaries/src/graph.mjs`'s own `kb: ['core',
 * 'schemas', 'diagrams']`), so this recomposes the same lower-level primitives `@forge/engine`'s own
 * `writeAdrBack` (`packages/engine/src/interaction/session.ts`, `SPEC-QUESTIONS.md` Q161 point 8)
 * already established for the identical "no template package available" constraint: `IdAllocator`
 * (`@forge/core/ids`), `renderArtifactPath` (`@forge/schemas/registry`), and `adrSchema.safeParse`
 * (`@forge/schemas`) — construct the full object, validate, then serialise. `17` §17.2 phase 6's own
 * literal fields (`status: accepted`, `framework: reconstructed`) are written verbatim; `date: unknown`
 * cannot be, because `adrSchema.date` is `z.string().date()` (a real, `.date()`-validated ISO date, not
 * a free string) — writing the literal token `"unknown"` there would simply fail schema validation.
 * See `SPEC-QUESTIONS.md` for the disclosed resolution: `date` holds the day *this adoption run*
 * reconstructed the decision (a real fact), while the body's own `## Context` section states in the
 * first line that the *original* decision date is unknown — combined with `framework: 'reconstructed'`
 * and `status: 'accepted'`, this is the same three-part signal `17` §17.2 phase 6 asks for, expressed
 * across the fields that can actually carry it rather than one that cannot.
 *
 * @see specs/17 §17.2
 * @see specs/08 §8.2
 * @see specs/08 §8.11.6
 * @see PLAN-M10.md P18
 * @see SPEC-QUESTIONS.md Q159
 * @see SPEC-QUESTIONS.md Q161
 */
import {
  componentsToC4,
  depsToGraph,
  schemaIntrospectToEr,
  type ComponentsToC4Input,
  type DepsToGraphInput,
  type GeneratedDiagram,
  type SchemaIntrospectToErInput,
} from '@forge/diagrams';
import { ArtifactDocument } from '@forge/core/artifacts';
import type { Clock } from '@forge/core';
import {
  listDirEntriesSorted,
  pathExists,
  readTextFile,
  writeFileAtomic,
  type ProjectPaths,
} from '@forge/core/fs';
import { IdAllocator } from '@forge/core/ids';
import {
  adrSchema,
  diagramSchema,
  renderArtifactPath,
  type ADR,
  type Diagram,
} from '@forge/schemas';
import * as YAML from 'yaml';

import type { CartographyClaimKind, CartographyFinding, CartographyResult } from './cartography.ts';
import type { DependencyGraph } from './inventory.ts';
import type { EvidenceRef } from './evidence.ts';
import type { InferenceFinding, InferenceResult } from './inference.ts';
import type { VerificationResult } from './verification.ts';
import {
  componentsFileSchema,
  type Component,
  type ComponentsFile,
} from '../schema/components-file.ts';
import { KB_ENTRY_CONFIDENCE, type KbEntryConfidence, type KbSource } from '../schema/kb-entry.ts';
import { DEFAULT_KB_ROOT } from '../schema/tree.ts';
import { KbWriter, type KbEntryInput, type KbWriteOptions } from '../write/writer.ts';

/** The literal owner recorded on every fact this piece writes: adoption reconstructs *structure*, not
 * *accountability* — nobody has been asked yet which human or team owns a reconstructed component,
 * fact, or decision (that is exactly what `17` §17.3's human-confirmation flow and `PLAN-M10.md` P19
 * exist to close), so a real name here would be fabricated. */
export const RECONSTRUCTION_OWNER = 'reconstruction';

// `Object.fromEntries`'s own return type is `{ [k: string]: number }` -- widened back to the closed
// `KbEntryConfidence` record here because the input array (`KB_ENTRY_CONFIDENCE`, the schema's own
// exhaustive 4-value tuple) provably supplies every key exactly once; `writer.ts`'s own
// `KB_ENTRY_CONFIDENCE_RANK` makes the identical cast for the identical reason.
const CONFIDENCE_RANK: Readonly<Record<KbEntryConfidence, number>> = Object.fromEntries(
  KB_ENTRY_CONFIDENCE.map((value, index) => [value, index]),
) as Record<KbEntryConfidence, number>;

function minConfidence(values: readonly KbEntryConfidence[]): KbEntryConfidence {
  return values.reduce((worst, value) =>
    CONFIDENCE_RANK[value] < CONFIDENCE_RANK[worst] ? value : worst,
  );
}

// ---- slugs and module keys -----------------------------------------------------------------------

/** `[a-z][a-z0-9-]*`, never empty — satisfies both `componentSchema`'s own `component:<slug>` pattern
 * and every path/file slug this piece needs. A slug that would otherwise start with a digit or hyphen
 * (a statement beginning with a number) gets a `c-` prefix rather than being silently mangled. */
export function slugify(text: string): string {
  const raw = text
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (raw.length === 0) return 'component';
  return /^[a-z]/.test(raw) ? raw : `c-${raw}`;
}

const KNOWN_SOURCE_EXTENSIONS = /\.(ts|tsx|js|jsx|mjs|cjs|mts|cts)$/;

/** Matches `DependencyGraphNode.module`'s own "extension stripped" convention (`inventory.ts`) so an
 * evidence `path` citation (which still carries its real extension) and a dependency-graph module key
 * refer to the same module when they name the same file. */
function moduleKey(path: string): string {
  return path.replace(KNOWN_SOURCE_EXTENSIONS, '');
}

// ---- component derivation (architecture/components.md, components-to-c4) ------------------------

export interface ComponentDerivation {
  readonly components: readonly Component[];
  /** A CARTOGRAPHY `component` finding's own `statement` -> the component id it produced — lets a
   * caller (e.g. retroactive-ADR blast-radius) relate a different finding back to the same component
   * inventory without re-deriving it. */
  readonly componentIdByStatement: ReadonlyMap<string, string>;
  /** Every dependency-graph module key this derivation could attribute to a component, and which one
   * — reused by `deriveRetroactiveAdrs` to compute a real `blast_radius` from a *different* finding's
   * own evidence paths. */
  readonly moduleOwner: ReadonlyMap<string, string>;
}

/**
 * Builds `architecture/components.md`'s real component inventory from CARTOGRAPHY's own `component`
 * findings, with `dependsOn` computed — never fabricated — from P15's real `DependencyGraph`: a
 * component's evidence paths name the modules it covers; that module's own real `imports` (static
 * import/require analysis, `inventory.ts`) that resolve to a *different* component's own modules become
 * a real cross-component edge. A module neither component claims contributes no edge at all — this
 * under-reports rather than guesses at ownership for an unclaimed module.
 *
 * `owner`/`failureModes` have no real CARTOGRAPHY-cited source, so they are `RECONSTRUCTION_OWNER`/`[]`
 * respectively — an honest "unknown," never a fabricated name or a guessed failure mode.
 */
export function deriveComponents(
  findings: readonly CartographyFinding[],
  dependencyGraph: DependencyGraph,
): ComponentDerivation {
  const componentFindings = findings.filter((finding) => finding.kind === 'component');
  const usedIds = new Set<string>();
  const draft: { id: string; statement: string; modules: Set<string> }[] = [];
  const componentIdByStatement = new Map<string, string>();

  for (const finding of componentFindings) {
    const base = `component:${slugify(finding.statement)}`;
    let id = base;
    let suffix = 2;
    while (usedIds.has(id)) {
      id = `${base}-${String(suffix)}`;
      suffix += 1;
    }
    usedIds.add(id);
    const modules = new Set<string>();
    for (const ref of finding.evidence) {
      if (ref.kind === 'path') modules.add(moduleKey(ref.path));
    }
    draft.push({ id, statement: finding.statement, modules });
    componentIdByStatement.set(finding.statement, id);
  }

  const moduleOwner = new Map<string, string>();
  for (const component of draft) {
    for (const module of component.modules) {
      if (!moduleOwner.has(module)) moduleOwner.set(module, component.id);
    }
  }

  const importsByModule = new Map<string, readonly string[]>();
  for (const node of dependencyGraph.nodes) {
    importsByModule.set(moduleKey(node.module), node.imports.map(moduleKey));
  }

  const components: Component[] = draft.map((component) => {
    const dependsOn = new Set<string>();
    for (const module of component.modules) {
      for (const imported of importsByModule.get(module) ?? []) {
        const owner = moduleOwner.get(imported);
        if (owner !== undefined && owner !== component.id) dependsOn.add(owner);
      }
    }
    return {
      id: component.id,
      label: component.statement,
      responsibility: component.statement,
      owner: RECONSTRUCTION_OWNER,
      dependsOn: [...dependsOn].sort(),
      failureModes: [],
    };
  });

  return { components, componentIdByStatement, moduleOwner };
}

/** `ComponentsToC4Input`'s own field names (`id`/`label`/`dependsOn`) already match `Component`'s
 * exactly (`components-file.ts`'s own doc comment) — this is a direct, lossless projection, not a
 * reinterpretation. */
export function toComponentsToC4Input(components: readonly Component[]): ComponentsToC4Input {
  return {
    components: components.map((c) => ({ id: c.id, label: c.label, dependsOn: c.dependsOn })),
  };
}

/** `DependencyGraphNode.module`/`.imports` map onto `DepsToGraphInput`'s `name`/`dependsOn` directly —
 * the module dependency graph *is* the already-structured module data `08` §8.11.6's `deps-to-graph`
 * row names, not something this piece re-derives. */
export function toDepsToGraphInput(graph: DependencyGraph): DepsToGraphInput {
  return { modules: graph.nodes.map((node) => ({ name: node.module, dependsOn: node.imports })) };
}

/**
 * `schema-introspect-to-er`'s real source of truth in this pipeline is CARTOGRAPHY's own
 * `data-ownership` findings, the only place P15-P17 record a real table name at all. Columns and
 * foreign keys have no such source anywhere upstream (a `data-ownership` claim is "table X owned by
 * component Y," never a column list or a relationship) — both stay empty rather than inventing
 * plausible-looking structure, matching `schemaIntrospectToEr`'s own doc comment precedent
 * (`SPEC-QUESTIONS.md` Q46) for a generator whose full taxonomy promise is not yet met upstream.
 */
export function toSchemaIntrospectToErInput(
  findings: readonly CartographyFinding[],
): SchemaIntrospectToErInput {
  const tables = new Set<string>();
  for (const finding of findings) {
    if (finding.kind === 'data-ownership' && finding.table !== undefined) tables.add(finding.table);
  }
  return {
    tables: [...tables].sort().map((name) => ({ name, columns: [] })),
    foreignKeys: [],
  };
}

// ---- confidence carry-forward (VERIFICATION overrides CARTOGRAPHY/INFERENCE) ---------------------

interface VerificationOverride {
  readonly confidenceAfter: KbEntryConfidence;
  readonly detail: string;
  readonly command?: string;
}

function overrideKey(origin: 'cartography' | 'inference', statement: string): string {
  return `${origin}:${statement}`;
}

/** Every CARTOGRAPHY/INFERENCE claim VERIFICATION actually re-checked, keyed so a later lookup can
 * find whether *this* statement's own confidence was promoted or downgraded — `undefined` (no entry)
 * means VERIFICATION never re-checked this claim at all, in which case RECONSTRUCTION carries forward
 * whatever confidence the originating phase already produced, unchanged. */
export function indexVerificationOverrides(
  verification: VerificationResult,
): ReadonlyMap<string, VerificationOverride> {
  const map = new Map<string, VerificationOverride>();
  for (const finding of verification.findings) {
    if (finding.subject.origin === 'repository') continue;
    if (finding.confidenceAfter === undefined) continue;
    map.set(overrideKey(finding.subject.origin, finding.subject.statement), {
      confidenceAfter: finding.confidenceAfter,
      detail: finding.detail,
      ...(finding.command === undefined ? {} : { command: finding.command }),
    });
  }
  return map;
}

function resolvedConfidence(
  origin: 'cartography' | 'inference',
  statement: string,
  base: KbEntryConfidence,
  overrides: ReadonlyMap<string, VerificationOverride>,
): KbEntryConfidence {
  return overrides.get(overrideKey(origin, statement))?.confidenceAfter ?? base;
}

// ---- KB entry rendering -----------------------------------------------------------------------

function evidenceRefText(ref: EvidenceRef): string {
  if (ref.kind === 'path')
    return ref.line === undefined ? ref.path : `${ref.path}:${String(ref.line)}`;
  return ref.description;
}

function evidenceToSources(evidence: readonly EvidenceRef[]): readonly KbSource[] {
  return evidence.map((ref) => ({ kind: 'code' as const, ref: evidenceRefText(ref) }));
}

function evidenceBulletList(evidence: readonly EvidenceRef[]): string {
  return evidence.map((ref) => `- ${evidenceRefText(ref)}`).join('\n');
}

function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

interface EntrySpec {
  readonly section: KbEntryInput['section'];
  readonly path: string;
  readonly title: string;
  readonly statement: string;
  readonly rationale: string;
  readonly implications: string;
  readonly evidence: readonly EvidenceRef[];
  readonly confidence: KbEntryConfidence;
  readonly status: 'draft' | 'active';
  readonly verificationDetail?: string;
  readonly diagrams?: readonly string[];
  readonly appliesTo?: readonly string[];
}

function renderEntryBody(spec: EntrySpec): string {
  const lines = [
    '## Statement',
    '',
    spec.statement,
    '',
    '## Rationale',
    '',
    spec.rationale,
    '',
    '## Implications',
    '',
    spec.implications,
    '',
  ];
  const verificationText =
    spec.verificationDetail ??
    (spec.confidence === 'verified'
      ? `Supported by the following evidence from SURVEY/INVENTORY:\n\n${evidenceBulletList(spec.evidence)}`
      : undefined);
  if (verificationText !== undefined) {
    lines.push('## Verification', '', verificationText, '');
  }
  lines.push('## Evidence', '', evidenceBulletList(spec.evidence), '');
  return lines.join('\n');
}

function toKbEntryInput(spec: EntrySpec, today: string, reviewBy: string): KbEntryInput {
  return {
    type: 'knowledge',
    section: spec.section,
    path: spec.path,
    title: spec.title,
    status: spec.status,
    confidence: spec.confidence,
    owner: RECONSTRUCTION_OWNER,
    sources: [...evidenceToSources(spec.evidence)],
    review_by: reviewBy,
    supersedes: [],
    superseded_by: null,
    related: [],
    diagrams: [...(spec.diagrams ?? [])],
    tags: ['adopt-reconstruction'],
    applies_to: [...(spec.appliesTo ?? [])],
    body: renderEntryBody(spec),
  };
}

function uniquePath(used: Set<string>, section: string, slug: string): string {
  let candidate = `${section}/${slug}.md`;
  let suffix = 2;
  while (used.has(candidate)) {
    candidate = `${section}/${slug}-${String(suffix)}.md`;
    suffix += 1;
  }
  used.add(candidate);
  return candidate;
}

const ARCHITECTURE_KINDS: ReadonlySet<CartographyClaimKind> = new Set([
  'component',
  'layering',
  'runtime-topology',
  'critical-path',
]);

/**
 * `architecture/` entries — one per CARTOGRAPHY finding whose kind describes structure (`component`,
 * `layering`, `runtime-topology`, `critical-path`; `data-ownership` goes to `data/` instead, below).
 * Confidence is carried forward from the finding, promoted/downgraded by a real VERIFICATION result
 * when one exists for this exact statement — never re-derived here.
 */
export function architectureEntries(
  findings: readonly CartographyFinding[],
  overrides: ReadonlyMap<string, VerificationOverride>,
  componentIdByStatement: ReadonlyMap<string, string>,
  diagramIds: readonly string[],
  today: string,
  reviewBy: string,
  used: Set<string>,
): readonly KbEntryInput[] {
  return findings
    .filter((finding) => ARCHITECTURE_KINDS.has(finding.kind))
    .map((finding) => {
      const override = overrides.get(overrideKey('cartography', finding.statement));
      const componentId = componentIdByStatement.get(finding.statement);
      const spec: EntrySpec = {
        section: 'architecture',
        path: uniquePath(used, 'architecture', slugify(finding.statement)),
        title: finding.statement,
        statement: finding.statement,
        rationale: `Reconstructed during brownfield adoption from a CARTOGRAPHY finding of kind "${finding.kind}" (\`17\` §17.2 phase 3).`,
        // `finding.kind` here is always one of `ARCHITECTURE_KINDS` (the `.filter` above) --
        // `data-ownership` never reaches this branch at all; it goes to `dataEntries` instead. A
        // `component` finding's own row in `architecture/components.md` (`deriveComponents`, written
        // separately) already carries its `dependsOn`/`failureModes` structure -- this entry's own job
        // is the one thing that inventory row cannot carry at all: a confidence rating and a citable
        // Verification section, so the two are pointed at each other rather than repeating one
        // another's content.
        implications:
          finding.kind === 'component' && componentId !== undefined
            ? `See architecture/components.md (${componentId}) for this component's full inventory row -- dependencies and failure modes are recorded there, not repeated here.`
            : 'Structural fact observed in the present-day codebase; no design intent is claimed beyond what the cited evidence shows.',
        evidence: finding.evidence,
        confidence: resolvedConfidence(
          'cartography',
          finding.statement,
          finding.confidence,
          overrides,
        ),
        status: 'active',
        ...(override === undefined ? {} : { verificationDetail: override.detail }),
        diagrams: diagramIds,
        ...(componentId === undefined ? {} : { appliesTo: [componentId] }),
      };
      return toKbEntryInput(spec, today, reviewBy);
    });
}

/** `data/` entries — one per distinct table named by a `data-ownership` finding, aggregating every
 * owner CARTOGRAPHY found for it (`cartography.ts`'s own `flagSharedWriteTables` already flags a table
 * more than one component writes; this entry's own body states the same fact for a human reader).
 * Confidence is the *worst* of every contributing finding's own resolved confidence — a table is never
 * reported more confidently than its least-certain ownership claim. */
export function dataEntries(
  findings: readonly CartographyFinding[],
  overrides: ReadonlyMap<string, VerificationOverride>,
  diagramIds: readonly string[],
  today: string,
  reviewBy: string,
  used: Set<string>,
): readonly KbEntryInput[] {
  const byTable = new Map<string, CartographyFinding[]>();
  for (const finding of findings) {
    if (finding.kind !== 'data-ownership' || finding.table === undefined) continue;
    const list = byTable.get(finding.table) ?? [];
    list.push(finding);
    byTable.set(finding.table, list);
  }
  return [...byTable.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([table, tableFindings]) => {
      const owners = [
        ...new Set(tableFindings.map((f) => f.owner).filter((o): o is string => o !== undefined)),
      ].sort();
      const evidence = tableFindings.flatMap((f) => f.evidence);
      const confidence = minConfidence(
        tableFindings.map((f) =>
          resolvedConfidence('cartography', f.statement, f.confidence, overrides),
        ),
      );
      const detail = tableFindings
        .map((f) => overrides.get(overrideKey('cartography', f.statement))?.detail)
        .find((d): d is string => d !== undefined);
      const spec: EntrySpec = {
        section: 'data',
        path: uniquePath(used, 'data', slugify(table)),
        title: `Table: ${table}`,
        statement: `Table "${table}" is written by: ${owners.join(', ') || 'an unidentified component'}.`,
        rationale:
          'Reconstructed during brownfield adoption from CARTOGRAPHY data-ownership findings (`17` §17.2 phase 3).',
        implications:
          owners.length > 1
            ? `More than one component writes this table (${owners.join(', ')}) — a shared-write table CARTOGRAPHY flagged directly.`
            : 'Exactly one component writes this table, per the cited evidence.',
        evidence,
        confidence,
        status: 'active',
        ...(detail === undefined ? {} : { verificationDetail: detail }),
        diagrams: diagramIds,
      };
      return toKbEntryInput(spec, today, reviewBy);
    });
}

/** `delivery/` entries — one per *repository-origin* VERIFICATION check (`build`/`test`/`pipeline`):
 * real, measured facts about the target repo as a whole, never a re-check of a prior CARTOGRAPHY/
 * INFERENCE claim (those are `architecture`/`data`/`engineering` entries instead). A failed or
 * inconclusive check is still written — "failures are findings, not blockers" (`17` §17.2 phase 5) —
 * at `confidence: 'low'` when VERIFICATION recorded no promotion (a failed build proves the build is
 * broken, which is not the same as *verifying* anything at a higher confidence). */
export function deliveryEntries(
  verification: VerificationResult,
  today: string,
  reviewBy: string,
  used: Set<string>,
): readonly KbEntryInput[] {
  const repositoryChecks = verification.findings.filter((f) => f.subject.origin === 'repository');
  return repositoryChecks.map((check) => {
    const title =
      check.kind === 'build'
        ? 'Build command'
        : check.kind === 'test'
          ? 'Test suite'
          : `${check.kind} check`;
    const confidence = check.confidenceAfter ?? 'low';
    const evidence: readonly EvidenceRef[] =
      check.command === undefined
        ? [{ kind: 'fact', description: `verification:${check.kind}@${check.measuredAt}` }]
        : [{ kind: 'fact', description: `verification-command:${check.command}` }];
    const spec: EntrySpec = {
      section: 'delivery',
      path: uniquePath(used, 'delivery', slugify(`${check.kind}-${check.outcome}`)),
      title: `${title} (reconstructed)`,
      statement: `The ${title.toLowerCase()} was measured, not merely claimed, during adoption: ${check.detail}`,
      rationale:
        'Reconstructed during brownfield adoption from a real VERIFICATION run (`17` §17.2 phase 5) against the target repository.',
      implications:
        check.outcome === 'pass'
          ? 'This is a real, verified fact about the current state of the repository.'
          : `This check did not pass (${check.outcome}); see the Verification section for what was actually observed.`,
      evidence,
      confidence,
      status: 'active',
      verificationDetail:
        check.command === undefined
          ? check.detail
          : `${check.detail}\n\nCommand: \`${check.command}\``,
    };
    return toKbEntryInput(spec, today, reviewBy);
  });
}

/** `engineering/standards.md` — a single aggregate entry (the mandate names one literal file, unlike
 * `architecture/`/`data/`/`product/`, which are directories) covering every INFERENCE `convention`
 * finding, each with its own real "N of M" adherence ratio. `undefined` when INFERENCE found no
 * convention claims at all — an empty `engineering/standards.md` is not written merely to exist. */
export function engineeringStandardsEntry(
  inferenceFindings: readonly InferenceFinding[],
  overrides: ReadonlyMap<string, VerificationOverride>,
  today: string,
  reviewBy: string,
  used: Set<string>,
): KbEntryInput | undefined {
  const conventions = inferenceFindings.filter((f) => f.kind === 'convention');
  if (conventions.length === 0) return undefined;

  const evidence = conventions.flatMap((f) => f.evidence);
  const confidence = minConfidence(
    conventions.map((f) => resolvedConfidence('inference', f.statement, f.confidence, overrides)),
  );
  const statement = conventions
    .map((f) => `- ${f.statement}${f.adherenceRatio === undefined ? '' : ` (${f.adherenceRatio})`}`)
    .join('\n');
  const detail = conventions
    .map((f) => overrides.get(overrideKey('inference', f.statement))?.detail)
    .find((d): d is string => d !== undefined);

  const spec: EntrySpec = {
    section: 'engineering',
    path: uniquePath(used, 'engineering', 'standards'),
    title: 'Observed conventions and adherence ratios',
    statement,
    rationale:
      "Reconstructed during brownfield adoption from INFERENCE convention findings (`17` §17.2 phase 4) — each one is INFERENCE's own real, structurally-capped `low`/`medium` output, never re-derived here.",
    implications:
      'Adherence ratios are counted, not estimated ("17 of 21," not "mostly"); a low ratio names a real gap for phase 7 (GAP ANALYSIS) to pick up.',
    evidence,
    confidence,
    status: 'draft',
    ...(detail === undefined ? {} : { verificationDetail: detail }),
  };
  return toKbEntryInput(spec, today, reviewBy);
}

/** `product/` entries — INFERENCE `intent` findings only ("apparent intent," `17` §17.2 phase 4's own
 * riskiest claim kind). `confidence: low` is forced regardless of what INFERENCE itself carried,
 * matching phase 6's own literal "usually sparse... reverse-engineered... marked `confidence: low`
 * pending human confirmation" — the one section RECONSTRUCTION deliberately does *not* carry forward a
 * higher upstream value for, because product intent reconstructed from routes and UI is a guess about
 * *why*, not a structurally-evidenced fact about *what*, however well-cited its evidence is. */
export function productEntries(
  inferenceFindings: readonly InferenceFinding[],
  today: string,
  reviewBy: string,
  used: Set<string>,
): readonly KbEntryInput[] {
  return inferenceFindings
    .filter((finding) => finding.kind === 'intent')
    .map((finding) => {
      const spec: EntrySpec = {
        section: 'product',
        path: uniquePath(used, 'product', slugify(finding.statement)),
        title: finding.statement,
        statement: finding.statement,
        rationale:
          'Reconstructed during brownfield adoption from an INFERENCE `intent` finding (`17` §17.2 phase 4) — a capability reverse-engineered from routes/UI, not a recorded product decision.',
        implications:
          'Pending human confirmation (`17` §17.3) — treat as a hypothesis about product intent, not a settled fact.',
        evidence: finding.evidence,
        confidence: 'low',
        status: 'draft',
      };
      return toKbEntryInput(spec, today, reviewBy);
    });
}

// ---- retroactive ADRs -----------------------------------------------------------------------------

export interface RetroactiveAdrCandidate {
  readonly title: string;
  readonly statement: string;
  readonly evidence: readonly EvidenceRef[];
  readonly blastRadius: readonly string[];
}

/**
 * One retroactive-ADR candidate per CARTOGRAPHY `layering` finding — "the significant structural
 * choices" `17` §17.2 phase 6 names, and the one CARTOGRAPHY kind that is itself already a claim about
 * a structural rule ("component X depends only on Y, never Z") rather than a component's own existence
 * (`component`), a runtime path (`runtime-topology`/`critical-path`), or data (`data-ownership`).
 * `blastRadius` is computed, never guessed: every real component (`deriveComponents`'s own
 * `moduleOwner`) whose modules overlap this finding's own cited evidence paths.
 */
export function deriveRetroactiveAdrCandidates(
  findings: readonly CartographyFinding[],
  moduleOwner: ReadonlyMap<string, string>,
): readonly RetroactiveAdrCandidate[] {
  return findings
    .filter((finding) => finding.kind === 'layering')
    .map((finding) => {
      const blastRadius = new Set<string>();
      for (const ref of finding.evidence) {
        if (ref.kind !== 'path') continue;
        const owner = moduleOwner.get(moduleKey(ref.path));
        if (owner !== undefined) blastRadius.add(owner);
      }
      return {
        title: finding.statement,
        statement: finding.statement,
        evidence: finding.evidence,
        blastRadius: [...blastRadius].sort(),
      };
    });
}

function retroactiveAdrCandidate(
  candidate: RetroactiveAdrCandidate,
  id: string,
  path: string,
  today: string,
): { readonly path: string; readonly adr: ADR; readonly text: string } {
  const adr = {
    id,
    type: 'ADR' as const,
    schemaVersion: 1,
    title: `Reconstructed: ${candidate.title}`,
    status: 'accepted' as const,
    category: 'architecture' as const,
    deciders: [RECONSTRUCTION_OWNER],
    date: today,
    reversibility: 'medium' as const,
    blast_radius: [...candidate.blastRadius],
    revisit_trigger: 'Revisit once a human confirms or corrects this reconstructed decision.',
    supersedes: [] as string[],
    superseded_by: null,
    related: [] as string[],
    diagrams: [] as string[],
    framework: 'reconstructed',
    created: today,
    updated: today,
    revision: 1,
    author: RECONSTRUCTION_OWNER,
    changelog: [
      {
        revision: 1,
        date: today,
        by: RECONSTRUCTION_OWNER,
        summary:
          'Reconstructed retroactively from brownfield CARTOGRAPHY evidence; not an original design decision.',
      },
    ],
  };
  const parsed = adrSchema.safeParse(adr);
  if (!parsed.success) {
    throw new RangeError(`adrSchema rejected a retroactive-ADR candidate: ${parsed.error.message}`);
  }
  const body = [
    retroactiveAdrMarker(candidate.statement),
    '',
    '## Context',
    '',
    '**Reconstructed retroactively during brownfield adoption; original decision date is unknown.** ' +
      'The `date` recorded above is the day this adoption run reconstructed it, not the original ' +
      'decision date — see `SPEC-QUESTIONS.md` for why `date: unknown` cannot be written literally.',
    '',
    candidate.statement,
    '',
    '## Options considered',
    '',
    'Not recorded — no original decision record exists for this structural choice; only its present-day shape could be observed.',
    '',
    '## Decision',
    '',
    candidate.statement,
    '',
    '## Diagram',
    '',
    'See `architecture/views/` for the generated component and dependency diagrams this decision is reflected in.',
    '',
    '## Consequences',
    '',
    `Dependents identified from real module-import analysis: ${candidate.blastRadius.join(', ') || 'none identified'}.`,
    '',
    '## Reversal plan',
    '',
    'Not recorded — retroactively reconstructed; no original reversal plan exists.',
    '',
    '## Evidence',
    '',
    evidenceBulletList(candidate.evidence),
    '',
  ].join('\n');
  return {
    path,
    adr: parsed.data,
    text: `---\n${stringifyFrontMatter(parsed.data)}---\n\n${body}`,
  };
}

function stringifyFrontMatter(data: Record<string, unknown>): string {
  return YAML.stringify(data);
}

// ---- diagram writing --------------------------------------------------------------------------

interface DiagramSpec {
  readonly section: string;
  readonly slug: string;
  readonly title: string;
  readonly generator: string;
  readonly diagram: GeneratedDiagram;
  readonly caption: string;
  readonly altText: string;
}

async function writeDiagram(
  paths: ProjectPaths,
  kbRoot: string,
  allocator: IdAllocator,
  clock: Clock,
  spec: DiagramSpec,
): Promise<{ readonly id: string; readonly path: string }> {
  const id = await allocator.allocate('Diagram');
  const pathResult = renderArtifactPath('Diagram', { section: spec.section, slug: spec.slug });
  if (!pathResult.success) {
    throw new RangeError(
      `renderArtifactPath('Diagram', ...) failed: missing ${pathResult.missingVariable}`,
    );
  }
  const today = clock.now().slice(0, 10);
  const sidecar: Diagram = {
    id,
    type: 'Diagram',
    schemaVersion: 1,
    title: spec.title,
    status: 'active',
    created: today,
    updated: today,
    revision: 1,
    author: RECONSTRUCTION_OWNER,
    changelog: [
      {
        revision: 1,
        date: today,
        by: RECONSTRUCTION_OWNER,
        summary: 'Generated during brownfield adoption RECONSTRUCTION.',
      },
    ],
    kind: spec.diagram.kind,
    notation: 'mermaid',
    source: pathResult.path,
    generated: true,
    generator: spec.generator,
    depicts: [...spec.diagram.depicts],
    // Written before the KB entries that would reference this diagram exist yet (`architecture`/
    // `data` entries name *this* diagram in their own `diagrams` field, not the reverse) — see this
    // file's own top-of-file doc comment for the ordering this implies. An empty `explains` is a real,
    // disclosed scope narrowing, not an oversight.
    explains: [],
    caption: spec.caption,
    alt_text: spec.altText,
    owner: RECONSTRUCTION_OWNER,
  };
  const parsed = diagramSchema.safeParse(sidecar);
  if (!parsed.success) {
    throw new RangeError(`diagramSchema rejected a generated diagram: ${parsed.error.message}`);
  }
  const mmdTarget = paths.resolveWithin(`${kbRoot}/${pathResult.path}`);
  const yamlTarget = paths.resolveWithin(`${kbRoot}/${pathResult.path}.yaml`);
  await writeFileAtomic(mmdTarget, `${spec.diagram.source.trim()}\n`);
  // `.mmd.yaml` sidecars are pure YAML, never `---`-fenced: `parseKbTree` routes them through
  // `parseFrontMatterYaml` directly on the raw file text (`schema/tree.ts`'s own `diagram-sidecar`
  // case), which parses the whole file as one YAML mapping -- a `---`-wrapped body here would fail
  // that parse as "multiple documents," not merely look wrong.
  await writeFileAtomic(yamlTarget, stringifyFrontMatter(parsed.data));
  return { id, path: pathResult.path };
}

// ---- idempotent writes ---------------------------------------------------------------------------
//
// Every KB-entry path this file writes is deterministic (`uniquePath(used, section, slugify(...))`
// over the exact same findings), which is exactly what makes a second `writeReconstruction` call
// against a project that already has one land on the identical path set. `KbWriter.write` refuses an
// existing path unconditionally (`KB-009`) -- correct for a genuinely new, unrelated write, but wrong
// here: without a check, a `writeReconstruction` call that is retried after a mid-run crash (or simply
// invoked twice, e.g. by `--incremental`) throws on the very first entry forever, with no path back to
// a working state short of a human deleting KB files by hand. A fresh critic round found exactly this,
// confirmed by running `writeReconstruction` twice against the same fresh project. Fixed the same way
// `08` §8.6 already treats every other KB write path: the deterministic path itself is the identity
// check (no separate provenance marker needed, since -- unlike a session-triggered ADR/Risk write --
// nothing else in this codebase ever writes to `architecture/<slugified-statement>.md`).

/** The already-allocated id of the KB entry at `entry.path`, if one exists, without touching
 * `KbWriter` or its id allocator at all -- a plain read of the file this exact deterministic path
 * would otherwise collide with. */
async function existingKbEntryId(
  paths: ProjectPaths,
  kbRoot: string,
  relativePath: string,
): Promise<string | undefined> {
  const target = paths.resolveWithin(`${kbRoot}/${relativePath}`);
  if (!(await pathExists(target))) return undefined;
  const raw = await readTextFile(target);
  const doc = ArtifactDocument.parse(raw, relativePath);
  const id = (doc.frontMatter as Record<string, unknown>)['id'];
  return typeof id === 'string' ? id : undefined;
}

/** `writer.write(entry)`, or the id already on disk at `entry.path` when a prior run (or a crash
 * mid-way through this one) already wrote it — see this section's own doc comment. Never re-validates
 * or re-writes the existing file's content against `entry`: a deterministic path colliding with a
 * *different* statement's content is a hash-space coincidence this piece does not attempt to detect,
 * the same residual gap `08` §8.6's own KB-wide duplicate-id detection (the KB linter, not this piece)
 * is already responsible for. */
async function writeKbEntryIdempotent(
  writer: KbWriter,
  paths: ProjectPaths,
  kbRoot: string,
  entry: KbEntryInput,
  options: KbWriteOptions = {},
): Promise<string> {
  const existing = await existingKbEntryId(paths, kbRoot, entry.path);
  if (existing !== undefined) return existing;
  return (await writer.write(entry, options)).id;
}

/** Every `.md` file directly under `dir` (relative to the project root), or `[]` if `dir` does not
 * exist at all — a brand-new project's own `decisions/` before this piece's first ever retroactive-ADR
 * write. Mirrors `@forge/engine/interaction/session.ts`'s own `listMarkdownFiles`, re-derived here
 * rather than imported: `@forge/kb` has no boundary-graph edge to `@forge/engine`. */
async function listMarkdownFiles(paths: ProjectPaths, dir: string): Promise<readonly string[]> {
  const target = paths.resolveWithin(dir);
  if (!(await pathExists(target))) return [];
  const entries = await listDirEntriesSorted(target);
  return entries
    .filter((entry) => !entry.isDirectory && entry.name.endsWith('.md'))
    .map((entry) => `${dir}/${entry.name}`);
}

/** A retroactive ADR's own file path embeds a freshly-`IdAllocator`-allocated id
 * (`renderArtifactPath('ADR', ...)`), so — unlike a KB entry's deterministic path — the *path* alone
 * cannot answer "did a prior run already write this candidate." A second run without a check silently
 * allocates a new id and writes a duplicate ADR for the identical `layering` finding every time,
 * diverging rather than converging on retry, the exact R9 failure a fresh critic round found in the
 * KB-entry path above and which turns out to have an un-guarded twin here. Fixed the same way
 * `writeAdrBack` (`packages/engine/src/interaction/session.ts`) already solves the identical
 * non-deterministic-id problem: a stable, greppable marker embedded in the body, scanned for across
 * every existing `decisions/*.md` file before ever allocating a new id. */
function retroactiveAdrMarker(statement: string): string {
  return `<!-- forge:reconstruction-adr statement=${JSON.stringify(statement)} -->`;
}

async function findExistingRetroactiveAdrId(
  paths: ProjectPaths,
  kbRoot: string,
  statement: string,
): Promise<string | undefined> {
  const marker = retroactiveAdrMarker(statement);
  const files = await listMarkdownFiles(paths, `${kbRoot}/decisions`);
  for (const relativePath of files) {
    const text = await readTextFile(paths.resolveWithin(relativePath)).catch(() => '');
    if (!text.includes(marker)) continue;
    const match = /^id:\s*(\S+)/m.exec(text);
    if (match?.[1] !== undefined) return match[1];
  }
  return undefined;
}

// ---- orchestration ------------------------------------------------------------------------------

export interface ReconstructionInput {
  readonly cartography: CartographyResult;
  readonly inference: InferenceResult;
  readonly verification: VerificationResult;
  readonly dependencyGraph: DependencyGraph;
}

export interface ReconstructionDeps {
  readonly paths: ProjectPaths;
  readonly clock: Clock;
  readonly kbRoot?: string;
}

export interface ReconstructionResult {
  readonly componentIds: readonly string[];
  readonly diagramIds: readonly string[];
  readonly kbEntryIds: readonly string[];
  readonly adrIds: readonly string[];
}

/**
 * The real write path: computes every derivation above, generates the three real
 * `@forge/diagrams` outputs this pipeline has real structured data for (skipping one entirely when its
 * own input would be empty — an empty diagram is not written merely to exist), writes
 * `architecture/components.md` (`componentsFileSchema`) when there is at least one component, then
 * every `architecture`/`data`/`delivery`/`engineering`/`product` KB entry via the already-real
 * `KbWriter`, then every retroactive ADR. Runs everything sequentially (never `Promise.all`): `KbWriter`
 * already serialises its own writes per project, but the `IdAllocator` this function constructs for
 * `Diagram`/`ADR` ids is a single, un-queued instance local to this one call — safe only because this
 * function itself never issues two allocations concurrently. This does *not* protect against a
 * concurrent, independent writer racing the same project's id sequence (e.g. a session step's own
 * `writeAdrBack`, `packages/engine/src/interaction/session.ts`, which uses a module-level, per-project
 * queue this local allocator does not share) — relied on only because FORGE's own architecture runs
 * one project per process (`CFG-002`: "another FORGE supervisor holds this project"), not proven by a
 * test here.
 */
export async function writeReconstruction(
  deps: ReconstructionDeps,
  input: ReconstructionInput,
): Promise<ReconstructionResult> {
  const kbRoot = deps.kbRoot ?? DEFAULT_KB_ROOT;
  const today = deps.clock.now().slice(0, 10);
  const reviewBy = addDays(today, 30);
  const used = new Set<string>();

  const overrides = indexVerificationOverrides(input.verification);
  const { components, componentIdByStatement, moduleOwner } = deriveComponents(
    input.cartography.findings,
    input.dependencyGraph,
  );

  const allocator = new IdAllocator({ paths: deps.paths, clock: deps.clock });
  // Kept as two separate arrays, never merged into one shared list: a fresh critic round found an
  // earlier draft handed the *same* `diagramIds` array -- which by then already included the
  // `schema-introspect-to-er` diagram -- to every `architecture/` entry, including three about a
  // single component and one about layering that the ER diagram does not depict at all. `diagrams`
  // on a KB entry is a claim that the named diagram actually depicts this fact (`08` §8.11.5's own
  // `depicts`/`explains` linkage); attaching an unrelated diagram is exactly the "confident
  // fabrication" `17` §17.1 names as this whole workflow's core risk, so `architectureDiagramIds`
  // and `dataDiagramIds` are tracked separately and each is handed only to its own section's entries.
  const architectureDiagramIds: string[] = [];
  const dataDiagramIds: string[] = [];

  if (components.length > 0) {
    const c4Input = toComponentsToC4Input(components);
    const diagram = componentsToC4(c4Input);
    const written = await writeDiagram(deps.paths, kbRoot, allocator, deps.clock, {
      section: 'architecture',
      slug: 'containers',
      title: 'Container decomposition (reconstructed)',
      generator: 'components-to-c4',
      diagram,
      caption: `Container-level decomposition reconstructed from ${String(components.length)} component(s) CARTOGRAPHY identified, with ${String(c4Input.components.reduce((n, c) => n + c.dependsOn.length, 0))} cross-component dependency edge(s) derived from real static import analysis.`,
      altText: `Components: ${components.map((c) => c.label).join('; ')}.`,
    });
    architectureDiagramIds.push(written.id);
  }

  if (input.dependencyGraph.nodes.length > 0) {
    const depsInput = toDepsToGraphInput(input.dependencyGraph);
    const diagram = depsToGraph(depsInput);
    const written = await writeDiagram(deps.paths, kbRoot, allocator, deps.clock, {
      section: 'architecture',
      slug: 'deps-graph',
      title: 'Module dependency graph (reconstructed)',
      generator: 'deps-to-graph',
      diagram,
      caption: `Module-level import graph reconstructed from real static analysis over ${String(depsInput.modules.length)} module(s) (\`17\` §17.2 phase 2, INVENTORY).`,
      altText: `Modules: ${depsInput.modules.map((m) => m.name).join('; ')}.`,
    });
    architectureDiagramIds.push(written.id);
  }

  const schemaErInput = toSchemaIntrospectToErInput(input.cartography.findings);
  if (schemaErInput.tables.length > 0) {
    const diagram = schemaIntrospectToEr(schemaErInput);
    const written = await writeDiagram(deps.paths, kbRoot, allocator, deps.clock, {
      section: 'data',
      slug: 'er-actual',
      title: 'Actual entity relationships (reconstructed)',
      generator: 'schema-introspect-to-er',
      diagram,
      caption: `Tables CARTOGRAPHY found real data-ownership evidence for (${String(schemaErInput.tables.length)} table(s)); columns and foreign keys are not yet extracted upstream, so this shows table names only.`,
      altText: `Tables: ${schemaErInput.tables.map((t) => t.name).join('; ')}.`,
    });
    dataDiagramIds.push(written.id);
  }

  const diagramIds: readonly string[] = [...architectureDiagramIds, ...dataDiagramIds];

  const kbEntryIds: string[] = [];
  if (components.length > 0) {
    const componentsFile: ComponentsFile = {
      type: 'Component',
      schemaVersion: 1,
      title: 'Component inventory (reconstructed)',
      status: 'active',
      created: today,
      updated: today,
      revision: 1,
      author: RECONSTRUCTION_OWNER,
      changelog: [
        {
          revision: 1,
          date: today,
          by: RECONSTRUCTION_OWNER,
          summary: 'Reconstructed during brownfield adoption CARTOGRAPHY/RECONSTRUCTION.',
        },
      ],
      components: [...components],
    };
    const parsed = componentsFileSchema.safeParse(componentsFile);
    if (!parsed.success) {
      throw new RangeError(
        `componentsFileSchema rejected the reconstructed component inventory: ${parsed.error.message}`,
      );
    }
    const target = deps.paths.resolveWithin(`${kbRoot}/architecture/components.md`);
    await writeFileAtomic(target, `---\n${stringifyFrontMatter(parsed.data)}---\n`);
  }

  const writer = new KbWriter({ paths: deps.paths, clock: deps.clock, kbRoot });

  const architecture = architectureEntries(
    input.cartography.findings,
    overrides,
    componentIdByStatement,
    architectureDiagramIds,
    today,
    reviewBy,
    used,
  );
  for (const entry of architecture) {
    kbEntryIds.push(await writeKbEntryIdempotent(writer, deps.paths, kbRoot, entry));
  }

  const data = dataEntries(
    input.cartography.findings,
    overrides,
    dataDiagramIds,
    today,
    reviewBy,
    used,
  );
  for (const entry of data) {
    kbEntryIds.push(await writeKbEntryIdempotent(writer, deps.paths, kbRoot, entry));
  }

  const delivery = deliveryEntries(input.verification, today, reviewBy, used);
  for (const entry of delivery) {
    kbEntryIds.push(await writeKbEntryIdempotent(writer, deps.paths, kbRoot, entry));
  }

  const standards = engineeringStandardsEntry(
    input.inference.findings,
    overrides,
    today,
    reviewBy,
    used,
  );
  if (standards !== undefined) {
    kbEntryIds.push(await writeKbEntryIdempotent(writer, deps.paths, kbRoot, standards));
  }

  const product = productEntries(input.inference.findings, today, reviewBy, used);
  for (const entry of product) {
    kbEntryIds.push(
      await writeKbEntryIdempotent(writer, deps.paths, kbRoot, entry, { confidenceCeiling: 'low' }),
    );
  }

  const adrCandidates = deriveRetroactiveAdrCandidates(input.cartography.findings, moduleOwner);
  const adrIds: string[] = [];
  for (const candidate of adrCandidates) {
    const existingAdrId = await findExistingRetroactiveAdrId(
      deps.paths,
      kbRoot,
      candidate.statement,
    );
    if (existingAdrId !== undefined) {
      adrIds.push(existingAdrId);
      continue;
    }
    const id = await allocator.allocate('ADR');
    const pathResult = renderArtifactPath('ADR', { id, slug: slugify(candidate.title) });
    if (!pathResult.success) {
      throw new RangeError(
        `renderArtifactPath('ADR', ...) failed: missing ${pathResult.missingVariable}`,
      );
    }
    // `renderArtifactPath('ADR', ...)`'s own path template hardcodes a literal `kb/` root
    // (`packages/schemas/src/registry/artifact-types.ts`) — the same fixed spelling `forge adr new`
    // (`@forge/cli/commands/adr.ts`) strips before substituting its own configured `kbRoot`. This
    // does the identical substitution, since `writeReconstruction`'s own `kbRoot` is configurable
    // (default `docs/forge/kb`, not `kb`) and this file's ADR candidate must land under it, not under
    // a literal `kb/decisions/` that may not even be this project's real KB root.
    const relativePath = pathResult.path.replace(/^kb\//, '');
    const built = retroactiveAdrCandidate(candidate, id, relativePath, today);
    const target = deps.paths.resolveWithin(`${kbRoot}/${built.path}`);
    await writeFileAtomic(target, built.text);
    adrIds.push(id);
  }

  return {
    componentIds: components.map((c) => c.id),
    diagramIds,
    kbEntryIds,
    adrIds,
  };
}
