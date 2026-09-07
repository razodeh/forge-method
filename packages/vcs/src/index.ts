/**
 * `@forge/vcs` — worktrees, lane branches, merge queue, conflict detection, claim enforcement,
 * shared-path strategies, dirty-tree protection (`specs/22` M5).
 *
 * @see specs/06 §6.4-§6.7
 * @see PLAN-M5.md
 */
export { VcsError, type VcsErrorInit } from './errors.ts';
export {
  assertCleanWorkingTree,
  assertGitAvailable,
  getDirtyFiles,
  isNoCommitsYetResult,
  resolveHeadShaOrUndefined,
  snapshotRepoState,
  wrapGitFailure,
  type RepoSnapshot,
} from './git.ts';
