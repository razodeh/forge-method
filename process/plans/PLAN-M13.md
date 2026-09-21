# PLAN-M13 — Live-run readiness: real agent prompts, grants and models

**Status: draft, awaiting approval. Nothing here is built.**

Post-v1.0. `specs/22` defines M1–M12 only, so this milestone has no spec entry yet — P0 below adds
one before any code, per this project's own spec-first rule.

## Why this milestone exists

Found on 2026-09-19 while checking how FORGE affects token usage: **a real agent step today receives
no usable prompt.** Every test passes because every test runs against `FakePlatformAdapter`, which
never reads the prompt. No live run has ever been done.

Confirmed by direct inspection:

- **Dispatch sends a file path as the prompt.** `buildSessionRequest`
  (`packages/engine/src/dispatch/steps.ts:260-261`) sets `prompt: node.brief ?? ''` and
  `systemPrompt: { mode: 'append', text: '' }`. `node.brief` is the raw workflow YAML value, e.g.
  `briefs/freeze-contracts.md`. The session-step path
  (`packages/engine/src/interaction/dispatch-agent-step.ts:61`) does the same.
- **The brief files do not exist.** Shipped workflows and gates reference 62 distinct
  `briefs/*.md` files; the 34 shipped agents reference 62 distinct `prompts/*.md` files
  (`prompt.system` plus `prompt.briefs.*`). No `briefs/` or `prompts/` directory exists anywhere in
  the repo. The CLI's validation oracle hides this: `briefExists: () => true`
  (`packages/cli/src/commands/workflow.ts:110`).
- **The prompt compiler is built, tested, and never called.** `@forge/agents/prompt` has
  `compilePrompt` (`05` §5.3's nine blocks), the verbatim `OPERATING_CONTRACT` (`05` §5.5) and
  `writePromptRecord`. `@forge/agents/context` has `packForStep`, `resolveContextRequest` and
  `markExternalContent`. None has a caller outside `packages/agents/`.
- **Every agent runs with the same tool grant.** `packages/cli/src/commands/run/context.ts:45,284`
  passes one `DEFAULT_TOOLS = { read, write: true, exec: false, network: 'none' }` for every step.
  The agent's own `tools` block is ignored, so `reviewer` (declared `write: false`) gets write
  access, and `developer`/`sdet` (which must run tests) get no exec.
- **No tier-to-model mapping.** `resolveModel` (`context.ts:54`) picks the first model the adapter
  lists; `05` §5.8's tier mapping is unbuilt (`SPEC-QUESTIONS.md` Q62 part 2 disclosed this).
- **Declared step `outputs` are never checked.** Nothing under `packages/engine/src/dispatch/` reads
  `node.outputs`, although block [1] of every prompt will promise "output that fails validation is
  rejected".

To confirm during the build, not yet verified: whether the `FORGE_REQUEST_CONTEXT` expansion loop
(`05` §5.4 point 4) is wired anywhere, and whether `renderRoleBlock` reads `prompt.system` at all.

## Surface decisions this plan commits to

- **Wiring, not rewriting.** The compiler, context pack and operating contract already exist and are
  tested. This milestone calls them from dispatch; it does not redesign them.
- **Brief and prompt content ships in `@forge/templates`**, indexed like workflows and gates
  (`BRIEF_INDEX`, `PROMPT_INDEX`) and copied into `.forge/` by `forge init` — the same mechanism
  `fm-core/module.yaml`'s own header comment describes for every other kind of fm-core content.
- **`engine → agents` and `engine → kb` are already legal edges**, so no graph change is needed for
  the wiring itself.
- **The system prompt carries blocks [1]–[3] and [5]–[9]; the user prompt carries block [4] (the
  brief).** To be confirmed against `07` §7.2's `SessionRequest` contract in P5; recorded in
  `SPEC-QUESTIONS.md` either way.

---

## P0 — Spec entry for M13

**Surface:** `specs/22-build-plan-and-milestones.md` (new M13 section: Build, Acceptance, Exit
tests), plus a resolution note on `SPEC-QUESTIONS.md` Q62 part 2.

**Checks:** acceptance is stated as observable behaviour — "a dispatched agent step's session
request contains all nine compiled blocks; its tools equal the agent's resolved grant; a compiled
`prompt.md` exists for every agent step".

**Depends on:** nothing.

## P1 — Brief and prompt content resolution

**Mandate:** make a brief reference resolve to real text, and make a missing one a real error.

**Surface:** `packages/templates/src/index.ts` (`BRIEF_INDEX`, `PROMPT_INDEX`),
`packages/cli/src/init/content.ts` (copy into `.forge/briefs/`, `.forge/prompts/`), a loader in
`@forge/agents` or `@forge/engine` (decided by the piece), and
`packages/cli/src/commands/workflow.ts` — replace `briefExists: () => true` with a real check.

**Checks:** a workflow naming a brief that does not exist fails `forge workflow validate --all` with
`unknown-brief`; a brief's text, not its path, reaches the compiler; override layering
(`.forge/overrides/`) works for briefs the way it does for other content.

**Depends on:** P0. Note: turning on the real `briefExists` check makes validation fail until P2
lands, so P1 and P2's first batch merge together.

## P2 — Author the 62 workflow and gate briefs

**Mandate:** the content itself. Each brief states the task, its acceptance criteria and the inputs
it expects — block [4] of `05` §5.3.

**Surface:** `packages/templates/templates/briefs/*.md`. Cut into three judgeable batches:

- **P2a** — planning path (`intake` → `plan-stage`), the briefs SC1 depends on.
- **P2b** — build/verify/deliver path (`build-stage`, `implement-story`, `verify-stage`, …), SC2/SC6.
- **P2c** — gate advisory critiques and the remaining workflows.

**Checks:** every brief referenced anywhere exists and every brief file is referenced (both
directions, the `TEMPLATE_INDEX` test pattern); no `TODO`/`FIXME`; a brief names only inputs its
step actually declares; Handlebars expressions use only declared helpers.

**Depends on:** P1.

## P3 — Agent system prompts and agent-level briefs

**Mandate:** the 62 `prompts/*.md` files the 34 agents reference.

**Open question the piece must settle first:** an agent's `prompt.briefs.*` and a workflow step's
`brief:` look like two sources for the same block. `05` §5.3 does not say which wins. Record the
answer in `SPEC-QUESTIONS.md` before writing content — it may turn out that the role block is
rendered entirely from the agent's structured fields and `prompt.system` is supplementary.

**Checks:** as P2, plus `forge agent validate --all` fails on a missing prompt file.

**Depends on:** P1. Independent of P2.

## P4 — Per-step tool grant and model resolution

**Mandate:** replace the one global grant and the first-listed model with the agent's own.

**Surface:** a resolver (in `@forge/agents` or `@forge/engine`) producing, per step: the agent's
`tools` narrowed by its ceiling and any overlay (`@forge/extensions`' existing `checkToolCeiling`/
`mergeGrants`), and a model from `05` §5.8's tier mapping via config. `context.ts` stops supplying
`DEFAULT_TOOLS`/`resolveModel` as the answer for every step.

**Checks:** `reviewer` is dispatched with `write: false`; `sdet` with its declared exec patterns; a
grant above the ceiling is refused; an unmapped tier is a named error, not a silent default; the
hard denylist (S2) still applies on top.

**Depends on:** P0. Independent of P1–P3. Security-relevant — expect a hostile critic round.

## P5 — Wire prompt assembly into dispatch

**Mandate:** the actual fix. Both dispatch paths build a real session request.

**Surface:** `packages/engine/src/dispatch/steps.ts` (`buildSessionRequest`),
`packages/engine/src/interaction/dispatch-agent-step.ts`, `ExecuteStepContext` (agent registry, KB
backend/tree, config budgets, autonomy), `packages/cli/src/commands/run/context.ts` (construct
them).

- Load the step's `AgentDefinition`; `packForStep`; `compilePrompt` with constraints from P4,
  budget and autonomy from config, and definition-of-done from the step's gate checks.
- Write `.forge/state/runs/<runId>/steps/<stepId>/prompt.md` via `writePromptRecord` — `05` §5.3
  calls this mandatory. Record the context pack's composition in the step record.
- Resume must recompile an identical prompt for an identical step (determinism).

**Checks:** a dispatched step's request contains all nine blocks; blocks [1] and [6] are unchanged
by a hostile KB entry or skill body; the prompt record exists and matches what was sent; packed
content from untrusted sources is wrapped and taints the step; crash-resume still converges.

**Depends on:** P1, P4. Needs at least P2a for an end-to-end test on a real workflow.

## P5b — `forge init` writes the model-tier map

**Mandate:** P5 (Q203) made an unmapped tier a hard failure (RUN-078, `05` §5.8), which is correct, but
`DEFAULT_CONFIG.models.tiers` is empty and `forge init` fills nothing in, so on a fresh project every
agent step fails. `@forge/schemas` cannot name platform models (`no-platform-concept` lint), so the
map must be written at init time from the selected adapter (`listModels()` already reports the
`haiku`/`sonnet`/`opus` aliases): `models.tiers.<tier>.<adapterId>`. Re-running init must not
overwrite a user's edited map.

**Depends on:** P5. Blocks P9.

## P3c — Re-key the agent brief specialisations that can never attach

**Mandate:** Q198/Q199: 22 of the 33 `prompt.briefs.<key>` entries in `modules/fm-core/agents/*` use
keys (copied from `05` §5.3's illustrative names) that match no shipped step brief and no
participant-mode name, so their authored content never reaches a prompt. Re-key each to the nearest
real step brief basename (or mode name), rename the prompt file and `PROMPTS_A`/`PROMPTS_B` entry to
match, merge or choose where two steps compete for one agent, and drop any with no sensible match.
Add a repository-level test that every `prompt.briefs` key across all agents is attachable (matches a
shipped step brief basename or a participant mode name), so this cannot regress.

**Depends on:** P5 (the matching rule).

## P10 — `forge plan run-plan`

**Mandate:** `plan-stage.workflow.yaml`'s `derive-run-plan` step runs `forge plan run-plan {{stageId}}
--json`, but `PLAN_PHASES` in `packages/cli/src/bin.ts` has no `run-plan` and nothing handles it, so any
real `plan-stage` run fails at that step. Read `03`/`10`/`09` for what the command must produce (the
engine-compiled run plan for a stage) and implement it, or, if the spec and workflow disagree,
record which is authoritative.

**Depends on:** none. Independent of the prompt work.

## P12 — Fix what the live smoke run found (Q208)

**Mandate:** the run-time defects P9 reproduced live, each a small, testable fix:
(1) a run with no admissible step must say why (emit `BudgetBreached`/a typed failure naming the cap and the step's
reservation) instead of a bare `RunFailed`; (2) the plan-level `maxCostUsd` must come from the agent's
`limits.max_cost_usd` (then the step, then the default), and a `command` step must not reserve the agent-sized default
(reserve 0, or accept `limits` on command steps); (3) command steps must find the running CLI (`forge`) even when it is
not on `PATH`; (5) keep the agent session's final text in the run record (or a linked transcript) so a step's answer
is never discarded; (6) a dirty-tree refusal is a normal remedy-bearing error, not a stack trace; (7) `forge init`
honours `-C` or rejects it.

**Depends on:** P9 (done). Finding 4 is P7 plus P11, not this piece. **Status:** done (Q210).

## P13 — The shipped `build-stage` workflow must compile

**Mandate:** found by P10 (Q206) running the real workflow: `build-stage.workflow.yaml` does not compile.
The `merge` step's per-item `dependsOn` cannot resolve `item.id`, and the `review` fanout declares no `itemKey`. So
`forge run build-stage` (the workflow that turns planned stories into code, `10` §10.4) cannot start at all, and
`forge plan run-plan` reports `stepPlan: unavailable` for every stage. Read `06`/`10`/`22` for what the fanout
and per-item dependency contract is meant to be, fix the workflow (or the compiler, if the compiler is what is wrong;
record which and why), and make a repository-level test that EVERY shipped workflow in every module compiles
(P6's repo-wide test may already cover this once it lands; extend rather than duplicate). Delete the `it.fails`
known-gap test P10 left in `packages/engine/test/plan/stage-plan.test.ts` (it goes red when this is fixed) and the
`step-plan-unavailable` note.

**Depends on:** P6 (the repo-wide compile test), P10. Blocks any real build-stage run and a useful second live smoke.
**Status:** done (Q211): the shipped `build-stage` compiles and `forge plan run-plan` reports `stepPlan: compiled`. It does NOT make `forge run build-stage` start: the CLI's run context lacks `stage.stories`/`stageId`/`vars` (Q211 open item 1, needs its own piece with the merge-lane question, item 2).

## P11 — Workflow / agent / gate coherence (decision piece)

**Mandate:** content authoring (Q200/Q201/Q202) found places where shipped definitions contradict each
other, which a live run will hit: steps assigned to agents that cannot produce the declared output
(`write: false` roles on file-producing steps; missing `kb_write`/output slots); no test-runner exec
grant for `diagnostician`/`sdet`/`backend`/`sre`; `intake` creates no `constraints/**`;
`execution.testCommands` set by no step; gate rule names with no `forge spec validate --rule`
implementation; `G-Stable` unreachable without a human; spec `09` §9.3 vs `10` §10.6 on test globs.
Each is a decision, not a mechanical fix, so the first deliverable is a triage in `SPEC-QUESTIONS.md`
(fix / spec-change / defer) for the owner. Not started.

**Depends on:** P9 (the live run decides which of these actually bite first).

## P6 — A test adapter that reads the prompt

**Mandate:** make this class of gap impossible to miss again.

**Surface:** `@forge/testkit` — a strict mode where the fake adapter fails a session whose prompt
is empty, is a bare file path, or lacks the operating contract. A repository-level test compiles
every shipped workflow and asserts every agent step resolves to a real agent, a real brief and a
non-empty compiled prompt.

**Checks:** reverting P5 makes this suite fail.

**Depends on:** P5.

## P7 — Output contract check after an agent step

**Mandate:** what block [1] promises. After an agent step, each declared `outputs` entry exists at
its registry path and validates against its schema; failure is a `validation`-class step failure.

**Known dependency:** the retry loop has no production callers (disclosed at M11 P11), so a
validation failure fails the step rather than retrying. Wiring retry is out of scope here; recorded,
not hidden.

**Depends on:** P5.

**Status:** built (Q209, `## M13 P7` in the log). Shipped write-forbidden agents on file-producing steps now fail honestly: 37 steps
are pinned in `test/output-contract-known-gaps.test.ts` until P11 resolves them.

## P8 — Context expansion protocol

**Mandate:** `05` §5.4 point 4 — resolve `FORGE_REQUEST_CONTEXT:` mid-session via the existing
`resolveContextRequest`. First confirm whether any of this is already wired.

**Depends on:** P5. Lowest priority; can slip to a later milestone without blocking a live run.

## P9 — First live smoke run (human-run)

**Mandate:** one cheap real step end to end with `FORGE_LIVE=1` and a real `ANTHROPIC_API_KEY`.
Needs the owner's key and spends real money, so it is run by the owner, not by an agent. Findings
go to `SPEC-QUESTIONS.md`; expect some.

**Depends on:** P5, P5b, P2a.

**Status:** run once (Q208, `## M13 P9` in the log): real assembly proven live, $0.3885 spent; two product gaps found
that make the workflow itself fail (`forge` not on `PATH` for command steps; a write-forbidden agent's step reports
success with no output). Re-run after P7 and P12 land.

---

## P14-P27 — Making a real run work (from the P11 triage)

Authoritative scope, evidence and proposed spec text: **`process/plans/P11-TRIAGE.md`** (§5 order of work, §6
proposed spec text, §2 register, §3 the 37 pinned steps). Every agent building one of these reads its rows
there first, then `process/plans/M13-AGENT-NOTES.md` for the standing process rules.

**Owner decisions (2026-09-20).** M13 scope: the *full* triage list. Q1 yes (authoring roles write, confined to
a claim made of their declared outputs; `reviewer` and `critic` stay read-only). Q2 yes (the engine writes and
validates the swarm-review `ReviewReport`; `reviewer` stays `write: false`). Q3 yes, after a failing two-step
test confirms the lane-visibility gap (auto-merge a successful lane no `merge` step consumes; later lanes
branch from the integration tip; explicit `merge` steps untouched). Q4-Q8 were not asked separately: choosing the
full list at the triage's recommended dispositions is recorded as approval of them (interactive `elicit` in M13;
optional `Story.test_paths`; test-running exec grant from `execution.testCommands`; keep every gate check and
implement the missing commands; keep G-Foundation's deployed skeleton via a Waiver-coverable
`skeleton-deployed` check). The owner can veto any of these; each is a separate piece.

| Piece | What it changes | Depends on |
|---|---|---|
| P14 Outputs are the claim | claim passed to `enforceClaim` = `produces` ∪ registry globs of declared outputs; steps declaring `outputs` are enforced `strict` at any autonomy; drop the `no-write-scope` class from the known-gaps test | P7 |
| P16 Declare what the brief writes | `produces` on output-declaring steps whose brief writes further documents; content test that brief-named write paths lie inside the step claim | P14 |
| P15 Authoring roles can write | `tools.write: true` on the authoring roles (not `reviewer`/`critic`), both `integration-architect` copies; architect ceiling, spec `05` §5.3 example and its roster test, `20` §20.1; `outputs` on the two unchecked steps | P14, P16 |
| P17 Swarm-review persists its report | engine creates a lane, writes/validates `REVIEW-NNN.md`, P7 still runs | P7 |
| P18 Definition and registry coherence | agent `outputs[]` aligned to registry and steps; five HandoffRecord briefs get the `subtype:` line; `write-prd` moves to `pm`; ADR templates; stale greenfield fixtures; spec example keys; repo test | P15 (same agent YAML files) |
| P19 Lane visibility | failing two-step test first; then auto-merge of lanes no `merge` step consumes, branch-from-integration-tip, read-only inline steps read the integration worktree; fix `runMergeStep` predecessor semantics (merges the review lanes, not the implement lanes: Q211) | P14 |
| P20 `elicit` and intake | interactive `elicit` (TTY plus `--answers`), a `capture-constraints` step, a compiled level-recording command step | P19 |
| P21 Run inputs | `forge run --input`, `--stage` also sets `stageId`, a `build-stage` run context (`stage.stories`, `stageId`, `vars.integration_branch`; Q211 open item 1) | P13 |
| P22 Command steps that exist | wire `forge story verify`; fix the three `deploy` strings | none |
| P23 Tests can run | exec grant derived from `execution.testCommands`, plus `doctor --rule test-command` | P15 |
| P24 Gates I | the six missing `spec validate --rule` names; a shared conservative overlap rule for G-Ready | none |
| P25 Gates II | the four remaining `doctor` rules, two `kb lint` rules, `test` smoke and contract, G-Foundation `skeleton-deployed` | none |
| P26 Gates III | diagram, interfaces-frozen, deploy dry-run and rollback-check, version-skew, migration-order, SLO and runbook coverage | P25 |
| P27 Sessions and `forge debug` | session roster read from `.forge/agents`; `forge debug` moved onto real prompt assembly (removes P6's pinned opt-out) | none |
| P9-2 (orchestrator, live) | re-run `retro` with a low `budget.perRunUsd` after P14, P15, P16, P18 | P14-P18 |
| P9-3 (orchestrator, live) | `plan-stage` at L1 | P14-P19, P27 |

**Found while building P14-P27 (each turns into a piece; see the Q entry cited):**

| Piece | What it changes | Source |
|---|---|---|
| P28 Confine model-proposed commands (**security**) | `forge debug`'s REPRODUCE/PROVE commands, proposed by the model, run through `runShellCommand` with `shell: true` and the full environment, outside every tool grant; nothing enforces `taint: 'external'` for a tainted step; no claim or output scan runs on the diff `forge debug` commits. Run them under the agent's resolved grant and a scrubbed environment, enforce taint on grants, scan the committed diff | Q215 findings 3-4 |
| P29 Debug and session leftovers | steel-man technique files read from `<project>/modules/*/techniques` (init should copy them to `.forge/techniques/`); collapse the CLI's older `loadProjectAgent` onto `readProjectAgent`; `forge debug` uses ad-hoc limits (20 turns/10 min/$2) not the diagnostician's declared ones; FIX now has `git*`/`cat*` exec and `git_commit: lane` (owner sign-off); DECIDE-owner matching is coarse (`decisions_owned` not matched to the question) | Q215 findings 1-2, 5-11 |
| P30 Self-verify vs review order | spec `10` §10.6 puts self-verify (step 6) before review (step 7) but the `09` §9.8 example `done` profile contains `review:blocking-findings == 0`, so a default profile can never be green at self-verify; split the profile into `verify` and `done` phases (owner decision) | Q213 |
| P31 Strict enforcement semantics | spec `06` §6.7 says strict fails the step; the code only reverts the file (owner call); P14's reworded `06` §6.4 contradicts `02` §2.5 / `08` §8.6 on the `KbWriter` (owner decision) | Q212 |

| P32 Gate on the review verdict | nothing gates on a `ReviewReport` verdict: a `blocked` or `incomplete` review still lets `implement-story` and `build-stage` advance. Decide the mechanism (a gate check, or a `verdict` front-matter field that a deterministic check reads) and implement it. Owner decision on which | Q217 |
| P33 Strict-enforcement owner decisions | (a) strict never fails the step (spec `06` §6.7 says it does), now backed by 25 silent losses P16 found; (b) `docs/forge/...` paths in `produces` do not follow a relocated docs root (58 references); (c) 9 steps declare no outputs and no `produces`, so strict reverts everything they write (`debug:fix`, `harden:fix-findings`, `implement-story:{document,refactor}`, `migrate:{expand,contract}`, `quick-fix:{write-failing-test,fix}`, `refactor:refactor-code`); (d) `prepare-release-build`'s claim is a guess; the `run-rca` reproduction location; the diagram location (`delivery/pipeline/**` vs `delivery/views/*.mmd`) | Q212, Q216 |
| P34 Spec text | `specs/03` §3.2.4 has no `--input` row, and its `forge run build --stage mvp` example does not match the workflow id `build-stage` (recommended text in Q218) | Q218 |

| P35 Gates fail closed (**rigour**) | `evaluateCheck` ignores the exit code and a missing `failOn` field, so a refusal envelope or any JSON without the field passes the check; evaluate fail-closed and add a repo-wide guard that runs every shipped gate check through the real CLI. In progress | Q219 |
| P36 An empty claim means no write (**security**) | a step with no `outputs` and no `produces` is unconfined when its agent has `write: true` (`assemble.ts` grants write from the agent alone): fail closed (`write: false` for an empty claim, or a declared claim), and restrict `Story.owner_role` to implementation roles so an `{{ownerRole}}` step cannot run an authoring role; give `implement-story:refactor`/`:document` and the other 9 KNOWN_EMPTY_CLAIM steps a claim | Q220, Q216 |
| P37 Approval rights vs authorship (owner decision) | `pm` (G-Product) and `po` (G-Ready) now write the evidence for gates they may approve; `may_approve` is read by no run-time code, `kb_write` and `file_ownership` are enforced nowhere, `05` §5.2 roster rule 3 is not implemented; P7 does not check an output entry's `from` against the running agent | Q220 |

Also carried from P13 (Q211): spec `10` §10.1's worked example does not compile as written (amend with `itemKey` on
`review`, `dependsOn: [prepare]` on `freeze-contracts`, and a sentence that a merge's `dependsOn` resolves per
item); `fixtures/greenfield-service/.forge/workflows/build-stage.workflow.yaml` is a stale hash-headed snapshot
(P18); existing projects hold the un-keyed `review` until `forge upgrade`.

**Deferred past M13** (P11-TRIAGE §5): advisory critique dispatch and parser, the six role-less agents,
`subworkflow`, `onComplete` wiring, G-Stable auto-close, migrate cut-over, operate creation steps, retry-loop
interplay, `kb_write` enforcement, path-scoped write grants, front-matter stamping, the input DSL, the adapter
cost-cap gap.

## Sequencing

```
P0 ─┬─ P1 ─┬─ P2a ─ P2b ─ P2c
    │      └─ P3
    └─ P4 ─────────┐
           P1 ─────┴─ P5 ─┬─ P6
                          ├─ P5b ── P9 (needs P2a)
                          ├─ P3c
                          ├─ P7
                          └─ P8
P10 (independent)   P11 (after P9)   P12 (from P9)   P13 (from P10)
```

P2/P3 are content and can run alongside P4. P5 is the join point. Same gauntlet discipline as
M1–M12; before declaring M13 complete, verify every `## M13 P<n>` log entry exists and that P6's
suite fails when P5 is reverted.

## Decisions needed from the owner

1. **Approve adding M13 to `specs/22`** (P0), or name it something else.
2. **Content volume.** 124 content files (62 briefs + 62 agent prompts). Recommended: author all of
   them, but in the order P2a → P2b → P3 → P2c so a live run is possible after P2a + P5.
3. **P9** needs your API key and a small spend. Say when you want it run.
