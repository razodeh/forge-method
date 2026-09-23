/**
 * `configLeafPaths` — every dot-path in `configSchema` that needs a `CONFIG_KEY_DOCS` entry and a
 * `DEFAULT_CONFIG` value.
 *
 * A "leaf" is any field whose declared type is not itself a `ZodObject`: recursion descends through
 * nested objects (`platform.routing.onRateLimit`) but stops at a `ZodRecord` or `ZodArray`
 * (`platform.perAgent` is one leaf, not one per dynamic key — its own keys are data, not schema).
 * This is what lets a test walk the real schema and catch a key that is missing a doc or a default,
 * rather than trusting a hand-maintained list to stay in sync with `schema.ts` by hand.
 *
 * @see PLAN-M1.md P8
 */
import { z } from 'zod';

/**
 * Unwraps `ZodNullable`/`ZodOptional`/`ZodDefault`/`ZodEffects` to the type underneath. `gates`
 * (`PLAN-M14.md` P16) is the first field where this actually matters for a `ZodObject`: unlike
 * `execution.testRoots`/`execution.mergeChecks`/`paths.release` (each an optional LEAF under an
 * always-present parent object), `gates: gatesSchema.optional()` wraps a whole nested object — without
 * this unwrap the walker would misclassify it as a leaf itself, one dot-path short of the real leaf
 * (`gates.waiverMaxDays`) underneath. The walker was written defensively for exactly this case before
 * any field actually exercised it; it now does.
 */
function unwrap(schema: z.ZodTypeAny): z.ZodTypeAny {
  if (
    schema instanceof z.ZodNullable ||
    schema instanceof z.ZodOptional ||
    schema instanceof z.ZodDefault
  ) {
    // `schema` narrows to a union of these three classes' *default* type parameter, under which
    // zod's own `_def.innerType` resolves to `any` rather than `ZodTypeAny` — the cast restates the
    // declared return type of `unwrap`, which every one of these three wrapper types' `innerType`
    // genuinely is.
    return unwrap(schema._def.innerType as z.ZodTypeAny);
  }
  if (schema instanceof z.ZodEffects) {
    // Same cause as above: `_def.schema` resolves to `any` under ZodEffects's default type param.
    return unwrap(schema._def.schema as z.ZodTypeAny);
  }
  return schema;
}

function collectPaths(schema: z.ZodTypeAny, prefix: readonly string[], into: string[]): void {
  const unwrapped = unwrap(schema);
  if (unwrapped instanceof z.ZodObject) {
    // `ZodRawShape`'s values are typed `ZodTypeAny` by zod's own definition of a ZodObject; the cast
    // is only needed because `Object.entries` widens an index signature's value type to `unknown`.
    for (const [key, child] of Object.entries(unwrapped.shape as Record<string, z.ZodTypeAny>)) {
      collectPaths(child, [...prefix, key], into);
    }
    return;
  }
  into.push(prefix.join('.'));
}

/** Every leaf dot-path in `configSchema`, in schema declaration order. */
export function configLeafPaths(schema: z.AnyZodObject): readonly string[] {
  const paths: string[] = [];
  collectPaths(schema, [], paths);
  return paths;
}
