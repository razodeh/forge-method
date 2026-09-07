/**
 * `appendKbEvent` — `08` §8.6: a direct write or an adjudicated proposal "appends an event." No
 * general, run-wide event-log implementation exists anywhere in this codebase yet (`SPEC-QUESTIONS.md`
 * Q52, point 5) — this is `KbWriter`'s own small, KB-scoped append-only log instead, at
 * `.forge/state/kb-events.jsonl` (one JSON object per line), via `ProjectPaths.resolveState` (the same
 * `.forge/state/`-internal-writer route `SPEC-QUESTIONS.md` Q29 established for the id cache).
 *
 * Read-modify-write of the whole file, not a true filesystem append: safe here because every call
 * this module receives is already serialised through `KbWriter`'s own per-operation queues — nothing
 * else ever writes this file concurrently.
 *
 * @see specs/08 §8.6
 * @see SPEC-QUESTIONS.md Q52
 * @see PLAN-M3.md P7
 */
import { pathExists, readTextFile, writeFileAtomic, type ProjectPaths } from '@forge/core/fs';

import type { KbSection } from '../schema/sections.ts';

export interface KbEvent {
  readonly at: string;
  readonly kind: 'write' | 'propose-applied' | 'propose-conflict';
  readonly entryId: string;
  readonly section: KbSection;
}

export async function appendKbEvent(paths: ProjectPaths, event: KbEvent): Promise<void> {
  const target = paths.resolveState('kb-events.jsonl');
  const existing = (await pathExists(target)) ? await readTextFile(target) : '';
  await writeFileAtomic(target, `${existing}${JSON.stringify(event)}\n`);
}
