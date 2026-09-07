/**
 * Lane commit conventions: `06` §6.4 step 3's own exact format — `forge(<story>): …`, trailers
 * `Forge-Step`, `Forge-Run`, `Co-Authored-By:` the agent role — so every lane commit is mechanically
 * parseable by the merge queue (P5), the audit trail (`20` §20.9), and a human reading `git log`.
 *
 * @see specs/06 §6.4
 * @see specs/18 §18.3
 * @see PLAN-M5.md P3
 */
import { execa } from 'execa';

import { VcsError } from './errors.ts';
import { wrapGitFailure } from './git.ts';
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
      remedy: 'Use the agent\'s short role id (e.g. "engineer", "reviewer", "data-architect"), not a display name or an email address.',
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

/** Stages everything in the lane worktree (`git add -A` — new, modified and deleted files alike; `06`
 * §6.4 step 3 says only "the agent commits," not "the agent stages, then commits") and commits it with
 * `message`, optionally signed (`sign`, wiring `18` §18.3's own `vcs.signCommits`). Returns the new
 * commit's own sha, so a caller (the merge queue, P5) has it without a separate `rev-parse` round trip. */
export async function commitInLane(
  handle: LaneHandle,
  options: { readonly message: string; readonly sign: boolean },
): Promise<{ readonly sha: string }> {
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
