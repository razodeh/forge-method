/**
 * `listArtifactFiles`, `countIdsFromFiles`, `scanProject`.
 *
 * @see specs/18 §18.8
 * @see PLAN-M1.md P13
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { ProjectPaths } from '../../src/fs/paths.ts';
import { countIdsFromFiles, listArtifactFiles, scanProject } from '../../src/ids/scan.ts';
import { DEFAULT_ID_REGISTRY, type IdRegistry } from '../../src/ids/registry.ts';

let projectRoot: string | undefined;

function freshProject(): ProjectPaths {
  const root = mkdtempSync(path.join(tmpdir(), 'forge-ids-scan-'));
  projectRoot = root;
  return new ProjectPaths(root);
}

function write(root: string, relative: string, content: string): void {
  const absolute = path.join(root, relative);
  mkdirSync(path.dirname(absolute), { recursive: true });
  writeFileSync(absolute, content);
}

afterEach(() => {
  if (projectRoot !== undefined) rmSync(projectRoot, { recursive: true, force: true });
  projectRoot = undefined;
});

function story(id: string): string {
  return `---\nid: ${id}\ntype: Story\ntitle: X\n---\nbody\n`;
}

describe('listArtifactFiles', () => {
  it('finds every .md file, sorted, recursively', async () => {
    const paths = freshProject();
    const root = paths.resolveWithin('.');
    write(root, 'specs/stories/STORY-002-b.md', story('STORY-002'));
    write(root, 'specs/stories/STORY-001-a.md', story('STORY-001'));
    write(root, 'README.md', '# not an artifact\n');
    expect(await listArtifactFiles(paths)).toEqual([
      'README.md',
      'specs/stories/STORY-001-a.md',
      'specs/stories/STORY-002-b.md',
    ]);
  });

  it('never descends into .git, .forge or node_modules', async () => {
    const paths = freshProject();
    const root = paths.resolveWithin('.');
    write(root, '.git/config.md', story('STORY-999'));
    write(root, '.forge/state/ids.md', story('STORY-998'));
    write(root, 'node_modules/pkg/README.md', story('STORY-997'));
    write(root, 'specs/stories/STORY-001-a.md', story('STORY-001'));
    expect(await listArtifactFiles(paths)).toEqual(['specs/stories/STORY-001-a.md']);
  });

  it('ignores files that are not Markdown', async () => {
    const paths = freshProject();
    const root = paths.resolveWithin('.');
    write(root, 'specs/data.yaml', 'id: X\n');
    write(root, 'specs/stories/STORY-001-a.md', story('STORY-001'));
    expect(await listArtifactFiles(paths)).toEqual(['specs/stories/STORY-001-a.md']);
  });

  it('returns an empty array for a project with no Markdown at all', async () => {
    const paths = freshProject();
    expect(await listArtifactFiles(paths)).toEqual([]);
  });
});

describe('countIdsFromFiles', () => {
  it('counts the highest numeric id per type', async () => {
    const paths = freshProject();
    const root = paths.resolveWithin('.');
    write(root, 'a.md', story('STORY-001'));
    write(root, 'b.md', story('STORY-003'));
    write(root, 'c.md', story('STORY-002'));
    expect(await countIdsFromFiles(paths, ['a.md', 'b.md', 'c.md'])).toEqual({ Story: 3 });
  });

  it('tracks each type independently', async () => {
    const paths = freshProject();
    const root = paths.resolveWithin('.');
    write(root, 'a.md', story('STORY-005'));
    write(root, 'b.md', '---\nid: ADR-0002\ntype: ADR\ntitle: X\n---\nbody\n');
    expect(await countIdsFromFiles(paths, ['a.md', 'b.md'])).toEqual({ Story: 5, ADR: 2 });
  });

  it('skips a file that is not a parseable artifact document', async () => {
    const paths = freshProject();
    const root = paths.resolveWithin('.');
    write(root, 'a.md', '# just a heading, no front matter\n');
    write(root, 'b.md', story('STORY-001'));
    expect(await countIdsFromFiles(paths, ['a.md', 'b.md'])).toEqual({ Story: 1 });
  });

  it('skips a document whose type is not a registered artifact type', async () => {
    const paths = freshProject();
    const root = paths.resolveWithin('.');
    write(root, 'a.md', '---\nid: X-001\ntype: NotRegistered\n---\nbody\n');
    expect(await countIdsFromFiles(paths, ['a.md'])).toEqual({});
  });

  it("skips an id that does not match its type's registered prefix/width", async () => {
    const paths = freshProject();
    const root = paths.resolveWithin('.');
    // Wrong prefix for Story (should be STORY-###).
    write(root, 'a.md', '---\nid: WRONG-001\ntype: Story\ntitle: X\n---\nbody\n');
    expect(await countIdsFromFiles(paths, ['a.md'])).toEqual({});
  });

  it('still counts an id even when the rest of the document is schema-invalid', async () => {
    // "never reused" only needs the id claimed, not the whole document valid — see the module doc.
    const paths = freshProject();
    const root = paths.resolveWithin('.');
    write(root, 'a.md', '---\nid: STORY-001\ntype: Story\n---\nbody\n'); // missing required "title"
    expect(await countIdsFromFiles(paths, ['a.md'])).toEqual({ Story: 1 });
  });

  it('accepts a custom registry, overriding one type’s prefix/width', async () => {
    const paths = freshProject();
    const root = paths.resolveWithin('.');
    write(root, 'a.md', '---\nid: S-1\ntype: Story\ntitle: X\n---\nbody\n');
    const registry: IdRegistry = { ...DEFAULT_ID_REGISTRY, Story: { idPrefix: 'S', idWidth: 1 } };
    expect(await countIdsFromFiles(paths, ['a.md'], registry)).toEqual({ Story: 1 });
  });
});

describe('scanProject', () => {
  it('combines both phases into one result', async () => {
    const paths = freshProject();
    const root = paths.resolveWithin('.');
    write(root, 'specs/stories/STORY-001-a.md', story('STORY-001'));
    const result = await scanProject(paths);
    expect(result.scannedFiles).toEqual(['specs/stories/STORY-001-a.md']);
    expect(result.counters).toEqual({ Story: 1 });
  });
});
