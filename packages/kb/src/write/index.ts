/**
 * `@forge/kb/write` — `08` §8.6: KB id allocation and the two write paths.
 *
 * @see PLAN-M3.md P7
 */
export { KbIdAllocator, type KbIdAllocatorDeps } from './id-allocator.ts';
export {
  KbWriter,
  KB_PROPOSAL_FIELDS,
  type KbWriterDeps,
  type KbEntryInput,
  type KbProposal,
  type KbProposalField,
  type KbProposalOutcome,
  type KbWriteOptions,
} from './writer.ts';
export { appendKbEvent, type KbEvent } from './event-log.ts';
