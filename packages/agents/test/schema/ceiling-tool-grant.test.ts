/**
 * `CeilingToolGrant`'s own doc comment (`src/schema/types.ts`) claims its fields are "asserted equal to
 * `ToolGrant`'s by a dedicated test" -- a fresh critic round found no such test existed. This is that
 * test.
 *
 * @see specs/05 §5.3
 * @see specs/15 §15.3.2
 * @see PLAN-M6.md A1
 */
import type { ToolGrant } from '@forge/extensions/agents';
import { describe, expect, it } from 'vitest';

import type { CeilingToolGrant } from '../../src/schema/types.ts';

/** `true` only when `A` and `B` have exactly the same key set (neither has a key the other lacks). If
 * `@forge/extensions/agents`'s own `ToolGrant` (M2 P3) gains or loses a field, `KeysMatch` here becomes
 * `false`, and the assignment below fails to compile -- caught by `tsc --noEmit`, the real floor check
 * this repo's own CI already runs, not a runtime assertion (there is no runtime representation of a
 * TypeScript-only interface to compare against). */
type KeysMatch<A, B> = [keyof A] extends [keyof B]
  ? [keyof B] extends [keyof A]
    ? true
    : false
  : false;

describe('CeilingToolGrant', () => {
  it("has exactly the same key set as @forge/extensions/agents's own ToolGrant (compile-time-checked)", () => {
    const keysMatch: KeysMatch<CeilingToolGrant, ToolGrant> = true;
    expect(keysMatch).toBe(true);
  });
});
