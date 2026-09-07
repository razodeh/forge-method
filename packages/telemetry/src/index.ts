/**
 * `@forge/telemetry` — the event log (write-ahead log, redaction at write time), cost ledger and budget
 * projections (`specs/22` M5).
 *
 * @see specs/18 §18.4
 * @see PLAN-M5.md
 */
export { TelemetryError, type TelemetryErrorInit } from './errors.ts';
export {
  appendEvent,
  errorCode,
  errorMessage,
  readEvents,
  type AppendEventOptions,
  type EventType,
  type ForgeEvent,
  type NewForgeEvent,
} from './events.ts';
export {
  attributedSpend,
  checkBudget,
  detectRunaway,
  projectLedger,
  type BudgetCheckInput,
  type LedgerEntry,
  type RetryAttempt,
  type UsageRecordedPayload,
} from './ledger.ts';
export { redactPayload } from './redact.ts';
