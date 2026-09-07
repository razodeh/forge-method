/**
 * `@forge/adapter-kit/events` — `AdapterEvent` runtime validation and normalisation.
 *
 * @see specs/07 §7.2
 * @see PLAN-M4.md P1
 */
export { adapterEventSchema } from './schema.ts';
export {
  normalizeAdapterEvent,
  type NormalizeAdapterEventIssue,
  type NormalizeAdapterEventResult,
} from './normalize.ts';
