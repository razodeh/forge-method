/**
 * `JSONSchema` — `07` §7.2 uses this type name (`SessionRequest.outputSchema?`, `StructuredRequest`)
 * without ever defining it, and no other file in the spec pack does either. Left as an opaque JSON
 * object rather than a modelled subset of JSON Schema's own keywords: nothing in this milestone's own
 * Surface inspects a schema's internal structure (that is a future structured-output validator's job,
 * likely a real library, not this package's own invention) — see `SPEC-QUESTIONS.md` Q58 point 6.
 *
 * @see specs/07 §7.2
 * @see SPEC-QUESTIONS.md Q58
 * @see PLAN-M4.md P1
 */
export type JSONSchema = Readonly<Record<string, unknown>>;
