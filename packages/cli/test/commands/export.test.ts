/**
 * `forge export <target>` — real `markdown-bundle`/`html` renderers, real dry-run-only refusals for
 * `jira`/`linear`/`github-issues`.
 */
import { afterEach, describe, expect, it } from 'vitest';

import { adrNew } from '../../src/commands/adr.ts';
import { specNew } from '../../src/commands/spec.ts';
import { exportHtml, exportMarkdownBundle, exportThirdParty } from '../../src/commands/export.ts';
import { writeKbEntryFixture } from './helpers.ts';
import { cleanupAll, createTestProject } from './upgrade/helpers.ts';

afterEach(cleanupAll);

function ctxFor(project: Awaited<ReturnType<typeof createTestProject>>) {
  return {
    paths: project.paths,
    specsRoot: project.config.paths.specs,
    kbRoot: project.config.paths.kb,
  };
}

describe('exportMarkdownBundle', () => {
  it('bundles a real spec document’s own real title and body', async () => {
    const project = await createTestProject();
    await specNew(
      {
        paths: project.paths,
        specsRoot: project.config.paths.specs,
        kbRoot: project.config.paths.kb,
      },
      'Vision',
      'A Real Vision',
    );
    const bundle = await exportMarkdownBundle(ctxFor(project));
    expect(bundle).toContain('A Real Vision');
  });

  it('bundles a real KB entry’s and a real ADR’s own real body content, not just their titles', async () => {
    const project = await createTestProject();
    await writeKbEntryFixture(project);
    await adrNew({ paths: project.paths, kbRoot: project.config.paths.kb }, 'A real decision');
    const bundle = await exportMarkdownBundle(ctxFor(project));
    expect(bundle).toContain('Fixture knowledge entry');
    // A critic round caught an earlier version of this function hardcoding `body: ''` for every real
    // KB-tree document — this asserts the real body text itself, not just the title, is present.
    expect(bundle).toContain('Confirmed directly against the real system.');
    expect(bundle).toContain('A real decision');
    expect(bundle).toContain('## Context');
  });

  it('falls back to the real document path when its own front matter has no title', async () => {
    const project = await createTestProject();
    const doc = await specNew(
      {
        paths: project.paths,
        specsRoot: project.config.paths.specs,
        kbRoot: project.config.paths.kb,
      },
      'Vision',
      'A Real Vision',
    );
    const { readTextFile, writeFileAtomic } = await import('@forge/core/fs');
    const text = await readTextFile(project.paths.resolveWithin(doc.path));
    await writeFileAtomic(project.paths.resolveWithin(doc.path), text.replace(/^title: .*$/m, ''));
    const bundle = await exportMarkdownBundle(ctxFor(project));
    expect(bundle).toContain(doc.path);
  });
});

describe('exportHtml', () => {
  it('wraps the identical real content in a real, self-contained HTML document', async () => {
    const project = await createTestProject();
    await specNew(
      {
        paths: project.paths,
        specsRoot: project.config.paths.specs,
        kbRoot: project.config.paths.kb,
      },
      'Vision',
      'A Real Vision',
    );
    const html = await exportHtml(ctxFor(project));
    expect(html).toContain('<!doctype html>');
    expect(html).toContain('A Real Vision');
  });

  it('escapes real HTML-significant characters rather than injecting them raw', async () => {
    const project = await createTestProject();
    await specNew(
      {
        paths: project.paths,
        specsRoot: project.config.paths.specs,
        kbRoot: project.config.paths.kb,
      },
      'Vision',
      '<script>alert(1)</script>',
    );
    const html = await exportHtml(ctxFor(project));
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });
});

describe('exportThirdParty', () => {
  it('is a real, named refusal for jira/linear/github-issues — no client exists for any of them', () => {
    expect(() => exportThirdParty('jira')).toThrow(expect.objectContaining({ code: 'USR-003' }));
    expect(() => exportThirdParty('linear')).toThrow(expect.objectContaining({ code: 'USR-003' }));
    expect(() => exportThirdParty('github-issues')).toThrow(
      expect.objectContaining({ code: 'USR-003' }),
    );
  });

  it('rejects an unrecognized target with USR-002 rather than a real refusal', () => {
    expect(() => exportThirdParty('not-a-real-target')).toThrow(
      expect.objectContaining({ code: 'USR-002' }),
    );
  });
});
