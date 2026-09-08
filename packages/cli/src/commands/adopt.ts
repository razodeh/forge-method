/**
 * `forge adopt [dir]` — `03` §3.2.1: "Brownfield: ingest an existing codebase into a KB (see `17`)."
 *
 * `PLAN-M6.md` C3's own Mandate text explicitly sanctions this: brownfield ingestion is `17`'s own
 * mechanism, `17` is not itself a separate M6 package, and "if no such mechanism exists yet in any
 * earlier milestone, record that gap explicitly rather than inventing brownfield ingestion here."
 * No codebase-scanning, KB-population, or component-inference mechanism exists anywhere in this
 * repository as of M6 — grepping every package's `src/` for anything resembling brownfield ingestion
 * finds nothing. Refused rather than fabricated.
 *
 * @see specs/03 §3.2.1
 * @see specs/17
 */
import { ForgeError } from '@forge/core/errors';

export function adopt(): never {
  throw new ForgeError('USR-003', { feature: 'forge adopt (brownfield ingestion, specs/17)' });
}
