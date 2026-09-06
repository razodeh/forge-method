/**
 * `overlayArrayField` — a zod shape for a field that may be a literal array (the seed/base case,
 * `@forge/extensions/resolve`'s "first contribution" rule) or one of `15` §15.2's six array-operator
 * directives (the overlay case). Every piece defining an overlay-able document (`agents`, `skills`,
 * `mcp`, workflows, …) needs this same shape for every array field it declares, so it lives here next
 * to the operator types it validates rather than being redeclared per piece.
 *
 * @see specs/15 §15.2
 * @see PLAN-M2.md P1, P3
 */
import { z } from 'zod';

/** `{ $set, $append, $prepend, $remove, $replaceWhere, $clear }`, all optional, over `itemSchema`. */
export function overlayArrayOperatorSchema(itemSchema: z.ZodTypeAny): z.ZodTypeAny {
  return z
    .object({
      $set: z.array(itemSchema).optional(),
      $append: z.array(itemSchema).optional(),
      $prepend: z.array(itemSchema).optional(),
      // Matches by value (itemSchema's own shape) or by `id` (a string) per `15` §15.2's own
      // "$remove (by value or id)" — the item schema alone cannot express "or a bare id string" when
      // itemSchema is itself an object schema, so this is always the wider of the two.
      $remove: z.array(z.union([itemSchema, z.string()])).optional(),
      $replaceWhere: z.array(z.record(z.string(), z.unknown())).optional(),
      $clear: z.boolean().optional(),
    })
    .strict();
}

/** A bare `itemSchema[]` (a base document's own field) or an array-operator directive (an overlay's). */
export function overlayArrayField(itemSchema: z.ZodTypeAny): z.ZodTypeAny {
  return z.union([z.array(itemSchema), overlayArrayOperatorSchema(itemSchema)]);
}
