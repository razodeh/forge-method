/**
 * `collectExternalKbIds` — `PLAN-M14.md` P30: the ids of every KB entry/ADR/Runbook whose own
 * `sources` carries `kind: 'external'` provenance, read from a real KB tree on disk (never a mocked
 * `parseKbTree`).
 *
 * @see specs/08 §8.3
 * @see specs/20 §20.5 point 3
 * @see PLAN-M14.md P30
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { ProjectPaths } from '@forge/core/fs';
import { afterEach, describe, expect, it } from 'vitest';

import { collectExternalKbIds } from '../../../src/commands/run/external-kb-ids.ts';

let scratchRoot: string | undefined;

function freshProject(): ProjectPaths {
  const root = mkdtempSync(path.join(tmpdir(), 'forge-external-kb-ids-'));
  scratchRoot = root;
  return new ProjectPaths(root);
}

function write(root: string, relative: string, content: string): void {
  const absolute = path.join(root, relative);
  mkdirSync(path.dirname(absolute), { recursive: true });
  writeFileSync(absolute, content);
}

afterEach(() => {
  if (scratchRoot !== undefined) rmSync(scratchRoot, { recursive: true, force: true });
  scratchRoot = undefined;
});

/** A real, schema-valid `kbEntrySchema` document (`08` §8.3's own worked example, minus the fields this
 * test varies) -- `sources` is the one field every case below overrides. `section` must match both the
 * id's own token (`sectionIdToken`) and the directory it is written under (`directoryImpliedSection`),
 * or the file fails to parse entirely -- a real, previously-caught mistake in this file's own first
 * draft (a hardcoded `architecture` section under a `data/` path silently produced a `KbParseError`,
 * not a test failure that pointed at the real cause). */
function kbEntryDoc(id: string, section: string, sourcesYaml: string): string {
  return `---
id: ${id}
type: knowledge
section: ${section}
title: A test entry
status: active
confidence: high
owner: architect
sources:
${sourcesYaml}
created: 2026-01-05
updated: 2026-01-05
review_by: 2026-04-05
supersedes: []
superseded_by: null
related: []
diagrams: []
tags: []
applies_to: []
---

## Statement
A test statement.
`;
}

describe('collectExternalKbIds', () => {
  it('collects a kb-entry whose sources include kind: external', async () => {
    const paths = freshProject();
    write(
      paths.resolveWithin('.'),
      'docs/forge/kb/architecture/KB-ARCH-0001.md',
      kbEntryDoc(
        'KB-ARCH-0001',
        'architecture',
        '  - kind: external\n    ref: mcp:confluence/get_page',
      ),
    );
    const ids = await collectExternalKbIds(paths, 'docs/forge/kb');
    expect(ids).toEqual(new Set(['KB-ARCH-0001']));
  });

  it('does not collect a kb-entry whose sources are all decision/human/code', async () => {
    const paths = freshProject();
    write(
      paths.resolveWithin('.'),
      'docs/forge/kb/architecture/KB-ARCH-0002.md',
      kbEntryDoc('KB-ARCH-0002', 'architecture', '  - kind: decision\n    ref: ADR-0011'),
    );
    const ids = await collectExternalKbIds(paths, 'docs/forge/kb');
    expect(ids).toEqual(new Set());
  });

  it('collects only the entries that actually carry an external source, among several', async () => {
    const paths = freshProject();
    write(
      paths.resolveWithin('.'),
      'docs/forge/kb/architecture/KB-ARCH-0001.md',
      kbEntryDoc(
        'KB-ARCH-0001',
        'architecture',
        '  - kind: external\n    ref: fetch:https://example.com/page',
      ),
    );
    write(
      paths.resolveWithin('.'),
      'docs/forge/kb/architecture/KB-ARCH-0002.md',
      kbEntryDoc('KB-ARCH-0002', 'architecture', '  - kind: human\n    ref: elicitation'),
    );
    write(
      paths.resolveWithin('.'),
      'docs/forge/kb/data/KB-DATA-0001.md',
      kbEntryDoc(
        'KB-DATA-0001',
        'data',
        '  - kind: human\n    ref: elicitation\n  - kind: external\n    ref: mcp:jira/search_issues',
      ),
    );
    const ids = await collectExternalKbIds(paths, 'docs/forge/kb');
    expect(ids).toEqual(new Set(['KB-ARCH-0001', 'KB-DATA-0001']));
  });

  it('returns an empty set for a project with no KB tree at all (never throws)', async () => {
    const paths = freshProject();
    await expect(collectExternalKbIds(paths, 'docs/forge/kb')).resolves.toEqual(new Set());
  });

  it("never throws for a malformed KB file: it is simply absent from the result (parseKbTree's own per-file contract)", async () => {
    const paths = freshProject();
    write(
      paths.resolveWithin('.'),
      'docs/forge/kb/architecture/KB-ARCH-0099.md',
      '---\nnot: valid front matter\n---\nbody\n',
    );
    write(
      paths.resolveWithin('.'),
      'docs/forge/kb/architecture/KB-ARCH-0001.md',
      kbEntryDoc(
        'KB-ARCH-0001',
        'architecture',
        '  - kind: external\n    ref: mcp:confluence/get_page',
      ),
    );
    const ids = await collectExternalKbIds(paths, 'docs/forge/kb');
    expect(ids).toEqual(new Set(['KB-ARCH-0001']));
  });
});
