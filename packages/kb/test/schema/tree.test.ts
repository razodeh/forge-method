/**
 * `parseKbTree` — `08` §8.2's whole-tree parse/validate entry point, checked against a real minimal
 * KB tree (`fixtures/greenfield-service`) and a handful of synthetic trees for specific failure modes.
 *
 * @see specs/08 §8.2
 * @see PLAN-M3.md P6
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { ProjectPaths } from '@forge/core/fs';
import { afterEach, describe, expect, it } from 'vitest';

import { parseKbTree } from '../../src/schema/tree.ts';

const FIXTURE_ROOT = path.resolve(import.meta.dirname, '../../../../fixtures/greenfield-service');

let scratchRoot: string | undefined;

function freshProject(): ProjectPaths {
  const root = mkdtempSync(path.join(tmpdir(), 'forge-kb-tree-'));
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

describe('parseKbTree — fixtures/greenfield-service', () => {
  it('parses the whole minimal tree with zero KbParseErrors', async () => {
    const paths = new ProjectPaths(FIXTURE_ROOT);
    const tree = await parseKbTree(paths);
    expect(tree.errors).toEqual([]);
  });

  it('parses the ADR file via the existing adrSchema, proving no shadow re-implementation', async () => {
    const paths = new ProjectPaths(FIXTURE_ROOT);
    const tree = await parseKbTree(paths);
    const adr = tree.entries.find((entry) => entry.kind === 'adr');
    expect(adr).toBeDefined();
    if (adr?.kind === 'adr') expect(adr.value.id).toBe('ADR-0001');
  });

  it('parses the diagram sidecar via the existing diagramSchema', async () => {
    const paths = new ProjectPaths(FIXTURE_ROOT);
    const tree = await parseKbTree(paths);
    const diagram = tree.entries.find((entry) => entry.kind === 'diagram');
    expect(diagram).toBeDefined();
    if (diagram?.kind === 'diagram') expect(diagram.value.id).toBe('DIAG-001');
  });

  it('parses an ops/runbooks/RUN-###-*.md file via the existing runbookSchema', async () => {
    const paths = new ProjectPaths(FIXTURE_ROOT);
    const tree = await parseKbTree(paths);
    const runbook = tree.entries.find((entry) => entry.kind === 'runbook');
    expect(runbook).toBeDefined();
    if (runbook?.kind === 'runbook') expect(runbook.value.id).toBe('RUN-001');
  });

  it('parses all four collection files, each with more than one entry', async () => {
    const paths = new ProjectPaths(FIXTURE_ROOT);
    const tree = await parseKbTree(paths);
    const risks = tree.entries.find((entry) => entry.kind === 'risks-file');
    const assumptions = tree.entries.find((entry) => entry.kind === 'assumptions-file');
    const openQuestions = tree.entries.find((entry) => entry.kind === 'open-questions-file');
    const environments = tree.entries.find((entry) => entry.kind === 'environments-file');
    expect(risks?.kind === 'risks-file' && risks.value.risks.length).toBe(2);
    expect(assumptions?.kind === 'assumptions-file' && assumptions.value.assumptions.length).toBe(2);
    expect(
      openQuestions?.kind === 'open-questions-file' && openQuestions.value.open_questions.length,
    ).toBe(2);
    expect(environments?.kind === 'environments-file' && environments.value.environments.length).toBe(
      2,
    );
  });

  it('parses the generic knowledge entry and the glossary entry via kbEntrySchema', async () => {
    const paths = new ProjectPaths(FIXTURE_ROOT);
    const tree = await parseKbTree(paths);
    const kbEntries = tree.entries.filter((entry) => entry.kind === 'kb-entry');
    expect(kbEntries.map((entry) => entry.path).sort()).toEqual([
      'architecture/architecture-spec.md',
      'glossary.md',
    ]);
  });

  it('never attempts to parse a generated index.md, at the KB root or under decisions/', async () => {
    const paths = new ProjectPaths(FIXTURE_ROOT);
    const tree = await parseKbTree(paths);
    const paths_ = [...tree.entries.map((entry) => entry.path), ...tree.errors.map((e) => e.path)];
    expect(paths_).not.toContain('index.md');
    expect(paths_).not.toContain('decisions/index.md');
  });
});

describe('parseKbTree — section/directory mismatch', () => {
  it('reports a KbParseError for an entry whose section does not match its own directory', async () => {
    const paths = freshProject();
    const root = paths.resolveWithin('.');
    write(
      root,
      'docs/forge/kb/architecture/misfiled.md',
      [
        '---',
        'id: KB-DATA-0001',
        'type: knowledge',
        'section: data',
        'title: Misfiled entry',
        'status: active',
        'confidence: low',
        'owner: architect',
        'sources:',
        '  - kind: human',
        '    ref: "elicitation"',
        'created: 2026-01-05',
        'updated: 2026-01-05',
        'review_by: 2026-04-05',
        'supersedes: []',
        'superseded_by: null',
        'related: []',
        'diagrams: []',
        'tags: []',
        'applies_to: []',
        '---',
        '',
        '## Statement',
        'This entry is filed under architecture/ but claims section: data.',
      ].join('\n'),
    );

    const tree = await parseKbTree(paths);
    expect(tree.entries).toEqual([]);
    expect(tree.errors).toHaveLength(1);
    expect(tree.errors[0]?.path).toBe('architecture/misfiled.md');
    expect(tree.errors[0]?.message).toMatch(/does not match this file's own directory/);
  });
});

describe('parseKbTree — one bad file does not hide the others', () => {
  it('collects a KbParseError for a malformed file and still returns every other file', async () => {
    const paths = freshProject();
    const root = paths.resolveWithin('.');
    write(root, 'docs/forge/kb/architecture/broken.md', 'not even front matter\n');
    write(
      root,
      'docs/forge/kb/architecture/good.md',
      [
        '---',
        'id: KB-ARCH-0001',
        'type: knowledge',
        'section: architecture',
        'title: A good entry',
        'status: active',
        'confidence: low',
        'owner: architect',
        'sources:',
        '  - kind: human',
        '    ref: "elicitation"',
        'created: 2026-01-05',
        'updated: 2026-01-05',
        'review_by: 2026-04-05',
        'supersedes: []',
        'superseded_by: null',
        'related: []',
        'diagrams: []',
        'tags: []',
        'applies_to: []',
        '---',
        '',
        '## Statement',
        'This one is fine.',
      ].join('\n'),
    );

    const tree = await parseKbTree(paths);
    expect(tree.errors).toHaveLength(1);
    expect(tree.errors[0]?.path).toBe('architecture/broken.md');
    expect(tree.entries).toHaveLength(1);
    expect(tree.entries[0]?.path).toBe('architecture/good.md');
  });
});

describe('parseKbTree — kbRoot is configurable', () => {
  it('walks a non-default kbRoot when one is given, per 08 §8.2 (configurable via paths.kb)', async () => {
    const paths = freshProject();
    const root = paths.resolveWithin('.');
    write(
      root,
      'somewhere-else/glossary.md',
      [
        '---',
        'id: KB-GLOSS-0001',
        'type: glossary',
        'section: glossary',
        'title: Terms',
        'status: active',
        'confidence: low',
        'owner: architect',
        'sources:',
        '  - kind: human',
        '    ref: "elicitation"',
        'created: 2026-01-05',
        'updated: 2026-01-05',
        'review_by: 2026-04-05',
        'supersedes: []',
        'superseded_by: null',
        'related: []',
        'diagrams: []',
        'tags: []',
        'applies_to: []',
        '---',
        '',
        '## Statement',
        'A term.',
      ].join('\n'),
    );

    const tree = await parseKbTree(paths, 'somewhere-else');
    expect(tree.errors).toEqual([]);
    expect(tree.entries).toHaveLength(1);
    expect(tree.entries[0]?.path).toBe('glossary.md');
  });
});

describe('parseKbTree — never throws, even when the KB root does not exist yet', () => {
  it('returns an empty result for a brand-new project with no docs/forge/kb at all', async () => {
    // A gauntlet critic found a first version of this function throwing RUN-034 here, breaking its
    // own documented "never throws" contract — the ordinary starting state of a brand-new project,
    // not a failure.
    const paths = freshProject();
    await expect(parseKbTree(paths)).resolves.toEqual({ entries: [], errors: [] });
  });

  it('returns an empty result for a configured kbRoot that does not exist', async () => {
    const paths = freshProject();
    await expect(parseKbTree(paths, 'somewhere-else')).resolves.toEqual({ entries: [], errors: [] });
  });

  it('reports a tree-level KbParseError, rather than throwing, when kbRoot is a file, not a directory', async () => {
    // A verify pass found `pathExists` alone doesn't distinguish "no KB yet" from "something is
    // sitting where the KB directory should be" — a plain file at docs/forge/kb still threw RUN-034.
    const paths = freshProject();
    const root = paths.resolveWithin('.');
    write(root, 'docs/forge/kb', 'not a directory\n');

    const tree = await parseKbTree(paths);
    expect(tree.entries).toEqual([]);
    expect(tree.errors).toHaveLength(1);
    expect(tree.errors[0]?.path).toBe('docs/forge/kb');
  });
});
