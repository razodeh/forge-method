/**
 * `overlayArrayField` — a zod shape for a field that may be a literal array or one of `15` §15.2's
 * six array-operator directives.
 *
 * @see specs/15 §15.2
 * @see PLAN-M2.md P1, P3
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { overlayArrayField, overlayArrayOperatorSchema } from '../../src/merge/schema.ts';

describe('overlayArrayField', () => {
  const schema = overlayArrayField(z.string());

  it('accepts a bare array of the item type', () => {
    expect(schema.safeParse(['a', 'b']).success).toBe(true);
  });

  it('accepts an array-operator directive', () => {
    expect(schema.safeParse({ $append: ['a'] }).success).toBe(true);
  });

  it('accepts a directive combining multiple operators', () => {
    expect(schema.safeParse({ $append: ['a'], $remove: ['b'] }).success).toBe(true);
  });

  it('rejects a bare array of the wrong item type', () => {
    expect(schema.safeParse([1, 2]).success).toBe(false);
  });

  it('rejects an unrecognised operator key', () => {
    expect(schema.safeParse({ $appand: ['a'] }).success).toBe(false);
  });

  it('rejects a plain object with no operator keys at all', () => {
    expect(schema.safeParse({ description: 'not an operator directive' }).success).toBe(false);
  });
});

describe('overlayArrayOperatorSchema — $remove accepts value or id', () => {
  const objectItem = z.object({ id: z.string(), weight: z.number() }).strict();
  const schema = overlayArrayOperatorSchema(objectItem);

  it('accepts $remove given a bare id string against an object item schema', () => {
    expect(schema.safeParse({ $remove: ['some-id'] }).success).toBe(true);
  });

  it('accepts $remove given a full object matching the item schema', () => {
    expect(schema.safeParse({ $remove: [{ id: 'a', weight: 1 }] }).success).toBe(true);
  });

  it('accepts $replaceWhere as a partial-object patch list', () => {
    expect(schema.safeParse({ $replaceWhere: [{ id: 'a', weight: 2 }] }).success).toBe(true);
  });

  it('accepts $clear as a boolean', () => {
    expect(schema.safeParse({ $clear: true }).success).toBe(true);
  });
});
