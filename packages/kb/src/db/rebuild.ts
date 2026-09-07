/**
 * `rebuildIndex` — clears and repopulates every table `08` §8.5 names, from an already-parsed
 * `KbTree` (P6) alone — "the only path callers should trust as ground truth," matching `18` §18.1's
 * own "rebuildable" invariant.
 *
 * Scope, all recorded in `SPEC-QUESTIONS.md` Q53: only `kb-entry`/`adr`/`diagram`/`runbook`-kind
 * parsed entries become `entries` rows — the four `collection: true` file kinds (`risks-file`,
 * `assumptions-file`, `open-questions-file`, `environments-file`) hold *many* ids each, not one, and
 * `KbParsedEntry`'s own shape for them has no per-sub-entry id to index against; `links.kind` only
 * ever produces `related`/`supersedes`/`applies_to` (never `derived_from`/`cites`, which have no
 * source in `KbTree`); `symbols`/`usage` are left empty (no source either). `hash` is computed from
 * each entry's own *parsed* value (`rebuildIndex` takes a `KbTree`, not a `ProjectPaths` — there is no
 * raw file text available to hash instead), so it is stable across two rebuilds of the same tree, not
 * a hash of the on-disk bytes.
 *
 * @see specs/08 §8.5
 * @see SPEC-QUESTIONS.md Q53
 * @see PLAN-M3.md P8
 */
import { createHash } from 'node:crypto';

import type { ADR, Diagram, Runbook } from '@forge/schemas';

import { readKbBodySection } from '../schema/body-sections.ts';
import type { KbEntry } from '../schema/kb-entry.ts';
import type { KbParsedEntry, KbTree } from '../schema/tree.ts';
import type { EntryRow, KbIndexBackend, LinkKind, LinkRow } from './types.ts';

function hashOf(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function linksOfKind(toIds: readonly string[], kind: LinkKind): readonly LinkRow[] {
  return toIds.map((toId) => ({ toId, kind }));
}

function indexKbEntry(path: string, value: KbEntry, backend: KbIndexBackend): void {
  const row: EntryRow = {
    id: value.id,
    type: value.type,
    section: value.section,
    title: value.title,
    path,
    status: value.status,
    confidence: value.confidence,
    updated: value.updated,
    hash: hashOf(value),
    statement: readKbBodySection(value.body, 'statement') ?? '',
    rationale: readKbBodySection(value.body, 'rationale') ?? '',
  };
  backend.upsertEntry(row);
  backend.upsertLinks(value.id, [
    ...linksOfKind(value.related, 'related'),
    ...linksOfKind(value.supersedes, 'supersedes'),
    ...linksOfKind(value.applies_to, 'applies_to'),
    ...linksOfKind(value.diagrams, 'related'),
  ]);
}

function indexAdr(path: string, value: ADR, backend: KbIndexBackend): void {
  const row: EntryRow = {
    id: value.id,
    type: value.type,
    section: '',
    title: value.title,
    path,
    status: value.status,
    confidence: '',
    updated: value.updated,
    hash: hashOf(value),
    statement: '',
    rationale: '',
  };
  backend.upsertEntry(row);
  backend.upsertLinks(value.id, [
    ...linksOfKind(value.related, 'related'),
    ...linksOfKind(value.supersedes, 'supersedes'),
    ...linksOfKind(value.diagrams, 'related'),
  ]);
}

function indexDiagram(path: string, value: Diagram, backend: KbIndexBackend): void {
  const row: EntryRow = {
    id: value.id,
    type: value.type,
    section: '',
    title: value.title,
    path,
    status: value.status,
    confidence: '',
    updated: value.updated,
    hash: hashOf(value),
    statement: '',
    rationale: '',
  };
  backend.upsertEntry(row);
  backend.upsertLinks(value.id, [
    ...linksOfKind(value.depicts, 'related'),
    ...linksOfKind(value.explains, 'related'),
  ]);
}

function indexRunbook(path: string, value: Runbook, backend: KbIndexBackend): void {
  const row: EntryRow = {
    id: value.id,
    type: value.type,
    section: '',
    title: value.title,
    path,
    status: value.status,
    confidence: '',
    updated: value.updated,
    hash: hashOf(value),
    statement: '',
    rationale: '',
  };
  backend.upsertEntry(row);
  // runbookSchema (M1) has no relational field of any kind — nothing to link.
  backend.upsertLinks(value.id, []);
}

function indexEntry(entry: KbParsedEntry, backend: KbIndexBackend): void {
  switch (entry.kind) {
    case 'kb-entry':
      indexKbEntry(entry.path, entry.value, backend);
      return;
    case 'adr':
      indexAdr(entry.path, entry.value, backend);
      return;
    case 'diagram':
      indexDiagram(entry.path, entry.value, backend);
      return;
    case 'runbook':
      indexRunbook(entry.path, entry.value, backend);
      return;
    case 'risks-file':
    case 'assumptions-file':
    case 'open-questions-file':
    case 'environments-file':
    case 'components-file':
      // Not indexed by this piece — see this file's own doc comment and SPEC-QUESTIONS.md Q53.
      // `components-file` (P10, SPEC-QUESTIONS.md Q56) joins the same group for the same reason: many
      // ids, not one, and `KbParsedEntry`'s own shape for it has no per-sub-entry id to index against.
      return;
  }
}

export function rebuildIndex(tree: KbTree, backend: KbIndexBackend): void {
  backend.clear();
  for (const entry of tree.entries) {
    indexEntry(entry, backend);
  }
}
