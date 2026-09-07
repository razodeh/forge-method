/**
 * Minimal, schema-validated `KbEntry`/`ADR`/`Component` factories shared by every `@forge/kb/lint`
 * test — each one parses a real, overridable object through its own real schema (never a hand-cast),
 * so a mistake in a test's own fixture data fails loudly at the same `.parse()` every real caller goes
 * through, not silently at a later assertion.
 *
 * @see PLAN-M3.md P10
 */
import {
  adrSchema,
  capabilitySchema,
  diagramSchema,
  epicSchema,
  runbookSchema,
  type ADR,
  type Capability,
  type Diagram,
  type Epic,
  type Runbook,
} from '@forge/schemas';

import { componentSchema, componentsFileSchema, type Component, type ComponentsFile } from '../../src/schema/components-file.ts';
import { kbEntrySchema, type KbEntry } from '../../src/schema/kb-entry.ts';
import { sectionIdToken, type KbSection } from '../../src/schema/sections.ts';
import type { KbParsedEntry, KbTree } from '../../src/schema/tree.ts';

let kbEntrySequence = 0;
let adrSequence = 0;
let diagramSequence = 0;
let runbookSequence = 0;
let capabilitySequence = 0;
let epicSequence = 0;

export function kbEntry(overrides: Record<string, unknown> = {}): KbEntry {
  kbEntrySequence += 1;
  const section = (overrides['section'] as KbSection | undefined) ?? 'architecture';
  const base = {
    id: `KB-${sectionIdToken(section)}-${String(kbEntrySequence).padStart(4, '0')}`,
    type: 'knowledge',
    section,
    title: 'A test entry',
    status: 'active',
    confidence: 'high',
    owner: 'architect',
    sources: [{ kind: 'human', ref: 'elicitation' }],
    created: '2026-01-05',
    updated: '2026-01-05',
    review_by: '2026-04-05',
    supersedes: [],
    superseded_by: null,
    related: [],
    diagrams: [],
    tags: [],
    applies_to: [],
    body: '## Statement\nA test statement.',
  };
  return kbEntrySchema.parse({ ...base, ...overrides });
}

export function adr(overrides: Record<string, unknown> = {}): ADR {
  adrSequence += 1;
  const base = {
    id: `ADR-${String(adrSequence).padStart(4, '0')}`,
    type: 'ADR',
    schemaVersion: 1,
    title: 'A test decision',
    status: 'accepted',
    created: '2026-01-05',
    updated: '2026-01-05',
    revision: 1,
    author: 'architect',
    changelog: [],
    category: 'architecture',
    deciders: ['architect'],
    date: '2026-01-05',
    reversibility: 'medium',
    blast_radius: ['api'],
    revisit_trigger: 'never',
    supersedes: [],
    superseded_by: null,
    related: [],
    diagrams: [],
    framework: 'test',
  };
  return adrSchema.parse({ ...base, ...overrides });
}

export function component(overrides: Record<string, unknown> = {}): Component {
  const base = {
    id: 'component:api',
    label: 'API',
    responsibility: 'Serves requests.',
    owner: 'platform',
    dependsOn: [],
    failureModes: [],
  };
  return componentSchema.parse({ ...base, ...overrides });
}

export function componentsFile(components: readonly Component[]): ComponentsFile {
  return componentsFileSchema.parse({
    type: 'Component',
    schemaVersion: 1,
    title: 'Component inventory',
    status: 'active',
    created: '2026-01-05',
    updated: '2026-01-05',
    revision: 1,
    author: 'architect',
    changelog: [],
    components,
  });
}

export function diagram(overrides: Record<string, unknown> = {}): Diagram {
  diagramSequence += 1;
  const base = {
    id: `DIAG-${String(diagramSequence).padStart(3, '0')}`,
    type: 'Diagram',
    schemaVersion: 1,
    title: 'A test diagram',
    status: 'active',
    created: '2026-01-05',
    updated: '2026-01-05',
    revision: 1,
    author: 'architect',
    changelog: [],
    kind: 'flowchart',
    notation: 'mermaid',
    source: `architecture/views/test-${String(diagramSequence)}.mmd`,
    generated: false,
    depicts: [],
    explains: [],
    caption: 'A test diagram.',
    alt_text: 'A test diagram, described.',
    owner: 'architect',
  };
  return diagramSchema.parse({ ...base, ...overrides });
}

export function runbook(overrides: Record<string, unknown> = {}): Runbook {
  runbookSequence += 1;
  const base = {
    id: `RUN-${String(runbookSequence).padStart(3, '0')}`,
    type: 'Runbook',
    schemaVersion: 1,
    title: 'A test runbook',
    status: 'active',
    created: '2026-01-05',
    updated: '2026-01-05',
    revision: 1,
    author: 'platform',
    changelog: [],
    symptoms: 'Something is wrong.',
    immediate_mitigation: 'Restart it.',
    diagnosis_steps: ['Check the logs.'],
    escalation: 'Page the on-call.',
    post_incident_actions: ['Write a postmortem.'],
  };
  return runbookSchema.parse({ ...base, ...overrides });
}

export function capability(overrides: Record<string, unknown> = {}): Capability {
  capabilitySequence += 1;
  const base = {
    id: `CAP-${String(capabilitySequence).padStart(3, '0')}`,
    type: 'Capability',
    schemaVersion: 1,
    title: 'A test capability',
    status: 'active',
    created: '2026-01-05',
    updated: '2026-01-05',
    revision: 1,
    author: 'pm',
    changelog: [],
    statement: 'The system does a thing.',
    priority: 'must',
    stage: 'MVP',
    depends_on: [],
    nfrs: [],
    metrics: [],
    acceptance_summary: 'The thing works.',
    epics: [],
  };
  return capabilitySchema.parse({ ...base, ...overrides });
}

export function epic(overrides: Record<string, unknown> = {}): Epic {
  epicSequence += 1;
  const base = {
    id: `EPIC-${String(epicSequence).padStart(3, '0')}`,
    type: 'Epic',
    schemaVersion: 1,
    title: 'A test epic',
    status: 'active',
    created: '2026-01-05',
    updated: '2026-01-05',
    revision: 1,
    author: 'pm',
    changelog: [],
    capability: 'CAP-001',
    stage: 'MVP',
    goal: 'Ship the thing.',
    scope_in: [],
    scope_out: [],
    stories: [],
    interfaces: [],
    data: [],
    exit_criteria: [],
  };
  return epicSchema.parse({ ...base, ...overrides });
}

/** Wraps already-built values into a `KbTree` — `path` only matters for the "root section" orphan
 * exemption (no `/`) and is otherwise arbitrary in these unit tests. */
export function treeOf(
  entries: readonly (
    | { readonly kind: 'kb-entry'; readonly value: KbEntry; readonly path?: string }
    | { readonly kind: 'adr'; readonly value: ADR; readonly path?: string }
    | { readonly kind: 'diagram'; readonly value: Diagram; readonly path?: string }
    | { readonly kind: 'runbook'; readonly value: Runbook; readonly path?: string }
    | { readonly kind: 'components-file'; readonly value: ComponentsFile; readonly path?: string }
  )[],
): KbTree {
  const parsedEntries: KbParsedEntry[] = entries.map((entry) => {
    switch (entry.kind) {
      case 'kb-entry':
        return { path: entry.path ?? `${entry.kind}/${entry.value.id}.md`, kind: 'kb-entry', value: entry.value };
      case 'adr':
        return {
          path: entry.path ?? `${entry.kind}/${entry.value.id}.md`,
          kind: 'adr',
          value: entry.value,
          body: '## Context\nA test decision.',
        };
      case 'diagram':
        return { path: entry.path ?? `${entry.kind}/${entry.value.id}.md`, kind: 'diagram', value: entry.value };
      case 'runbook':
        return {
          path: entry.path ?? `${entry.kind}/${entry.value.id}.md`,
          kind: 'runbook',
          value: entry.value,
          body: '## Symptoms\nSomething is wrong.',
        };
      case 'components-file':
        return {
          path: entry.path ?? 'architecture/components.md',
          kind: 'components-file',
          value: entry.value,
        };
    }
  });
  return { entries: parsedEntries, errors: [] };
}
