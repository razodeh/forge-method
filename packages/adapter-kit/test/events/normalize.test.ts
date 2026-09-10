/**
 * `normalizeAdapterEvent` — every `AdapterEvent` variant round-trips through `adapterEventSchema`,
 * and a malformed raw object is rejected with a structured issue, never a thrown `ForgeError`
 * (`SPEC-QUESTIONS.md` Q58 point 15 — `@forge/adapter-kit` has no `core` edge in `02` §2.2's graph).
 *
 * @see specs/07 §7.2
 * @see SPEC-QUESTIONS.md Q58
 * @see PLAN-M4.md P1
 */
import { describe, expect, it, vi } from 'vitest';

import { adapterEventSchema } from '../../src/events/schema.ts';
import { normalizeAdapterEvent } from '../../src/events/normalize.ts';
import type { AdapterEvent } from '../../src/types/events.ts';

const WORKED_EXAMPLES: readonly AdapterEvent[] = [
  { type: 'session.started', sessionId: 's1', model: 'm1', tools: ['Read', 'Edit'], meta: {} },
  { type: 'text', text: 'hello', partial: false },
  { type: 'text', text: 'hel', partial: true, agentPath: ['pm', 'architect'] },
  { type: 'thinking', text: 'considering options' },
  { type: 'tool.call', id: 't1', name: 'Edit', input: { path: 'a.ts' } },
  { type: 'tool.result', id: 't1', ok: true, summary: 'wrote a.ts', bytes: 128 },
  { type: 'file.changed', path: 'a.ts', change: 'modified' },
  { type: 'control', token: 'FORGE_ASK', payload: { question: 'ok?' } },
  { type: 'retry', attempt: 1, maxRetries: 3, reason: 'rate limit', delayMs: 500 },
  { type: 'usage', inputTokens: 10, outputTokens: 5 },
  { type: 'usage', inputTokens: 10, outputTokens: 5, cacheReadTokens: 2, costUsd: 0.01 },
  { type: 'error', code: 'ADP-001', message: 'boom', retryable: false },
  { type: 'session.ended', reason: 'complete' },
];

describe('normalizeAdapterEvent — every AdapterEvent variant round-trips', () => {
  it.each(WORKED_EXAMPLES.map((event) => [event.type, event] as const))(
    'accepts a realistic %s event unchanged',
    (_label, event) => {
      const result = normalizeAdapterEvent(event);
      expect(result).toEqual({ ok: true, event });
    },
  );
});

describe('normalizeAdapterEvent — rejects a malformed raw object', () => {
  it('rejects a shape missing a required field, naming the field path', () => {
    const result = normalizeAdapterEvent({ type: 'text', partial: false });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.issue.path).toBe('text');
  });

  it('rejects an unknown type discriminator', () => {
    const result = normalizeAdapterEvent({ type: 'not.a.real.type' });
    expect(result.ok).toBe(false);
  });

  it('rejects an extra, unrecognised field on an otherwise-valid event (.strict())', () => {
    const result = normalizeAdapterEvent({ type: 'thinking', text: 'x', bogus: true });
    expect(result.ok).toBe(false);
  });

  it('rejects a non-object value entirely, naming the root', () => {
    const result = normalizeAdapterEvent('not an object');
    expect(result.ok).toBe(false);
    expect(!result.ok && result.issue.path).toBe('(root)');
  });

  it('never throws for any input, including null/undefined/an array', () => {
    for (const input of [null, undefined, [], 42, true]) {
      expect(() => normalizeAdapterEvent(input)).not.toThrow();
    }
  });

  it('falls back to a default path/message if a failed parse ever reports zero issues', () => {
    // Zod's own contract guarantees `safeParse`'s `error.issues` is non-empty on a genuine failure —
    // this branch is unreachable through any real parse, only through a schema whose own contract is
    // violated. Exercised directly via a mock, the same shape `IdAllocator.allocate`'s own
    // provably-unreachable-but-type-necessary branch tests already use elsewhere in this codebase.
    type SafeParseResult = ReturnType<typeof adapterEventSchema.safeParse>;
    const emptyIssuesFailure = {
      success: false,
      error: { issues: [] },
    } as unknown as SafeParseResult;
    const spy = vi.spyOn(adapterEventSchema, 'safeParse').mockReturnValueOnce(emptyIssuesFailure);

    const result = normalizeAdapterEvent({ type: 'thinking', text: 'x' });
    expect(result).toEqual({
      ok: false,
      issue: { path: '(root)', message: 'does not match any known AdapterEvent variant' },
    });
    spy.mockRestore();
  });
});

describe('normalizeAdapterEvent — required unknown-typed keys (input, payload)', () => {
  it('rejects a tool.call with no input key at all, even though the value type is unknown', () => {
    const result = normalizeAdapterEvent({ type: 'tool.call', id: 't1', name: 'Edit' });
    expect(result).toEqual({ ok: false, issue: { path: 'input', message: 'Required' } });
  });

  it('accepts a tool.call whose input key is present with value undefined (the key existed)', () => {
    const result = normalizeAdapterEvent({
      type: 'tool.call',
      id: 't1',
      name: 'Edit',
      input: undefined,
    });
    expect(result.ok).toBe(true);
  });

  it('rejects a control event with no payload key at all', () => {
    const result = normalizeAdapterEvent({ type: 'control', token: 'FORGE_ASK' });
    expect(result).toEqual({ ok: false, issue: { path: 'payload', message: 'Required' } });
  });

  it('skips the required-unknown-key check (deferring to the ordinary schema failure) for a plain object with no string type at all', () => {
    // A plain object missing `type` entirely — the required-key pre-check reads `raw.type`, finds it
    // is not a string, and defers to `adapterEventSchema` itself to report the real problem, rather
    // than crashing or matching a `REQUIRED_UNKNOWN_KEY_BY_TYPE` entry that could not possibly apply.
    const result = normalizeAdapterEvent({ id: 't1', name: 'Edit', input: {} });
    expect(result.ok).toBe(false);
  });

  it('skips the required-unknown-key check for a numeric type value too', () => {
    const result = normalizeAdapterEvent({ type: 123 });
    expect(result.ok).toBe(false);
  });

  it.each(['constructor', 'toString', '__proto__', 'hasOwnProperty', 'valueOf'])(
    'does not resolve an Object.prototype member for type %s (the lookup is a Map, not a plain object)',
    (type) => {
      // A verify pass found the original plain-object lookup table resolved these exact `type`
      // strings to an *inherited* Object.prototype member instead of undefined, leaking a function
      // value into `issue.path` — a NormalizeAdapterEventIssue whose declared `path: string` was
      // silently violated at runtime. A schema-shape failure is the correct, ordinary outcome here
      // (none of these are real AdapterEvent types), with a genuine string path.
      const result = normalizeAdapterEvent({ type });
      expect(result.ok).toBe(false);
      expect(!result.ok && typeof result.issue.path).toBe('string');
    },
  );

  it('does not apply the required-key check to a type this rule does not name', () => {
    // Sanity: the check is scoped to exactly 'tool.call'/'control', not every event kind.
    const result = normalizeAdapterEvent({ type: 'thinking', text: 'x' });
    expect(result.ok).toBe(true);
  });
});

describe('normalizeAdapterEvent — never throws, even for adversarial property access', () => {
  it('does not throw for a raw object whose type getter throws', () => {
    const evil: Record<string, unknown> = {};
    Object.defineProperty(evil, 'type', {
      enumerable: true,
      get(): string {
        throw new Error('getter boom');
      },
    });
    const result = normalizeAdapterEvent(evil);
    expect(result.ok).toBe(false);
  });

  it('does not throw for a raw object whose non-discriminant field getter throws', () => {
    const evil: Record<string, unknown> = { type: 'text', partial: false };
    Object.defineProperty(evil, 'text', {
      enumerable: true,
      get(): string {
        throw new Error('text getter boom');
      },
    });
    const result = normalizeAdapterEvent(evil);
    expect(result.ok).toBe(false);
  });

  it('does not throw for a Proxy whose get trap throws', () => {
    const proxy = new Proxy(
      { type: 'text', text: 'x', partial: false },
      {
        get(): never {
          throw new Error('proxy get trap boom');
        },
      },
    );
    const result = normalizeAdapterEvent(proxy);
    expect(result.ok).toBe(false);
  });

  it("does not throw for a Proxy whose ownKeys trap throws (hit by .strict()'s extra-key scan)", () => {
    const proxy = new Proxy(
      { type: 'text', text: 'x', partial: false },
      {
        ownKeys(): never {
          throw new Error('proxy ownKeys trap boom');
        },
      },
    );
    const result = normalizeAdapterEvent(proxy);
    expect(result.ok).toBe(false);
  });

  it('falls back to String(cause) when the thrown value is not an Error instance', () => {
    const evil: Record<string, unknown> = {};
    Object.defineProperty(evil, 'type', {
      enumerable: true,
      get(): string {
        // eslint-disable-next-line @typescript-eslint/only-throw-error -- deliberately adversarial.
        throw 'a plain string, not an Error';
      },
    });
    const result = normalizeAdapterEvent(evil);
    expect(result).toEqual({
      ok: false,
      issue: { path: '(root)', message: 'a plain string, not an Error' },
    });
  });

  it("does not throw even when the thrown cause's own toString also throws", () => {
    // A verify pass found `describeThrown`'s own `String(cause)` fallback was unprotected: a thrown
    // value whose `toString`/`Symbol.toPrimitive` itself throws re-escaped past the outer catch.
    const evil: Record<string, unknown> = {};
    Object.defineProperty(evil, 'type', {
      enumerable: true,
      get(): string {
        // eslint-disable-next-line @typescript-eslint/only-throw-error -- deliberately adversarial.
        throw {
          toString(): never {
            throw new Error('toString itself throws');
          },
        };
      },
    });
    const result = normalizeAdapterEvent(evil);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.issue.message).toBe('a thrown value that could not be described');
  });

  it('does not throw for a self-referential Proxy thrown as the cause itself', () => {
    let proxy: object = {};
    proxy = new Proxy(
      {},
      {
        get(): never {
          // eslint-disable-next-line @typescript-eslint/only-throw-error -- deliberately adversarial.
          throw proxy;
        },
      },
    );
    const result = normalizeAdapterEvent(proxy);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.issue.message).toBe('a thrown value that could not be described');
  });
});

describe('normalizeAdapterEvent — numeric constraints reject Infinity, not just negatives/NaN', () => {
  it.each([
    [
      'retry.delayMs',
      { type: 'retry' as const, attempt: 1, maxRetries: 3, reason: 'x', delayMs: Infinity },
    ],
    ['usage.inputTokens', { type: 'usage' as const, inputTokens: Infinity, outputTokens: 1 }],
    [
      'usage.costUsd',
      { type: 'usage' as const, inputTokens: 1, outputTokens: 1, costUsd: Infinity },
    ],
    [
      'tool.result.bytes',
      { type: 'tool.result' as const, id: 't1', ok: true, summary: 'x', bytes: Infinity },
    ],
  ])('rejects Infinity for %s', (_label, event) => {
    const result = normalizeAdapterEvent(event);
    expect(result.ok).toBe(false);
  });
});
