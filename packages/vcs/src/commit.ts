/**
 * Lane commit conventions: `06` §6.4 step 3's own exact format — `forge(<story>): …`, trailers
 * `Forge-Step`, `Forge-Run`, `Co-Authored-By:` the agent role — so every lane commit is mechanically
 * parseable by the merge queue (P5), the audit trail (`20` §20.9), and a human reading `git log`.
 *
 * @see specs/06 §6.4
 * @see specs/18 §18.3
 * @see PLAN-M5.md P3
 */
import path from 'node:path';

import { execa } from 'execa';

import { VcsError } from './errors.ts';
import { getDirtyFiles, wrapGitFailure } from './git.ts';
import type { LaneHandle } from './lanes.ts';

export interface CommitMessageOptions {
  /** `06` §6.4's own example names this "story" — kept generic here since not every lane commit is
   * necessarily scoped to a story specifically. */
  readonly scope: string;
  readonly subject: string;
  readonly stepId: string;
  readonly runId: string;
  readonly agentRole: string;
}

/** `stepId` in particular flows from a workflow YAML file a project can overlay (`lanes.ts`'s own
 * `laneBranchName` comment), and `subject` is the field most likely to carry LLM-generated freeform
 * text — neither is fully-trusted, FORGE-internal data. A bare `\n` in any of the five fields below
 * would let that data forge a trailer line (e.g. a `stepId` of `"real\nForge-Step: forged"` lands
 * *inside* the real trailer paragraph, and `git interpret-trailers` reads it as a second, equally
 * legitimate `Forge-Step` value) or, via `subject`, open a second fake trailer-shaped paragraph in the
 * permanent audit record (`20` §20.9). Rejecting the newline outright — rather than stripping or
 * escaping it — keeps the failure loud at the one point where this data is still structured, instead of
 * silently mangling content a caller might not notice. */
/** Exported — not just used locally — so `merge-queue.ts` can apply the identical guarantee to the
 * `stepId`/`runId` it tags a merge (and revert) commit message with. Those trailers carry exactly the
 * same forgeable-newline risk this function was built for; reusing the one check keeps that property
 * from drifting out of sync between the two call sites rather than being reimplemented at the second. */
export function assertSingleLine(fieldName: string, value: string): void {
  if (value.includes('\n') || value.includes('\r')) {
    throw new VcsError({
      code: 'VCS-INVALID-COMMIT-FIELD',
      message: `Commit message field "${fieldName}" contains a newline or carriage return, which would corrupt the commit's conventional-commit structure and could forge a trailer.`,
      remedy: `Remove any newline/carriage-return characters from "${fieldName}" before formatting the commit message.`,
    });
  }
}

const AGENT_ROLE_PATTERN = /^[a-z][a-z0-9-]*$/;

/** `agentRole` is reused as both the display name and the email local-part of the `Co-Authored-By`
 * trailer below, so — beyond just rejecting a newline — it needs a shape that makes sense as both at
 * once. This is stricter than `assertSingleLine`, not an addition to it: it already rejects any
 * newline, along with a bare space, an empty string, or an already-email-shaped value (all confirmed to
 * produce a trailer git accepts as well-formed but that defeats its own purpose as real co-author
 * crediting). The pattern matches this spec pack's own agent role id convention (`specs/05` §5's role
 * table: `architect`, `data-architect`, `reviewer`, …). */
function assertValidAgentRole(agentRole: string): void {
  if (!AGENT_ROLE_PATTERN.test(agentRole)) {
    throw new VcsError({
      code: 'VCS-INVALID-AGENT-ROLE',
      message: `"${agentRole}" is not a valid agent role: it must be a lowercase identifier (letters, digits, hyphens, starting with a letter) to form a well-shaped "Co-Authored-By" name and email local-part.`,
      remedy:
        'Use the agent\'s short role id (e.g. "engineer", "reviewer", "data-architect"), not a display name or an email address.',
    });
  }
}

/** A `Co-Authored-By` trailer needs a real "Name <email>" shape for git/GitHub tooling to recognise it
 * at all — `06` §6.4 step 3 names only "the agent role" as the value, not an email. `.invalid` is the
 * RFC 2606-reserved TLD this repo's own test identity already uses (`test/setup.ts`'s
 * `test@forge.invalid`) for exactly the same reason: an address that cannot be mistaken for, or ever
 * resolve to, a real person's inbox. A distinct `agents.` subdomain keeps a synthetic agent co-author
 * identity visibly separate from that unrelated test-fixture identity. */
function agentCoAuthorTrailer(agentRole: string): string {
  return `Co-Authored-By: ${agentRole} <${agentRole}@agents.forge.invalid>`;
}

/** `forge(<scope>): <subject>`, followed by the three trailers `06` §6.4 step 3 requires, in the order
 * given there. Pure formatting — no git call — so the exact shape is independently testable against
 * the spec's own worked example without a real repository. Throws `VcsError` (`VCS-INVALID-COMMIT-FIELD`
 * / `VCS-INVALID-AGENT-ROLE`) rather than producing a structurally unsafe message — see
 * `assertSingleLine`/`assertValidAgentRole` above. */
export function formatCommitMessage(options: CommitMessageOptions): string {
  assertSingleLine('scope', options.scope);
  assertSingleLine('subject', options.subject);
  assertSingleLine('stepId', options.stepId);
  assertSingleLine('runId', options.runId);
  assertValidAgentRole(options.agentRole);

  return [
    `forge(${options.scope}): ${options.subject}`,
    '',
    `Forge-Step: ${options.stepId}`,
    `Forge-Run: ${options.runId}`,
    agentCoAuthorTrailer(options.agentRole),
  ].join('\n');
}

/** `formatCommitMessage`'s own sibling for a commit the FORGE CLI makes directly, on its own behalf,
 * rather than a lane commit an agent's session produced (`forge config set <key> <value> --commit`,
 * `PLAN-M14.md` P37): the identical `forge(<scope>): <subject>` header, and the identical
 * `Forge-Step`/`Forge-Run` trailer lines when they apply, built through the same `assertSingleLine`
 * check `formatCommitMessage` already uses (so a `stepId` that could forge a trailer line is rejected
 * here exactly as it would be there) — but no `Co-Authored-By` trailer at all (there is no agent role:
 * this is a plain CLI write, not lane work an agent produced), and the trailer paragraph itself is
 * OPTIONAL, present only when `marker` is. `configSet --commit`'s own real caller passes `ctx.marker`
 * (`bin.ts`'s `gateCommandMarker(realEnvSnapshot())`, P4/P15's identical shape): absent for a human
 * typing the command at their own shell (no trailer paragraph at all), `{runId, stepId}` inside a
 * run-spawned `command` step (`intake:record-level`). */
export interface ConfigCommitMessageOptions {
  readonly scope: string;
  readonly subject: string;
  /** The real FORGE run/step marker, `bin.ts`'s `GateCommandContext['marker']`-shaped: `stepId` is
   * itself optional even when `runId` is present (a session-level marker, not a `command` step's own),
   * the identical shape `gateCommandMarker` already returns. */
  readonly marker?: { readonly runId: string; readonly stepId?: string };
}

export function formatConfigCommitMessage(options: ConfigCommitMessageOptions): string {
  assertSingleLine('scope', options.scope);
  assertSingleLine('subject', options.subject);
  const header = `forge(${options.scope}): ${options.subject}`;
  if (options.marker === undefined) return header;

  const trailers: string[] = [];
  if (options.marker.stepId !== undefined) {
    assertSingleLine('stepId', options.marker.stepId);
    trailers.push(`Forge-Step: ${options.marker.stepId}`);
  }
  assertSingleLine('runId', options.marker.runId);
  trailers.push(`Forge-Run: ${options.marker.runId}`);
  return [header, '', ...trailers].join('\n');
}

/** Stages everything in the lane worktree (`git add -A` — new, modified and deleted files alike; `06`
 * §6.4 step 3 says only "the agent commits," not "the agent stages, then commits") and commits it with
 * `message`, optionally signed (`sign`, wiring `18` §18.3's own `vcs.signCommits`). Returns the new
 * commit's own sha, so a caller (the merge queue, P5) has it without a separate `rev-parse` round trip.
 *
 * Checks the working tree for real, structural dirtiness (`getDirtyFiles`, the same check
 * `assertCleanWorkingTree` already uses) *before* attempting `git add`/`git commit`, and returns the
 * lane's own current `HEAD` unchanged — a genuine no-op, not an error — when there is nothing to stage
 * at all. A gauntlet critic round (`@forge/engine/resume`'s own P19/P20 crash-resume E2E test) found the
 * previous, unconditional version threw a raw `git commit` failure ("nothing to commit, working tree
 * clean") whenever a caller re-ran identical, already-idempotent work against a lane whose own prior
 * attempt had already committed it — exactly `06` §6.10's own resume/reroll scenario, where re-running a
 * step from its `idempotencyKey` after a crash can legitimately reproduce content the lane already has.
 * `session.changedFiles.length > 0`-shaped callers (`@forge/engine/dispatch`'s own `runAgentWork`) only
 * know whether the *session itself* wrote anything, never whether that write actually changed the lane's
 * own current state — this is the one place that gap can be closed structurally, for every caller at
 * once, rather than patched per call site. */
export async function commitInLane(
  handle: LaneHandle,
  options: { readonly message: string; readonly sign: boolean },
): Promise<{ readonly sha: string }> {
  const dirtyFiles = await getDirtyFiles(handle.path);
  if (dirtyFiles.length === 0) {
    const { stdout } = await wrapGitFailure(
      () => execa('git', ['rev-parse', 'HEAD'], { cwd: handle.path }),
      `resolving the lane worktree's own current HEAD (nothing to commit) at "${handle.path}"`,
    );
    return { sha: stdout.trim() };
  }

  await wrapGitFailure(
    () => execa('git', ['add', '-A'], { cwd: handle.path }),
    `staging changes in the lane worktree at "${handle.path}"`,
  );

  const commitArgs = ['commit', '-m', options.message, ...(options.sign ? ['-S'] : [])];
  await wrapGitFailure(
    () => execa('git', commitArgs, { cwd: handle.path }),
    `committing in the lane worktree at "${handle.path}"`,
  );

  const { stdout } = await wrapGitFailure(
    () => execa('git', ['rev-parse', 'HEAD'], { cwd: handle.path }),
    `resolving the new commit's sha in the lane worktree at "${handle.path}"`,
  );
  return { sha: stdout.trim() };
}

export interface CommitPathsOptions {
  /** Paths relative to `cwd`, staged and committed EXACTLY as given — never widened by any real git
   * default. Every real caller today (`configSet --commit`, P37) passes exactly one, but nothing here
   * assumes that: the property this function exists for ("commits exactly the named paths, nothing
   * else") has to hold for whatever a caller passes. */
  readonly paths: readonly string[];
  readonly message: string;
  readonly sign: boolean;
}

export interface CommitPathsResult {
  readonly sha: string;
  /** `false` for a real no-op: none of `paths` were dirty, nothing was staged or committed, and `sha`
   * is simply `cwd`'s own already-current `HEAD` — never a fabricated "new" sha for a commit that never
   * happened. `configSet --commit` (P37) reports this case as its own `committed: null`, not `sha`. */
  readonly committed: boolean;
}

/** Throws `VCS-COMMIT-PATH-ESCAPES-REPO` if `relativePath` is absolute, or resolves outside `cwd` via
 * `..` — `git add`/`git commit`'s own pathspec resolution is relative to the process's *working
 * directory*, not the repository root, and neither rejects an absolute path or a `..`-escaping one on
 * its own; without this check, a caller-supplied path could stage or commit something entirely outside
 * `cwd`, which is exactly the "stages/commits EXACTLY the named paths" contract `commitPaths` exists to
 * hold (this piece's own single most important correctness property, per its own build brief). */
function assertPathWithinRepo(cwd: string, relativePath: string): void {
  if (path.isAbsolute(relativePath)) {
    throw new VcsError({
      code: 'VCS-COMMIT-PATH-ESCAPES-REPO',
      message: `Commit path "${relativePath}" is absolute; commitPaths only accepts paths relative to the repository root.`,
      remedy: 'Pass a path relative to the repository root, not an absolute path.',
    });
  }
  const resolved = path.resolve(cwd, relativePath);
  const relativeToCwd = path.relative(cwd, resolved);
  if (relativeToCwd.startsWith('..') || path.isAbsolute(relativeToCwd)) {
    throw new VcsError({
      code: 'VCS-COMMIT-PATH-ESCAPES-REPO',
      message: `Commit path "${relativePath}" resolves outside the repository at "${cwd}".`,
      remedy: 'Pass a path inside the repository, not one that escapes it via "..".',
    });
  }
}

/**
 * Stages and commits EXACTLY `options.paths` — `git add -- <paths>` then `git commit -m <message> --
 * <paths>`, deliberately never `git add -A` the way `commitInLane` above does: `commitInLane`'s own
 * unconditional stage-everything is right for a lane worktree, whose whole tree is that one step's own
 * isolated work, but `commitPaths`'s own real caller (`configSet --commit`, P37) can run directly
 * against the checked-out project root — a real user's own working tree, potentially holding unrelated
 * dirty state this call must never sweep into its commit. Both the `git add` and the `git commit`
 * themselves are still pathspec-scoped (`-- <paths>`, not only the earlier `git add`), so even a file
 * some OTHER process staged between the two calls is not accidentally included.
 *
 * A real no-op (none of `paths` are dirty) returns the repository's current `HEAD` with `committed:
 * false` rather than a raw `git commit` failure ("nothing to commit") — the identical idempotency
 * `commitInLane` already established for a lane, here for an explicit path set instead of a whole
 * worktree. Honours `sign` (`vcs.signCommits`, `18` §18.3) and needs no special case for an unborn
 * `HEAD`: once staging is already correct, the first real commit in a brand-new repository is not
 * something `git commit -- <paths>` needs help with.
 *
 * If `git commit` itself fails after `git add` already succeeded (a missing signing key, a rejecting
 * hook), `paths` are un-staged back to their own `HEAD` state before the failure propagates — this
 * function's own index never stays half-staged just because it reported failure. The WORKING TREE
 * content is this function's caller's own concern (it never wrote it, so it cannot restore it): a
 * caller that also wrote new content to `paths` before calling this (`configSet --commit`) restores
 * that content itself on the same failure.
 *
 * @throws {VcsError} `VCS-COMMIT-PATH-ESCAPES-REPO` — see `assertPathWithinRepo`.
 */
export async function commitPaths(
  cwd: string,
  options: CommitPathsOptions,
): Promise<CommitPathsResult> {
  for (const relativePath of options.paths) {
    assertPathWithinRepo(cwd, relativePath);
  }

  const dirtyFiles = await getDirtyFiles(cwd);
  const dirty = new Set(dirtyFiles);
  const anyDirty = options.paths.some((relativePath) => dirty.has(relativePath));
  if (!anyDirty) {
    const { stdout } = await wrapGitFailure(
      () => execa('git', ['rev-parse', 'HEAD'], { cwd }),
      `resolving the repository's own current HEAD (nothing to commit) at "${cwd}"`,
    );
    return { sha: stdout.trim(), committed: false };
  }

  await wrapGitFailure(
    () => execa('git', ['add', '--', ...options.paths], { cwd }),
    `staging ${options.paths.join(', ')} at "${cwd}"`,
  );

  const commitArgs = [
    'commit',
    '-m',
    options.message,
    ...(options.sign ? ['-S'] : []),
    '--',
    ...options.paths,
  ];
  try {
    await wrapGitFailure(
      () => execa('git', commitArgs, { cwd }),
      `committing ${options.paths.join(', ')} at "${cwd}"`,
    );
  } catch (cause) {
    // A round-1 critic finding, reproduced live (a real signing failure): `git add` above already
    // succeeded, so without this the index is left with `paths` staged but never committed even
    // though this call reports failure. `git reset -- <paths>` un-stages them back to their own `HEAD`
    // state (never touching the working tree content, which is this function's caller's own concern
    // — `configSet --commit` separately restores the file's own pre-write bytes on this same failure)
    // — best-effort: if the reset itself fails too, the original commit failure is still the one that
    // reaches the caller, not a second, more confusing one about the reset.
    await execa('git', ['reset', '--', ...options.paths], { cwd }).catch(() => undefined);
    throw cause;
  }

  const { stdout } = await wrapGitFailure(
    () => execa('git', ['rev-parse', 'HEAD'], { cwd }),
    `resolving the new commit's sha at "${cwd}"`,
  );
  return { sha: stdout.trim(), committed: true };
}
