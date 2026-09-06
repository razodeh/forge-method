/**
 * `violation` — builds one `InvariantViolation`, rendering its `message` through the real,
 * already-registered `ForgeError` template for `code` rather than a hand-rolled string that could
 * drift from what a thrown `ForgeError` for the same code would actually say.
 *
 * `ForgeError` is constructed but never thrown here: its `.message` is already rendered at
 * construction time (`ForgeError`'s own constructor calls `super(definition.message(details))`), so
 * reading it needs no throw/catch — the same pattern `packages/core/test/errors.test.ts` itself uses
 * to inspect a code's rendering.
 *
 * @see PLAN-M2.md P8
 */
import { ForgeError, type ErrorDetailsFor, type ForgeErrorCode } from '@forge/core';

import type { InvariantId, InvariantViolation } from './types.ts';

export function violation<TCode extends ForgeErrorCode>(
  id: InvariantId,
  code: TCode,
  details: ErrorDetailsFor<TCode>,
): InvariantViolation {
  return { id, code, message: new ForgeError(code, details).message };
}
