/**
 * `@forge/vcs` — worktrees, lane branches, merge queue, conflict detection, claim enforcement,
 * shared-path strategies, dirty-tree protection (`specs/22` M5).
 *
 * @see specs/06 §6.4-§6.7
 * @see PLAN-M5.md
 */
export {
  applySharedPathStrategy,
  diffLaneChanges,
  enforceClaim,
  type ClaimEnforcementResult,
  type SharedPathStrategyOptions,
} from './claims.ts';
export {
  assertSingleLine,
  commitInLane,
  formatCommitMessage,
  type CommitMessageOptions,
} from './commit.ts';
export { SYSTEM_CLOCK, type VcsClock } from './clock.ts';
export { VcsError, type VcsErrorInit } from './errors.ts';
export {
  analyzeGitProfile,
  type ChurnHotspot,
  type CoChangePair,
  type GitProfile,
  type GitProfileOptions,
} from './git-profile.ts';
export {
  assertCleanWorkingTree,
  assertGitAvailable,
  errorMessage,
  getDirtyFiles,
  isNoCommitsYetResult,
  resolveHeadShaOrUndefined,
  resolveRevision,
  snapshotRepoState,
  wrapGitFailure,
  type RepoSnapshot,
} from './git.ts';
export { createAnnotatedTag, resolveTagCommit, tagExists } from './tag.ts';
export {
  clearStaleRepoLocks,
  createLaneWorktree,
  laneBranchName,
  listOrphanedLaneBranches,
  listOrphanedWorktreeDirectories,
  listOrphanedWorktrees,
  parseWorktreeBlocks,
  removeLaneWorktree,
  removeOrphanedLaneBranch,
  removeOrphanedWorktreeDirectory,
  resetLaneWorktree,
  slugifyStepId,
  type LaneHandle,
  type LaneId,
  type ParsedWorktreeBlock,
} from './lanes.ts';
export {
  conflictStatuses,
  processMergeCandidate,
  revertMerge,
  type CheckResult,
  type ConflictedFile,
  type MergeCandidate,
  type MergeConflictDescription,
  type MergeConflictResolver,
  type MergeOutcome,
  type PostMergeCheck,
  type PreMergeCheck,
  type ProcessMergeCandidateOptions,
} from './merge-queue.ts';
