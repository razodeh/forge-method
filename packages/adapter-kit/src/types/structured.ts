/**
 * `StructuredRequest<T>` — no field-level shape given anywhere in the spec pack; designed from `07`
 * §7.2's own one-line description: "one-shot structured completion for cheap utility tasks." `T`
 * exists on the *method* (`structured<T>(req): Promise<T>`) for the caller's own return-type
 * inference, not encoded redundantly into the request shape itself. See `SPEC-QUESTIONS.md` Q58
 * point 6.
 *
 * @see specs/07 §7.2
 * @see SPEC-QUESTIONS.md Q58
 * @see PLAN-M4.md P1
 */
import type { JSONSchema } from './json-schema.ts';

/** `T` documents the caller's own expected return shape (paired with `PlatformAdapter.structured<T>`)
 * — the request itself carries no field typed by it, the same phantom-type-parameter shape
 * `JSON.parse<T>`-style generic helpers already use elsewhere in the TS ecosystem. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- see the doc comment above.
export interface StructuredRequest<T> {
  readonly prompt: string;
  readonly outputSchema: JSONSchema;
  readonly model?: string;
}
