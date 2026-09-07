/**
 * `normalizeAdapterEvent` — the one gate every raw, adapter-produced event object is squeezed through
 * before it becomes a typed `AdapterEvent` the rest of FORGE can trust. Every future adapter (an SDK's
 * own event objects, CLI NDJSON, a generic YAML-mapped stream) produces its own raw shape; this
 * package does not know or care which.
 *
 * Returns a result, never throws a `ForgeError`: `02` §2.2's own graph gives `adapter-kit ← schemas,
 * telemetry` — no `core` edge, so `ForgeError` (defined in `@forge/core/errors`) is structurally
 * unreachable from this package, the same position-in-the-graph reason `@forge/schemas` itself never
 * throws. A future caller with `core` access (`@forge/engine`, `@forge/agents` — both `02` §2.2 graph
 * rows include `core`) is where this structured failure becomes a real, user-facing `ForgeError`, not
 * here. This function *also* never lets a thrown JS exception escape at all (see the `try`/`catch`
 * below) — a gauntlet critic found that a raw object with a throwing getter, a `Proxy` trap, or similar
 * adversarial shape could make `adapterEventSchema.safeParse` itself throw past the `{ok:false}` path,
 * defeating the very "safely validate untrusted adapter output" purpose this function exists for.
 *
 * Shallow, not deep: the returned event's own top-level shape is a fresh object/array (mutating `raw`
 * after normalizing does not change the result), but a value living inside an `unknown`/`Record<string,
 * unknown>`-typed field (`meta`, `input`, `payload`) is not cloned — it is the *same* object reference
 * `raw` itself holds. `AdapterEvent`'s own `readonly`/`Readonly<>` markers are a top-level,
 * compile-time-only guarantee (as `readonly` always is in TS), not a deep-freeze; a caller that holds
 * onto both `raw` and a successful result, and later mutates a nested object inside `raw`'s own
 * `meta`/`input`/`payload`, will see that same mutation reflected in the already-"normalized" result. A
 * deep clone was considered and rejected: these fields can be arbitrarily large (a real tool-call input,
 * a whole session's `meta`), and this function sits on a live, potentially high-frequency event stream —
 * paying an unbounded deep-clone cost on every event to guard against a caller-discipline issue (don't
 * mutate an object you handed to something that promises to trust it) is a worse trade than documenting
 * the limitation honestly. `SPEC-QUESTIONS.md` Q58 records this as a considered tradeoff, not an
 * oversight.
 *
 * @see specs/02 §2.2
 * @see specs/07 §7.2
 * @see SPEC-QUESTIONS.md Q58
 * @see PLAN-M4.md P1
 */
import type { AdapterEvent } from '../types/events.ts';
import { adapterEventSchema } from './schema.ts';

export interface NormalizeAdapterEventIssue {
  readonly path: string;
  readonly message: string;
}

export type NormalizeAdapterEventResult =
  | { readonly ok: true; readonly event: AdapterEvent }
  | { readonly ok: false; readonly issue: NormalizeAdapterEventIssue };

/** `07` §7.2's own `tool.call.input`/`control.payload` are `unknown`, not `unknown | undefined` — a
 * required field whose *value* may be anything, including `undefined`, is not the same contract as an
 * *optional* field. Zod's own `z.unknown()` cannot express this distinction (a missing key and a
 * present-but-`undefined` key both parse identically, since `undefined` is itself a valid `unknown`
 * value) — confirmed by a gauntlet critic: `normalizeAdapterEvent({type:'tool.call', id, name})`, with
 * no `input` key at all, validated as `ok: true`. Checked here, directly against `raw`'s own own-keys,
 * before Zod ever sees it — the one place "was this key actually present" is still answerable. */
// A `Map`, not a plain object: a verify pass found `REQUIRED_UNKNOWN_KEY_BY_TYPE[type]` (plain-object
// bracket lookup) resolves an attacker-controlled `type` string like `'constructor'`/`'__proto__'`/
// `'toString'` to an *inherited* `Object.prototype` member instead of `undefined` — the function value
// or `Object.prototype` itself then leaks into `NormalizeAdapterEventIssue.path`, silently violating
// its own declared `string` contract at runtime (confirmed: `JSON.stringify` on such an issue drops the
// `path` key entirely, since a function value is not JSON-serialisable). A `Map` has no prototype-chain
// lookup ambiguity at all — `.get('constructor')` is `undefined` unless a key literally named
// `'constructor'` was ever `.set()` on this exact instance, which it was not.
const REQUIRED_UNKNOWN_KEY_BY_TYPE: ReadonlyMap<string, string> = new Map([
  ['tool.call', 'input'],
  ['control', 'payload'],
]);

function missingRequiredUnknownKey(raw: unknown): NormalizeAdapterEventIssue | undefined {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined;
  const type: unknown = (raw as { type?: unknown }).type;
  if (typeof type !== 'string') return undefined;
  const requiredKey = REQUIRED_UNKNOWN_KEY_BY_TYPE.get(type);
  if (requiredKey === undefined) return undefined;
  if (Object.prototype.hasOwnProperty.call(raw, requiredKey)) return undefined;
  return { path: requiredKey, message: 'Required' };
}

/** Never throws, for any `cause` whatsoever — a verify pass found the original `cause instanceof Error
 * ? cause.message : String(cause)` was itself unprotected: both `instanceof` (which can invoke a
 * `Proxy`'s own `getPrototypeOf` trap) and `String()` (which can invoke a poisoned `toString`/
 * `Symbol.toPrimitive`, including one that throws the very value being stringified, e.g. a
 * self-referential `Proxy`) can themselves throw for a sufficiently adversarial `cause` — defeating the
 * exact "never throws" guarantee this helper exists to provide for its own caller's `catch` block. */
function describeThrown(cause: unknown): string {
  try {
    return cause instanceof Error ? cause.message : String(cause);
  } catch {
    return 'a thrown value that could not be described';
  }
}

/** Never coerces an unrecognised shape into a best-guess event — a malformed adapter output is a real
 * bug worth surfacing structurally, not hiding behind a silent fallback. */
export function normalizeAdapterEvent(raw: unknown): NormalizeAdapterEventResult {
  try {
    const missingKey = missingRequiredUnknownKey(raw);
    if (missingKey !== undefined) {
      return { ok: false, issue: missingKey };
    }

    const result = adapterEventSchema.safeParse(raw);
    if (!result.success) {
      const firstIssue = result.error.issues[0];
      const path = firstIssue === undefined ? '(root)' : firstIssue.path.join('.') || '(root)';
      const message = firstIssue?.message ?? 'does not match any known AdapterEvent variant';
      return { ok: false, issue: { path, message } };
    }
    return { ok: true, event: result.data };
  } catch (cause) {
    // A throwing getter, a Proxy trap, or similar adversarial shape can make property access itself
    // throw partway through validation — caught here so this function's own "never throws" contract
    // holds for every input, not only ones that fail validation in the ordinary way.
    return { ok: false, issue: { path: '(root)', message: describeThrown(cause) } };
  }
}
