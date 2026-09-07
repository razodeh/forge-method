/**
 * `resolveTemplate` — `10` §10.1's own worked example substitution (`vars.integration_branch`,
 * `item.id`), built on `parseExpression`/`evaluate`.
 *
 * @see specs/10 §10.1
 * @see PLAN-M5.md P9
 */
import { describe, expect, it } from 'vitest';

import { ForgeError } from '@forge/core/errors';

import { resolveTemplate } from '../../src/expr/template.ts';
import type { ExpressionContext } from '../../src/expr/types.ts';

describe('resolveTemplate', () => {
  it('resolves 10 §10.1\'s own "forge/integration/{{stageId}}" worked example', () => {
    expect(resolveTemplate('forge/integration/{{stageId}}', { stageId: 'mvp' } as unknown as ExpressionContext)).toBe(
      'forge/integration/mvp',
    );
  });

  it('resolves 10 §10.1\'s own "{{vars.integration_branch}}" worked example', () => {
    const context = { vars: { integration_branch: 'forge/integration/mvp' } };
    expect(resolveTemplate('{{vars.integration_branch}}', context)).toBe('forge/integration/mvp');
  });

  it('resolves 10 §10.1\'s own "{{item.id}}" worked example', () => {
    expect(resolveTemplate('{{item.id}}', { item: { id: 'story-014' } })).toBe('story-014');
  });

  it('resolves multiple placeholders in one template', () => {
    const context = { item: { id: 'story-014', owner_role: 'engineer' } };
    expect(resolveTemplate('{{item.id}}:{{item.owner_role}}', context)).toBe('story-014:engineer');
  });

  it('resolves text with no placeholders unchanged', () => {
    expect(resolveTemplate('git switch -c integration', {})).toBe('git switch -c integration');
  });

  it('resolves a numeric or boolean result by stringifying it', () => {
    expect(resolveTemplate('count: {{item.count}}', { item: { count: 3 } })).toBe('count: 3');
    expect(resolveTemplate('done: {{item.done}}', { item: { done: true } })).toBe('done: true');
  });

  it('resolves a placeholder wrapping a fuller expression, not just a bare path', () => {
    expect(resolveTemplate('{{length(item.tags)}}', { item: { tags: ['a', 'b'] } })).toBe('2');
  });

  it('throws a CFG-014 ForgeError for a placeholder whose expression fails to parse', () => {
    let caught: unknown;
    try {
      resolveTemplate('{{item..id}}', { item: { id: 'x' } });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ForgeError);
    if (caught instanceof ForgeError) {
      expect(caught.code).toBe('CFG-014');
    }
  });

  it('throws a CFG-015 ForgeError for a placeholder that resolves to an unresolved path, rather than substituting the literal text "undefined"', () => {
    let caught: unknown;
    try {
      resolveTemplate('{{item.owner_role}}', { item: {} });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ForgeError);
    if (caught instanceof ForgeError) {
      expect(caught.code).toBe('CFG-015');
    }
  });

  it('throws a CFG-015 ForgeError for a placeholder that resolves to an object, rather than substituting "[object Object]"', () => {
    let caught: unknown;
    try {
      resolveTemplate('{{item}}', { item: { id: 'x' } });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ForgeError);
    if (caught instanceof ForgeError) {
      expect(caught.code).toBe('CFG-015');
    }
  });

  it('throws a CFG-015 ForgeError for a placeholder that resolves to null, rather than substituting the literal text "null"', () => {
    let caught: unknown;
    try {
      resolveTemplate('{{item.value}}', { item: { value: null } });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ForgeError);
    if (caught instanceof ForgeError) {
      expect(caught.code).toBe('CFG-015');
    }
  });

  it('throws a CFG-015 ForgeError for a placeholder that resolves to an array', () => {
    let caught: unknown;
    try {
      resolveTemplate('{{item.tags}}', { item: { tags: ['a', 'b'] } });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ForgeError);
    if (caught instanceof ForgeError) {
      expect(caught.code).toBe('CFG-015');
    }
  });

  it('trims whitespace inside a placeholder before parsing it', () => {
    expect(resolveTemplate('{{  item.id  }}', { item: { id: 'story-014' } })).toBe('story-014');
  });

  describe('unterminated placeholders', () => {
    it('throws a CFG-014 ForgeError for a placeholder missing its closing "}}", rather than silently leaving the literal "{{..." text unchanged', () => {
      let caught: unknown;
      try {
        resolveTemplate('branch: {{item.id', { item: { id: 'story-014' } });
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(ForgeError);
      if (caught instanceof ForgeError) {
        expect(caught.code).toBe('CFG-014');
        expect(caught.message).toContain('item.id');
      }
    });

    it('throws a CFG-014 ForgeError for a bare, otherwise-empty unterminated "{{"', () => {
      expect(() => resolveTemplate('{{', {})).toThrow(ForgeError);
    });

    it('throws a CFG-014 ForgeError when the closing "}}" is inside a string literal that itself never closes, not a false "closed" match on a lone "}"', () => {
      expect(() => resolveTemplate('{{"unterminated', {})).toThrow(ForgeError);
    });
  });

  describe('"}}" inside a placeholder\'s own string literal', () => {
    it('does not mistake a "}}" inside a quoted string literal for the closing delimiter', () => {
      expect(resolveTemplate('{{"a}}b" == "a}}b"}}', {})).toBe('true');
    });

    it('resolves a path comparison against a context value that itself contains "}}"', () => {
      expect(resolveTemplate('{{item.value == "x}}y"}}', { item: { value: 'x}}y' } })).toBe('true');
    });

    it('still finds the real closing "}}" after a string literal containing one', () => {
      expect(resolveTemplate('prefix {{"a}}b" == "a}}b"}} suffix', {})).toBe('prefix true suffix');
    });
  });

  describe('performance: linear, not quadratic, in template length', () => {
    it('resolves a template with many placeholders well within a generous time budget', () => {
      const placeholderCount = 20000;
      const template = Array.from({ length: placeholderCount }, () => '{{item.id}}').join(',');
      const context = { item: { id: 'x' } };

      const started = performance.now();
      const result = resolveTemplate(template, context);
      const elapsedMs = performance.now() - started;

      expect(result).toBe(Array.from({ length: placeholderCount }, () => 'x').join(','));
      // A correct single-pass scanner resolves this in low tens of milliseconds on real hardware; the
      // regex this file used to use was confirmed empirically to be quadratic on adversarial input, which
      // would blow well past this generous a ceiling at this input size. The bound here is intentionally
      // loose (not a tight benchmark) to stay non-flaky on a shared CI runner.
      expect(elapsedMs).toBeLessThan(2000);
    });
  });
});
