/**
 * `configLeafPaths` — the leaf-path walker `docs.test.ts`'s completeness check depends on.
 *
 * Tested against small, purpose-built schemas rather than the real `configSchema`, so a bug in the
 * walker itself is not masked by `configSchema` happening to have the shape the walker handles well.
 */
import { z } from 'zod';
import { describe, expect, it } from 'vitest';

import { configLeafPaths } from '../../src/config/walk.ts';

describe('configLeafPaths', () => {
  it('descends through nested objects, dot-joining the path', () => {
    const schema = z
      .object({
        a: z.object({ b: z.object({ c: z.string() }).strict() }).strict(),
      })
      .strict();
    expect(configLeafPaths(schema)).toEqual(['a.b.c']);
  });

  it('stops at a record — its own keys are data, not schema', () => {
    const schema = z.object({ perAgent: z.record(z.string(), z.string()) }).strict();
    expect(configLeafPaths(schema)).toEqual(['perAgent']);
  });

  it('stops at an array', () => {
    const schema = z.object({ items: z.array(z.string()) }).strict();
    expect(configLeafPaths(schema)).toEqual(['items']);
  });

  it('treats an enum, a literal, and a union as leaves, not objects to descend into', () => {
    const schema = z
      .object({
        mode: z.enum(['a', 'b']),
        kind: z.literal('x'),
        concurrency: z.union([z.literal('auto'), z.number()]),
      })
      .strict();
    expect(configLeafPaths(schema)).toEqual(['mode', 'kind', 'concurrency']);
  });

  it('unwraps nullable and optional to see whether the inner type is an object', () => {
    const schema = z
      .object({
        nullableLeaf: z.string().nullable(),
        optionalObject: z.object({ inner: z.string() }).strict().optional(),
      })
      .strict();
    expect(configLeafPaths(schema)).toEqual(['nullableLeaf', 'optionalObject.inner']);
  });

  it('unwraps a refined (ZodEffects) object to see it is still an object underneath', () => {
    // None of configSchema's own top-level fields are refined objects (only individual array
    // elements are, e.g. security.redactPatterns), so this is exercised here rather than through the
    // real schema — without it, the walker would silently treat a refined nested object as a leaf.
    const schema = z
      .object({
        refinedObject: z
          .object({ inner: z.string() })
          .strict()
          .refine(() => true),
      })
      .strict();
    expect(configLeafPaths(schema)).toEqual(['refinedObject.inner']);
  });

  it('preserves declaration order', () => {
    const schema = z.object({ z: z.string(), a: z.string(), m: z.string() }).strict();
    expect(configLeafPaths(schema)).toEqual(['z', 'a', 'm']);
  });
});
