/**
 * `splitFrontMatter`, `parseFrontMatterYaml`.
 *
 * @see specs/18 §18.6
 * @see PLAN-M1.md P12
 */
import { describe, expect, it } from 'vitest';

import { parseFrontMatterYaml, splitFrontMatter } from '../../src/artifacts/parse.ts';
import { isForgeError } from '../../src/errors/forge-error.ts';

describe('splitFrontMatter', () => {
  it('splits a well-formed document into prefix, front matter, infix and body', () => {
    const source = '---\nid: X\ntype: Story\n---\nbody line\n';
    const result = splitFrontMatter(source, 'x.md');
    expect(result).toEqual({
      prefix: '---\n',
      frontMatterText: 'id: X\ntype: Story\n',
      infix: '---\n',
      body: 'body line\n',
    });
  });

  it('reassembles byte-for-byte from its own four parts', () => {
    const source = '---\nid: X\n  # a comment\n---\n\nbody\n\n\nmore body\n';
    const result = splitFrontMatter(source, 'x.md');
    expect(result.prefix + result.frontMatterText + result.infix + result.body).toBe(source);
  });

  it('throws CFG-005 when the file does not open with a bare "---" line', () => {
    expect.assertions(2);
    try {
      splitFrontMatter('id: X\ntype: Story\n', 'x.md');
    } catch (error) {
      expect(isForgeError(error)).toBe(true);
      expect(isForgeError(error) && error.code).toBe('CFG-005');
    }
  });

  it('throws CFG-005 for a "---" line with trailing content (not a bare delimiter)', () => {
    expect.assertions(1);
    try {
      splitFrontMatter('--- \nid: X\n---\nbody\n', 'x.md');
    } catch (error) {
      expect(isForgeError(error) && error.code).toBe('CFG-005');
    }
  });

  it('throws CFG-006 when no closing "---" line ever appears', () => {
    expect.assertions(1);
    try {
      splitFrontMatter('---\nid: X\ntype: Story\n', 'x.md');
    } catch (error) {
      expect(isForgeError(error) && error.code).toBe('CFG-006');
    }
  });

  it('tolerates a leading UTF-8 BOM, keeping it in prefix', () => {
    const bom = String.fromCharCode(0xfeff);
    const source = `${bom}---\nid: X\n---\nbody\n`;
    const result = splitFrontMatter(source, 'x.md');
    expect(result.prefix).toBe(`${bom}---\n`);
  });

  it('handles CRLF-delimited documents, ranges and all', () => {
    const source = '---\r\nid: X\r\n---\r\nbody\r\n';
    const result = splitFrontMatter(source, 'x.md');
    expect(result).toEqual({
      prefix: '---\r\n',
      frontMatterText: 'id: X\r\n',
      infix: '---\r\n',
      body: 'body\r\n',
    });
  });

  it('handles a document with no trailing newline at all, closing delimiter included', () => {
    const source = '---\nid: X\n---';
    const result = splitFrontMatter(source, 'x.md');
    expect(result).toEqual({ prefix: '---\n', frontMatterText: 'id: X\n', infix: '---', body: '' });
  });

  it('never mistakes a "---" inside the body for the closing delimiter of an unterminated block', () => {
    // Only the FIRST "---" after the opening line closes the front matter — a body containing its
    // own horizontal rule is not a second, later opportunity to close an already-closed block.
    const source = '---\nid: X\n---\nbefore\n\n---\n\nafter\n';
    const result = splitFrontMatter(source, 'x.md');
    expect(result.body).toBe('before\n\n---\n\nafter\n');
  });
});

describe('parseFrontMatterYaml', () => {
  it('parses a well-formed mapping', () => {
    expect(parseFrontMatterYaml('id: X\ntype: Story\n', 'x.md')).toEqual({
      id: 'X',
      type: 'Story',
    });
  });

  it('throws CFG-007 for syntactically invalid YAML', () => {
    expect.assertions(1);
    try {
      parseFrontMatterYaml(': : :\n', 'x.md');
    } catch (error) {
      expect(isForgeError(error) && error.code).toBe('CFG-007');
    }
  });

  it('throws CFG-007 when the front matter is a list, not a mapping', () => {
    expect.assertions(1);
    try {
      parseFrontMatterYaml('- a\n- b\n', 'x.md');
    } catch (error) {
      expect(isForgeError(error) && error.code).toBe('CFG-007');
    }
  });

  it('throws CFG-007 when the front matter is a bare scalar', () => {
    expect.assertions(1);
    try {
      parseFrontMatterYaml('just a string\n', 'x.md');
    } catch (error) {
      expect(isForgeError(error) && error.code).toBe('CFG-007');
    }
  });

  it('throws CFG-007 for empty front matter (no fields at all)', () => {
    expect.assertions(1);
    try {
      parseFrontMatterYaml('', 'x.md');
    } catch (error) {
      expect(isForgeError(error) && error.code).toBe('CFG-007');
    }
  });
});
