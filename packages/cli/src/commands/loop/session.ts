/**
 * `forge session <type>` / `forge session <list|show <id>|resume <id>>` — `03` §3.2.6. `16`'s own
 * facilitated-collaboration-session mechanism (`brainstorm`/`design-review`/`retro`/`premortem`/
 * `war-room`/`estimation`/`tradeoff`/`standup`) is not named anywhere in `22`'s own M6 Build line —
 * `PLAN-M6.md` C5's own Mandate text records this as a real scope boundary and asks for a clearly-
 * marked "not yet implemented" error rather than silently building `16`'s own engine ahead of its own
 * milestone, or omitting the command from the CLI's own `--help` surface entirely.
 *
 * @see specs/03 §3.2.6
 */
import { ForgeError } from '@forge/core/errors';

export type SessionType =
  | 'brainstorm'
  | 'design-review'
  | 'retro'
  | 'premortem'
  | 'war-room'
  | 'estimation'
  | 'tradeoff'
  | 'standup';

/** @throws {ForgeError} `USR-003`, always. */
export function startSession(type: SessionType): never {
  throw new ForgeError('USR-003', { feature: `forge session ${type}` });
}

/** @throws {ForgeError} `USR-003`, always — `list`/`show`/`resume` all read real session records
 * `startSession` never had a chance to write in the first place. */
export function sessionList(): never {
  throw new ForgeError('USR-003', { feature: 'forge session list' });
}

export function sessionShow(): never {
  throw new ForgeError('USR-003', { feature: 'forge session show' });
}

export function sessionResume(): never {
  throw new ForgeError('USR-003', { feature: 'forge session resume' });
}
