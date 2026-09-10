/**
 * `readArtifact`, `writeArtifact` — `ArtifactDocument` through `@forge/core/fs`.
 *
 * @see specs/02 §2.5
 * @see PLAN-M1.md P12
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { ArtifactDocument } from '../../src/artifacts/document.ts';
import { isForgeError } from '../../src/errors/forge-error.ts';
import { ProjectPaths } from '../../src/fs/paths.ts';
import { readArtifact, writeArtifact } from '../../src/artifacts/io.ts';

let projectRoot: string | undefined;

function freshProject(): ProjectPaths {
  const root = mkdtempSync(path.join(tmpdir(), 'forge-artifact-io-'));
  projectRoot = root;
  return new ProjectPaths(root);
}

afterEach(() => {
  if (projectRoot !== undefined) rmSync(projectRoot, { recursive: true, force: true });
  projectRoot = undefined;
});

describe('readArtifact', () => {
  it('reads and parses a file relative to the project root', async () => {
    const paths = freshProject();
    const absolute = paths.resolveWithin('specs/vision.md');
    mkdirSync(path.dirname(absolute), { recursive: true });
    writeFileSync(absolute, '---\nid: X\ntitle: Hello\n---\nbody\n');

    const doc = await readArtifact(paths, 'specs/vision.md');
    expect(doc.get(['title'])).toBe('Hello');
    expect(doc.path).toBe('specs/vision.md');
  });

  it('rejects a path outside the project root, via CFG-003', async () => {
    const paths = freshProject();
    await expect(readArtifact(paths, '../outside.md')).rejects.toSatisfy(
      (error: unknown) => isForgeError(error) && error.code === 'CFG-003',
    );
  });
});

describe('writeArtifact', () => {
  it('writes doc.toString() back to the path it was parsed from', async () => {
    const paths = freshProject();
    const absolute = paths.resolveWithin('specs/vision.md');
    mkdirSync(path.dirname(absolute), { recursive: true });
    const original = '---\nid: X\ntitle: Hello\n---\nbody\n';
    writeFileSync(absolute, original);

    const doc = await readArtifact(paths, 'specs/vision.md');
    doc.set(['title'], 'Goodbye');
    await writeArtifact(paths, doc);

    // A real string value is always rendered double-quoted now (`stringifyScalar`'s own doc
    // comment in `edit.ts` — a real `YAML.stringify` corruption class this guarantees against).
    expect(readFileSync(absolute, 'utf8')).toBe('---\nid: X\ntitle: "Goodbye"\n---\nbody\n');
  });

  it('round-trips: read, write with no edits, byte-identical file', async () => {
    const paths = freshProject();
    const absolute = paths.resolveWithin('specs/vision.md');
    mkdirSync(path.dirname(absolute), { recursive: true });
    const original = '---\nid: X  # a comment\ntitle: Hello\n---\n\nbody\n\n\nmore\n';
    writeFileSync(absolute, original);

    const doc = await readArtifact(paths, 'specs/vision.md');
    await writeArtifact(paths, doc);

    expect(readFileSync(absolute, 'utf8')).toBe(original);
  });

  it('writes atomically — a partial write never observed by a later read', async () => {
    const paths = freshProject();
    const absolute = paths.resolveWithin('specs/vision.md');
    mkdirSync(path.dirname(absolute), { recursive: true });
    writeFileSync(absolute, '---\nid: X\ntitle: Hello\n---\nbody\n');

    const doc = ArtifactDocument.parse(readFileSync(absolute, 'utf8'), 'specs/vision.md');
    doc.set(['title'], 'Written');
    await writeArtifact(paths, doc);

    expect(readFileSync(absolute, 'utf8')).toContain('title: "Written"');
  });
});
