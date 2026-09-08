/**
 * `@forge/agents/handoff` — `05` §5.6's handoff protocol.
 *
 * @see specs/05 §5.6
 * @see PLAN-M6.md A7
 */
export { handoffRecordSchema, type HandoffRecord } from '@forge/schemas/artifacts';
export { emitHandoff } from './emit-handoff.ts';
export { inboundHandoffFor } from './inbound-handoff-for.ts';
export type { EmitHandoffContext, HandoffTelemetryEmitter } from './types.ts';
