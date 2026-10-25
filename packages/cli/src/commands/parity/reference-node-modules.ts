/**
 * `linkReferenceNodeModules` — restores, as an explicit mechanism, the property `specs/13` F-TEST-9's
 * "Where each side is observed" paragraph documents as a real, disclosed regression
 * (`process/SPEC-QUESTIONS.md` Q314): before M17 P8 moved the reference's scratch worktree outside
 * the project tree, Node's own `node_modules` directory walk-up reached the candidate's installed
 * packages from the nested worktree PURELY as an emergent property of that nesting — never a
 * mechanism the engine itself implemented (confirmed then, by grep, and re-confirmed here: no file
 * under `packages/cli/src/commands/parity/*.ts` did any symlinking or `NODE_PATH` injection before
 * this piece). Once the worktree moved outside the project's own working tree (`13` F-TEST-9, `18`'s
 * Worktree location paragraph, `specs/22` M17 P8), that walk-up no longer reaches anything. This
 * restores the identical "both sides run against one installed copy" property F-TEST-9's own honest
 * boundary paragraph already states as parity's accepted, by-design limitation ("a change of
 * installed dependency is not seen where both sides run against one installed copy" — a property the
 * spec continues to assume, not one this piece invents) — as an explicit, reviewable mechanism rather
 * than an accident of nesting.
 *
 * **Why a symlink, not `NODE_PATH` or a `setup` command — the other two options Q314's own DECISION
 * paragraph left open.**
 *   - `NODE_PATH` only steers Node's CommonJS `require()` resolution (`module.paths`) — confirmed
 *     empirically (this piece's own test coverage), Node's ESM resolver never consults it at all, so
 *     any reference-side command that is an ES module (`import`), or that shells out to a
 *     locally-installed binary under `node_modules/.bin`, would still fail to resolve. The spec's own
 *     "any runtime" framing for this gap (F-TEST-9, above) rules out a Node-require-only fix.
 *   - A `setup` command cannot do this at all: F-TEST-9 vets `setup` exactly as `run` is, and
 *     `network: none` applies to it too, so a recognised package-manager install verb (`npm install`,
 *     `pnpm install`, …) is refused outright by the engine's own vetting — there is no
 *     declaration-authored way to populate `node_modules` from inside a vetted command.
 *   - A symlink the harness creates itself — one entry, `<worktreeRoot>/node_modules` pointing at the
 *     project's own, already-installed `node_modules` — needs neither: confirmed empirically (this
 *     module's own test file) that both Node's CJS and ESM resolvers correctly follow it, from a
 *     script nested arbitrarily deep inside the scratch tree, as plain directory walk-up — exactly
 *     reproducing what the old, accidental nesting gave for free. It is also exactly what the old
 *     nesting *was*: one real `node_modules` directory, reached by walk-up — this makes that
 *     reachability explicit instead of removing it.
 *
 * **Scoped to the project root's own top-level `node_modules` only**, matching the old, accidental
 * mechanism's own real reach: the pre-M17 nested worktree's walk-up, from anywhere inside it, climbed
 * past every intermediate directory (none of which had their own `node_modules`, since the nested
 * worktree held only `git worktree add`'s freshly-checked-out tracked files) until it struck the
 * project root's own top-level `node_modules`, never a workspace package's own nested one. This
 * mirrors that reach precisely, not a deeper, package-by-package equivalent — a bigger mechanism than
 * the regression this closes, and not something that ever worked before M17 P8 either.
 *
 * **Safe to remove alongside the rest of the scratch worktree.** The symlink is one plain directory
 * entry under the worktree root; removing the worktree (`git worktree remove`, or the raw `fs.rm`
 * fallback `@forge/vcs`'s own `removeLaneWorktree` falls back to) unlinks that entry without ever
 * following it into the real `node_modules` it points at — confirmed empirically (this module's own
 * test file, and independently via a bare `git worktree remove` repro), not assumed.
 *
 * A no-op when the project has no top-level `node_modules` at all (nothing installed, or a non-Node
 * project) — `13` F-TEST-9's own `setup` escape hatch already covers "needs more than the tracked
 * files" generically for anything this narrower mechanism does not reach.
 *
 * **Also a no-op when the destination already exists (`EEXIST`) — a real, not merely theoretical,
 * case.** A project that intentionally tracks its own `node_modules` in git (rare, but real: airgapped
 * or compliance setups — `specs/20` §20.2's deny list names `node_modules/` as its own, separate
 * bullet from "anything in `.gitignore`", which only makes sense if a tracked `node_modules` is an
 * anticipated case) means `createLaneWorktree`'s own ordinary checkout already populated the scratch
 * worktree's `node_modules` with real, tracked content before this function ever runs — module
 * resolution there already works, with no symlink needed, exactly as it did immediately after M17 P8
 * landed and before this piece existed. Refusing with `RUN-163` here would be a genuine regression
 * (confirmed by direct execution, not assumed): it would convert a working scenario into a permanent,
 * unrecoverable failure with no actionable remedy, since the "problem" is the project's own
 * intentionally-tracked dependencies, not anything wrong. `EEXIST` is therefore the one error code
 * this function treats as the identical no-op as "nothing to link" — anything else (a permissions
 * problem, say) still raises `RUN-163`.
 *
 * @throws {ForgeError} `RUN-163` if a `node_modules` symlink genuinely cannot be created for a reason
 * other than the destination already existing — not either no-op above, which is not a failure.
 *
 * @see specs/13-frameworks-testing-and-debugging.md F-TEST-9
 * @see process/SPEC-QUESTIONS.md Q314
 * @see process/plans/PLAN-M17.md P8
 */
import { lstat, symlink } from 'node:fs/promises';
import path from 'node:path';

import { ForgeError } from '@forge/core/errors';

const NODE_MODULES = 'node_modules';

/** Whether `absolutePath` exists, by any entry type — mirrors `candidate-isolation.ts`'s own local
 * `exists` helper (not shared: that one is private to its own module), the same "ask `lstat`, treat
 * `ENOENT` as the one legitimate false, propagate anything else" shape used throughout this
 * directory. */
async function exists(absolutePath: string): Promise<boolean> {
  try {
    await lstat(absolutePath);
    return true;
  } catch (cause) {
    if (cause instanceof Error && 'code' in cause && cause.code === 'ENOENT') return false;
    throw cause;
  }
}

/**
 * Symlinks `<projectRoot>/node_modules` to `<worktreeRoot>/node_modules`, so a reference-side `setup`
 * or `run` command that imports a third-party package resolves it exactly as the candidate does — see
 * this module's own doc comment for the full account of why a symlink, scoped to only the project's
 * top-level `node_modules`, is the right mechanism. Called once, right after the reference's scratch
 * worktree is created and before any surface's `setup` or `run` ever executes inside it
 * (`observe.ts`'s own `withReferenceWorktree`) — never for the candidate side, which already has its
 * own real `node_modules` in place.
 */
export async function linkReferenceNodeModules(
  projectRoot: string,
  worktreeRoot: string,
): Promise<void> {
  const source = path.join(projectRoot, NODE_MODULES);
  if (!(await exists(source))) return; // Nothing installed to share -- see this module's own doc comment.

  const destination = path.join(worktreeRoot, NODE_MODULES);
  try {
    await symlink(source, destination, 'dir');
  } catch (cause) {
    // A destination that already exists (a real, tracked `node_modules` the checkout itself already
    // populated -- see this module's own doc comment) means resolution there already works with no
    // symlink needed: the identical no-op as "nothing to link", never a failure.
    if (cause instanceof Error && 'code' in cause && cause.code === 'EEXIST') return;
    throw new ForgeError(
      'RUN-163',
      { path: destination, detail: cause instanceof Error ? cause.message : String(cause) },
      { cause },
    );
  }
}
