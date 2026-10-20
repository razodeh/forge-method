/**
 * `runAdoptTestsAgent` — `forge test adopt --agent` (`13` F-TEST-11, `specs/22` M17 P7): the
 * `adopt-tests` workflow's own hardened control flow, driven directly against
 * `@forge/engine/dispatch`'s already-built `assembleAgentSession`/`ctx.adapter.startSession`, the
 * identical "a real, already-built mechanism exists; call it directly, no synthetic workflow
 * document drives the real control flow" precedent `forge debug`/`review`/`panel` already establish
 * (`ad-hoc-step.ts`'s own doc comment). `templates/workflows/adopt-tests.workflow.yaml` is this
 * piece's own real, validated, documented shape of the same work (every agent/brief/gate it names is
 * real) — `forge run adopt-tests` runs it as an ordinary one-shot workflow with no internal retry
 * across rounds, the identical known, disclosed gap `debug.workflow.yaml`/`debugSymptom` already has.
 *
 * **Why this needs its own loop, not the generic engine's per-step `retry:`.** The bounded,
 * named-failing-check retry `13` F-TEST-11 asks for ("a failing proof loops back to the agent naming
 * the failing check... default 3 rounds, then stop and disclose") needs the SPECIFIC reason the
 * PREVIOUS round failed fed into the NEXT round's own prompt — the generic `StepNodeRetryPolicy`
 * (`06` §6.8's nine-member failure taxonomy) retries a step for a classified reason, it does not carry
 * a free-text "here is exactly what you got wrong" message back into the retried session's own
 * prompt. This function's own `for` loop plays that role directly: round N's task text is the brief
 * plus, from round 2 on, the previous round's own `TranslatorProofResult.failedCheck`/`.reason`.
 *
 * **Each round runs in its own, fresh, disposable lane worktree (DECISION REVERSED, specs/22 M17 P7,
 * critic round 3 — see the history below).** `createLaneWorktree` (`@forge/vcs`, `06` §6.4) gives this
 * round's session a real `git worktree` checked out fresh from `ctx.integrationBase`, and the
 * session's own `SessionRequest.cwd` is set to it — not `deps.projectRoot`. The adapter-kit
 * conformance suite (`@forge/adapter-kit/conformance`, C2 "cwd isolation" / C4 "exec allowlist")
 * requires every real `PlatformAdapter` to confine BOTH a session's own file writes AND its live,
 * in-turn tool-use execution to `cwd` — so every command the agent's own Bash tool-use runs during
 * investigation, however it is shaped, executes against the LANE's copy of the project, never the
 * real one. Whatever the session writes, explores, or breaks stays in a worktree this function
 * deletes at the end of the round (`removeLaneWorktree`, honouring `execution.retainLaneWorktrees` —
 * `shouldRetainLane`, below) — the exact guarantee every other agent role already gets from a lane
 * (`06` §6.4), now extended to this one. The ONE thing that ever crosses back out, and only once the
 * deterministic proof has actually vetted it, is the winning round's own translator file content,
 * copied — never the lane's live working tree merged, committed, or otherwise trusted wholesale —
 * into `deps.projectRoot`'s own `.forge/test-translators/<layer>.<ext>` (`copyTranslatorIntoProject`,
 * below). `runTranslatorProof` itself also runs inside the lane (`cwd`/`paths` both lane-rooted): the
 * lane is a real checkout of the same project, so running the real test command there IS running it
 * for real, and nothing the proof's own real subprocess does can touch the live project tree either.
 *
 * **What the agent reports, and what this function trusts.** The session may write real files freely
 * inside its own lane — there is no write-claim refusal here any more (see the history below for why)
 * — and separately REPORTS structured JSON (`ADOPT_TESTS_OUTPUT_SCHEMA`) naming the command it
 * proposes, the injected-failure probe it used, and (when it wrote one) the translator's own path,
 * relative to the lane root. Nothing from the session's own say-so reaches
 * `.forge/test-adopt/<layer>.proposal.yaml` on its own word: `runTranslatorProof` (`proof.ts`, P6) is
 * run against the REAL, written translator and the REAL command every round, exactly as `13`
 * F-TEST-11's own Decision 2 requires ("An agent-written translator is never trusted on the agent's
 * word") — and the REAL command itself is independently re-vetted, not merely run, before that proof
 * ever touches a real shell: see `vetProposedTestCommand`'s own doc comment. `parsed.translatorPath`
 * itself is validated to stay under `TRANSLATOR_CLAIM_PREFIX` (`RUN-160` otherwise) before it is ever
 * used as a COPY-OUT destination in the real project — the one new check this round's lane model
 * needs that the old, no-lane model did not: previously, an out-of-prefix `translatorPath` could only
 * ever be misread (and RUN-159 already refused a session that wrote anywhere else); now, with no
 * write-claim refusal inside the lane at all, a validated prefix is what stops a session from naming
 * some OTHER real in-lane file (`package.json`, say) as `translatorPath` and having this function
 * copy its content over an unrelated real file in the live project.
 *
 * **The exec grant is a courtesy-scoping layer now, not the only gate (reframed again, critic round
 * 3).** `grantWithAdoptTestsExec` (`@forge/engine/dispatch`) still unions a bounded, static allowlist
 * of conventional test-invocation commands onto the test-architect's own declared grant for every
 * round's session, and `vetProposedTestCommand` still independently re-vets the session's own FINAL
 * structured command before `runTranslatorProof` ever touches it — both unchanged in mechanism. What
 * changed is which of these actually carries the weight: lane isolation (above) is now the primary
 * defence against a dangerous LIVE command doing anything to the real project tree, because a
 * critic round proved the allowlist alone cannot be: widening it for real framework coverage
 * (Django/Laravel/`make`/`rake`/`gradlew`/`mvnw`) reopened the exact exploit class dropping `find*`
 * had just closed (`make -f /tmp/evil.mk pwn`, `./gradlew --init-script=/tmp/evil.gradle tasks`, ... —
 * all still real, valid matches of patterns this list needs for genuine investigation, and the pattern
 * language still has no way to express "this verb, without this dangerous flag" for any of them, for
 * the identical reason `find*` itself could not be narrowed rather than dropped). `vetProposedCommand`
 * (which the FINAL command alone goes through) is sound against this exact class — confirmed directly,
 * both critic rounds agree — but it was never reachable from the session's own LIVE, in-turn tool
 * calls at all, only from this function's own later, separate execution of the session's FINAL report.
 * Lane isolation closes that gap at its real root: a live `make -f /tmp/evil.mk pwn` during
 * investigation can still run, and the allowlist still does not — cannot — refuse it on shape alone,
 * but it now only ever touches the lane's own disposable checkout, never the real project. The
 * allowlist's job is therefore back to what finding #7 originally wanted of it — reasonable,
 * reviewable scoping for what a genuine investigation plausibly needs — not the sole safety net
 * finding #2's live reproduction proved it could never actually be.
 *
 * **History — why there is no RUN-159, `baselineDirty`, or per-round `cleanupStaleTranslators` any
 * more.** A first critic round found the ORIGINAL no-lane design (below) insufficient in three ways,
 * fixed with: (1) `vetProposedTestCommand`, the final-command re-vet (kept, see above); (2) a
 * pre-session dirty-file baseline, so `changedFiles` would not misattribute a project's own
 * pre-existing dirty `.forge/` state to the session (`RUN-159`'s own write-claim refusal otherwise); (3)
 * `cleanupStaleTranslators`, run every round, to converge `.forge/test-translators/` back to one file
 * after a prior round left debris. A SECOND critic round then found the ALLOWLIST widening (2)'s own
 * sibling fix (#7) needed reopened the exact unsandboxed-execution exploit class (1) had just closed,
 * through DIFFERENT patterns (`make`/`rake`/`gradlew`/`mvnw`) — and concluded, correctly, that no
 * allowlist patch could close this for every current and future test-runner wrapper script, and that
 * the real fix was lane isolation for the whole investigation/exec phase, the same guarantee every
 * other agent role already has. Lane isolation makes (2) and (3) categorically moot, not merely
 * safer: there is no pre-existing dirty state to misattribute in a lane freshly checked out for this
 * round alone, and there is no cross-round debris to converge when each round's own lane, and
 * whatever it wrote, is discarded at that round's own end — so `baselineDirty`/`RUN-159`'s own
 * out-of-claim refusal and `cleanupStaleTranslators`'s own per-round call are REMOVED, not merely
 * unreachable: the write-claim concept they existed to enforce (`isWithinAdoptTestsClaim`, the
 * `TRANSLATOR_CLAIM_PREFIX`-or-`HANDOFF_RECORD_PATH` allow-list) served the OLD model, where refusing
 * a stray write was the only thing standing between it and the real project; in the NEW model,
 * nothing the session writes reaches the real project at all unless this function explicitly, by
 * name, copies it out — an allow-list of what LEAVES the lane, never a deny-list of what entered it.
 * One real behaviour change this disposal carries, disclosed rather than silently dropped: the shared
 * brief's own unconditional "register a HandoffRecord" instruction is still followed inside the lane
 * (nothing here tells the session not to), but `docs/forge/reports/handoffs.md` is no longer copied
 * into the real project the way it incidentally was under the old, no-lane model — `--agent`'s own
 * declared outcome (`AdoptTestsAgentResult`) never promised one; the OLD behaviour was a side effect
 * of there being no lane to absorb it, not a requirement, and a per-round HandoffRecord for an
 * attempt that may not even be the one that succeeds is not real, lasting project history worth the
 * complexity of a correct append-vs-overwrite merge into a file other sessions may also be writing.
 * `cleanupStaleTranslators` itself is KEPT, just moved: it still runs once, in the real project, right
 * before the winning round's translator is copied in — a STALE file for this layer, left by some
 * EARLIER, unrelated invocation of this same command, is exactly as real a risk under the new model as
 * the old one, just no longer a CROSS-ROUND risk within a single invocation.
 *
 * **Lane isolation alone does not confine live exec (critic round 4 — a correction, not a fourth
 * patch on the same guess).** Round 3's own reasoning — `SessionRequest.cwd`'s doc comment ("Lane
 * worktree") plus the adapter-kit conformance suite's C2/C4 checks — concluded a lane confines a
 * session's own live exec the same way it confines live writes. Independently re-verified directly
 * against the real adapter source: `cwd` is passed straight through to `execa`/the SDK's own
 * `Options.cwd` with no sandbox behind it at all — a subprocess's own starting directory, never a
 * containment boundary (`@forge/adapter-claude-code`'s own pre-existing `tool-grant.ts` doc comment
 * already said as much, for the identical reason, before this piece ever existed), and C4 only ever
 * tests that the allow-list PATTERN is respected, never that an ALLOWED command's own reach stays
 * inside `cwd`. So round 3's own live repro target (`make -f /tmp/evil.mk pwn`,
 * `./gradlew --init-script=/tmp/evil.gradle tasks`, ...) remained fully live-exploitable through the
 * lane the whole time — the lane only ever confined the WRITE channel, a genuinely different
 * mechanism (the write-tool's own cwd-relative resolution) than exec.
 *
 * **The real fix: a per-call gate on live exec, not another allowlist revision.**
 * `createLiveExecGate` (above) builds `SessionRequest.vetExecCommand`, wired by
 * `@forge/adapter-claude-code`'s own `build-options.ts` into the SDK's real, documented
 * `Options.canUseTool` — a callback the SDK invokes with the real command text before a live `Bash`
 * call executes, confirmed to exist and to genuinely block execution until it resolves (its own
 * `.d.ts` doc comment: "Called before each tool execution to determine if it should be allowed").
 * Every live command, not only the session's final structured report, now goes through the identical
 * `vetProposedCommand` mechanism `vetProposedTestCommand` already held the final one to.
 *
 * **DECISION: lane isolation is KEPT, as a second, independently-real layer (specs/22 M17 P7, critic
 * round 4).** `createLiveExecGate`'s own doc comment discloses the one thing round 4 could not fully
 * verify: whether the real SDK's `canUseTool` is actually consulted for a `Bash` call that also
 * matches an `allowedTools` rule, as opposed to that rule resolving the decision before the callback
 * is ever reached — a question resting on the type's own doc comment, not a live, confirmed API call
 * (money, not merely effort, to run). Given that real uncertainty, removing the ONE layer that IS
 * independently, demonstrably proven (the lane's own write confinement — never disputed, unlike the
 * exec claim) in favour of a layer whose activation is not yet fully confirmed would trade a known
 * guarantee for an unconfirmed one. Kept, at its existing real cost (a real `git worktree add`/
 * `remove` pair per round): even if `canUseTool` turns out not to fire exactly as its own doc comment
 * suggests, nothing the session writes outside its one explicit copy-out still reaches the real
 * project either way. The exec allowlist (`ADOPT_TESTS_EXEC_PATTERNS`) is left exactly as round 3
 * shipped it — not widened back to include `find*`, Django/Laravel/gradlew/mvnw are already there —
 * a DELIBERATE choice not to compound one not-fully-verified claim (`canUseTool` firing as expected)
 * with another (a wider allowlist being safe BECAUSE of it): widening remains a reasonable, real
 * follow-up once `canUseTool`'s own activation is confirmed against a live call, not before.
 *
 * **Original no-lane DECISION (specs/22 M17 P7, critic round 2 — superseded by the above).** This
 * session used to run directly against `deps.projectRoot`, reasoning from `proof.ts`'s own "no
 * worktree needed, every write is additive" precedent for the deterministic proof's OWN writes
 * (probe/lock files). That precedent held for `proof.ts` because its writes are few, fixed, and
 * FORGE's own (never the model's) — it did not actually transfer to this function's own LIVE agent
 * session, whose entire job is running arbitrary, model-chosen commands against the real project
 * during investigation, which is exactly the activity lane isolation exists to contain everywhere
 * else in this codebase. Recorded here, not deleted, so a reader does not wonder whether this
 * reversal was ever actually examined.
 *
 * @see specs/13 F-TEST-11
 * @see specs/22 M17 P6 (`proof.ts`, `adopt.ts` — the staged-proposal lifecycle this plugs into)
 * @see specs/22 M17 P7
 */
import { ArtifactDocument, writeArtifact } from '@forge/core/artifacts';
import {
  ForgeError,
  FORGE_AGENT_ID,
  FORGE_RUN_ID,
  FORGE_STEP_ID,
  SYSTEM_CLOCK,
  readTextFile,
} from '@forge/core';
import { listDirSorted, pathExists, writeFileAtomic, ProjectPaths } from '@forge/core/fs';
import type { Clock } from '@forge/core';
import type { ExecCommandVerdict, PlatformAdapter, SessionRequest } from '@forge/adapter-kit/types';
import { resolveContentReference } from '@forge/agents/prompt';
import {
  ADOPT_TESTS_EXEC_PATTERNS,
  assembleAgentSession,
  grantWithAdoptTestsExec,
  readProjectAgent,
  vetProposedCommand,
} from '@forge/engine/dispatch';
import {
  testCommandEntrySchema,
  type ForgeConfig,
  type StructuredTestCommand,
} from '@forge/schemas/config';
import { createLaneWorktree, removeLaneWorktree, type LaneHandle } from '@forge/vcs';
import { rm } from 'node:fs/promises';
import { z } from 'zod';

import { agentStepLimits, buildAdHocStepNode } from '../ad-hoc-step.ts';
import { adrNew, type AdrCommandContext } from '../../adr.ts';
import { buildRunEngineContext } from '../../run/context.ts';
import { DETECTED_LAYER } from './detect.ts';
import { writeStagedProposal, type StagedProposalRecord } from './adopt.ts';
import { createSystemTempPath } from './system-temp.ts';
import { runTranslatorProof, type InjectedProbe, type ProofCheckNumber } from './proof.ts';

const TEST_ARCHITECT_AGENT_ID = 'test-architect';

/** The only path PREFIX the winning round's own translator is ever copied out of the lane and into
 * the real project under — `13` F-TEST-11's own "a translator script committed to the project at
 * `.forge/test-translators/<layer>.<ext>`". This is no longer a WRITE CLAIM a live session is held
 * to (there is no lane write-claim refusal any more — see this file's own top doc comment, "History")
 * — it is the one destination prefix `copyTranslatorIntoProject` ever writes the real project under,
 * and the prefix `assertTranslatorPathWithinClaim` requires `parsed.translatorPath` to start with
 * before this function ever treats it as that destination. */
const TRANSLATOR_CLAIM_PREFIX = '.forge/test-translators/';

/** Refuses (`RUN-160`) a `translatorPath` that does not start with `TRANSLATOR_CLAIM_PREFIX` — the
 * one new check the lane model needs that the old, no-lane model did not (this file's own top doc
 * comment, "What the agent reports..."): with no write-claim refusal inside the lane any more, a
 * session naming some OTHER real in-lane file (`package.json`, its own `src/index.ts`, ...) as
 * `translatorPath` would otherwise have this function copy that file's real content over an unrelated
 * real path in the live project the moment the round's proof happens to pass. */
function assertTranslatorPathWithinClaim(translatorPath: string): void {
  if (translatorPath.startsWith(TRANSLATOR_CLAIM_PREFIX)) return;
  throw new ForgeError('RUN-160', {
    detail:
      `the proposed "translatorPath" ("${translatorPath}") does not start with ` +
      `"${TRANSLATOR_CLAIM_PREFIX}" -- a translator may only ever be copied into the real project ` +
      'from under that one prefix',
  });
}

/** `13` F-TEST-11's own default bound: three rounds, then stop and disclose. */
const DEFAULT_MAX_ROUNDS = 3;

const probeResponseSchema = z
  .object({
    path: z.string().min(1),
    content: z.string().min(1),
    expectedName: z.string().min(1),
    expectedFile: z.string().min(1).optional(),
  })
  .strict();

/** The structured JSON `ADOPT_TESTS_OUTPUT_SCHEMA` asks for — a real `command`/`probe` proposal, or a
 * `noTestsFound` proposal for a project with no test setup at all (`13` F-TEST-11 point 4). Validated
 * (`QUALITY-BAR.md` R1: an agent's own structured output is `unknown` until validated) before this
 * module ever reads a field off it. */
const proposalResponseSchema = z.union([
  z
    .object({
      // Explicit, optional `false` (never bare-absent) so TypeScript's own value-based narrowing on
      // `parsed.noTestsFound === true` below can tell the two branches apart: a property declared on
      // only ONE member of a plain `z.union` (no shared literal on every member) does not narrow
      // reliably through the `in` operator, confirmed directly against this exact schema (`pnpm
      // typecheck` reported `parsed.probe` as missing after the guard, which this fixes).
      noTestsFound: z.literal(false).optional(),
      command: testCommandEntrySchema,
      probe: probeResponseSchema,
      translatorPath: z.string().min(1).optional(),
      runnerVersion: z.string().min(1),
      reason: z.string().min(1),
    })
    .strict(),
  z
    .object({
      noTestsFound: z.literal(true),
      command: testCommandEntrySchema,
      adrSummary: z.string().min(1),
      reason: z.string().min(1),
    })
    .strict(),
]);

type ProposalResponse = z.infer<typeof proposalResponseSchema>;

/** `SessionRequest.outputSchema` — informational for the fake adapter (which trusts a script's own
 * `structured` field directly, `@forge/testkit`'s own `FakeSessionScript` doc comment), but a real
 * adapter needs a real shape to steer a real model's structured-output request toward
 * (`QUALITY-BAR.md` R7: never faked). Mirrors `proposalResponseSchema` above, loosely (JSON Schema has
 * no real discriminated-union syntax this codebase's own `JSONSchema` type carries). */
const ADOPT_TESTS_OUTPUT_SCHEMA: NonNullable<SessionRequest['outputSchema']> = {
  type: 'object',
  properties: {
    command: { type: 'object' },
    probe: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        content: { type: 'string' },
        expectedName: { type: 'string' },
        expectedFile: { type: 'string' },
      },
    },
    translatorPath: { type: 'string' },
    runnerVersion: { type: 'string' },
    reason: { type: 'string' },
    noTestsFound: { type: 'boolean' },
    adrSummary: { type: 'string' },
  },
};

export interface AdoptTestsAgentDeps {
  readonly paths: ProjectPaths;
  readonly projectRoot: string;
  readonly config: ForgeConfig;
  readonly adapter: PlatformAdapter;
  readonly checksRoot: string;
  readonly agentsRoot: string;
  /** `docs/forge/kb` in a real project (`bin.ts`'s own `KB_ROOT`) — where the no-test-setup branch's
   * ADR is scaffolded (`adrNew`, `@forge/cli`'s own `commands/adr.ts`). */
  readonly kbRoot: string;
}

export interface AdoptTestsAgentOptions {
  /** `detect.ts`'s own `DETECTED_LAYER` ('unit') — the only layer either path ever targets today. */
  readonly layer?: string;
  /** `13` F-TEST-11's own default bound. */
  readonly maxRounds?: number;
  readonly clock?: Clock;
  /** `proof.ts`'s own `TranslatorProofInput.createTempPath` — defaults to a real OS temp path
   * (`createSystemTempPath`, the one sanctioned `QUALITY-BAR.md` R10 exemption for exactly this). */
  readonly createTempPath?: () => string;
}

/** `runAdoptTestsAgent`'s own three real outcomes. `'staged'`/`'no-test-setup'` both write a real
 * `StagedProposalRecord` (`adopt.ts`) — never the live `.forge/config.yaml` itself (`13` F-TEST-11's
 * own staged-proposal lifecycle, unchanged by this piece): only `G-TestAdopt`'s own human approval,
 * then `forge test adopt --write`, ever promotes one. `'exhausted'` writes nothing at all. Every
 * variant carries `runId`: this ad hoc dispatch writes no `last-run.json` pointer
 * (`review.ts`'s own doc comment), so a caller that wants to approve or promote THIS exact session's
 * own result (`forge gate approve G-TestAdopt --run <runId>`, then `forge test adopt --write --run
 * <runId>`) has no other way to learn the id it ran under. */
export type AdoptTestsAgentResult =
  | {
      readonly outcome: 'staged';
      readonly layer: string;
      readonly record: StagedProposalRecord;
      readonly rounds: number;
      readonly runId: string;
    }
  | {
      readonly outcome: 'exhausted';
      readonly layer: string;
      readonly rounds: number;
      readonly failedCheck: ProofCheckNumber;
      readonly reason: string;
      readonly runId: string;
    }
  | {
      readonly outcome: 'no-test-setup';
      readonly layer: string;
      readonly adrPath: string;
      readonly record: StagedProposalRecord;
      readonly runId: string;
    };

/** One round's own task text: the real, shipped brief (`briefs/adopt-tests.md`, read off the
 * project's own materialized copy, `resolveContentReference`) plus, from round 2 on, the PREVIOUS
 * round's own named failing check — real, trusted feedback FORGE itself produced (`runTranslatorProof`),
 * never untrusted model content, so it needs no fencing (`20` §20.5). */
async function buildRoundTaskText(
  paths: ProjectPaths,
  layer: string,
  round: number,
  maxRounds: number,
  feedback: { readonly failedCheck: ProofCheckNumber; readonly reason: string } | undefined,
): Promise<string> {
  const brief = await resolveContentReference(paths, 'briefs/adopt-tests.md');
  const kickoff = `Investigate and propose a test configuration for the "${layer}" layer. This is round ${String(round)} of ${String(maxRounds)}.`;
  const feedbackText =
    feedback === undefined
      ? ''
      : `\n\nThe previous round's translator proof failed check ${String(feedback.failedCheck)}: ${feedback.reason}\nRevise the actual cause this names, then report again.`;
  return `${kickoff}${feedbackText}\n\n${brief}`;
}

/** Validates `structured` (`QUALITY-BAR.md` R1: `unknown` until validated) and refuses (`RUN-160`)
 * when it is not a usable proposal at all — including the one shape `testCommandEntrySchema` accepts
 * but an agent-authored proposal may not: the legacy bare-string form, which carries no `format` for
 * the deterministic proof to validate against. */
function parseProposalResponse(structured: unknown): ProposalResponse {
  const result = proposalResponseSchema.safeParse(structured);
  if (!result.success) {
    throw new ForgeError('RUN-160', {
      detail: result.error.issues
        .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
        .join('; '),
    });
  }
  if (typeof result.data.command === 'string') {
    throw new ForgeError('RUN-160', {
      detail:
        'the proposed "command" is the legacy bare-string form, which carries no "format" — an ' +
        'agent-authored proposal must report the structured form the deterministic proof can check',
    });
  }
  return result.data;
}

/** Removes every file under `.forge/test-translators/` whose basename starts with `${layer}.`,
 * except `keep` (its own basename, when given). Called exactly ONCE per `runAdoptTestsAgent` call, in
 * the REAL project (`deps.paths`), right before the winning round's own translator is copied in
 * (`copyTranslatorIntoProject`, below) — never per round any more, now that each round's own lane is
 * fresh and disposable (this file's own top doc comment, "History"): there is no cross-round debris
 * left in the real project to converge, only the real, disclosed risk that remains under ANY design,
 * lane or not — a STALE file for this same layer, left by some EARLIER, unrelated invocation of this
 * same command (a different extension, a different attempt, days or weeks ago), would otherwise leave
 * `checkTestAdoptionApproved`'s own "exactly one file" freshness check unable to tell "stale" apart
 * from "missing." The identical "clean up before the one real write, in every exit path" discipline
 * `proof.ts`'s own probe/lock cleanup already uses. */
async function cleanupStaleTranslators(
  paths: ProjectPaths,
  layer: string,
  keep: string | undefined,
): Promise<void> {
  const dir = paths.resolveWithin(TRANSLATOR_CLAIM_PREFIX.replace(/\/$/, ''));
  if (!(await pathExists(dir))) return;
  const keepBasename = keep === undefined ? undefined : keep.split('/').at(-1);
  const entries = await listDirSorted(dir);
  for (const name of entries) {
    if (!name.startsWith(`${layer}.`)) continue;
    if (name === keepBasename) continue;
    await rm(paths.resolveWithin(`${TRANSLATOR_CLAIM_PREFIX}${name}`), { force: true });
  }
}

/** Copies the winning round's own translator — `translatorContent`, already read from the LANE by
 * the caller, the real bytes that just produced a passing `TranslatorProofResult` — into the real
 * project at the identical relative path (`TRANSLATOR_CLAIM_PREFIX`-anchored;
 * `assertTranslatorPathWithinClaim` has already refused anything else by the time this is ever
 * called). The ONE write this whole function ever makes to the real project's own tree beyond the
 * staged-proposal record itself — never the lane's working tree merged, committed, or trusted
 * wholesale, only this one file's own bytes, by name, once the deterministic proof run inside the
 * lane has actually vetted them. `cleanupStaleTranslators` runs first so a stale file from some
 * earlier, unrelated invocation can never make the one this writes look ambiguous. */
async function copyTranslatorIntoProject(
  realPaths: ProjectPaths,
  layer: string,
  translatorPath: string,
  translatorContent: string,
): Promise<void> {
  await cleanupStaleTranslators(realPaths, layer, translatorPath);
  await writeFileAtomic(realPaths.resolveWithin(translatorPath), translatorContent);
}

/** The one grant both `vetProposedTestCommand` (the session's own FINAL reported command) and
 * `createLiveExecGate` (every LIVE, in-turn Bash call during the round, `specs/22` M17 P7, critic
 * round 4) hold their own real shell-executed text to — the SAME bounded menu the live session's own
 * tool-use grant (`grantWithAdoptTestsExec`) already had to stay inside, never a separate, looser one
 * a caller might accidentally let drift out of sync with it. */
const ADOPT_TESTS_VET_GRANT = { exec: ADOPT_TESTS_EXEC_PATTERNS, network: 'none' as const };

/**
 * Builds `SessionRequest.vetExecCommand` for one round — a real per-call gate on the session's own
 * LIVE Bash tool-use, closing a gap `vetProposedTestCommand` (below) never actually covered despite
 * both functions sharing a name that suggested otherwise (`specs/22` M17 P7, critic round 4).
 *
 * **Why lane isolation alone was not enough, and this is not a fourth patch on the same guess.**
 * Round 3 built lane isolation reasoning from `SessionRequest.cwd`'s own doc comment ("Lane
 * worktree") and the adapter-kit conformance suite's C2/C4 checks, concluding a lane confines a
 * session's own live exec the same way it confines its live writes. Independently re-verified
 * directly against the real adapter source (`@forge/adapter-claude-code`'s `cli/spawn.ts`/
 * `sdk/build-options.ts`): `cwd` is passed straight through to `execa`/the SDK's own `Options.cwd`
 * with no sandbox, chroot or container behind it at all — a subprocess's own STARTING directory,
 * never a containment boundary; `tool-grant.ts`'s own pre-existing doc comment already says as much
 * for the identical reason ("a granted exec capability can still reach any host... not something
 * this mapping... can close without sandboxing"). `checkC4ExecAllowlist` (the conformance check
 * round 3 cited) only ever tests that the allow-list PATTERN is respected, never that an ALLOWED
 * command's own reach stays inside `cwd`. So `make -f /tmp/evil.mk pwn` and the rest of round 3's own
 * `adopt-tests-grant.test.ts` additions were, and without this function still are, fully
 * live-exploitable: the lane never contained a live exec call at all, only a live WRITE (the
 * write-tool's own `resolveInsideCwd`-style resolution, a genuinely different mechanism this
 * function does not touch or need to).
 *
 * **The real fix.** Claude Code's SDK exposes a genuine per-tool-call veto gate,
 * `Options.canUseTool` (confirmed against the real, installed `.d.ts`): a synchronous-from-the-
 * model's-perspective, awaited callback that receives the real `input.command` for a live `Bash`
 * call and can deny it before it ever reaches a real shell. `@forge/adapter-claude-code`'s own
 * `build-options.ts` wires `SessionRequest.vetExecCommand` into it (`buildCanUseTool`) — this
 * function builds that callback for THIS round, holding every live command to the identical
 * `ADOPT_TESTS_VET_GRANT`/`root` pair `vetProposedTestCommand` already holds the session's FINAL
 * reported command to, via the SAME `vetProposedCommand` mechanism (never a second, independently-
 * maintained check that could drift from it).
 *
 * **Disclosed, not assumed closed.** Whether the real SDK's `canUseTool` is actually CONSULTED for a
 * `Bash` call that also matches an `allowedTools` rule — as opposed to that rule resolving the
 * decision before the callback is ever reached — rests on the type's own plain doc comment ("Called
 * before each tool execution") in the installed `.d.ts`, not on a live, confirmed API call (one
 * would cost real money to run, the identical `QUALITY-BAR.md`-adjacent constraint this whole
 * codebase already accepts elsewhere for a genuinely SDK-internal question no amount of static
 * reading can fully settle). `SessionRequest.vetExecCommand`'s own doc comment carries the identical
 * disclosure. Lane isolation (round 3) is KEPT regardless, as a second, independently-real layer: it
 * still demonstrably confines the session's own live WRITES (never disputed, never only a claim), so
 * even if this callback's own activation turns out imperfect, nothing the session writes outside its
 * one copy-out reaches the real project either way — see this file's own top doc comment for the
 * explicit DECISION this restates.
 */
function createLiveExecGate(root: string): (command: string) => Promise<ExecCommandVerdict> {
  return async (command) => {
    const refusal = await vetProposedCommand(command, ADOPT_TESTS_VET_GRANT, root);
    return refusal === undefined ? { allowed: true } : { allowed: false, reason: refusal.detail };
  };
}

/** Re-vets the proposed command's own real shell-executed fields — `run` always, `translate`/`scope`/
 * `filter` when declared — against `ADOPT_TESTS_EXEC_PATTERNS`, independently of whatever the live
 * session's own tool-use grant happened to allow, before any of them ever reaches a real shell
 * (`runTranslatorProof` -> `runStructuredTestLayer` -> `runShellCommand`), run with `cwd: lanePath` —
 * `root` below is that SAME lane path, never `deps.projectRoot`, so `vetPath`'s own containment
 * check (inside `vetProposedCommand`) matches where the command is actually about to execute.
 *
 * **Why this exists at all, and why lane isolation (this file's own top doc comment) does not make
 * it redundant.** The exec grant (`grantWithAdoptTestsExec`) only ever gates the session's own
 * IN-TURN tool calls — what the fake adapter's `execAttempts`, or a real adapter's own tool-use
 * channel, check against. It does nothing at all to the SEPARATE, automatic execution this function's
 * own caller performs on whatever string the session's structured JSON response names: a session
 * that writes nothing via tool-use and simply REPORTS a malicious `command.run` reached a real shell,
 * unsandboxed, with a real, live reproduction (a marker file written outside the project root)
 * proving it — and lane isolation does nothing for THIS specific gap, because it is FORGE's OWN later,
 * separate execution of the session's final report, not a live tool call the lane's own `cwd` already
 * confines. Nor does lane isolation address what this vet's OWN network stage catches (a
 * `command.translate` that fetches or exfiltrates over the network): a lane only contains WRITES to
 * the project tree, never a command's own network reach. `vetProposedCommand` (`confined-command.ts`)
 * is the identical, already-reviewed mechanism `forge debug`'s own RCA loop already holds a
 * model-PROPOSED command to (`rca/shell.ts`'s `createRcaShell`) — reused here rather than re-derived,
 * with the grant it is held to being `ADOPT_TESTS_EXEC_PATTERNS` itself: the SAME bounded menu the
 * live session's own tool-use already had to stay inside, so the one thing a session could otherwise
 * still do that its own grant could not (report a free-text final answer with no relation to what it
 * was allowed to try) is closed, not merely narrowed.
 *
 * `{output}`/`{files}`/`{name}`/`{name:regex}` placeholder tokens (`translate`/`scope`/`filter`'s own
 * template syntax, `18` §18.3) are vetted as literal text, never substituted first: FORGE itself
 * substitutes `{output}` with a real, FORGE-controlled temp path later (`reporter.ts`'s own
 * `substituteOutputPlaceholder`), so there is nothing a model-supplied value could inject through it;
 * the placeholder's own characters (`{`/`}`, no comma or `..` inside) do not trip the brace-expansion
 * refusal (`confined-command.ts`'s own `BRACE_LIST`), confirmed directly against a real invocation.
 *
 * @throws {ForgeError} `RUN-161`, naming the field, the real command, and the vet's own refusal
 * reason, for the first field (in `run`/`translate`/`scope`/`filter` order) that fails.
 */
async function vetProposedTestCommand(command: StructuredTestCommand, root: string): Promise<void> {
  const fields: readonly (readonly [string, string | undefined])[] = [
    ['run', command.run],
    ['translate', command.translate],
    ['scope', command.scope],
    ['filter', command.filter],
  ];
  for (const [field, value] of fields) {
    if (value === undefined) continue;
    const refusal = await vetProposedCommand(value, ADOPT_TESTS_VET_GRANT, root);
    if (refusal !== undefined) {
      throw new ForgeError('RUN-161', { field, command: value, reason: refusal.detail });
    }
  }
}

/** `doc`'s own file, with its body replaced by `body` — `ArtifactDocument` has no body setter of its
 * own (only front-matter `set()`); `toString()`'s own doc comment guarantees it is exactly
 * `prefix + frontMatterText + infix + bodyText` in that order, so slicing off `doc.body`'s own length
 * from the end of it recovers everything BEFORE the body, whatever it contains, without needing to
 * read any of this class's private fields directly. */
function withReplacedBody(doc: ArtifactDocument, body: string): ArtifactDocument {
  const full = doc.toString();
  const beforeBody = full.slice(0, full.length - doc.body.length);
  return ArtifactDocument.parse(`${beforeBody}${body}\n`, doc.path);
}

/** The no-test-setup branch (`13` F-TEST-11 point 4): scaffolds a real ADR (`adrNew`, the identical
 * real id-allocation/template/front-matter `forge adr new` uses) with the agent's own `adrSummary` as
 * its body, then stages the proposed conventional runner the same way a real translator proposal is
 * staged — `source: 'agent'`, no `proof` (there is nothing real to prove yet: no test exists in this
 * project for a probe to fail against). `runPromotion` already refuses a proposal with no recorded
 * proof (`adopt.ts`), so nothing here can ever reach the live config before a human adopts the runner
 * for real and a later run proves it — `13` F-TEST-11's own "never a silently added dependency" holds
 * by construction, not by a special case this branch invents. */
async function stageNoTestSetup(
  deps: AdoptTestsAgentDeps,
  layer: string,
  parsed: Extract<ProposalResponse, { noTestsFound: true }>,
  clock: Clock,
  runId: string,
): Promise<AdoptTestsAgentResult> {
  const adrCtx: AdrCommandContext = { paths: deps.paths, kbRoot: deps.kbRoot, clock };
  const doc = await adrNew(adrCtx, `Adopt a conventional test runner for the "${layer}" layer`);
  await writeArtifact(deps.paths, withReplacedBody(doc, parsed.adrSummary));
  const record: StagedProposalRecord = {
    layer,
    source: 'agent',
    command: parsed.command,
    reason: parsed.reason,
  };
  await writeStagedProposal(deps.paths, layer, record);
  return { outcome: 'no-test-setup', layer, adrPath: doc.path, record, runId };
}

/** Whether round N's own lane should survive `removeLaneWorktree` — the real, 3-way
 * `execution.retainLaneWorktrees` policy (`18` §18.3: `never | on-failure | always`), applied per
 * round rather than collapsed to a boolean ahead of time (`RunEngineContext.retainLaneWorktrees`
 * itself already IS that collapsed boolean, correct only for a caller with exactly one lane and one
 * known outcome — `forge debug`'s own single RCA lane — never for this function's own multiple,
 * independently-outcomed per-round lanes). */
function shouldRetainLane(config: ForgeConfig, roundOutcome: 'passed' | 'failed'): boolean {
  const policy = config.execution.retainLaneWorktrees;
  return policy === 'always' || (policy === 'on-failure' && roundOutcome === 'failed');
}

/**
 * `forge test adopt --agent` (`13` F-TEST-11, `specs/22` M17 P7): investigates, runs the tests for
 * real (the test-architect's own bounded exec grant) inside a fresh, disposable lane worktree,
 * proves a candidate configuration deterministically, loops back with the named failing check on a
 * failure (bounded, default 3 rounds), and stages — never promotes — the result. See this file's own
 * doc comment for the full design.
 *
 * @throws {ForgeError} `RUN-056` when `test-architect` has no real materialized agent definition;
 * `RUN-160` when a round's own structured response is not a usable proposal at all, or names a
 * `translatorPath` outside its one allowed destination prefix; `RUN-161` when the round's own final
 * proposed command is refused by the vet; whatever `assembleAgentSession`/`createLaneWorktree`
 * themselves refuse with for a config or VCS problem this project has (an unmapped model tier, a
 * grant above the agent's own ceiling, a dirty or unavailable integration base, ...).
 */
export async function runAdoptTestsAgent(
  deps: AdoptTestsAgentDeps,
  options: AdoptTestsAgentOptions = {},
): Promise<AdoptTestsAgentResult> {
  // Refused upfront, before a lane, a session, or even the agent definition is ever touched
  // (`specs/22` M17 P7, critic round 5): a transport with no real per-call exec gate
  // (`AdapterCapabilities.execCommandGating`, its own doc comment has the full reasoning) has no real
  // safety guarantee for the live investigation phase this command's own exec grant exists to run at
  // all -- a hard refusal here, never a warning a human could miss, is the DELIBERATE choice: see
  // `createLiveExecGate`'s own doc comment for why this gate matters at all, and this function's top
  // doc comment for the KEPT-lane-isolation DECISION this refusal does not change.
  const adapterCapabilities = await deps.adapter.capabilities();
  if (!adapterCapabilities.execCommandGating) {
    throw new ForgeError('RUN-162', { adapterId: deps.adapter.id });
  }

  const layer = options.layer ?? DETECTED_LAYER;
  const maxRounds = options.maxRounds ?? DEFAULT_MAX_ROUNDS;
  const clock = options.clock ?? SYSTEM_CLOCK;
  const createTempPath =
    options.createTempPath ?? (() => createSystemTempPath('forge-adopt-tests'));

  const agent = await readProjectAgent(deps.paths, deps.agentsRoot, TEST_ARCHITECT_AGENT_ID);
  const runId = `adopt-tests-${clock.now().replace(/[^0-9]/g, '')}`;
  const ctx = await buildRunEngineContext({
    paths: deps.paths,
    projectRoot: deps.projectRoot,
    config: deps.config,
    runId,
    adapter: deps.adapter,
    checksRoot: deps.checksRoot,
    agentsRoot: deps.agentsRoot,
    clock,
  });

  let feedback: { readonly failedCheck: ProofCheckNumber; readonly reason: string } | undefined;
  for (let round = 1; round <= maxRounds; round += 1) {
    const stepId = `adopt-tests:round-${String(round)}`;
    // A fresh, real `git worktree`, checked out from `ctx.integrationBase`, for THIS round alone --
    // never reused across rounds, never the real project tree (this file's own top doc comment, "Each
    // round runs in its own, fresh, disposable lane worktree"). `SessionRequest.cwd` below is this
    // lane's own path: the adapter-kit conformance suite (C2/C4) requires every real `PlatformAdapter`
    // to confine a session's own live writes AND exec to it.
    const lane: LaneHandle = await createLaneWorktree(deps.projectRoot, {
      runId: ctx.runId,
      stepId,
      integrationBase: ctx.integrationBase,
    });
    const lanePaths = new ProjectPaths(lane.path);
    let roundOutcome: 'passed' | 'failed' = 'failed';
    try {
      const taskText = await buildRoundTaskText(deps.paths, layer, round, maxRounds, feedback);
      const node = buildAdHocStepNode(
        stepId,
        TEST_ARCHITECT_AGENT_ID,
        taskText,
        agentStepLimits(agent),
      );
      const assembled = await assembleAgentSession({
        node,
        ctx,
        agent,
        taskText,
        role: String(round),
        briefKey: 'adopt-tests',
        callerConfinesWrites: true,
      });
      await assembled.persist();

      const abortController = new AbortController();
      const sessionRequest: SessionRequest = {
        runId: ctx.runId,
        stepId: assembled.stepKey,
        cwd: lane.path,
        systemPrompt: assembled.systemPrompt,
        prompt: assembled.prompt,
        model: assembled.model,
        thinking: assembled.thinking,
        tools: grantWithAdoptTestsExec(assembled.tools),
        permissionMode: 'deny-unlisted',
        limits: agentStepLimits(agent),
        env: {
          [FORGE_RUN_ID]: ctx.runId,
          [FORGE_STEP_ID]: assembled.stepKey,
          [FORGE_AGENT_ID]: agent.id,
        },
        outputSchema: ADOPT_TESTS_OUTPUT_SCHEMA,
        abortSignal: abortController.signal,
        // The real, per-call gate on this round's own live exec (`createLiveExecGate`'s own doc
        // comment has the full critic-round-4 finding and the honest disclosure of what is, and is
        // not, verified about it).
        vetExecCommand: createLiveExecGate(lane.path),
      };
      const handle = await ctx.adapter.startSession(sessionRequest);
      const session = await handle.result();

      // No write-claim refusal here any more: whatever the session wrote inside its own lane, beyond
      // what this function explicitly copies out below, is discarded with the lane itself
      // (`removeLaneWorktree` in `finally`) -- this file's own top doc comment, "History", has the
      // full reasoning for why that is a strictly safer default than the old deny-list ever was.

      const parsed = parseProposalResponse(session.structured);
      if (parsed.noTestsFound === true) {
        roundOutcome = 'passed';
        return await stageNoTestSetup(deps, layer, parsed, clock, runId);
      }

      // The one new check the lane model needs: a `translatorPath` outside its own claim prefix would
      // otherwise have the copy-out below write some OTHER real in-lane file's content over an
      // unrelated real path in the live project (this file's own `assertTranslatorPathWithinClaim`
      // doc comment has the full reasoning).
      if (parsed.translatorPath !== undefined) {
        assertTranslatorPathWithinClaim(parsed.translatorPath);
      }

      const probe: InjectedProbe = {
        path: parsed.probe.path,
        content: parsed.probe.content,
        expectedName: parsed.probe.expectedName,
        ...(parsed.probe.expectedFile === undefined
          ? {}
          : { expectedFile: parsed.probe.expectedFile }),
      };
      const translatorContent =
        parsed.translatorPath === undefined
          ? undefined
          : await readTextFile(lanePaths.resolveWithin(parsed.translatorPath));
      const command = parsed.command as StructuredTestCommand;

      // Never trust the reported command enough to run it: re-vetted, independently of whatever the
      // live session's own tool-use grant allowed, against the SAME lane root it is about to run in,
      // before it ever reaches a real shell (this file's own `vetProposedTestCommand` doc comment has
      // the full reasoning).
      await vetProposedTestCommand(command, lane.path);

      const proof = await runTranslatorProof({
        command,
        cwd: lane.path,
        paths: lanePaths,
        createTempPath,
        probe,
        ...(translatorContent === undefined ? {} : { translatorContent }),
        runnerVersion: parsed.runnerVersion,
        now: () => clock.now(),
      });

      if (proof.ok) {
        roundOutcome = 'passed';
        if (parsed.translatorPath !== undefined && translatorContent !== undefined) {
          await copyTranslatorIntoProject(
            deps.paths,
            layer,
            parsed.translatorPath,
            translatorContent,
          );
        }
        const record: StagedProposalRecord = {
          layer,
          source: 'agent',
          command,
          reason: parsed.reason,
          proof: {
            ok: true,
            subjectHash: proof.subjectHash,
            runnerVersion: proof.runnerVersion,
            checkedAt: proof.checkedAt,
          },
        };
        await writeStagedProposal(deps.paths, layer, record);
        return { outcome: 'staged', layer, record, rounds: round, runId };
      }

      if (round === maxRounds) {
        return {
          outcome: 'exhausted',
          layer,
          rounds: round,
          failedCheck: proof.failedCheck,
          reason: proof.reason,
          runId,
        };
      }
      feedback = { failedCheck: proof.failedCheck, reason: proof.reason };
    } finally {
      await removeLaneWorktree(deps.projectRoot, lane, {
        retain: shouldRetainLane(deps.config, roundOutcome),
      });
    }
  }
  // Unreachable by construction: every iteration above either returns (a passing proof, or the LAST
  // round of a failing one) or sets `feedback` and continues to the next round -- the `round ===
  // maxRounds` check on every failing round guarantees the loop always returns before `round` can
  // exceed `maxRounds`. TypeScript cannot see that a bounded `for` loop never falls through without a
  // literal `while (true)` (which would obscure this loop's real, finite bound), so this is a real,
  // typed fallback for a branch no real input ever reaches, never a silent placeholder (`QUALITY-BAR.md`
  // R7).
  throw new ForgeError('RUN-160', {
    detail: 'the adopt-tests retry loop exited without a result -- this should be unreachable',
  });
}
