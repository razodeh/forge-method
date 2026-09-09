/**
 * `generatedHeader` — `03` §3.3's own idempotency rule, adapted per file type since the spec's own
 * literal HTML-comment syntax is not valid YAML.
 *
 * @see specs/03 §3.3
 */
import { describe, expect, it } from 'vitest';
import * as YAML from 'yaml';

import { generatedHeader, withGeneratedHeader } from '../../src/init/generated-header.ts';

describe('generatedHeader', () => {
  it('uses a #-comment for a .yaml file, carrying the real version and hash', () => {
    const header = generatedHeader('.forge/workflows/intake.workflow.yaml', '1', 'abc123');
    expect(header).toBe(
      '# forge:generated v=1 hash=abc123 — edits will be overwritten; use overrides/\n',
    );
  });

  it('uses a #-comment for a .yml file too', () => {
    const header = generatedHeader('foo.yml', '1', 'abc123');
    expect(header.startsWith('#')).toBe(true);
  });

  it('uses an HTML comment for a .md file', () => {
    const header = generatedHeader('.forge/templates/ADR.md', '1', 'abc123');
    expect(header).toBe(
      '<!-- forge:generated v=1 hash=abc123 — edits will be overwritten; use overrides/ -->\n',
    );
  });

  it('uses an HTML comment for any other/no extension, as a safe default', () => {
    const header = generatedHeader('README', '1', 'abc123');
    expect(header.startsWith('<!--')).toBe(true);
  });
});

describe('withGeneratedHeader', () => {
  it('prepends the ordinary header for content with no real front matter, matching generatedHeader', () => {
    const content = 'id: intake\nsteps: []\n';
    const combined = withGeneratedHeader(
      content,
      '.forge/workflows/intake.workflow.yaml',
      '1',
      'abc123',
    );
    expect(combined).toBe(
      generatedHeader('.forge/workflows/intake.workflow.yaml', '1', 'abc123') + content,
    );
  });

  it('inserts a real YAML comment inside real front matter, rather than an HTML comment before it', () => {
    // A critic round caught the original `generatedHeader(path) + content` composition corrupting
    // real front matter: `.forge/skills/<id>/SKILL.md`/`.forge/templates/<Type>.md` both open with a
    // real `---` line, and prepending an HTML comment before it moves that delimiter off line one —
    // every real front-matter parser in this codebase requires it literally first.
    const content = '---\nname: my-skill\n---\n\nBody text.\n';
    const combined = withGeneratedHeader(content, '.forge/skills/my-skill/SKILL.md', '1', 'abc123');
    const lines = combined.split('\n');
    expect(lines[0]).toBe('---');
    expect(lines[1]).toBe(
      '# forge:generated v=1 hash=abc123 — edits will be overwritten; use overrides/',
    );
    expect(lines[2]).toBe('name: my-skill');
    expect(combined).toContain('---\n\nBody text.\n');
  });

  it('recognizes real front matter regardless of the file extension', () => {
    const content = '---\nid: X\n---\n\nBody.\n';
    const combined = withGeneratedHeader(content, 'anything.yaml', '1', 'abc123');
    expect(combined.startsWith('---\n# forge:generated')).toBe(true);
  });

  it('the real header line it inserts is still valid YAML alongside the surrounding front matter', () => {
    const content = '---\nid: X\ntitle: Y\n---\n\nBody.\n';
    const combined = withGeneratedHeader(content, 'x.md', '1', 'abc123');
    const frontMatterText = combined.split('---\n')[1];
    expect(frontMatterText).toBeDefined();
    if (frontMatterText === undefined) return;
    expect(() => {
      YAML.parse(frontMatterText);
    }).not.toThrow();
  });
});
