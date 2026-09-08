/**
 * `generatedHeader` — `03` §3.3's own idempotency rule, adapted per file type since the spec's own
 * literal HTML-comment syntax is not valid YAML.
 *
 * @see specs/03 §3.3
 */
import { describe, expect, it } from 'vitest';

import { generatedHeader } from '../../src/init/generated-header.ts';

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
