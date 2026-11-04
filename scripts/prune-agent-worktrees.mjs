#!/usr/bin/env node
/**
 * Removes `.claude/worktrees/agent-*` git worktrees left behind by `isolation:"worktree"`
 * subagents once their useful output (a diff, a critic finding) has been captured elsewhere.
 * Nothing with uncommitted changes is ever touched -- those are reported so a human notices
 * growth instead of it silently accumulating (the problem this script exists to prevent: 106
 * such directories, 70GB, built up unnoticed over a week of sessions).
 *
 * Run directly (`node scripts/prune-agent-worktrees.mjs`) or wired as a Claude Code SessionStart
 * hook; see .claude/settings.json.
 */
import { execFileSync } from 'node:child_process';

/**
 * @param {readonly string[]} args
 * @param {{ cwd?: string }} [options]
 */
function git(args, options = {}) {
  return execFileSync('git', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
  });
}

/** @param {unknown} err */
function firstLine(err) {
  const failure = /** @type {{ stderr?: string; message?: string }} */ (err);
  return String(failure.stderr ?? failure.message).split('\n')[0];
}

/** @param {number} pid */
function isPidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    const failure = /** @type {{ code?: string }} */ (err);
    return failure.code !== 'ESRCH';
  }
}

function main() {
  try {
    git(['worktree', 'prune', '-v']);
  } catch {
    // Non-fatal -- fall through and still try to inspect what's left.
  }

  let porcelain;
  try {
    porcelain = git(['worktree', 'list', '--porcelain']);
  } catch (err) {
    const failure = /** @type {{ message?: string }} */ (err);
    console.error(`prune-agent-worktrees: could not list worktrees: ${failure.message}`);
    return;
  }

  const agentWorktrees = porcelain
    .split('\n\n')
    .map((block) => block.split('\n').find((line) => line.startsWith('worktree ')))
    .filter((line) => line !== undefined)
    .map((line) => line.slice('worktree '.length))
    .filter((path) => /\.claude\/worktrees\/agent-[^/]+$/.test(path));

  if (agentWorktrees.length === 0) return;

  let removed = 0;
  let staleLocksCleared = 0;
  const dirty = [];
  const liveLocked = [];

  for (const worktreePath of agentWorktrees) {
    let status;
    try {
      status = git(['status', '--short'], { cwd: worktreePath });
    } catch (err) {
      dirty.push(`${worktreePath} (status check failed: ${firstLine(err)})`);
      continue;
    }

    if (status.trim() !== '') {
      const fileCount = status.trim().split('\n').length;
      dirty.push(`${worktreePath} (${fileCount} uncommitted change${fileCount === 1 ? '' : 's'})`);
      continue;
    }

    try {
      git(['worktree', 'remove', worktreePath]);
      removed += 1;
      continue;
    } catch (err) {
      const failure = /** @type {{ stderr?: string; message?: string }} */ (err);
      const stderr = String(failure.stderr ?? failure.message);
      const lockMatch = stderr.match(/cannot remove a locked working tree, lock reason: (.*)/);
      if (!lockMatch) {
        dirty.push(`${worktreePath} (remove failed: ${firstLine(err)})`);
        continue;
      }

      // A worktree lock left by a Claude Code agent names the PID that holds it. If that PID is
      // no longer running, the lock is stale (the owning process exited without releasing it --
      // this is the exact mechanism that let 13 of the original 106 pollution directories linger
      // even though they were otherwise clean) and it's safe to unlock and remove. If the PID is
      // still alive, this worktree belongs to another currently-running session -- leave it alone.
      // `lockMatch[1]`'s `(.*)` group always matches (even as '') whenever the outer regex does --
      // the `?? ''` fallback only satisfies noUncheckedIndexedAccess, it never actually triggers.
      const lockReason = lockMatch[1] ?? '';
      const pidMatch = lockReason.match(/pid (\d+)/);
      const pid = pidMatch ? Number(pidMatch[1]) : undefined;
      const isAlive = pid !== undefined && isPidAlive(pid);

      if (pid !== undefined && !isAlive) {
        try {
          git(['worktree', 'unlock', worktreePath]);
          git(['worktree', 'remove', worktreePath]);
          removed += 1;
          staleLocksCleared += 1;
          continue;
        } catch (unlockErr) {
          dirty.push(
            `${worktreePath} (stale lock, but remove still failed: ${firstLine(unlockErr)})`,
          );
          continue;
        }
      }

      liveLocked.push(`${worktreePath} (locked: ${lockReason})`);
    }
  }

  const parts = [];
  if (removed > 0) {
    const staleNote =
      staleLocksCleared > 0 ? `, ${staleLocksCleared} had a stale lock from an exited process` : '';
    parts.push(`removed ${removed} clean agent worktree${removed === 1 ? '' : 's'}${staleNote}`);
  }
  if (liveLocked.length > 0) {
    parts.push(
      `${liveLocked.length} left alone, locked by a currently-running process:\n  ${liveLocked.join('\n  ')}`,
    );
  }
  if (dirty.length > 0) {
    parts.push(
      `${dirty.length} dirty agent worktree${dirty.length === 1 ? '' : 's'} left untouched:\n  ${dirty.join('\n  ')}`,
    );
  }

  if (parts.length > 0) {
    console.log(JSON.stringify({ systemMessage: `[worktree cleanup] ${parts.join('; ')}` }));
  }
}

main();
