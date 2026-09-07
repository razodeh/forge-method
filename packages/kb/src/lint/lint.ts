/**
 * `lintKb` — `08` §8.7's own rule table, the checks this package owns (`SPEC-QUESTIONS.md` Q44/Q56).
 * Synchronous, no filesystem access, no `KbIndexBackend` — every check is a pure function of an
 * already-parsed `KbTree` plus the small amount of caller-supplied data (`specArtifacts`, `level`,
 * `now`) nothing in `KbTree` itself carries.
 *
 * @see specs/08 §8.7
 * @see SPEC-QUESTIONS.md Q44
 * @see SPEC-QUESTIONS.md Q56
 * @see PLAN-M3.md P10
 */
import type { ADR, Capability, Diagram, Epic, Runbook } from '@forge/schemas';

import type { Component } from '../schema/components-file.ts';
import type { KbEntry } from '../schema/kb-entry.ts';
import type { KbParsedEntry, KbTree } from '../schema/tree.ts';
import { checkContradictions } from './contradictions.ts';
import { adrsOf, componentsFileOf, diagramsOf, kbEntriesOf, runbooksOf } from './extract.ts';
import { owningAdrIds } from './kb-links.ts';
import { sortFindings, type KbFinding } from './types.ts';

export interface LintKbSpecArtifacts {
  readonly capabilities: readonly Capability[];
  readonly epics: readonly Epic[];
}

// An id whose own shape claims to reference something inside this KB tree — `related`/`supersedes`
// can just as legitimately name an out-of-tree id (an NFR, a Story) this package has no visibility
// into at all (SPEC-QUESTIONS.md Q56 point 6's own reasoning, applied here to the id-kind space
// instead of the tag space): only an id shaped like one of these four is ever checked for existence,
// so a real external reference is never misreported as "dangling".
const KB_TREE_ID_PATTERN = /^(KB-[A-Z]+-\d{4}(-\d+)?|ADR-\d{3,4}(-\d+)?|RUN-\d{3,4}(-\d+)?|DIAG-\d{3,4}(-\d+)?)$/;

// ---- "Front matter valid against schema" -------------------------------------------------------

function checkSchemaValidity(tree: KbTree): readonly KbFinding[] {
  return tree.errors.map((error) => ({
    ruleId: 'kb:schema',
    severity: 'error',
    message: `${error.path}: ${error.message}`,
  }));
}

// ---- "Referenced IDs exist" (related, supersedes; not applies_to — Q56 point 6) -----------------

function checkDanglingRefs(
  kbEntries: readonly KbEntry[],
  adrs: readonly ADR[],
  diagrams: readonly Diagram[],
  runbooks: readonly Runbook[],
): readonly KbFinding[] {
  // `related`/`supersedes` are generic id lists, not restricted to kb-entry/ADR ids — a real fixture
  // entry can (and does) name a runbook or a diagram there, so every kind this tree can produce an id
  // for belongs in the known-id universe, even though only kb-entries/ADRs have these two fields.
  const knownIds = new Set<string>([
    ...kbEntries.map((e) => e.id),
    ...adrs.map((a) => a.id),
    ...diagrams.map((d) => d.id),
    ...runbooks.map((r) => r.id),
  ]);
  const findings: KbFinding[] = [];

  function checkIds(ownerId: string, field: string, ids: readonly string[]): void {
    // Deduplicated: a gauntlet critic found a repeated id in the same field (a copy-paste, most
    // plausibly) produced one byte-identical finding per repetition rather than one finding for the
    // one real problem.
    for (const id of new Set(ids)) {
      if (!KB_TREE_ID_PATTERN.test(id)) continue;
      if (knownIds.has(id)) continue;
      findings.push({
        ruleId: 'kb:dangling-ref',
        severity: 'error',
        message: `${ownerId}'s own ${field} names ${JSON.stringify(id)}, which does not exist in this KB tree.`,
        entryId: ownerId,
      });
    }
  }

  for (const entry of kbEntries) {
    checkIds(entry.id, 'related', entry.related);
    checkIds(entry.id, 'supersedes', entry.supersedes);
    if (entry.superseded_by !== null) checkIds(entry.id, 'superseded_by', [entry.superseded_by]);
    // A verify pass found `sources[].ref` (kind: 'decision') was never checked here, even though
    // `adrScope`/`inboundLinkedIds` both already treat it as a genuine reference relationship — a
    // typo'd or since-deleted ADR id in `sources` silently failed to establish that entry's own
    // component coverage, with no diagnostic pointing at the actual broken citation, only a
    // downstream "no owning ADR" finding that gave no hint why.
    checkIds(
      entry.id,
      'sources',
      entry.sources.filter((source) => source.kind === 'decision').map((source) => source.ref),
    );
  }
  for (const adr of adrs) {
    checkIds(adr.id, 'related', adr.related);
    checkIds(adr.id, 'supersedes', adr.supersedes);
    if (adr.superseded_by !== null) checkIds(adr.id, 'superseded_by', [adr.superseded_by]);
  }

  return findings;
}

// ---- "No dangling supersession chains; no cycles" ------------------------------------------------

/** A supersession cycle (A supersedes B supersedes ... supersedes A), over `supersedes` edges among
 * KB entries and ADRs combined — a genuinely cross-kind cycle (a KB entry supersedes an ADR that
 * supersedes it back) is exactly as real a cycle as a same-kind one. */
function checkSupersessionCycles(kbEntries: readonly KbEntry[], adrs: readonly ADR[]): readonly KbFinding[] {
  const edges = new Map<string, readonly string[]>();
  for (const entry of kbEntries) edges.set(entry.id, entry.supersedes);
  for (const adr of adrs) edges.set(adr.id, adr.supersedes);

  const findings: KbFinding[] = [];
  const reportedCycleMembers = new Set<string>();

  // `walk` takes its own outgoing-edge list as a parameter rather than looking it up via
  // `edges.get(currentId)` itself — every call site already has it in hand (the initial call from
  // `edges.entries()` below; the recursive one right after the `edges.get(nextId)` dangling check),
  // so `edges.get`'s own `readonly string[] | undefined` return type never needs a `?? []` fallback
  // that nothing could actually reach.
  function findCycleFrom(startId: string, startOutgoing: readonly string[]): readonly string[] | undefined {
    const stack: string[] = [startId];
    const onStack = new Set<string>([startId]);

    function walk(outgoing: readonly string[]): readonly string[] | undefined {
      for (const nextId of outgoing) {
        if (nextId === startId) return [...stack, nextId];
        if (onStack.has(nextId)) continue; // a different cycle, reported from its own start
        const nextOutgoing = edges.get(nextId);
        if (nextOutgoing === undefined) continue; // dangling — checkDanglingRefs' own job
        stack.push(nextId);
        onStack.add(nextId);
        const found = walk(nextOutgoing);
        if (found !== undefined) return found;
        stack.pop();
        onStack.delete(nextId);
      }
      return undefined;
    }

    return walk(startOutgoing);
  }

  for (const [id, outgoing] of edges) {
    if (reportedCycleMembers.has(id)) continue;
    const cycle = findCycleFrom(id, outgoing);
    if (cycle === undefined) continue;
    for (const member of cycle) reportedCycleMembers.add(member);
    findings.push({
      ruleId: 'kb:supersession-cycle',
      severity: 'error',
      message: `Supersession cycle: ${cycle.join(' supersedes ')}.`,
      entryId: id,
    });
  }

  return findings;
}

// ---- "ADR coverage: every component in components.md has ≥1 owning ADR" -------------------------

function checkComponentCoverage(
  components: readonly Component[],
  kbEntries: readonly KbEntry[],
  adrs: readonly ADR[],
): readonly KbFinding[] {
  return components
    .filter((component) => owningAdrIds(component.id, kbEntries, adrs).length === 0)
    .map((component) => ({
      ruleId: 'kb:component-coverage',
      severity: 'error',
      message: `Component ${JSON.stringify(component.id)} has no owning ADR (no KB entry both applies_to it and cites a decision).`,
      entryId: component.id,
    }));
}

// ---- "Referenced IDs exist", extended to component.md's own closed component: namespace ---------

/** A gauntlet critic found `component.dependsOn` — unlike `related`/`supersedes`, which name ids
 * outside this package's own visibility (`KB_TREE_ID_PATTERN`'s whole reason for existing) —
 * references only ever the *same* self-contained register `components.md` itself defines, so unlike
 * `applies_to`'s wider tag space (`SPEC-QUESTIONS.md` Q56 point 6, no `datastore:`/`entity:`/`actor:`
 * registry exists), there is no ambiguity here: a `dependsOn` id that is not itself a real component in
 * the same file is simply wrong. The same reasoning extends to a KB entry's own `applies_to`, but only
 * for the `component:`-prefixed tags specifically — every other tag in that same array (a `datastore:`,
 * an `entity:`, a bare label) is still left unchecked, for the identical Q56 point 6 reason. Both are
 * skipped entirely (not "everything is dangling") when no `components.md` exists in this tree at all —
 * with no registry to check against, this function has no basis to call any `component:` id wrong. */
function checkComponentReferences(
  components: readonly Component[],
  kbEntries: readonly KbEntry[],
): readonly KbFinding[] {
  if (components.length === 0) return [];
  const knownComponentIds = new Set(components.map((component) => component.id));
  const findings: KbFinding[] = [];

  for (const component of components) {
    for (const dependsOnId of component.dependsOn) {
      if (knownComponentIds.has(dependsOnId)) continue;
      findings.push({
        ruleId: 'kb:dangling-ref',
        severity: 'error',
        message: `Component ${JSON.stringify(component.id)}'s own dependsOn names ${JSON.stringify(dependsOnId)}, which is not a registered component.`,
        entryId: component.id,
      });
    }
  }

  for (const entry of kbEntries) {
    for (const tag of entry.applies_to) {
      if (!tag.startsWith('component:')) continue;
      if (knownComponentIds.has(tag)) continue;
      findings.push({
        ruleId: 'kb:dangling-ref',
        severity: 'error',
        message: `${entry.id}'s own applies_to names ${JSON.stringify(tag)}, which is not a registered component.`,
        entryId: entry.id,
      });
    }
  }

  return findings;
}

// ---- diagram:required (narrowed — SPEC-QUESTIONS.md Q56 point 8) --------------------------------

const REQUIRED_DIAGRAM_SOURCES: readonly { readonly purpose: string; readonly source: string }[] = [
  { purpose: 'System context', source: 'architecture/views/context.mmd' },
  { purpose: 'Container / deployable decomposition', source: 'architecture/views/containers.mmd' },
];

function levelAtLeast(level: string, minimum: string): boolean {
  const levelNumber = Number(level.replace(/^L/, ''));
  const minimumNumber = Number(minimum.replace(/^L/, ''));
  if (Number.isNaN(levelNumber) || Number.isNaN(minimumNumber)) return false;
  return levelNumber >= minimumNumber;
}

function checkDiagramRequired(diagrams: readonly Diagram[], level: string): readonly KbFinding[] {
  if (!levelAtLeast(level, 'L2')) return [];
  const sources = new Set(diagrams.map((diagram) => diagram.source));

  return REQUIRED_DIAGRAM_SOURCES.filter((required) => !sources.has(required.source)).map(
    (required) => ({
      ruleId: 'diagram:required',
      severity: 'error',
      message: `${required.purpose} diagram is required at level ${level} (G-Design) but no diagram sources from ${JSON.stringify(required.source)}.`,
    }),
  );
}

// ---- diagram:adr-coverage ------------------------------------------------------------------------

function checkDiagramAdrCoverage(adrs: readonly ADR[]): readonly KbFinding[] {
  return adrs
    .filter((adr) => adr.category === 'architecture' && adr.diagrams.length === 0)
    .map((adr) => ({
      ruleId: 'diagram:adr-coverage',
      severity: 'error',
      message: `Structural ADR ${adr.id} (category: architecture) contains or references no diagram.`,
      entryId: adr.id,
    }));
}

// ---- "Every CAP-### has ≥1 downstream epic (or is explicitly deferred: priority: wont)" ---------

function checkCapCoverage(capabilities: readonly Capability[], epics: readonly Epic[]): readonly KbFinding[] {
  return capabilities
    .filter((cap) => cap.priority !== 'wont')
    .filter((cap) => !epics.some((epic) => epic.capability === cap.id))
    .map((cap) => ({
      ruleId: 'kb:cap-coverage',
      severity: 'warn',
      message: `${cap.id} has no downstream epic and is not marked priority: wont.`,
      entryId: cap.id,
    }));
}

// ---- "Staleness: review_by in the past" (kb-entry only — the only kind with a required review_by) --

function checkStaleness(kbEntries: readonly KbEntry[], now: Date): readonly KbFinding[] {
  return kbEntries
    .filter((entry) => new Date(entry.review_by).getTime() < now.getTime())
    .map((entry) => ({
      ruleId: 'kb:staleness',
      severity: 'warn',
      message: `${entry.id} passed its review date of ${entry.review_by}.`,
      entryId: entry.id,
    }));
}

// ---- "confidence: low entries used as inputs to accepted ADRs" ----------------------------------

function checkLowConfidenceInputs(adrs: readonly ADR[], kbEntries: readonly KbEntry[]): readonly KbFinding[] {
  const kbEntryById = new Map(kbEntries.map((entry) => [entry.id, entry]));
  const findings: KbFinding[] = [];

  for (const adr of adrs) {
    if (adr.status !== 'accepted') continue;
    for (const id of adr.related) {
      const entry = kbEntryById.get(id);
      if (entry?.confidence !== 'low') continue;
      findings.push({
        ruleId: 'kb:low-confidence-input',
        severity: 'warn',
        message: `Accepted ADR ${adr.id} draws on ${entry.id}, whose confidence is "low".`,
        entryId: adr.id,
      });
    }
  }

  return findings;
}

// ---- "Orphan entries: no inbound links and not in a root section" -------------------------------

/** Every id referenced by any entry's own `related`/`supersedes`/`diagrams` field, plus (for a KB
 * entry) every `sources[].ref` that names a real tree id — the KB-entry-as-bridge mechanism (Q56
 * points 2–3) makes `sources` a genuine reference relationship, the same way `related` is one. Also
 * includes a `Diagram`'s own `depicts`/`explains` — a gauntlet critic found a diagram that legitimately
 * `explains` (or `depicts`) a real KB entry or ADR id did not count as linking to it, so that entry
 * still showed up as an orphan despite a genuine, real inbound reference existing. */
function inboundLinkedIds(
  kbEntries: readonly KbEntry[],
  adrs: readonly ADR[],
  diagrams: readonly Diagram[],
): ReadonlySet<string> {
  const referenced = new Set<string>();
  for (const entry of kbEntries) {
    for (const id of [...entry.related, ...entry.supersedes, ...entry.diagrams]) referenced.add(id);
    for (const source of entry.sources) {
      if (source.kind === 'decision') referenced.add(source.ref);
    }
  }
  for (const adr of adrs) {
    for (const id of [...adr.related, ...adr.supersedes, ...adr.diagrams]) referenced.add(id);
  }
  for (const diagram of diagrams) {
    for (const id of [...diagram.depicts, ...diagram.explains]) referenced.add(id);
  }
  return referenced;
}

function isRootPath(path: string): boolean {
  return !path.includes('/');
}

function checkOrphans(
  tree: KbTree,
  kbEntries: readonly KbEntry[],
  adrs: readonly ADR[],
  diagrams: readonly Diagram[],
): readonly KbFinding[] {
  const linked = inboundLinkedIds(kbEntries, adrs, diagrams);
  const findings: KbFinding[] = [];

  for (const entry of tree.entries) {
    if (entry.kind !== 'kb-entry' && entry.kind !== 'adr' && entry.kind !== 'diagram' && entry.kind !== 'runbook') {
      continue;
    }
    if (isRootPath(entry.path)) continue;
    if (linked.has(entry.value.id)) continue;
    findings.push({
      ruleId: 'kb:orphan',
      severity: 'warn',
      message: `${entry.value.id} (${entry.path}) has no inbound link from any other entry and is not in a root section.`,
      entryId: entry.value.id,
    });
  }

  return findings;
}

// ---- "Glossary drift" (narrowed — SPEC-QUESTIONS.md Q56 point 7) --------------------------------

const GLOSSARY_TERM_PATTERN = /\*\*([^*]+)\*\*/g;
const BACKTICK_TERM_PATTERN = /`([^`]+)`/g;

function glossaryTerms(tree: KbTree): ReadonlySet<string> {
  const glossary = tree.entries.find(
    (entry): entry is Extract<KbParsedEntry, { kind: 'kb-entry' }> =>
      entry.kind === 'kb-entry' && entry.path === 'glossary.md',
  );
  const terms = new Set<string>();
  if (glossary === undefined) return terms;
  for (const match of glossary.value.body.matchAll(GLOSSARY_TERM_PATTERN)) {
    const term = match[1];
    if (term !== undefined) terms.add(term.trim().toLowerCase());
  }
  return terms;
}

function backtickTerms(text: string): readonly string[] {
  return [...text.matchAll(BACKTICK_TERM_PATTERN)].flatMap((match) => (match[1] !== undefined ? [match[1]] : []));
}

function checkGlossaryDrift(tree: KbTree, specArtifacts: LintKbSpecArtifacts): readonly KbFinding[] {
  const known = glossaryTerms(tree);
  const findings: KbFinding[] = [];

  function checkText(ownerId: string, text: string): void {
    for (const term of backtickTerms(text)) {
      if (known.has(term.trim().toLowerCase())) continue;
      findings.push({
        ruleId: 'kb:glossary-drift',
        severity: 'warn',
        message: `${ownerId} uses the term ${JSON.stringify(term)}, which is not defined in glossary.md.`,
        entryId: ownerId,
      });
    }
  }

  for (const cap of specArtifacts.capabilities) {
    checkText(cap.id, cap.statement);
    checkText(cap.id, cap.acceptance_summary);
  }
  for (const epic of specArtifacts.epics) {
    checkText(epic.id, epic.goal);
  }

  return findings;
}

export function lintKb(
  tree: KbTree,
  specArtifacts: LintKbSpecArtifacts,
  level: string,
  now: Date,
): readonly KbFinding[] {
  const kbEntries = kbEntriesOf(tree);
  const adrs = adrsOf(tree);
  const diagrams = diagramsOf(tree);
  const runbooks = runbooksOf(tree);
  const componentsFile = componentsFileOf(tree);
  const components = componentsFile?.components ?? [];

  return sortFindings([
    ...checkSchemaValidity(tree),
    ...checkDanglingRefs(kbEntries, adrs, diagrams, runbooks),
    ...checkSupersessionCycles(kbEntries, adrs),
    ...checkContradictions(kbEntries, adrs),
    ...checkComponentCoverage(components, kbEntries, adrs),
    ...checkComponentReferences(components, kbEntries),
    ...checkDiagramRequired(diagrams, level),
    ...checkDiagramAdrCoverage(adrs),
    ...checkCapCoverage(specArtifacts.capabilities, specArtifacts.epics),
    ...checkStaleness(kbEntries, now),
    ...checkLowConfidenceInputs(adrs, kbEntries),
    ...checkOrphans(tree, kbEntries, adrs, diagrams),
    ...checkGlossaryDrift(tree, specArtifacts),
  ]);
}
