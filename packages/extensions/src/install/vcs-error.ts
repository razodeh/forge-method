/**
 * `vcsFailureDetails` — the `{ vcsCode, vcsMessage }` pair every `@forge/vcs`-wrapping `ForgeError`
 * in this directory needs (`VCS-008`, `VCS-009`), factored once rather than duplicated between
 * `fetch-git.ts`, `fetch-local.ts`, and `fetch-npm.ts` (all three wrap the identical
 * `computeContentChecksum` failure as `VCS-009`).
 *
 * @see PLAN-M11.md P1
 * @see PLAN-M11.md P2
 */
import { VcsError } from '@forge/vcs';

/**
 * Checks `cause instanceof VcsError` first, rather than merely duck-typing "has a string `.code`" —
 * a critic round found the original duck-typed version would report an unrelated raw `node:fs` error
 * (an `ENOENT`/`EACCES` that reached this layer for some other reason) as if its own `.code` were a
 * legitimate `VcsError` code, conflating two unrelated code namespaces in the resulting message. Only
 * a genuine `VcsError` gets its own `code`/`message` surfaced; anything else is reported as `UNKNOWN`
 * with `String(cause)`, honestly, rather than guessed at.
 */
export function vcsFailureDetails(cause: unknown): { vcsCode: string; vcsMessage: string } {
  if (cause instanceof VcsError) {
    return { vcsCode: cause.code, vcsMessage: cause.message };
  }
  return { vcsCode: 'UNKNOWN', vcsMessage: cause instanceof Error ? cause.message : String(cause) };
}
