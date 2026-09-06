/**
 * `applyAutofix` — `08` §8.11.6's `autofix` drift policy: "regenerate and commit."
 *
 * @see specs/08 §8.11.6
 * @see PLAN-M3.md P4
 */
import { writeFileAtomic, type AbsolutePath } from '@forge/core/fs';

/**
 * Overwrites the `.mmd` file at `target` with `expected` (a `DriftResult.expected`), atomically.
 *
 * This package owns no project-root or path-containment logic of its own (`diagrams ← core, schemas`
 * only, no KB-tree awareness) — the caller resolves a diagram's own project-relative `source` field
 * to a real, contained `AbsolutePath` before calling this.
 */
export async function applyAutofix(target: AbsolutePath, expected: string): Promise<void> {
  await writeFileAtomic(target, expected);
}
