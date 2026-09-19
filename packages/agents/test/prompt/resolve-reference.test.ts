/**
 * Brief/prompt reference resolution — `PLAN-M13.md` P1's "a reference resolves to real text, a missing
 * one is a real error" mandate, including the containment of an untrusted reference.
 *
 * @see specs/05 §5.3
 * @see specs/03 §3.3
 * @see PLAN-M13.md P1
 */
import { ProjectPaths, writeFileAtomic, type AbsolutePath } from '@forge/core';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  isWellFormedContentReference,
  listResolvableContentReferences,
  resolveContentReference,
} from '../../src/prompt/index.ts';

let scratchDirs: string[] = [];
afterEach(() => {
  for (const dir of scratchDirs) rmSync(dir, { recursive: true, force: true });
  scratchDirs = [];
});

function freshProjectRoot(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'forge-agents-resolve-reference-'));
  scratchDirs.push(dir);
  return dir;
}

const HTML_HEADER =
  '<!-- forge:generated v=0.0.0 hash=abc123 — edits will be overwritten; use overrides/ -->';
const YAML_HEADER =
  '# forge:generated v=0.0.0 hash=abc123 — edits will be overwritten; use overrides/';

describe('resolveContentReference', () => {
  it("reads a workflow step brief's real text -- not its path -- from .forge/briefs/", async () => {
    const paths = new ProjectPaths(freshProjectRoot());
    await writeFileAtomic(
      paths.resolveWithin('.forge/briefs/write-vision.md'),
      'Write a real Vision document stating the problem, the users, and the success metric.\n',
    );

    const text = await resolveContentReference(paths, 'briefs/write-vision.md');

    expect(text).toBe(
      'Write a real Vision document stating the problem, the users, and the success metric.\n',
    );
    expect(text).not.toBe('briefs/write-vision.md');
  });

  it("reads an agent prompt's real text from .forge/prompts/", async () => {
    const paths = new ProjectPaths(freshProjectRoot());
    await writeFileAtomic(
      paths.resolveWithin('.forge/prompts/domain-modeler.system.md'),
      'You are the Domain Modeler. Own bounded contexts and the ubiquitous language.\n',
    );

    expect(await resolveContentReference(paths, 'prompts/domain-modeler.system.md')).toContain(
      'You are the Domain Modeler.',
    );
  });

  it('returns the authored body, not the forge:generated header a real `forge init` prepends', async () => {
    const paths = new ProjectPaths(freshProjectRoot());
    await writeFileAtomic(
      paths.resolveWithin('.forge/briefs/plain.md'),
      `${HTML_HEADER}\nDo the plain thing.\n`,
    );
    // A brief that itself opens with front matter gets the header *inside* the block, on line 1.
    await writeFileAtomic(
      paths.resolveWithin('.forge/briefs/fm.md'),
      `---\n${YAML_HEADER}\ntitle: x\n---\nDo the framed thing.\n`,
    );

    expect(await resolveContentReference(paths, 'briefs/plain.md')).toBe('Do the plain thing.\n');
    const framed = await resolveContentReference(paths, 'briefs/fm.md');
    expect(framed).toBe('---\ntitle: x\n---\nDo the framed thing.\n');
    expect(framed).not.toContain('forge:generated');
  });

  it("returns a project's own local edit to a generated brief, not the shipped text", async () => {
    const paths = new ProjectPaths(freshProjectRoot());
    await writeFileAtomic(
      paths.resolveWithin('.forge/briefs/edited.md'),
      `${HTML_HEADER}\nShipped text.\n`,
    );
    await writeFileAtomic(
      paths.resolveWithin('.forge/briefs/edited.md'),
      `${HTML_HEADER}\nLocally edited text.\n`,
    );

    expect(await resolveContentReference(paths, 'briefs/edited.md')).toBe('Locally edited text.\n');
  });

  it('surfaces a typed RUN-079, whose remedy names the file to create, for a well-formed reference with no backing file', async () => {
    const paths = new ProjectPaths(freshProjectRoot());
    const error: unknown = await resolveContentReference(paths, 'briefs/does-not-exist.md').catch(
      (caught: unknown) => caught,
    );
    expect(error).toMatchObject({ code: 'RUN-079' });
    expect((error as { remedy: string }).remedy).toMatch(/Create that file|forge init/);
    expect((error as Error).message).toContain('briefs/does-not-exist.md');
  });

  it('refuses blank and header-only content with RUN-079, exactly as the validators exclude it', async () => {
    const paths = new ProjectPaths(freshProjectRoot());
    await writeFileAtomic(paths.resolveWithin('.forge/briefs/blank.md'), '  \n\n');
    await writeFileAtomic(paths.resolveWithin('.forge/briefs/only-header.md'), `${HTML_HEADER}\n`);

    for (const ref of ['briefs/blank.md', 'briefs/only-header.md']) {
      await expect(resolveContentReference(paths, ref)).rejects.toMatchObject({ code: 'RUN-079' });
    }
  });

  it('strips the header from CRLF and BOM-prefixed files, and never leaks it', async () => {
    const paths = new ProjectPaths(freshProjectRoot());
    await writeFileAtomic(
      paths.resolveWithin('.forge/briefs/crlf.md'),
      `${HTML_HEADER}\r\nDo the crlf thing.\r\n`,
    );
    await writeFileAtomic(
      paths.resolveWithin('.forge/briefs/bom.md'),
      `\uFEFF${HTML_HEADER}\nDo the bom thing.\n`,
    );

    expect(await resolveContentReference(paths, 'briefs/crlf.md')).toBe('Do the crlf thing.\r\n');
    expect(await resolveContentReference(paths, 'briefs/bom.md')).toBe('Do the bom thing.\n');
  });

  it('surfaces RUN-034 for a directory named like a brief', async () => {
    const root = freshProjectRoot();
    mkdirSync(path.join(root, '.forge', 'briefs', 'dir.md'), { recursive: true });
    await expect(
      resolveContentReference(new ProjectPaths(root), 'briefs/dir.md'),
    ).rejects.toMatchObject({ code: 'RUN-034' });
  });

  it.each([
    ['a project-root secret via traversal', '../.env'],
    ['a sibling .forge file', 'config.local.yaml'],
    ['an agent definition', 'agents/x.yaml'],
    ['an embedded traversal', 'briefs/../config.local.yaml'],
    ['a second level of nesting', 'briefs/a/b.md'],
    ['a Windows-style traversal', 'briefs\\..\\..\\.env'],
    ['a Windows drive path', 'C:\\Windows\\x.md'],
    ['a POSIX absolute path', '/etc/passwd'],
    ['a non-markdown extension', 'briefs/x.txt'],
    ['an empty reference', ''],
    ['a NUL byte', 'briefs/a\0.md'],
    ['a state-directory path outside briefs/prompts', 'state/x.md'],
  ])('refuses %s with CFG-053 before any read', async (_label, ref) => {
    const root = freshProjectRoot();
    writeFileSync(path.join(root, '.env'), 'SECRET=1\n');
    mkdirSync(path.join(root, '.forge'), { recursive: true });
    writeFileSync(path.join(root, '.forge', 'config.local.yaml'), 'secret: 1\n');

    const error: unknown = await resolveContentReference(new ProjectPaths(root), ref).catch(
      (caught: unknown) => caught,
    );
    expect(error).toMatchObject({ code: 'CFG-053' });
    // The remedy states the real fix (the expected shape), not a project-root-escape story.
    expect((error as { remedy: string }).remedy).toContain('briefs/<name>.md');
    expect((error as Error).message).not.toContain('escapes');
  });

  it('refuses a symlinked brief whose target escapes the project root', async () => {
    const root = freshProjectRoot();
    const outside = path.join(root, '..', 'forge-agents-resolve-reference-secret.txt');
    await writeFileAtomic(outside as AbsolutePath, 'do not leak me\n');
    try {
      mkdirSync(path.join(root, '.forge', 'briefs'), { recursive: true });
      symlinkSync(outside, path.join(root, '.forge', 'briefs', 'evil.md'));
      await expect(
        resolveContentReference(new ProjectPaths(root), 'briefs/evil.md'),
      ).rejects.toMatchObject({ code: 'CFG-003' });
    } finally {
      rmSync(outside, { force: true });
    }
  });
});

describe('isWellFormedContentReference', () => {
  it('accepts exactly briefs/<name>.md and prompts/<name>.md', () => {
    expect(isWellFormedContentReference('briefs/write-vision.md')).toBe(true);
    expect(isWellFormedContentReference('prompts/architect.system.md')).toBe(true);
    expect(isWellFormedContentReference('overrides/prompts/x.md')).toBe(false);
    expect(isWellFormedContentReference('briefs/x.md/')).toBe(false);
  });
});

describe('listResolvableContentReferences', () => {
  it('lists only regular, non-empty .md files, as the exact <kind>/<name>.md references', async () => {
    const root = freshProjectRoot();
    const paths = new ProjectPaths(root);
    await writeFileAtomic(paths.resolveWithin('.forge/briefs/real.md'), 'Real text.\n');
    await writeFileAtomic(paths.resolveWithin('.forge/briefs/empty.md'), '');
    await writeFileAtomic(paths.resolveWithin('.forge/briefs/blank.md'), '  \n\n');
    await writeFileAtomic(paths.resolveWithin('.forge/briefs/header-only.md'), `${HTML_HEADER}\n`);
    await writeFileAtomic(paths.resolveWithin('.forge/briefs/notes.txt'), 'not markdown\n');
    mkdirSync(path.join(root, '.forge', 'briefs', 'dir.md'), { recursive: true });
    await writeFileAtomic(paths.resolveWithin('.forge/prompts/other.md'), 'A prompt.\n');

    expect([...(await listResolvableContentReferences(paths, 'briefs'))]).toEqual([
      'briefs/real.md',
    ]);
    expect([...(await listResolvableContentReferences(paths, 'prompts'))]).toEqual([
      'prompts/other.md',
    ]);
  });

  it('excludes a symlink whose target escapes the project, rather than trusting Dirent.isDirectory', async () => {
    const root = freshProjectRoot();
    const outside = path.join(root, '..', 'forge-agents-list-reference-secret.txt');
    await writeFileAtomic(outside as AbsolutePath, 'outside\n');
    try {
      mkdirSync(path.join(root, '.forge', 'briefs'), { recursive: true });
      symlinkSync(outside, path.join(root, '.forge', 'briefs', 'evil.md'));
      symlinkSync(path.join(root, 'nowhere'), path.join(root, '.forge', 'briefs', 'dangling.md'));
      expect([
        ...(await listResolvableContentReferences(new ProjectPaths(root), 'briefs')),
      ]).toEqual([]);
    } finally {
      rmSync(outside, { force: true });
    }
  });

  it('returns the empty set, not a crash, when the directory is missing or is a regular file', async () => {
    const root = freshProjectRoot();
    const paths = new ProjectPaths(root);
    expect(await listResolvableContentReferences(paths, 'briefs')).toEqual(new Set());

    mkdirSync(path.join(root, '.forge'), { recursive: true });
    writeFileSync(path.join(root, '.forge', 'prompts'), 'i am a file, not a directory\n');
    expect(await listResolvableContentReferences(paths, 'prompts')).toEqual(new Set());
  });
});
