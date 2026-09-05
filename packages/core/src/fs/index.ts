/**
 * `@forge/core/fs` — the single path every write to a host project goes through.
 *
 * `specs/02` §2.5: containment, the deny list, atomicity. A subpath (like `@forge/core/errors`) per
 * `PLAN-M1.md` P4's documented surface, so a consumer that only needs filesystem access — the
 * engine's scheduler, the VCS lane manager — can import it without naming the rest of the domain
 * model.
 *
 * @see specs/02 §2.5
 * @see specs/18 §18.10
 */
export { writeFileAtomic } from './atomic.ts';
export { ensureDir, listDirSorted, pathExists, readTextFile } from './operations.ts';
export { DENIED_PREFIXES, ProjectPaths, type AbsolutePath } from './paths.ts';
