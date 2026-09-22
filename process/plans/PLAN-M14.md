# PLAN-M14 — Honest workflows: enforcement, gates, lanes and the security gaps M13 disclosed

**Status: plan. Nothing here is built.** Post-v1.0; the `specs/22` M14 entry is written with this plan
(spec first), so no P0 piece exists. Every piece follows `process/plans/M13-AGENT-NOTES.md` unchanged
(see Standing rules). Pieces take the next free `SPEC-QUESTIONS.md` number at commit time (Q233 is
free today); the log entry is `## M14 P<n>` in `process/GAUNTLET-LOG.md`. M13 pieces are cited as
`M13 P<n>`.

## Why this milestone exists

M13 made one workflow (`retro`) complete end to end on real Claude (Q231) and, doing so, disclosed
what a real run still lacks: an out-of-claim write is reverted but the step "succeeds" (25 silent
losses, Q216); a `ReviewReport` verdict stops nothing; a lane with two predecessors cannot be
built; the shipped `agent` conflict policy has no resolver; `forge merge` and the DECIDE lane land
with no checks; `forge gate approve` cannot tell an agent's shell from a person's; waivers never
expire; `forge kb verify`, `forge adopt` and the RCA loop run untrusted-source commands with the
full environment; gates, `elicit` and session steps have never run live. Q231 lists what the two
live runs did not exercise; Q232 records the 21 owner decisions that M13 left open, decided on
2026-09-21 and delegated to the orchestrator. M14 implements those decisions, closes the rigour and
security gaps they name, and proves the next workflow (`plan-stage`, with a gate and two session
steps) live.

## Decisions this plan commits to

Q232 is binding: every piece implements its decisions as decided and re-opens none.

1. An out-of-claim write under `strict` fails the step (P3).
2. Lanes write declared KB outputs as files; `KbWriter`'s guarantees become output checks (P8, P10,
   P11; spec text P1).
3. `docs/forge/<section>/` prefixes in `produces` follow the configured roots by engine expansion (P6).
4. `prepare-release-build` claims a configured list of app paths, refusing until set (P12).
5. RCA reproductions live under a defect-scoped test glob (P13).
6. A write-capable agent step with an empty claim is a validate error / doctor warning (P7).
7. A `ReviewReport` verdict binds: `blocked` fails the step, `incomplete` blocks the merge,
   `concerns` is recorded (P14, P18).
8. `pm`/`po` keep `may_approve`; an agent never approves a gate it produced evidence for in the same
   run (P19).
9. An agent-run `forge gate approve|waive` is refused under the engine's session marker (P4, P15).
10. Waivers: 90-day default cap, `--owner` an identifier (P16).
11. The `spec validate` rules keep failing an empty project; `skeleton:deployed` keeps its Waiver
    cost (P21, P22, P23 add the briefs and recorders, relax nothing).
12. The deliver-stage deploy strings stay (P23).
13. The DoD profile splits into `verify` and `done` (P1 spec text, P25 code).
14. Test commands stay exact strings plus one validated `{path}` (P5, P24, P26).
15. Plan compilation taints steps; `adopt`/`migrate` are tainted by construction (P27, P30, P31).
16. The `exit 1 beside a v:1 envelope` trust stays (P28 refuses as findings, changes no exit code).
17. Several unmerged predecessors are joined in-lane in plan order (P34).
18. The `agent` conflict policy gets its resolver; the integration branch is fast-forwarded to `main`
    at run start (P9, P35, P38).
19. A merge with no configured test layers stays refused; `fast`/`full` as Q226 (P39, P40).
20. `forge config set --commit`, used by `intake:record-level` (P37).
21. Loader-level agent output validation; `forge upgrade` names stale materialised files (P33, P42,
    P43).

**Error codes assigned here** (three drafts had claimed `RUN-104`; `RUN-103` is the highest at
`packages/core/src/errors/codes.ts:1243`, `GATE-509` at :2007, `CFG-054` at :1874; holes are not
reused): `RUN-104` claim failure (P3), `RUN-105` elicit `show` entry missing (P41), `RUN-106`
`paths.release` unset (P12), `RUN-107` integration branch diverged (P9), `RUN-108` blocked review
(P14); `GATE-510`..`GATE-513` (P15, P16, P19); `CFG-055` (P37). Engine failure codes
(`LANE-JOIN-CONFLICT`, `MERGE-REVIEW-INCOMPLETE`, `MERGE-RESOLVER-*`, `MERGE-CHECKS-UNCONFIGURED`)
are string codes classified in `packages/engine/src/failures/classify.ts`, as `MERGE-CONFLICT-UNRESOLVED` is.

## Pieces

Format per piece: Mandate / Surface / Spec / Tests first / Mutation evidence / Depends on / Size /
Discloses. Line numbers were verified at `269aed2`.

## P1 — Spec amendments Q232 lists, in one mechanical piece, plus `doctor --rule test-command` `granted`

**Mandate.** Amend every spec sentence Q232's "Spec text to amend" names, plus decisions 1, 2, 13 and
20, so the specs state what M14 builds (spec first, code follows). Verified edits: `specs/03` line 86
`forge run` row gains `[--input <name>=<value>]... [--answers <file>]` with the Q218/Q227 text
(`--answers` also on `forge resume` line 88 and `forge plan replan`; a question with no answer and no
terminal fails its step); line 87 `forge run build --stage mvp` becomes `forge run build-stage
--stage mvp`, same fix at `specs/01` line 124 SC2; line 124 `forge config` row gains `set <key>
<value> [--commit]` (commits only `.forge/config.yaml`, FORGE-authored message); line 246 gains the
one-line `{"v":1,"ok":false,"error":{"code","message","remedy","exitCode"}}` refusal-envelope sentence.
`specs/10` line 136 `elicit` row becomes Q227 (c)'s text (`name`/`prompt`/optional `choices`; answers
are data, never template input; `RUN-101`/`RUN-102`; `ElicitationRequested`/`ElicitationAnswered`) plus
"A question may `show` a register entry an earlier step produced (`show: {type, subtype}`); the engine
reads it from the integrated tree and places its text before the question, as data." `specs/09` lines
264-273: `done:` splits into `verify:` (`build:typecheck`, `build:lint`, `test:unit --scope story`,
`test:integration --scope story`, `spec:ac-coverage --story`, `security:secrets-scan`) and `done:`
(`review:blocking-findings == 0`, `docs:public-api-documented`, `kb:no-new-contradictions`); lines
278-279 say `verify` runs at `10` §10.6 step 6 (`forge story verify`) and `done` at step 9 and in the
merge queue. `specs/02` lines 158-159 and `specs/08` line 214 (+ the **Declared output** bullet and
"These invariants bind every path") get decision 2's text; P11 pins them and adds only the `06` §6.4
rule 1 cross-reference. `specs/06` lines 186-188: an `agent` step declaring `outputs` is always
`strict`; an out-of-claim write under `strict` reverts, records `PolicyViolation` and **fails the
step**; `warn` remains the `guided` default for a step declaring neither `outputs` nor `produces` — a
`command` step; an `agent` step with an empty claim has no write grant (M13 P36) and is enforced
`strict` (Q225 D1), which reconciles decision 1 with the code P3 keeps. `specs/20` line 85 rule 3 gains
"; under `strict` the step also fails". `specs/15` after line 180: the derived test-command grant sits
outside the ceiling by design (`execution.testCommands`; `forge doctor --rule test-command` lists it);
line 629 I7 gains the exception. `specs/05` rows 29/30/74 (analyst loses "success metrics", pm gains
it, facilitator's retros are `em`'s). Code: `testCommandViolations`
(`packages/cli/src/commands/doctor/rules-test-command.ts:97`) also returns `granted: [{layer, command}]`
for the configured `AGENT_RUN_LAYERS` passing `checkTestCommand`; `DoctorRuleResult` (`doctor/rules.ts:53`)
gains the OPTIONAL field; `doctor/rule-command.ts:52` prints it. Must not change: `05` §5.3's fenced
example (lines 98-213, parsed by `a2-roster.test.ts`), `05` §5.5, any workflow, brief or engine code,
`packages/methods/src/dod/schema.ts` (P25's), other rules' envelopes.

**Surface.** `specs/{01,02,03,05,06,08,09,10,15,20}-*.md` at the lines above;
`packages/cli/src/commands/doctor/{rules-test-command,rules,rule-command}.ts`;
`packages/cli/test/commands/doctor/rules-test-command.test.ts`; new `test/spec-cli-examples.test.ts`;
new `packages/methods/test/dod/spec-block.test.ts`.

**Spec.** 03 §3.2, §3.2.4, §3.5; 01 SC2; 10 §10.1; 09 §9.8; 02 §2.5; 08 §8.6; 06 §6.7; 20 §20.2;
15 §15.3.2, I7; 05 §5.2.

**Tests first.** `test/spec-cli-examples.test.ts`: every `forge run <id>` literal in 03 §3.2.4 and 01
SC2 names a `WORKFLOW_INDEX` id (red on `build`); the `forge run`/`resume` rows list `--input`/`--answers`
and `forge plan replan`; the `forge config` row names `--commit`; one deletable describe pins each
amended sentence (06 'fails the step', 20 'the step also fails', 02 no longer 'never as raw file
writes', 08 '**Declared output**', 15 'execution.testCommands', 10 'RUN-101'/'choices'/'show:', 05
"retros are `em`'s"). `spec-block.test.ts`: YAML-parse the ```yaml block under `## 9.8` (not
`loadDodProfile`, strict on ready/done): `backend-default` has `ready`/`verify`/`done`, the three
post-review ids only in `done`, the six build/test ids in `verify`. Doctor test: the real `--json`
envelope carries `granted` equal to the passing layers, `[]` when none, a refused layer absent;
`errors`/`violations` unchanged. `a2-roster.test.ts` and `operating-contract.test.ts` stay green.

**Mutation evidence.** Revert `build-stage` → `build` in either spec: two failures. Revert any pinned
hunk: its pin fails (count logged). Remove `granted` or derive it without `checkTestCommand`: two
failures. Move `review:blocking-findings == 0` into `verify`: spec-block fails.

**Depends on.** none. **Size.** M.

**Discloses.** 09 §9.8's 'Stored in docs/forge/kb/engineering/definition-of-done.md' vs the code's
`engineering/dod-profiles.yaml` (Q213) is left; 17 §17.4 / 04's 'max 3 questions per modal' left; the
`show` sentence and decisions 1, 2, 13 are ahead of the code until P3, P8-P11, P25, P41 land; line 178
of 15 §15.3.2 says escalations appear in `forge doctor` but no doctor code reads
`security.toolCeilingEscalations` (grep empty), not fixed here.

## P2 — Non-inline command steps declare what they write

**Mandate.** Every shipped non-inline `command` step that writes a tracked file in its lane declares
`produces` for exactly what it writes, and a root test proves that under `execution.autonomy: guided`
no shipped step emits `PolicyViolation` for its own declared work. Verified enumeration: 14 non-inline
command steps, none with `produces` (`adopt:inventory-codebase`, `debug:prove-fix`,
`migrate:verify-migration`, `quick-fix:verify`, `refactor:verify-invariants`, `verify-stage:run-tests`,
`deliver-stage:deploy|rehearse-rollback|smoke-test`, `implement-story:self-verify`,
`migrate:migrate-data`, `replan:re-derive`, `verify-stage:check-coverage|verify-traceability`); only
`forge adopt inventory` is known to write a tracked file (`reports/adoption/inventory.json`,
`packages/cli/src/commands/adopt.ts:86,229,301`); the piece establishes per command whether it writes
under the lane. Why: `resolveStepClaim` (`packages/engine/src/dispatch/outputs.ts:230-241`) gives a
`command` step `globs: produces` and the default policy, so under `strict` an undeclared write is
reverted today and would fail the step once P3 lands. Must not change `steps.ts:220-239`'s emit
condition, `resolveStepClaim`, `resolveClaimPolicy` (`packages/cli/src/commands/run/context.ts:503`)
or inline steps.

**Surface.** `packages/templates/templates/workflows/{adopt,debug,deliver-stage,implement-story,migrate,quick-fix,refactor,replan,verify-stage}.workflow.yaml`;
read-only `packages/cli/src/commands/adopt.ts`, `bin.ts:3555,3573,3604`; new
`test/command-steps-in-claim.test.ts`; `test/command-steps.test.ts` (`NON_FORGE_STEPS` :211).

**Spec.** 06 §6.7; 18 §18.4 (`PolicyViolation`); 10 §10.1.

**Tests first.** For every shipped non-inline `command` step (derived from the files), `runWorkflow`
under `guided` with the launcher shim and strict fake adapter in a seeded `forge init` project: no
`PolicyViolation` for a path the command wrote (red for `adopt:inventory-codebase`); every documented
write path lies inside `produces` or under uncommitted `.forge/` state; under `supervised` the written
files survive (red today for the inventory report).

**Mutation evidence.** Remove `produces` from any writing command step: the guard names it and the
strict case shows the revert.

**Depends on.** none; lands before P3. **Size.** S.

**Discloses.** Inline steps out of scope (reverted by design); if only the inventory step writes, the
piece is one line plus the guard and the Q entry says P36 resolved the rest of Q212's item; a claim
that `produces` globs cannot express is a finding, never widened to `**`.

## P3 — An out-of-claim write under `strict` fails the step

**Mandate.** When `runLaneLifecycle` (`packages/engine/src/dispatch/steps.ts:156-285`) enforces a
`strict` claim and `enforceClaim` returns a non-empty `outOfClaim`, the step ends `failed` with
`StepFailureInfo { source: 'claim', code: 'RUN-104' }` (new source member, `types.ts:442-462`;
`classifyFailure` (`failures/classify.ts:127-171`) maps `claim` → `policy`, so `decideRetry` never
retries it). Order fixed: work commit, `PolicyViolation` (payload gains `stepFailed: boolean`),
`claim-revert` commit and its `LaneCommitted {reason:'claim-revert'}` land first (:225-259); the
failure returns after :260, before `work.failure` (:263) and the output check (:273); no `LaneReady`,
lane not registered. When `work.failure` is also set the adapter failure wins and the violation stays
in the event. `warn` (`resolveClaimPolicy`, `packages/kb/src/adopt/claim-policy.ts:48-51`) is
byte-for-byte unchanged. No new resume rule: a crash before `StepFailed` leaves the step `running`
and `rollbackLaneToBase` (`resume/orchestrate.ts:234`) re-runs it. Must not change `enforceClaim`
(`packages/vcs/src/claims.ts:158-223`), `RUN-083`/`084`, `forge debug`'s scan, `reconstruct.ts`.
`RUN-104`'s message keeps the P7 docs-roots hint (`outputs.ts:688-690`) when a declared output's path
is among the reverted ones. No spec edit (P1 owns 06 §6.7).

**Surface.** `packages/engine/src/dispatch/{steps,types}.ts`, `failures/classify.ts`,
`packages/core/src/errors/codes.ts`, `packages/cli/src/commands/run/run-failure.ts:31`; verify
unchanged: `packages/telemetry/src/audit.ts:94`, `packages/tui/src/state/run-read-model.ts:188`. Tests
to flip (outcome only, never the 'stray reverted' assertions):
`packages/engine/test/dispatch/{output-claim,agent,empty-claim}.test.ts`,
`packages/cli/test/commands/run/{output-claim,empty-claim}.test.ts`, `test/nine-steps-claims.test.ts`
(:271/:293 split into in-claim success and protected-write failure), `test/authoring-roles-run.test.ts`;
check `swarm-review-step.ts` (`steps.ts:121`: lane created before work) before deciding whether its
revert cases flip.

**Spec.** 06 §6.7 L184, §6.8 L230 (`policy`: fail immediately, no retry); 20 §20.9; 18 §18.4; 05 §5.5
rule 6.

**Tests first.** New `packages/engine/test/dispatch/strict-fails-step.test.ts` (real git lane, faked
session): strict + one stray → `failed`, `source 'claim'`, `RUN-104`, message lists ≤5 paths plus totals,
no `LaneReady`, `laneRegistry` lacks the step, `claim-revert` `LaneCommitted` after `PolicyViolation`,
lane HEAD lacks the stray, declared output committed, payload `{kind, policy:'strict', stepFailed:true,
paths, totalOutOfClaim, totalReverted}`; `classifyFailure === 'policy'`, `decideRetry` says no;
empty-claim agent step writing one file fails under every autonomy (`resolveStepClaim` :234-241);
warn + produces-only pinned `{policy:'warn', stepFailed:false}` succeeded, and warn + `.forge/x`
reverted-but-succeeded pinned; adapter failure precedence; control characters clipped (`clip`,
`outputs.ts:346`). `resume/orchestrate.test.ts`: crash after the revert commit → reroll, a repeated
stray fails `RUN-104` again, an in-claim session succeeds. CLI: run `failed`, dependent gate not run,
stderr carries the remedy, `--json` carries the code.

**Mutation evidence.** Remove the `return failed(...)`: >20 failures. Map `claim` → `validation`: two.
Return before the revert commit: two. `stepFailed: false` always: one. `RUN-104` when `work.failure`
set: one.

**Depends on.** P2. **Size.** M.

**Discloses.** Under `warn` a protected-path write is reverted, flagged, still succeeds (decision 1
silent); adapter failure hides a concurrent violation in the event only; enforcement runs only when
the adapter reports changed files (OS confinement deferred); duplicate `PolicyViolation` on retry
unchanged; retry loop has no production caller (proven at `decideRetry`); `context.ts:500-503`
comments and 17 §17.4 / 20 §20.2 `guided` prose left.

## P4 — Every engine-spawned session and run-spawned command carries the FORGE run/step/agent marker

**Mandate.** `@forge/core` exports `FORGE_RUN_ID`, `FORGE_STEP_ID`, `FORGE_AGENT_ID` (no such key
exists under `packages/*/src` today, grep verified) and every `SessionRequest` the engine builds
carries them: `buildSessionRequest` (`packages/engine/src/dispatch/steps.ts:292-316`, `env: {}`),
each participant session of `dispatchAgentStep` (`interaction/dispatch-agent-step.ts:107`),
`forge debug`'s two sites (`packages/cli/src/commands/loop/debug.ts:508,672`; run id the
`debug-<ts>` id at :826, agent `diagnostician`). Run-spawned commands carry `FORGE_RUN_ID` and
`FORGE_STEP_ID`: `commandEnvFor` (`run/launcher-shim.ts:108-125`, PATH only) takes the run id and
`commandStepEnvironment` (`dispatch/elicit.ts:320-329`, its `Pick` widened to `runId`) adds the
step id (P37 consumes both); the CLI gate shim (`bin.ts:1072`) sets none. Both adapters merge
`req.env` last (`adapter-claude-code/src/adapter.ts:457`, `adapter-generic/src/adapter.ts:33-37`); one
conformance case pins that an env key reaches the subprocess. Must not change
`CONFINED_ENV_ALLOWLIST` (`confined-command.ts:56`) or the adapters' env handling.

**Surface.** new `packages/core/src/session-marker.ts`; `steps.ts`, `dispatch-agent-step.ts`,
`elicit.ts`, `debug.ts`, `launcher-shim.ts`, `run/run.ts:195-208`;
`packages/adapter-kit/src/conformance/` (`suite.ts`); specs 07 §7.2, 20 §20.10.

**Spec.** 07 §7.2 (`SessionRequest.env`); 20 §20.5, §20.10 S6; 10 §10.3 rule 6 (amended in P15).

**Tests first.** `packages/engine/test/dispatch/{agent,command-env}.test.ts`: every recorded request
has `env.FORGE_RUN_ID === ctx.runId`, `FORGE_STEP_ID === node.id`, `FORGE_AGENT_ID === node.agent`; a
command step's env carries run and step ids; `dispatch-agent-step`/`swarm-review-step` tests: each
participant carries its own agent id; `launcher-shim.test.ts`: PATH only without a marker, PATH +
run id with one; `debug.test.ts`: `diagnostician` and the debug run id;
`test/agent-prompts-all-workflows.test.ts`: every dispatched request names its own step; adapter-kit
conformance against both adapters: `env: {FORGE_PROBE:'x'}` visible in the subprocess.

**Mutation evidence.** Remove the marker from `buildSessionRequest`: engine cases and the root test
fail; from `dispatch-agent-step.ts`: participant cases; from `commandEnvFor`: shim and command-step
cases.

**Depends on.** none. **Size.** S.

**Discloses.** A fence for an honest session (`env -u` defeats it; OS confinement deferred);
`forge debug` REPRODUCE/PROVE children run scrubbed and never see it. R10: composed from `ctx`, never
`process.env`.

## P5 — `execution.testRoots`, one `isTestPath` in the engine, a validated `<trusted> <path> [-t <token>]` form

**Mandate.** `checkTestCommand` (`packages/engine/src/dispatch/test-command-grant.ts:140`) is
unchanged. New `dispatch/test-path.ts` owns `isTestPath` (moved verbatim from
`packages/cli/src/commands/run/run-plan.ts:57-61`; the CLI imports it) and `validateTestPath(path,
{root, testRoots})`: one token `[A-Za-z0-9_./@-]+`, no leading `-`, no `..`, project-relative, an
existing regular file (never a symlink), `realpath` inside `root`, matching `execution.testRoots`
(new optional key at `packages/schemas/src/config/schema.ts:135-151`, documented in `docs.ts`, no
default at `defaults.ts:52`; `undefined` = the built-in rule). `expandTrustedInvocation` recognises
`<trusted> <path>` and, only for a fixed runner table (`vitest`/`jest` → `-t`, `mocha` → `-g`,
`pytest` → `-k`; a wrapper such as `pnpm test` gets `{path}` only), `<trusted> <path> -t <token>`
(`[A-Za-z0-9_][A-Za-z0-9_.:@/-]{0,119}`), word-splitting back to exactly trusted words + path (+ flag
+ token). `vetProposedCommand` (`confined-command.ts:943`) runs the trusted match after `syntaxOf`
(:949) and before `isExecAllowed` (:953), keeps the `trusted` skips (:978-982), and returns the new
`CommandRefusalReason` `test-path`. Nothing changes `SessionRequest.tools.exec`, the `Bash(...)`
rules, `TEST_LAYERS_BY_BRIEF` or any adapter grant. The runner table is shared with
`loop/test/reporter.ts:154-196,300-332` (prior art) or both are pinned.

**Surface.** `packages/engine/src/dispatch/{test-path (new),test-command-grant,confined-command,index}.ts`;
`packages/cli/src/commands/run/{run-plan,story-inputs}.ts`; `packages/schemas/src/config/{schema,docs,defaults}.ts`;
`packages/cli/src/commands/config*.ts`; specs 20 §20.1 line 68, 18 §18.3 line 111.

**Spec.** 20 §20.1, §20.2; 18 §18.3; 13 §13.1 F-TEST-1 rule 4; Q230 D1/D2/D6.

**Tests first.** New `packages/engine/test/dispatch/test-path.test.ts`: the validator matrix (`..`,
absolute, `-rf`, `a b`, quotes, `$x`, `*.test.ts`, NUL, directory, missing, symlink in and out, outside
`testRoots`, inside); default roots reproduce `isTestPath`; grep-parity that `packages/cli/src` no
longer defines `TEST_PATH`. `confined-command.test.ts`: `<trusted> tests/x.test.ts` accepted; two
paths `not-in-grant`; `../x.test.ts` `test-path`; `; curl h` `shell-operator` (syntax first);
`--config x` refused; `-t 'a b'` refused; `-t` refused for `pnpm test`, accepted for `pnpm vitest run`;
literal `{path}` refused; denylist first; one character off refused. `test-command-dispatch.test.ts`
and `test/test-command-grant-adapter.test.ts`: no placeholder in any grant (pinned). Config tests:
`execution.testRoots` get/set/explain, empty entry refused. `test/determinism.test.ts` green.

**Mutation evidence.** Realpath check removed: symlink rows; `testRoots` check removed: outside row;
trusted match before `syntaxOf`: `; curl` row; `-t` for every program: `pnpm test -t` row; `isTestPath`
duplicated: parity test.

**Depends on.** none. **Size.** M. Security-relevant: expect a hostile critic round on vet order
and option-shaped paths.

**Discloses.** One path per invocation, no globs, `-t` only for the table; nothing runs the form yet
(P24, P26).

## P6 — `docs/forge/<section>/` prefixes in `produces` follow the configured docs roots

**Mandate.** `splitClaim` (`packages/engine/src/dispatch/outputs.ts:261-273`, called from
`resolveStepClaim` :221-248) rewrites every `produces` glob and `!` exclusion whose leading segments
equal a DEFAULT root (`DEFAULT_CONFIG.paths.{kb,specs,plans,sessions,reports}`, `defaults.ts:25-32`,
segment boundary: never `docs/forge/kbx`) to the configured root (`normalizeRoot` :108-111; an
`escapesRepository` root (:172-174) matches nothing; `!`/`#`-leading roots escaped as
`outputClaimGlobs` does at :194). `DocRoots` (`types.ts:413`) and `sectionRoot` (:90-103) gain `plans`;
`context.ts:507-512` adds it. Under the default layout every shipped claim is byte-identical.
`assemble.ts` hands the RESOLVED claim where it hands `node.produces` (:569 `packForStep`, :590
`compilePrompt`) so block [5] (`compile-prompt.ts:175-221`) and the skill filter
(`pack-for-step.ts:80-88`) see real paths. `test/brief-write-paths-in-claim.test.ts`'s caveat (:47-49)
is lifted: the main assertion also runs under a relocated layout. Must not change the interval map /
`globsOverlap`, briefs, `outputGlob`, `enforceClaim`.

**Surface.** `outputs.ts`, `types.ts`, `assemble.ts`, `compile-prompt.ts`, `pack-for-step.ts`,
`context.ts`, `defaults.ts`; tests `output-claim.test.ts` (:235), `empty-claim.test.ts` (:310),
`outputs.test.ts`, `compile-prompt.test.ts`, `cli/.../run/output-claim.test.ts`.

**Spec.** 06 §6.7 L177-181, L189-201; 18 §18.7 L263-302, §18.5; 06 §6.4 rule 1.

**Tests first.** `kb: 'knowledge'` + `produces: ['docs/forge/kb/glossary.md']` → claim
`knowledge/glossary.md`; lane write to it kept, to the literal reverted; `!docs/forge/kb/x/**`
expands into `exclude`; `docs/forge/kbx/y` untouched; bare `docs/forge/kb` → the root; one case per
section; `!weird`/`#x` roots escaped through the real matcher; `../out`/`/abs` dropped; `!@protected`
unaffected; identity under the default layout for every shipped workflow (fixture of
`test/write-implies-claim.test.ts:45-70`); block [5] and the StepContext carry the resolved claim;
brief-write-paths passes under `{kb:'knowledge', specs:'spec', plans:'p', sessions:'s', reports:'r'}`;
CLI: `forge config set paths.kb knowledge` then a session writing `knowledge/glossary.md` kept, the
literal reverted (fails `RUN-104` with P3).

**Mutation evidence.** Rewrite disabled: relocated cases fail, identity passes; escape dropped: one;
raw `produces` kept in `assemble.ts`: block [5] and skill cases; `plans` omitted: one.

**Depends on.** none (P3 for the RUN-104 assertion). **Size.** M.

**Discloses.** Interval map keeps the literal `produces`; briefs still name the default layout (a
wrong hint on a relocated project); two layouts proven, not every layout; a configured root equal to
another section's default is refused or documented, never double-mapped.

## P7 — A write-capable agent step with an empty claim is a validate error and a doctor warning

**Mandate.** `validateWorkflow` (`packages/engine/src/workflow/validate.ts`, `agent` branch :406-440)
reports `write-without-claim` (error, `stepId`) for an `agent` step with empty `outputs` and no
non-`!` `produces` entry (normalised from `string | readonly string[]`, `types.ts:82`) when
`oracle.agentWrites(step.agent)`; `walkAllSteps` (:126-156) already visits every nesting.
`WorkflowExistenceOracle` (`types.ts:311-317`) gains the synchronous `agentWrites`; `buildOracle`
(`packages/cli/src/commands/workflow.ts:116-152`) backs it with a map built once from
`.forge/agents/<id>.yaml` via `loadAgentDefinition` (`tools.write`); `{{ownerRole}}` counts as a
writer (`isImplementationAgent`, `load.ts:86`); `{{run.filesExpected}}` counts as a claim; a corrupt
agent file is "not a writer, not judged". `forge doctor` gains `workflow-claims` (warning, `run-doctor.ts:80-104`)
over `.forge/workflows/*.workflow.yaml`, `fix` naming `forge upgrade` and `produces:`/`outputs:`. Must
not change the run-time grant rule (`assemble.ts`, M13 P36), existing codes, the doctor exit contract.

**Surface.** `validate.ts`, `workflow/types.ts`, `commands/workflow.ts`, `doctor/{run-doctor,types}.ts`;
tests `engine/test/workflow/validate.test.ts`, `cli/test/commands/workflow.test.ts`, new
`cli/test/commands/doctor/workflow-claims.test.ts`, `test/write-implies-claim.test.ts` (cross-check).

**Spec.** 06 §6.7 L189-201; 20 §20.1; 10 §10.1 Validation; 03 §3.2.8, §3.7.

**Tests first.** Engine: writer + nothing → one finding; `produces: ['!src/x']` → error; string
`{{run.filesExpected}}` → none; `outputs: [{type: ADR}]` → none; non-writer → none; `{{ownerRole}}` →
error; `command` → none; offenders in fanout template, parallel and sequence children, `onComplete`,
`onFailure.escalations[].do` → five; unknown agent → only `unknown-agent`. CLI (`forge init` temp
project): `validate --all` clean; one `produces` removed → finding, non-zero. Doctor: `ok:false`,
warning, `workflow:step`, fix text; overall exit unaffected. Root: zero findings over shipped
workflows.

**Mutation evidence.** Check removed: all red cases; `agentWrites` always false: writer cases;
`{{ownerRole}}` non-writer: template case; string `produces` unnormalised: string case.

**Depends on.** none. **Size.** S.

**Discloses.** Run-time empty claim from `files_expected` is a plan finding, not here; pre-P36
materialised workflows warn on nine steps until `forge upgrade` (fix text says so).

## P8 — Declared KB outputs get a supervisor-reserved, collision-free id before prompt assembly

**Mandate.** The `REVIEW-NNN` queue in `packages/engine/src/interaction/swarm-review-step.ts:160-269`
moves to `dispatch/output-ids.ts` parameterised by (idPrefix, idWidth, scan target, cardinality);
`allocateNumber` (:292) becomes a caller with `ReviewReport` numbering unchanged (45 pinned cases).
For every declared output whose registry `pathTemplate` starts `kb/` (`artifact-types.ts`: ADR :57,
Runbook :109, registers Risk :67, Assumption :74, OpenQuestion :81, Environment :103),
`runAgentStep` (`steps.ts:566-620`) reserves BEFORE `tryAssemble` (:587): base = 1 + the highest
`<PREFIX>-N` visible in `ctx.integrationPath`, `ctx.projectRoot`, every `laneRegistry` lane and the
step's own existing lane (resume `runAgentAttempt`, `orchestrate.ts:167-183`; swarm-review :292),
above every other reservation of the run; one id for `one`, a block of 25 for `many`. A reservation
is `pending` until `createLaneForStep` binds it to `laneWorktreePath` (`orchestrate.ts:160-166`) and
is released when the step ends without a lane (P17's `existsSync` liveness would drop a pre-lane
reservation). `StepContext.outputs[]` (`assemble.ts:590-597`) gains `reservedIds`, rendered by
`renderOutputContractBlock` (`compile-prompt.ts:204-218`); register ids are counted from entries in
each tree's register file (`countIdsFromFiles`, `packages/core/src/ids/scan.ts:68`, if its regexes
serve). Exhaustion is a typed `prompt`-sourced refusal before any lane. Must not change `IdAllocator`,
`KbIdAllocator`, `REVIEW-NNN` semantics, the output check (P10).

**Surface.** `swarm-review-step.ts`, new `dispatch/output-ids.ts` (+ `dispatch/index.ts:57-66`),
`steps.ts`, `assemble.ts`, `compile-prompt.ts`, `orchestrate.ts`; read-only `vcs/src/lanes.ts:123-154`,
`artifact-types.ts`, `core/src/ids/scan.ts`; new `engine/test/dispatch/output-ids.test.ts`,
`swarm-review-step.test.ts` (unchanged expectations), `compile-prompt.test.ts`, `agent.test.ts`.

**Spec.** 18 §18.8 L303-310; 08 §8.6 L222-228; 06 §6.4 rule 1; 05 §5.5.

**Tests first.** Base above the highest ADR in root, integration worktree, a ready sibling lane and
the step's own lane; three concurrent steps declaring ADR get disjoint ranges before any lane exists;
a re-run of a discarded attempt gets the same base; a reservation lapses when its step ends without a
lane or its worktree is removed; deterministic block [5]; exhaustion refusal before any lane;
symlinked docs directory skipped; register ids counted across trees; `ReviewReport` numbers as before
through the shared module; block [5] states the id / range and in-order rule / entry ids, absent for a
non-KB output; the audit prompt record carries the reserved id.

**Mutation evidence.** Sibling scan skipped: collision; `existsSync` liveness kept: pre-lane
collision; reserve after assembly: block [5] case; `ReviewReport` routed around the module: shared
tests fail while swarm-review passes.

**Depends on.** none. **Size.** M.

**Discloses.** Non-KB id-bearing outputs keep agent-chosen ids; `KB-<SECTION>-NNNN` entry files via
`produces` get no reservation; Diagram excluded; reservations are in-process per (project, run), two
supervisors excluded by the run lock; the block of 25 leaves gaps (18 §18.8 forbids reuse, not gaps);
advisory until P10.

## P9 — The integration branch is fast-forwarded to `main` at run start; a diverged branch refuses the run

**Mandate.** `runWorkflow` (`packages/cli/src/commands/run/run.ts:147-219`) resolves
`integrationBranchFor(config, expressionContext)` and calls `ensureIntegrationWorktree` (`context.ts:264`,
idempotent) itself right after `assertCleanWorkingTree` (~:166) and the run lock (~:174), then a new
`syncIntegrationBranchToTrunk(integrationPath, TRUNK)` (`TRUNK = 'main'`, `context.ts:67`), then the
manifest; `buildRunEngineContext` (:453-484) finds the worktree healthy. Tips equal → no-op;
integration behind → `git merge --ff-only main` (never `reset --hard`); integration ahead → no-op;
diverged → `ForgeError('RUN-107', {branch, integrationTip, trunkTip})`, remedy: merge `main` into the
branch in the integration worktree or delete it once delivered. On refusal nothing exists for the run
(lock released, no `runs/<id>/`, no `last-run.json` change). The manifest gains `integrationTipAtStart`
and `syncedFromTrunk: sha | null`. Only `runWorkflow` syncs (`resume.ts:82-96`, `forge merge`
`bin.ts:1198-1203`, review/debug/session/panel do not). Must not change `ensureIntegrationWorktree`'s
repair behaviour, `integrationBranchFor`, `--dry-run`, the trunk name.

**Surface.** `run/{context,run}.ts`, `core/src/errors/codes.ts`, `run/vcs-refusal.ts:55` (a `VcsError`
from `--ff-only` on a dirty tree maps to the generic refusal), `run/lock.ts`; specs 06 §6.5, 03 §3.2.4
line 86; tests `cli/test/commands/run/{context,lane-integration,run,resume}.test.ts`,
`cli/test/bin-run-failures.test.ts`.

**Spec.** 06 §6.5, §6.4; 20 §20.2 point 4 (line 87), §20.10 S8; 18 §18.4; 03 §3.2.4.

**Tests first.** `syncIntegrationBranchToTrunk`: equal no-op; two behind → HEAD == main, no new
commit; ahead → no-op; diverged → `RUN-107` naming both short shas and the branch, no `MERGE_HEAD`;
dirty worktree touching a changed file → `VcsError`, never a half-merge; run 1 lands a lane, a human
commits `hotfix.txt` on main, run 2's first session sees it; diverged refuses before the manifest and
`last-run.json`, lock gone; `--dry-run` never syncs; `forge resume` and `forge merge --lane` never
fast-forward; manifest fields as stated; `forge run` prints `RUN-107` exit 1.

**Mutation evidence.** Sync removed: `hotfix.txt` case; `reset --hard`: the ahead case loses a
commit; `git merge main` instead of refusing: `MERGE_HEAD`/no `RUN-107`; sync after the manifest:
nothing-created case.

**Depends on.** none. **Size.** S.

**Discloses.** Trunk stays the literal `main`; a run never merges `main` into a diverged branch;
`deliver` still folds nothing back; the sync runs with the lock held before the queue exists
(`forge merge` is not excluded by the lock); a project without `main` gets a clear `VcsError`.

## P10 — The output check holds a produced KB output to its reserved id range

**Mandate.** `OutputCheckInput` (`outputs.ts:309-321`) gains the step's reservation; `checkOne`
(:647-780) requires, for a KB-located type, that every produced id absent at the base revision lies in
the reserved range and is used contiguously from its base (an id present at base is an update); for
registers the produced-entry diff (:533-556, `registerEntries` :390-404, `entryId` :424) applies the
rule per entry id. `runLaneLifecycle` passes the reservation into `verifyDeclaredOutputs`
(`steps.ts:273-275`, `outputs.ts:843`). A wrong id is `RUN-083` naming the reserved ids (message within
`MAX_PROBLEM_CHARS`, :339). Must not change non-KB checks, `RUN-084`, the claim.

**Surface.** `outputs.ts`, `steps.ts`; tests `engine/test/dispatch/{output-contract,output-claim}.test.ts`
(:586-710 model), new `cli/test/commands/run/kb-output-ids.test.ts`,
`engine/test/resume/output-contract-resume.test.ts`.

**Spec.** 08 §8.6 L222-228; 18 §18.8; 05 §5.5 block [1]; 06 §6.4 rule 1.

**Tests first.** `ADR-0007-x.md` with the reserved id passes; `ADR-0009` when 0007 reserved fails
naming 0007; `many` 0007+0008 passes, 0007+0009 fails; base id is an update; register entries inside
the range pass, one colliding with a ready sibling's new entry fails; Epic not held; full `runWorkflow`
with a two-step fanout both declaring ADR ends with two distinct ADRs and a second run numbers after
them; crash after `LaneCommitted` → resume rerolls into the same id and passes.

**Mutation evidence.** Range rule dropped: two cases; rule on every type: Epic case; no reservation
passed: every dependent case.

**Depends on.** P8. **Size.** S.

**Discloses.** A reserved id with the wrong slug passes; sequential runs safe by scan.

## P11 — Declared KB outputs carry `sources`; a register entry may be deprecated, never removed

**Mandate.** `artifactSourceSchema` (new `packages/schemas/src/artifacts/source.ts`, the shape of the
unexported `kbEntrySourceSchema`, `packages/kb/src/schema/kb-entry.ts:47`; `@forge/kb` re-exports it,
`kbEntrySchema` :84-100 keeps `sources: min(1)`). The six KB-located schemas gain OPTIONAL `sources`
(`adr.ts:14-28`, `runbook.ts`, `risk.ts:26`, `assumption.ts:22`, `open-question.ts:21-23`,
`environment.ts:25`, each per type since `baseFrontMatterShape` is shared, `front-matter.ts:29-47`)
and the six templates (`packages/templates/templates/artifacts/{ADR,Runbook,Risk,Assumption,OpenQuestion,Environment}.md`,
none carries `sources`) gain `sources: []`; schema and template land together. The OUTPUT CHECK
(`validateFile`, `outputs.ts:490-594`), not `spec validate`/`kb lint`, requires ≥1 source on every
produced KB document and every new or changed register entry, and every entry id present at base must
be present at HEAD (may gain `status: deprecated`/`superseded` where the schema has a status;
OpenQuestion has open/resolved). Block [5] states both rules. Spec: P1 carries `02` §2.5 / `08` §8.6;
this piece pins them and adds the `06` §6.4 rule 1 (L94-97) cross-reference only. Must not change
`KbWriter`, lint rules, existing projects' validity.

**Surface.** the schema files, `kb-entry.ts`, the six templates, `outputs.ts` (`REGISTER_SCHEMAS`
:289-296, `documentProblems` :438), `compile-prompt.ts`, `schemas/src/json-schema/emit.ts` (+ tests),
`specs/06` §6.4; tests `output-contract.test.ts`, `schemas/test/artifacts`, `compile-prompt.test.ts`,
templates content test, `test/output-contract-known-gaps.test.ts` (count unchanged).

**Spec.** 08 §8.6 L222-228, §8.3; 02 §2.5 L157-158; 06 §6.4 rule 1, §6.7; 18 §18.6, §18.7.

**Tests first.** Each schema accepts with and without `sources`, a source must match the shape,
`kbEntrySchema` still `min(1)`; produced ADR without `sources` fails `RUN-083` naming file and rule;
`kb/risks.md` new/changed entry without sources fails, untouched entries pass; base entry absent at
HEAD fails; id changed fails; OpenQuestion `status: resolved` passes; Epic not held; block [5] text;
templates carry `sources: []` and validate as scaffolds; the amended 02/08/06 sentences quoted.

**Mutation evidence.** Sources rule dropped: four cases; retained-entry rule dropped: one; rule on
every type: Epic; `sources` made required in a schema: the without-sources schema cases (rule lives in
the check).

**Depends on.** P1, P8, P10. **Size.** M.

**Discloses.** `spec validate`/`kb lint` do not require `sources` on hand-written artifacts;
statement replaced under a kept id undetected; contradiction detection stays the linter's; whether
`sources` becomes schema-required with a migration is not decided.

## P12 — `prepare-release-build` claims `paths.release`, refusing with a remedy until set

**Mandate.** New leaf `paths.release: string[]` (default `[]`; `pathsSchema` `schema.ts:45-54`,
`defaults.ts:25-32`, `docs.ts` `ConfigDocKey` :20-25; `..`, absolute and `!`-leading refused);
`configLeafPaths` (`walk.ts:6`) stops at a `ZodArray`, so `forge config set paths.release '[apps/mobile/**,
app.json]'` works through `configSet`'s `YAML.parse` route (`config.ts:51,104-110`).
`modules/fm-mobile/workflows/store-release.workflow.yaml:59-82` replaces the six guessed globs with
`'{{config.paths.release}}'`, spliced one claim per entry by `resolveClaimEntry`
(`plan/compile.ts:137-168`), keeping `test/device-matrix/**`. `buildRunExpressionContext`
(`run/expression-context.ts:195-275`) exposes exactly `config: {paths: {release}}` and, when the
list is empty and the workflow references `config.paths.release`, refuses BEFORE `compileRunPlan`
with `RUN-106` naming the key and the `forge config set` line (`assertPlannable` :332-338 covers only
unsupplied inputs; `evaluate.ts:23` resolves a missing root to `undefined`, so `RUN-089` does not
cover it). The brief (`briefs/prepare-release-build.md:16-18`) names the key. Must not change
`package.json` unclaimed, the `Task` output, `RESERVED_INPUT_NAMES` (`inputs.ts:27-39`, has `config`).

**Surface.** `schemas/src/config/{schema,defaults,docs}.ts`, `config.ts`, `expression-context.ts`,
`codes.ts`, `store-release.workflow.yaml`, the brief; tests `test/brief-write-paths-in-claim.test.ts`
(`BROAD_PRODUCES_ALLOWED` :766-772 loses the two mobile entries), `test/write-implies-claim.test.ts`
(`FIXTURE_CONTEXT` :45-70), `test/{agent-prompts-all-workflows,run-inputs-compile,fm-mobile-workflow}.test.ts`,
`cli/test/commands/{config,run/expression-context}.test.ts`, `schemas/test/config/`.

**Spec.** 06 §6.7; 10 §10.1 L147 (`config` helper root); 03 §3.2.4, §3.5; 18 §18.5; 15.

**Tests first.** Defaults `[]`, list accepted, bad entries refused, doc text required; `config set`
round-trips, scalar refused; `config.paths.release` present iff non-empty, nothing else exposed;
empty list + reference → `RUN-106` before compile; no reference unaffected; `forge run store-release
--input buildTarget=ios --dry-run` exits `RUN-106` unset, and set → the compiled claim equals
`test/device-matrix/**` plus the entries; the two allowances removed with the hygiene assertion
(:1183) green; scripted session writing `apps/mobile/ios/Info.plist` kept, `src/platform/ios/Button.tsx`
reverted (fails `RUN-104` with P3).

**Mutation evidence.** Empty list exposed instead of refused; a guessed glob restored (hygiene);
whole config exposed; pre-compile check skipped (RUN-089 does not fire).

**Depends on.** none (P3 for the RUN-104 assertion). **Size.** M.

**Discloses.** A listed `apps/mobile/**` still admits app source; `forge init` does not prompt for
the key; the key name is this piece's choice (config is the only surface with `forge config set`).

## P13 — RCA reproductions live under a defect-scoped test glob the claims include and the briefs name

**Mandate.** `debug:run-rca` (`debug.workflow.yaml:15-24`) and `quick-fix:reproduce`
(`quick-fix.workflow.yaml:11-18`) add `produces` entries
`'**/*{{defectId}}*.{test,spec}.{js,jsx,ts,tsx,cjs,mjs,cts,mts}'` and
`'**/{test,tests,__tests__,e2e}/**/*{{defectId}}*'` (extensions match `isTestPath`);
`build-stage`'s escalation `rca` (`build-stage.workflow.yaml:146-149`, no `defectId`) uses `DEF-*`. The
briefs say where the reproduction goes and that its path is recorded in the RCA:
`run-rca-framework.md:20-33,50-59`; `reproduce-defect.md:38-40`'s `reports/defects/` location narrowed
to a non-test script; `rca.md:59` 'Do not edit ... tests' gains the new-reproduction-test exception.
`test/brief-write-paths-in-claim.test.ts` gains IMPLIED_WRITES anchors (:670-757) and allowances
(:766-772); `test/workflows.test.ts:187-188`'s structural copy of build-stage follows. Must not change
`fix-defect.md:33-36`, the `fix` claims, the Defect Reproduction-section claim.

**Surface.** the three workflows, the three briefs, the two root tests, read-only `run-plan.ts:57-61`
and `compile.ts:137-168` (`safeResolveTemplate` :108), `briefs-*-content.test.ts`, new
`cli/test/commands/run/rca-reproduction.test.ts`, `specs/13` §13.2 L161-164, L197-200, L214.

**Spec.** 13 §13.2 REPRODUCE/PROVE, example L214, G-Stable L311; 06 §6.7; 10 §10.6.

**Tests first.** IMPLIED_WRITES `debug:run-rca` → `tests/regression/defect-1.test.ts`, `quick-fix:reproduce`
same, `build-stage:rca` → `tests/regression/DEF-012.test.ts`; `--input defectId=DEF-012` compiles both
entries with brace groups intact and each satisfies `isTestPath`; real `debug` run: scripted `run-rca`
writes `tests/regression/DEF-012.test.ts`, the RCA and the Defect section → kept; `tests/regression/other.test.ts`
or `src/x.ts` reverted; escalation claim asserted at parse level; content tests pin the three briefs.

**Mutation evidence.** Entries removed: run and coverage fail; extension widened past `isTestPath`:
compile case; brief sentence reverted: its anchor goes stale.

**Depends on.** none. **Size.** S.

**Discloses.** Shell-script reproductions stay beside the Defect; nothing verifies the RCA's
`reproduction` field lies in the claim (G-Stable rule, later); escalations are not compiled (parse-level
only); the escalation claim is prefix-scoped.

## P14 — `verdict` front matter on every engine-written ReviewReport; `blocked` fails the swarm-review step

**Mandate.** `reviewReportSchema` (`packages/schemas/src/artifacts/review-report.ts`, `.strict()`, no
type field) accepts optional `verdict: blocked|incomplete|concerns|clear`; `reviewFrontMatter`
(`packages/engine/src/interaction/review-report.ts:359`, already receives `verdict`) writes it as a
key; the engine still validates before writing (`swarm-review-step.ts:316`); export
`parseReviewVerdict(frontMatter)`. A step whose merged verdict is `blocked` commits the report on
its lane exactly as today, then ends `failed` with `RUN-108`, `source: 'output'`, message naming the
file and the blocking count; the lane is removed from `laneRegistry` explicitly (`LaneReady` fires
for a failed work step, Q217 (g)); `resumeSwarmReviewStep` re-applies the rule from the committed
report with zero sessions. `classifyFailure` returns `policy` for `RUN-108` (`classify.ts:154-160`
maps `output` to `validation`, and `implement-story:review` carries `retryOn: [validation]`).
`incomplete`/`concerns`/`clear` succeed unchanged. Schema lands before the writer emits the key.
Must not change verdict computation, `reviewer` `write: false`, `dispatchSwarmReview`, numbering,
`ArtifactCreated` (only for a succeeded step, :508-524).

**Surface.** `review-report.ts` (schema + engine), `swarm-review-step.ts` (~:479-524), `classify.ts`,
`plan/types.ts:63`, `codes.ts`, comments in `implement-story.workflow.yaml:71-77` and `build-stage`,
`specs/05:339-347` ("nothing gates on them yet"), `specs/18` §18.7 ReviewReport row.

**Spec.** 05 §5.5, §5.7; 06 §6.8; 18 §18.6, §18.7; 10 §10.6 step 7.

**Tests first.** `review-report.test.ts`: front matter carries `verdict`, validates, rejects
`approved`, old reports validate, forged `verdict:` body lines stay code-spanned;
`swarm-review-step.test.ts` (real lane): one blocking finding → `failed`, `RUN-108`, `git show
<lane>:<sessions>/reviews/REVIEW-001.md` has `verdict: blocked`, no registry entry, no
`ArtifactCreated`, `classifyFailure === 'policy'`, resume fails the same way with zero sessions,
other verdicts succeed with the key, determinism case passes; CLI `swarm-review-report.test.ts`: a
blocking perspective fails the run at `review`, one dispatch round, report on the lane, no merge
commit; `test/agent-prompts-all-workflows.test.ts` unchanged.

**Mutation evidence.** Writer not emitting `verdict`: schema and `git show` cases; `blocked` branch
reverted: three cases; classified `validation`: `policy` case and a second dispatch round in the CLI
case.

**Depends on.** none. **Size.** M.

**Discloses.** Decision 7's "(the implementer's loop retries)" has no engine primitive (retry is per
step, no `rerunFrom`): a blocked review escalates and the person re-runs after a fix — recorded as an
open owner question in the Q entry; `forge review` still folds a failed session into an empty
perspective.

## P15 — `forge gate approve|waive` under the session marker is refused unless the gate names agents and `may_approve` lists it

**Mandate.** `runGateSubcommand` (`bin.ts:1082-1170`) reads the three marker keys from
`realEnvSnapshot()` (`bin.ts:392`, the one ambient snapshot) into `GateCommandContext.marker`. With
`FORGE_AGENT_ID`, `gateApprove` and `gateWaive` (`run/gate-commands.ts`; `gateWaive` hard-codes
`{kind:'human'}`) use `{kind:'agent', agentId, mayApprove}` read through `readProjectAgent`
(`packages/engine/src/dispatch/assembly-context.ts:111`; P32 deletes `loadProjectAgent`), so
`approverRefusal` (`gates/approve.ts:127-160`) binds: not `alwaysHuman`, role in `approval.roles`, gate
in `may_approve`; every shipped gate says `roles: [human]`, so every agent-run approve is refused
today. The marker's run id must equal the resolved `--run` (`resolveDispatchRunId`, `bin.ts:1120`,
defaults to the last run). `FORGE_RUN_ID` without an agent id (a run's own command step) → `GATE-510`
for approve and waive; `check` allowed; `reject` records the marker as `approver`. No marker:
byte-identical. Must not change shipped gates, `may_approve` values, `alwaysHuman` on G-Deliver,
`runGateStep`'s taint guard (`steps.ts:777`), `approverRefusal`'s rules.

**Surface.** `bin.ts`, `gate-commands.ts`, `approve.ts:96-98`, `codes.ts`; specs 10 §10.3 rule 6 ("The
command is a person's..."), 05 §5.9, `docs/authoring-guide.md`.

**Spec.** 10 §10.3 rules 1, 6; 05 §5.2, §5.9; 03 §3.6; 20 §20.10 S6.

**Tests first.** `gate-commands.test.ts`: (a) marker `architect`/`run-1` on `roles:[human]` → `GATE-508`,
no event; (b) `roles:[human, sre]` + `sre.yaml` `may_approve:[G-X]` → approved, `approver === 'agent sre'`;
(c) `alwaysHuman` → `GATE-508`; (d) run id only → `GATE-510` for approve and waive, `check` works,
`reject` records `run run-1 step deploy`; (e) run id ≠ `--run` → refused; (f) unknown agent → `GATE-508`
with `RUN-056` cause; (g) no marker unchanged; `bin.test.ts`: real CLI with the marker → exit 3,
`{v:1, ok:false, error:{code:'GATE-508'}}`; `run.test.ts`: a `command` step running `forge gate approve
G-X --json --run {{run.id}}` fails `GATE-510`, no CLI-appended `GateApproved`.

**Mutation evidence.** Marker read removed: (a)-(f) and bin; `gateWaive` human hard-code kept: waive
halves; `--run` equality dropped: (e).

**Depends on.** P4. **Size.** M.

**Discloses.** `quorum > 1` stays refused; no shipped gate names an agent, so the "unless" clause is
exercised by fixture gates only; the in-run `gate` step keeps the taint guard as its only rule.

## P16 — Waivers: 90-day default cap (`gates.waiverMaxDays`) and `--owner` an identifier

**Mandate.** `forge gate waive` refuses (`GATE-512`, exit usage, nothing appended) an `--expires` later
than grant + `gates.waiverMaxDays` days (default 90; new optional top-level `gates` block, strict,
beside `autonomyByGate` at `schema.ts:143`; `mergeChecks` lives under `execution` :150; older configs
load) and (`GATE-513`) an `--owner` that is not one token (1-100 chars of letters, digits, `.`, `_`, `@`,
`+`, `:`, `-`, starting alphanumeric; no whitespace, `\p{Cc}`, `\p{Cf}`). `recordedWaivers` skips a
`GateWaived` whose `expiresAt` exceeds its own `ts` + cap. The rule lives in `gates/waiver.ts`
(`validateWaiverPolicy(waiver, grantedAt, maxDays)`, `isWaiverOwnerIdentifier`; `isNonBlank` :36 stays
the floor); the CLI supplies clock and config. Must not change `applyWaiver`/`isApproved`, `GATE-504/505`,
the `--json` shape beyond `policy: {maxDays}`.

**Surface.** `schemas/src/config/{schema,defaults,docs}.ts` (`configLeafPaths` requires the doc),
`config.ts:41` (`REAL_KEYS` derives), `waiver.ts`, `gate-commands.ts`, `bin.ts:1082-1170`, `codes.ts`;
specs 10 §10.3 rule 1, 03 §3.2.4, `docs/authoring-guide.md`.

**Spec.** 10 §10.3 rule 1; 15 §15.10 I3; 03 §3.2.4; 18 §18.4.

**Tests first.** `waiver.test.ts`: grant+90d accepted, +90d+1ms refused; owners `''`, `'  '`, `'the
team'`, zero-width, `'a\tb'` refused; `'r.abu-odeh@example.com'`, `'JIRA-1234'`, `'ops:oncall'` accepted;
cap is the argument; `gate-commands.test.ts`: `now+91d` → `GATE-512` naming the key and 90; `now+90d`
recorded; `'the team'` → `GATE-513`; a hand-appended 400-day waiver skipped by `check`/`approve`
(`GATE-507`) and honoured with `waiverMaxDays: 400`; `config set gates.waiverMaxDays 30` round-trips,
`0`/`x` refused, config without `gates` loads; usage line names `--owner <identifier>`.

**Mutation evidence.** Cap removed: +91d; read-back cap removed: 400-day case; `isNonBlank` only:
`'the team'`; hard-coded 90: the 400 config case.

**Depends on.** none. **Size.** S.

**Discloses.** `--owner` is not an authenticated identity; waivers stay gate-wide per run; `gate
waive` still exits `gateFailed` after recording.

## P17 — `forge gate check|approve|waive` write the `GateReport` artifact and the digests verify against it

**Mandate.** Each evaluation writes one `GateReport` to `<paths.reports>/gates/<gate>-<ts>.md`
(registry row `artifact-types.ts:110`; `ts` from the injected clock, filesystem-safe, no `:`), front
matter validating against `gateReportSchema` (`gate-report.ts`, `.strict()`; gains optional `gate`,
`outcome: passed|failed|waived`, `evaluatedAt`), numbered above every `GATE-*` under `reports/gates/`,
body one section per deterministic check (`run`, `exitCode`, `passed`, `reason`, `failOn`, fenced
`stdout`/`stderr` through `sanitizeResultText`, `result-record.ts:88`, capped with a marker), the
waiver used, advisory checks as not run. `recordChecks` (`approve.ts:107-121`) digests the SAME
sanitised, capped text; events and `--json` gain `reportPath`. Validated with `documentProblems`
(`outputs.ts:438`, `definitionForType`, `artifact-types.ts:221`), written with `writeFileAtomic`
(`core/src/fs/atomic.ts:76`) BEFORE the event; a write failure is typed and nothing is approved
without its trail. Renderer `renderGateReportFile` beside the existing `buildGateReport`
(`gates/report.ts`). In-run `runGateStep` (`steps.ts:744-799`) writes no file; its `GateEvaluated`
payload (:767-770) gains per-check digests. Must not change `evaluateGate`, `buildGateReport` purity,
the template headings.

**Surface.** `gates/{report,approve}.ts`, `result-record.ts`, `gate-report.ts` (+ `emit.ts:87`
snapshot), `gate-commands.ts`, `bin.ts:1127-1170`, `steps.ts`, `templates/artifacts/GateReport.md`;
specs 10 §10.3 rule 4, 18 §18.7.

**Spec.** 10 §10.3 rules 4, 6; 18 §18.6, §18.7; 20 §20.10 S3; 21 §21.1.

**Tests first.** `report.test.ts`: byte-identical render; an `AKIA...` key redacted and the digest
equals sha256 of the redacted block; 1 MiB stdout capped and digested as capped; ESC stripped; front
matter validates; template headings appear. `gate-commands.test.ts`: `gateCheck` writes
`docs/forge/reports/gates/G-X-<ts>.md` id `GATE-001`, then `GATE-002`, an existing `GATE-007` makes
`GATE-008`; approve writes then appends with `reportPath`; a file squatting `reports/gates` → typed
error, no `GateApproved`; waive writes `outcome: waived`; fenced stdout equals the sanitised recorded
stdout; relocated `paths.reports` followed. `bin.test.ts`: `--json` carries `reportPath`, human prints
`report: <path>`. `gate.test.ts`: in-run payload carries digests, no file in the integration worktree.
`test/templates.test.ts`: template round-trips.

**Mutation evidence.** Write removed: three cases; raw stdout digested: redaction case; event before
write: squatting case; `documentProblems` skipped: forced-invalid front matter written.

**Depends on.** none. **Size.** M.

**Discloses.** Directory-scan numbering in one process (two concurrent `gate check` may collide; the
run lock does not cover CLI gate commands); in-run gate steps write no file (committing one on a lane
is open); the report is uncommitted; advisory checks listed only.

## P18 — `runMergeStep` reads each swarm-review lane's committed `verdict`

**Mandate.** For every lane in `mergeLandingScope` whose node has `interactionMode === 'swarm-review'`,
`runMergeStep` (`steps.ts:807-912`) locates the committed `REVIEW-NNN.md` on the lane branch and reads
its front matter via `ctx.vcs.readAtRevision(lane, 'HEAD', file)` (`types.ts:96`; object database,
never the worktree); `LaneHandle` carries no base sha (:41-45), so the piece states one way to find
the file (`changedFiles(lane, <integration tip>)` filtered by `REPORT_FILE`, `swarm-review-step.ts:91`,
or a small `listFilesAtRevision` on the facade). `incomplete`, `blocked`, or a missing/unparseable
field refuses the lane with `MERGE-REVIEW-INCOMPLETE` (`policy`, beside `VCS-MISSING-CONFLICT-RESOLVER`
at `classify.ts:73`; remedy names the report, the review step and `forge resume`), keeps it in
`laneRegistry`, and refuses every downstream lane via `MERGE-DEPENDENCY-NOT-LANDED`; the reverse rule
is added explicitly: the implement lane a refused review reviews (upstream, P38 stacking) is not
landed either. `concerns` lands; `detail.merges[]` entries gain `reviewVerdict`/`reviewReportId`
(`types.ts:497`, not the `MergeOutcome` union :162), `landLane` passes them into `MergeCompleted`
(`integrate.ts:160-163`), and the merge commit gains `Forge-Review-Verdict: concerns (REVIEW-NNN)`
(`merge-queue.ts:272-279`, newline guard of `commit.ts:28-37`). `clear` lands with no trailer. Must
not change `MergeOutcome`, conflict handling, `landLane`'s check semantics.

**Surface.** `steps.ts`, `dispatch/{types,facades,integrate}.ts`, `vcs/src/merge-queue.ts`,
`classify.ts`; specs 10 §10.1 (merge row), 06 §6.5.

**Spec.** 10 §10.1, §10.6; 06 §6.4, §6.5, §6.8; 20 §20.9.

**Tests first.** `merge.test.ts` (real git): `incomplete` → `MERGE-REVIEW-INCOMPLETE`, lane kept, tip
unchanged, remedy text; the stacked implement lane not landed; no `verdict` → incomplete; `concerns`
→ landed, payload and `detail.merges[0].reviewVerdict`, `git log -1 --format=%B` carries the trailer;
`clear` no trailer; a non-swarm-review lane with a stray `REVIEW-*.md` untouched; `classifyFailure`
`policy`; vcs: a `reviewReportId` with `\n` refused; CLI: a major-only perspective completes with the
trailer and `verdict: concerns`; resume after a crash between `LaneReady` and the merge still refuses
(read from git).

**Mutation evidence.** Verdict read reverted: three cases + missing trailer; reverse propagation
dropped: code lands without its review; newline guard dropped: vcs case.

**Depends on.** P14. **Size.** M.

**Discloses.** A run fails at the merge for an `incomplete` review with the remedy pointing at the
review step, as decided; a refused lane stays registered and is retried by the next merge that scopes
it; a hand-edited lane branch could forge `verdict:` (Q229's threat model); no gate check added.

## P19 — An agent never approves a gate that a step run by that agent produced evidence for in the same run

**Mandate.** `approveGate`'s agent approver is refused (`GATE-511`, nothing appended) when this run's
log shows the agent produced evidence: (a) a `StepStarted` whose top-level `agentId`
(`telemetry/src/events.ts:104`) equals the approver and whose payload `gateEvidence` lists the gate
(compiled `StepNode.gateEvidence`, `plan/compile.ts:556-557,984-1004`; emitted by `runAgentStep`
`steps.ts:576` and `swarm-review-step.ts:336`, which today carry neither); or (b) an `ArtifactCreated`
by that agent whose `type` a gate's `evidence:` names (`InterfaceContract(*)` → `InterfaceContract`).
`GateDefinition` gains `evidence?: readonly {artifact: string}[]` (`document.ts:82` `EVIDENCE_KEYS`
validates and drops it at :324-336). `ApproveGateInput.producedEvidenceFor` feeds `approverRefusal`;
the CLI computes it over `readEvents(projectRoot, runId)` and applies it in `gateWaive` too.
`pm`/`po` keep `may_approve`. Must not change 05 §5.9 values, the human path, the taint guard,
`produces_evidence_for` lists, `reconstructRunState`'s `StepStarted` handling (`reconstruct.ts:165-167`,
pinned).

**Surface.** `gates/{types,document,approve}.ts`, `steps.ts:576`, `swarm-review-step.ts:336`,
`gate-commands.ts`, `codes.ts`; specs 05 §5.5, 10 §10.3 rule 6, `docs/method-guide.md` if it states
the rule.

**Spec.** 05 §5.2, §5.5, §5.9; 10 §10.3; 20 §20.10 S6.

**Tests first.** `document.test.ts`: `evidence: [{artifact: 'InterfaceContract(*)'}]` parses, `artefact`
is `unknown-key`; `approve.test.ts`: `producedEvidenceFor:['G-X']` → `GATE-511`, `['G-Y']` approved,
human ignores it; `agent.test.ts`/`swarm-review-step.test.ts`: `StepStarted` carries `agentId` and
`payload.gateEvidence`; resume still reconstructs `running`; `gate-commands.test.ts`: the `StepStarted`
source, the `ArtifactCreated` source, another run's events ignored, neither → existing rules, waive
refused the same way; `run.test.ts`: end-to-end with fixture gate `roles:[human, architect]`.

**Mutation evidence.** Check removed: engine and CLI cases; payload not emitted: the `gateEvidence`
case and end-to-end (artifact source still passes: independent); `evidence` parsing dropped: the
artifact case; `runId` ignored: other-run case.

**Depends on.** P15. **Size.** M.

**Discloses.** `ArtifactCreated` is emitted only by the swarm-review step today
(`swarm-review-step.ts:513`); the piece states whether `verifyDeclaredOutputs` gains the emission;
the `Type(*)`/`Type(id)` grammar is parsed as the name before `(`, never a wildcard; the rule is
observed, not declared (`produces_evidence_for` stays documentary); cross-run evidence not refused.

## P20 — `*.check.yaml` files attach to gates through `appliesTo`; `warn` is reported, never fails

**Mandate.** `loadGateRegistry` (`packages/cli/src/commands/run/gates.ts:19`, reads only `*.gate.yaml`
at :47) also reads every `*.check.yaml` under `.forge/checks/`, `.forge/overrides/checks/` and
`.forge/modules/<id>/checks/` (module roots from the installed `manifest.yaml`; `installBundleTree`,
`module.ts:453-470`, already copies `checks/`), parses each with an engine-side `parseCheckDocument`
(`gates/document.ts`; keys `id, name, description, run, parser, failOn, remedy, appliesTo, severity`;
`appliesTo.gates` non-empty and known; `severity: error|warn`; `parser` in `SUPPORTED_PARSERS`
(`evaluate.ts:23`, `forge-json`/`json`, wider than `gateCheckSchema`'s `json`-only enum at
`packages/extensions/src/workflows/gate-check.ts:19`, which stays the overlay-side one)), and appends
each `error` check to `checks.deterministic` of every gate it names (duplicate id → `GATE-506`), so
`gate check/approve/waive/list --json` (each attached check shows `source`), the in-run evaluator
(`context.ts:468-476`) and `gateValidateAll` (`workflow.ts:241`; new codes `unknown-check-key`,
`invalid-check-value`, `unknown-gate-in-appliesTo`) see them. A `warn` check evaluates into
`GateEvaluationResult.warnings` and never affects `passed`. The preset-written
`regulated-compliance-matrix.check.yaml` (`extensions/src/presets/registry.ts:103-113`, already
`appliesTo: {gates: ['G-Design']}`) therefore attaches. Must not change the check contract, gate
documents' own `checks:`, `evaluateGate`'s pass rule, `gateCheckSchema`.

**Surface.** `gates/{document,types,evaluate}.ts`, `run/gates.ts:19-70`, `commands/workflow.ts:200-310`,
`gate-commands.ts`; specs 10 §10.3, 15 §15.7, `docs/authoring-guide.md:176-186`.

**Spec.** 10 §10.3 (check contract); 15 §15.7 L518-527, §15.10 I4; 19 §19.1, §19.6.

**Tests first.** `document.test.ts`: accepts the 15 §15.7 example; refuses `appliesTo: {gate: ...}`
(did you mean `gates`), empty `gates`, `severity: fatal`, missing `remedy`, unparseable `failOn`,
`parser: yaml`; accepts `name`/`description`, `parser: forge-json`. `gates.test.ts`: an override check
attaches with `source: 'overrides/checks/acme.check.yaml'`; unknown gate → `GATE-506` naming the file;
duplicate id → `GATE-506`; a manifest-listed module's check attaches; `warn` attaches under warnings.
`evaluate.test.ts`: failing `warn` leaves `passed: true` with a reason in `warnings`.
`gate-validate.test.ts`: the two new codes once each. `preset.test.ts`: the regulated preset shows
`regulated:compliance-matrix` under G-Design. `gate-fail-closed.test.ts`: the derived line set comes
from the real loader and every attached line meets the contract.

**Mutation evidence.** Scan skipped: attach, module, preset, validate cases; `appliesTo` ignored:
per-gate `gate list` cases; `warn` counted: evaluate case.

**Depends on.** none. **Size.** M.

**Discloses.** One broken check file blocks `gate list/check/approve` for every gate (Q229 D3's
stance; `workflow validate --all` says which); `warn` semantics are this piece's reading of one word;
shipped module checks carry no `appliesTo` until P22.

## P21 — Briefs and claims for `architecture/version-skew.yaml` and `data/migrations.yaml`

**Mandate.** `build-stage:freeze-contracts` (architect, `build-stage.workflow.yaml:35-50`) and fm-service
`contract-test-cycle:draft-contract` (integration-architect, `modules/fm-service/workflows/contract-test-cycle.workflow.yaml:46-61`;
brief `packages/templates/templates/briefs/draft-contract.md`) write or update
`docs/forge/kb/architecture/version-skew.yaml` in exactly the shape `spec validate --rule version-skew`
reads (`VERSION_SKEW_FILE`, `packages/cli/src/commands/spec/integration-rules.ts:56`; strict schema
:172-189), declaring EVERY valid contract under `specs/interfaces/`; `shape-solution:model-data`
(data-architect, `shape-solution.workflow.yaml:21-41`, whose `produces` lists the prose
`data/migrations.md`) writes the initial `docs/forge/kb/data/migrations.yaml` (`MIGRATIONS_FILE`
:57; schema :341-348) and `migrate:plan-migration` (`migrate.workflow.yaml:11-17`) appends planned
entries matching its ADR. Each of the four steps' `produces` claims the file; the two module-private
zod schemas export their key lists so a content test derives the required keys; each brief gains a
`### Declarations the gate reads` section and names the check. Must not change the rules' strictness,
the file constants, the steps' `outputs`, `reviewer`/`critic` grants.

**Surface.** `briefs/{freeze-contracts,draft-contract,model-data,plan-migration,critique-integration}.md`,
the four workflows, `integration-rules.ts`; specs 10 §10.3 (G-Integration row), 12 F-DATA-6 (line 84),
14 §14.4 rule 3 (line 143); new `test/gate-declarations-authored.test.ts`,
`test/brief-write-paths-in-claim.test.ts` (extractor :159-400, `extractWritePaths` :318),
`cli/test/commands/spec/integration-rules.test.ts` (not `gate-p26-coverage.test.ts`, which covers
other families per its header).

**Spec.** 10 §10.3; 12 F-DATA-6; 14 §14.4 rule 3; 06 §6.7; 20 §20.1; 09 §9.8 precedent.

**Tests first.** The four claims contain the two paths (red until `produces` is edited; the extractor
must recognise the new prose); for each file at least one brief names the exact path AND every
schema key from the exported lists, and the referencing step claims it; `freeze-contracts.md` says
every contract is declared; `plan-migration.md` names `expands` and `release`; the embedded samples
written verbatim into a fixture pass both rules with `errors: 0`, one misspelled key fails naming it;
real `runWorkflow`: an architect session writing a contract AND `version-skew.yaml` keeps both, a
data-architect session keeps `migrations.yaml`, a `version-skew.yml` write is reverted (and fails
with P3).

**Mutation evidence.** `version-skew.yaml` removed from `freeze-contracts.produces`: two root tests
and the end-to-end revert; schema-key paragraph removed: key assertion; sample key misspelled:
round-trip.

**Depends on.** none (P3 for the fails-the-step half). **Size.** M.

**Discloses.** Both files stay self-attested; no cross-check against repository migration files;
`critique-integration` stays unwired; `freeze-contracts` runs at every level while G-Integration is
L4-only (the brief says why); two concurrent `contract-test-cycle` runs conflict at `merge-contract`.

## P22 — The seven shipped module checks gain `appliesTo`/`severity`; the in-run evaluator supplies `FORGE_BASE_REF`

**Mandate.** The seven `modules/*/checks/*.check.yaml` (verified: 7 files, none with `appliesTo` or
`severity`) declare `severity: error` and `appliesTo.gates`: `contract:verify`, `api:breaking-change`
→ `G-Integration`; `a11y:audit`, `bundle:size`, `lineage:coverage`, `data-quality:tests`,
`device-matrix:coverage` → `G-Verify` (content proposal; the owner may re-place). The in-run evaluator
(`createGateEvaluator(gateRegistry, {env: input.commandEnv})`, `context.ts:475`) receives
`FORGE_BASE_REF` = the run's `integrationTipAtStart` (P9's manifest field); outside a run `forge gate
check` passes the caller's `FORGE_BASE_REF` through the snapshot (`bin.ts:392`) or the check fails
with its stated reason. `module.yaml` `checks:` lists stay documentary. Must not change the `run`
strings, the contract, `module-checks-empty-project.test.ts`'s assertion.

**Surface.** the seven check files, `modules/*/module.yaml` comments (fm-web:95-97, fm-service:121,
fm-data:123, fm-mobile:106), `context.ts:468-478`, `bin.ts:1062-1080`; specs 19 §19.1, 10 §10.3
catalogue rows; `test/gates.test.ts`, `cli/test/commands/module.test.ts`.

**Spec.** 10 §10.3 (G-Integration, G-Verify); 19 §19.1, §19.6; 15 §15.7.

**Tests first.** Every shipped check carries `appliesTo.gates` naming shipped gate ids and a severity,
count 7; after `forge module add fm-web` on a fresh init project `gate check G-Verify --json` runs
`a11y:audit` and `bundle:size` (each fails with its reason) and `gate list --json` shows them with
`source`; the run-time evaluator passes `FORGE_BASE_REF`; outside a run `api:breaking-change` fails
`FORGE_BASE_REF is not set` and passes the ref through when set; the empty-project test unchanged.

**Mutation evidence.** `appliesTo` removed from one file: root case; `FORGE_BASE_REF` dropped: in-run
case; `bundle:size` pointed at G-Deliver: `gate list` case.

**Depends on.** P20, P9. **Size.** S.

**Discloses.** Installing fm-web/fm-data/fm-mobile makes G-Verify fail until built or waived (fail
closed, Q229 D4; the change log says so); `store-release` may want `device-matrix:coverage` on
G-Deliver; `checks:` in `module.yaml` not cross-checked.

## P23 — `forge deploy record <dry-run|rollback|deployment>`: a validating writer for the delivery records

**Mandate.** `forge deploy record dry-run --env <ENV-id> --sha --ran-at` writes
`<paths.reports>/deployments/<ENV-id>.dry-run.json`; `record rollback --env --from-sha --to-sha
--rehearsed-at --health-url --health-status --health-checked-at` writes `<ENV-id>.rollback.json`;
`record deployment --env --sha --deployed-at --health-*` writes the `<ENV-id>.json`
`skeletonDeployedViolations` reads (`doctor/rules-delivery.ts:243-300`); each in exactly the shape
`deploy-evidence.ts`/`rules-delivery.ts` parse, validated BEFORE writing with the checks' own rules
(environment in the COMMITTED `kb/delivery/environments.md` via `readCommittedTree`; commits in HEAD's
history; `to_sha` a strict ancestor of `from_sha`; zoned instants, not future by the injected clock,
not before the commit; health host the environment's own non-local host, 2xx); `--json` prints
`{v:1, written}`; nothing committed (14 §14.3 rule 7). Routing in `runDeployCommand` (`bin.ts:3173-3236`)
BEFORE `parseCommandFlags(args, DEPLOY_FLAGS)` (:3180); an environment named `record` is refused.
`deploy-evidence.ts` exports its private classifiers (`STAGING` :80, `isTarget` :110, `isAncestor`
:172, `commitProblem` :183, `instantProblem` :214, `rollbackProblem` :331) rather than duplicating
them. `design-cicd-pipeline.md` requires the two stages to run the commands and commit the records;
`design-deployment-strategy.md` names the deployment command. Must not change the three
`deliver-stage` strings, the checks, the shapes, `forge deploy <env>`.

**Surface.** `bin.ts`, new `commands/deploy-record.ts`, `deploy-evidence.ts`, `rules-delivery.ts:49-151`,
`doctor/committed-tree.ts`, the two briefs, `deliver-stage.workflow.yaml` comment; specs 03 §3.2.5
(new row beside line 106), 14 §14.3 rule 7 / §14.4 rules 2, 5, `docs/method-guide.md`.

**Spec.** 14 §14.3 rules 1, 7, §14.4 rules 2, 5, §14.9; 10 §10.3 (G-Deliver); 11 F-INIT-7; 03 §3.2.5;
21 §21.1.

**Tests first.** New `deploy-record.test.ts` (tmp repo with committed `environments.md`): each record
makes its check pass after commit; refusals with no file and a remedy naming the flag (unknown env,
not a target, sha not in history, zone-less, future, before the commit, not an ancestor, equal shas,
`localhost`, 503, checked-at before rehearsed-at); atomic replace; a stale record reported by the
check; `bin.test.ts`: no kind, unknown kind, missing flag, combined with `--dry-run` → exit 2 with
usage; env named `record` refused; `test/command-steps.test.ts` pins the three strings;
`test/templates.test.ts`: the briefs carry the literal commands and each form refuses with usage
through the real CLI.

**Mutation evidence.** Ancestor validation removed: `to_sha` cases; write before validate: refusal
cases find a file; key renamed: round-trips; command deleted from a brief: brief test.

**Depends on.** none. **Size.** M.

**Discloses.** Records self-attested (no HTTP request); a later commit makes a record stale; the
`deliver-stage` run still fails at `deploy` until the pipeline has run; the Waiver on G-Deliver stays.

## P24 — `forge debug` REPRODUCE/PROVE run a defect's own test through `<command> <path>`

**Mandate.** `createRcaShell` (`packages/engine/src/rca/shell.ts:51`) passes `root` and `testRoots` to
`vetProposedCommand` so a placeholder-matched proposal runs under `ENGINE_COMMAND_LIMITS` as trusted
(:80). `runnableCommandsNote` (`rca/loop.ts:224-228`) states the shape and `-t` only for a table
runner (`RcaLoopDeps.runnableCommands`, `rca/types.ts:122`, gains the flag); REPRODUCE (:329-367)
records the expanded string as `state.reproductionCommand`; PROVE (:574-576) re-runs that identical
string; the RCA `reproduction` field (`schemas/src/artifacts/rca.ts:27`) carries it; a refused path
lands in `refusedCommands` with `test-path`. `debug.ts:845-852,898-923` passes `testRoots`. Must not
change FIX's `exec: false` (`test/forge-debug-real-project.test.ts:159-168`), `TEST_LAYERS_BY_BRIEF`,
`revertCheckScript` (`loop.ts:206`).

**Surface.** `rca/{shell,loop,types}.ts`, `loop/debug.ts`; specs 13 §13.2 step 2 (L161-168), L214.

**Spec.** 13 §13.2; 20 §20.1; Q230 D5, D6, D10.

**Tests first.** `rca/test-command.test.ts` (real loop, real confined runner, argv-recording fake
command): REPRODUCE runs `<command> <path>` once, PROVE the identical string, the RCA field holds
it; a refused path in `refusedCommands` and named in the next prompt; the note shows `-t` only for the
known runner; whole-layer proposals still work; `debug-test-command.test.ts`: no exec → no
placeholder offered; `testRoots` narrows; PROVE never runs the bare layer when a path was proposed.

**Mutation evidence.** PROVE re-running the bare command: identical-string case; `testRoots` not
passed: narrowing case; note claiming `-t` for all: note case.

**Depends on.** P5. **Size.** S.

**Discloses.** Agent sessions still run whole layers; a runner rejecting a positional file wastes a
loop (exit 2/64 made `inconclusive` only if a real runner is shown to use them); `revertCheckScript`
stays unguarded.

## P25 — The DoD `verify` phase in code: `forge story verify` runs `verify`; the lane commit runs `done`

**Mandate.** Decision 13's code half was in no group's drafts; added by the orchestrator, surface
verified. `dodProfileSchema` (`packages/methods/src/dod/schema.ts:16-19`, `ready`/`done`, `.strict()`)
gains `verify: z.array(dodCheckSchema)` (optional in the schema so pre-M14 profiles load; the shipped
profile shape and `scaffold-project.md:51-56,85` name all three; a profile without `verify` is a
`kb lint` warning naming the split). `forge story verify <id>` (`packages/cli/src/commands/story.ts`,
`phase: 'done'` at :92 and :360) runs the `verify` list by default (`phase: 'verify'`) and
`--phase done` runs `done`; `implement-story.workflow.yaml`'s `self-verify` (:63-66, `forge story verify
{{storyId}} --json`) is unchanged in text and now runs `verify`; a new command step
`done-check` (`run: forge story verify {{storyId}} --phase done --json`) sits between `document` (:79-83)
and the `commit` checkpoint (:89-91) so `done` runs after review (10 §10.6 step 9); the merge queue's
post-check set may name it later (not here). `packages/methods/test/fixtures/dod-profiles.ts:17-29`
(old nine-item `done`) and `packages/templates` DoD content follow 09 §9.8's amended block (P1). Must
not change `evaluateDodProfile` semantics per check, `spec:ac-coverage`, `persistState: false`.

**Surface.** `packages/methods/src/dod/{schema,types,load,evaluate}.ts`, `packages/methods/test/dod/`,
`packages/methods/test/fixtures/dod-profiles.ts`, `story.ts`, `bin.ts` (`--phase` beside `--story` :790),
`implement-story.workflow.yaml`, `briefs/scaffold-project.md`, `test/workflows.test.ts` (structural
copies), `test/command-steps.test.ts` (new shipped string classified).

**Spec.** 09 §9.8 (as amended by P1); 10 §10.6 steps 6, 9; 03 §3.2.5.

**Tests first.** Schema: a profile with `ready`/`verify`/`done` loads; without `verify` loads with the
lint warning; an unknown phase key refused; `story.test.ts`: `forge story verify` reports `phase:
'verify'` and runs only the `verify` ids, `--phase done` only the `done` ids; the 09 §9.8 block
(P1's `spec-block.test.ts`) parses through `loadDodProfile`; `implement-story` compiles with
`done-check` after `document` and before `commit`; `command-steps.test.ts` classifies the new string
ACCEPTED.

**Mutation evidence.** `verify` ignored (both phases run `done`): the phase cases; `done-check`
removed: the compile-order case; `verify` made required: the pre-M14 profile case.

**Depends on.** P1. **Size.** S.

**Discloses.** `done` is run by a command step, not by the merge queue (decision 13 says "the
merge/commit path"; the queue's named sets stay `fast`/`full`, Q226); `review:blocking-findings == 0`
still has no command until P14's verdict is readable by a check (recorded as an open question).

## P26 — `forge story verify --scope story` runs the story's own test files through the validated path form

**Mandate.** `splitScope`/`runLayer` (`story.ts:167-171,245-278`) no longer run the whole layer with
the note at :273-275: `files_expected.filter(isTestPath)` (engine rule, globs expanded against the
tree, files only, no symlinks, ≤50), each through `validateTestPath`, run through the existing
file-scoping seam `runAndNormalize(..., fileFilter?)` (`loop/test/reporter.ts:154-196` vitest,
:300-332 pytest, where `fileFilter` alone is ignored today at :325-329) via a new `TestRunOptions.files`
(`loop/test/run.ts:89-91`). A path failing validation, a symlink or >50 files makes the check
`unverifiable` naming the reason; no test paths keeps the whole-layer run. Must not change
`spec:ac-coverage`, `persistState: false`, `testRunLayer` (`layer.ts:101`).

**Surface.** `story.ts`, `loop/test/{run,reporter}.ts`, `dispatch/test-path.ts` (P5); specs 03 §3.2.5,
09 §9.8.

**Spec.** 09 §9.5, §9.8; 10 §10.6 step 6; 03 §3.2.5; 20 §20.1.

**Tests first.** `story.test.ts` (the `runTests` seam :124-132): `['tests/a.test.ts','src/a.ts']` runs
once with `files: ['tests/a.test.ts']`; a glob expands to existing files only; `tests/x.test.ts;touch
/tmp/c` or `../x.test.ts` → `unverifiable`, nothing run; no test paths → whole layer + note; 51 files
→ cap named; run/reporter tests: `files` reaches `runAndNormalize`, the pytest positional form, a
spaced path quoted; `bin-story-verify.test.ts`: the real line.

**Mutation evidence.** Validation skipped: two rows; symlinks followed: one; `files` dropped: the
once-with-files row.

**Depends on.** P5, P25. **Size.** S.

**Discloses.** `Story.test_paths` (M13-approved, never built) stays unbuilt; the list is derived from
`files_expected`; `ecosystem: 'unknown'` cannot be scoped; lint/typecheck never scoped.

## P27 — Plan compilation sets `StepNode.taint` from an authored `taint: external`; adopt and migrate carry it

**Mandate.** `AgentStep` (`packages/engine/src/workflow/types.ts:66-86`) gains `taint?: 'external'`;
the schema (`workflow/schema.ts:81-89`) accepts only that literal; `compilePlan` (`plan/compile.ts:955`,
node construction ~:525-577) copies it onto the `StepNode` (`plan/types.ts:197-210`'s doc rewritten);
`taint:` on a non-agent step is a validation issue. `adopt:reverse-derive-specs`, `adopt:gap-analysis`
(`adopt.workflow.yaml:11-25`) and `migrate:plan-migration|expand|contract` (`migrate.workflow.yaml:11-40`)
declare it citing decision 15; the greenfield fixture copies are regenerated with `runInit`. The
existing consumers then fire on real steps: `restrictGrantForTaint`, block [6] (`assemble.ts:607`),
`assertGateApprovalAllowed`, `context.json.externalContent` (:641), no derived test commands.
`forge run <wf> --dry-run --json` (`run.ts:72-86`) prints each node's taint. Must not change
`restrictGrantForTaint`, `taintedByPeerOutput`, `forge debug`'s FIX taint, any untainted step's grant.

**Surface.** `workflow/{types,schema,validate}.ts`, `plan/{compile,types}.ts`, the two workflows and
`fixtures/greenfield-service/.forge/workflows/{adopt,migrate}.workflow.yaml`, `run.ts`; specs 10 §10.1,
06 §6.2, 20 §20.5 point 6 (L166-167), 17 §17.2.

**Spec.** 20 §20.5 points 3, 4, 6; 15 §15.5.4; 06 §6.2; 10 §10.1; 17 §17.2; 20 §20.10 S6.

**Tests first.** `compile.test.ts`: the field compiles onto the node, absent stays absent, `internal`
is a schema error, on a command step a validation issue, ids unchanged; new `test/tainted-steps.test.ts`:
exactly the five steps tainted across every shipped workflow, fixtures agree; `taint-grant.test.ts`:
through `executeStep` with the real `adopt` workflow `reverse-derive-specs` gets `{read, write, exec:
false, network: 'none'}`, `externalContent: true`, no test commands; `migrate:expand` (backend, `git *`)
has `exec: false`; `s6-taint-enforcement.test.ts`: a compiled tainted plan is refused gate approval;
CLI dry-run prints `taint`; `workflow validate --all` accepts it.

**Mutation evidence.** Field not copied: the pin fails for five; any string accepted: `internal`;
dropped from `migrate:expand`: pin and `exec: false`.

**Depends on.** none. **Size.** S.

**Discloses.** `migrate:expand`/`:contract` lose exec and derived test commands (the briefs already
say the next command step runs the suite); a pre-M14 materialised `adopt.workflow.yaml` runs untainted
until `forge upgrade` (P43 names it stale); `forge doctor --security` unbuilt.

## P28 — `forge kb verify` and `forge adopt` verification run stored commands through the confined runner

**Mandate.** A stored KB verification command (`packages/cli/src/commands/kb.ts:201-250`, today
`execa(command, {shell: true})` with the whole environment) and adopt phase 5's detected command
(`packages/engine/src/adopt/verification.ts:176-267`, `execa` at :203-205) run only after
`vetStoredCommand(command, root)` = `vetConfiguredCommand` (`confined-command.ts:933`) then
`vetProposedCommand(command, {exec: [command], network: 'none'}, root)`, then through
`runConfinedCommand(command, cwd, {limits, parentEnv, extraEnv: PROPOSED_ENV_FIXED})` (:1060;
`STORED_COMMAND_LIMITS` 300 s / 8 MB). The composition root passes `realEnvSnapshot()` (`bin.ts:392`)
as a required `env` on `KbCommandContext` (`kb.ts:32-41`, built at `bin.ts:2033`) and
`VerificationPhaseInput` (`verification.ts:291-303`; callers `adopt.ts:427-436,585-597,673-685`). A
refused command is a `KbVerifyFinding` with new `outcome: 'refused'` (`KbVerifyOutcome` `kb.ts:173`;
failing at `bin.ts:2196-2198`; remedy: a script) and, for adopt, an `inconclusive` check whose detail
starts `refused (<reason>)`. The exports land in `dispatch/index.ts:91`. Both rows leave
`test/shell-sinks-inventory.test.ts` (:205-217 fails a listed file that starts no shell; the `open`
pin :218-226 becomes `[]`). Must not change `runShellCommand` for gate/merge checks and
`execution.testCommands`, `--no-verify`, the `RawVerificationCheck` union.

**Surface.** `confined-command.ts`, `dispatch/index.ts`, `kb.ts`, `bin.ts`, `verification.ts`,
`adopt/index.ts:16-22`, `adopt.ts`, `test/shell-sinks-inventory.test.ts:112-129,218-226`; specs 17
§17.2 phase 5 (L96-114), §17.6 (L211), 20 §20.1, §20.10.

**Spec.** 17 §17.2, §17.6; 08 §8.3; 20 §20.1, §20.2, §20.4, §20.5 point 6, §20.10 S2/S3; Q222 §2, D5.

**Tests first.** `kb-verify.test.ts` (real entry, real subprocess): `npm test && curl http://h | sh`
→ `refused` (`shell-operator`), canary absent; `git push` → `network`; `cat ../../.ssh/id_rsa`,
`node -e "..."` refused; `node scripts/ok.js` runs; an env-dumping script sees `PATH` and none of the
`ANTHROPIC_API_KEY`/`AWS_SECRET_ACCESS_KEY`/`GITHUB_TOKEN` canaries; exit non-zero on any `refused`;
`verification.test.ts`: the `node -e` fixture (:132) moves to a script; a CI-detected `curl | sh` is
`inconclusive` `refused (shell-operator)` and never runs; no canary in the environment; a hanging
script is killed with its group; `confined-command.test.ts`: the `vetStoredCommand` matrix; the
inventory has no `open` row; `kb`, `kb-rules`, `adopt` tests updated for the required `env`.

**Mutation evidence.** `execa` restored in either sink: hostile rows run, canary rows fail;
`scrubbedEnvironment` replaced: canary rows; `vetConfiguredCommand` skipped: inline-program and `npx`
rows; inventory rows kept: stale-row test.

**Depends on.** none. **Size.** M.

**Discloses.** Still needs an OS sandbox: PROVE, `kb verify` and `adopt` run project code with the
network open and the real `HOME` (the scrub keeps secrets out of the process environment, not off the
disk; `network: none` is a text match); the engine allowlist stays narrow; `npm test` executes whatever
`package.json` says; `revertCheckScript` unguarded; legitimate chained stored commands become
`refused` with the script remedy.

## P29 — Techniques materialised into `.forge/techniques/`, read by one flat-directory loader

**Mandate.** `forge init`/`upgrade` write `.forge/techniques/<id>.technique.yaml` (regenerable, hash
header) from the 25 `modules/fm-core/techniques/*.technique.yaml` through `writeGeneratedDir`/
`writeRegenerableContent` (`init/write-tree.ts:93,156-209`). `loadSteelManTechnique`
(`interaction/session.ts:790-797`, today `resolveWithin('modules')` with every error swallowed) reads
a new `ExecuteStepContext.techniquesRoot` (`dispatch/types.ts:301-330`) through `loadTechniqueFromDir`/
`listTechniquesInDir` in `packages/sessions/src/technique/load.ts` (`loadTechnique(modulesDir, id)`
:101 kept); an absent technique degrades to panel mode VISIBLY (a note in the outcome and record,
printed by `forge run`); a malformed file fails the step with `RUN-065` (`codes.ts:851-863`, re-pointed
to `.forge/techniques`). Must not change the technique schema, panel semantics, Q215's roster reader.

**Surface.** `sessions/src/technique/{load,schema,index}.ts`, `session.ts`, `dispatch/types.ts`,
`run/context.ts`, fixture assemblies (`engine/test/dispatch/helpers.ts`, `cli/test/commands/loop/helpers.ts`),
`init/{content,write-tree,types}.ts`, `codes.ts`, `fixtures/greenfield-service/.forge/techniques/`
(generated); specs 03 §3.3 (L193-198, L218), 16 §16.4 (L64-67), 19 §19.1 (L38).

**Spec.** 16 §16.4, §16.7 point 3; 19 §19.1; 03 §3.3.

**Tests first.** `session-roster.test.ts`: a project with the file and NO `modules/` runs a
`tradeoff` CONVERGE in debate mode (`proposer:round-N`/`critic:round-N` seen); without it panel mode
plus the note; malformed → `RUN-065` naming the path; init and `test/greenfield-fixture-generated.test.ts`:
25 files with hash headers, `forge upgrade` reports drift; sessions test: id/name mismatch refused.

**Mutation evidence.** Reading `modules/` again: the no-`modules/` case; note dropped: its
assertion; writer skipping techniques: init and fixture tests.

**Depends on.** none; lands before P43 so the classifier covers the new directory. **Size.** M.

**Discloses.** Copied verbatim (no `extends`); Q215's other left-open items not here.

## P30 — Declared `mcp:`/`fetch:` inputs and KB entries with `external` provenance taint a step at compile

**Mandate.** An `inputs:` entry may be a KB id, `mcp:<server>[/<tool>]` or `fetch:<https-url>`
(`workflow/schema.ts:89`; `http:` refused). `compilePlan` takes an optional third argument
`{taint: {externalKbIds}}` and sets `taint: 'external'` when any input is an external scheme or an id
in the set; EVERY compile site passes it: `runEngine` (`run/run-engine.ts:320`, via `RunEngineContext`),
`dryRunWorkflow` (`run.ts:86`), `assertPlannable` (`expression-context.ts:332`), `resumeWorkflow`
(`resume.ts:107`, from a new manifest field beside `expressionContext`, `context.ts:58/122`), the
stage plan (`plan/stage-plan.ts:648,732`), `compileRunPlan` (`plan/run-plan.ts:56`). Provenance:
`'external'` added to `KB_ENTRY_SOURCE_KINDS` (`kb/src/schema/kb-entry.ts:43`, `ref` = server/tool or
URL); the CLI collects the ids carrying it. `assemble.ts:561-570` separates external refs from
`declaredInputIds` before `packForStep` (`KB-013` for an unknown id, :143) and lists them in block
[4] (`StepContext.externalInputs?`, `pack-for-step.ts:30-40`). Must not change the clamp, the authored
signal, id determinism.

**Surface.** `plan/{compile,run-plan,stage-plan}.ts`, `run-engine.ts`, `run/{run,expression-context,resume,context}.ts`,
`workflow/{schema,validate}.ts`, `assemble.ts`, `pack-for-step.ts`, `kb-entry.ts`, `kb/src/lint`;
specs 10 §10.1 (`inputs:` schemes), 08 §8.3, 20 §20.5 point 3.

**Spec.** 20 §20.5 points 1, 3; 08 §8.3; 10 §10.1 (L47, 67, 80, 94); 05 §5.4 point 6; 15 §15.5.4.

**Tests first.** `compile.test.ts`: `mcp:jira/search_issues` taints and is not a KB id; `fetch:http://`
refused; an `externalKbIds` hit taints; ids identical with and without the set; kb tests: an entry with
`sources: [{kind: 'external', ref: 'mcp:confluence/get_page'}]` validates and lints; CLI: the manifest
records the set, `forge resume` recompiles the same tainted plan, dry run and real run agree, a step
declaring `mcp:` reaches the adapter with `exec: false`, `network: 'none'` and block [4] listing it;
`run-engine` test: the real compile site taints.

**Mutation evidence.** Set ignored in `compilePlan`; refs not split before `packForStep` (`KB-013`);
set not passed at `run-engine.ts:320` (dry-run passes, runEngine fails); manifest not recording it
(resume row).

**Depends on.** P27. **Size.** M.

**Discloses.** A step tainted by its own `mcp:`/`fetch:` input loses exec and network so cannot read
the input (Q222 D3 unchanged; no shipped step declares one); nothing writes `kind: external` yet
(08 §8.3 content decision deferred); `markExternalContent` still has no caller; an agent's `mcp:`
grant alone does not taint.

## P31 — A tainted step writes ADRs only as `status: proposed`; `forge adr accept` by a person confirms

**Mandate.** `OutputCheckInput.node` (`outputs.ts:309-310`) is widened with `taint` (the shape :222
uses); `documentProblems`/`checkDeclaredOutputs` (:780)/`verifyDeclaredOutputs` (:843, called with the
full node at `steps.ts:274`, so a `taintedByPeerOutput` decider (`dispatch-agent-step.ts:339,387,469`)
and a compiled tainted step reach it tainted) refuse, as a `validation` failure, any produced ADR
(statuses `adr.ts:10`) whose `status` is not `proposed`, naming the file, rule and remedy
(`forge adr accept <id>`). Block [6] states it (`forbiddenActionsFor`, `assemble.ts:332-354`). The
engine's own ADR write-back for a `kind: session` DECIDE (`session.ts:995-1051`, `accepted` at :1017,
node dispatched untainted at :1807) is pinned `accepted` when untainted and `proposed` when the DECIDE
node is tainted. `forge adr accept|reject|supersede` (`adr.ts:106-158`) refuse under P4's marker. Must
not change the ADR schema, `forge adr new`, untainted steps' outputs.

**Surface.** `outputs.ts:222,309-322,438,649,780,843`, `assemble.ts:332-354,524`, `session.ts:995-1051`,
`adr.ts:106-158`, `security/taint-guard.ts:5-30` (doc); specs 15 §15.5.4 (L428-430), 20 §20.5 point 3.

**Spec.** 15 §15.5.4; 20 §20.5 point 3, §20.3, §20.10 S6; 05 §5.5; 16 §16.3 step 4.

**Tests first.** `output-contract.test.ts`: tainted node + `accepted` → validation failure naming the
remedy; `proposed` passes; untainted `accepted` passes; `cardinality: many` checks every ADR;
`taint-grant.test.ts`: block [6] names the rule only when tainted; `dispatch-agent-step.test.ts`: a
debate decider writing `accepted` fails; `session.test.ts`: untainted DECIDE pinned `accepted`,
hand-tainted gets `proposed`; `adr.test.ts`: `forge adr accept` refused under the marker, works
without; `s6-taint-enforcement.test.ts`: a compiled tainted adopt step's `accepted` ADR refused.

**Mutation evidence.** Check removed from `documentProblems`: `accepted` row passes; `taint` dropped
at the call site: every tainted row; write-back unconditional either way: the session pins.

**Depends on.** P27, P4. **Size.** S.

**Discloses.** Whether a `kind: session` DECIDE should itself be tainted (Q203 D8) is not decided;
today's behaviour pinned; only ADRs are gated; no in-run elicitation.

## P32 — One agent reader in the CLI; `forge debug`/`review`/`panel` on their agent's limits; DECIDE owner by topic

**Mandate.** (2) `loadProjectAgent` (`packages/cli/src/commands/loop/agent-loader.ts`, no id-vs-file
check, every I/O error folded into `RUN-056`) is deleted; `agent.ts:36,66`, `doctor/model-tiers.ts:38,99`,
`loop/panel.ts:28,55`, `loop/review.ts:40,154`, `loop/index.ts:11` use `readProjectAgent`
(`assembly-context.ts:111`); `model-tiers.ts:95-103` keeps its catch-all. (3) `forge debug` sessions
request the diagnostician's declared limits (`max_turns: 45, wall_clock_ms: 2700000, max_cost_usd:
5.0`, `diagnostician.agent.yaml:49-52`) instead of `AD_HOC_LIMITS` (`ad-hoc-step.ts:20-24`, wired at
`debug.ts:92,289`); `review.ts:170` and `panel.ts:69` take their agent's limits through
`buildAdHocStepNode(id, agentId, brief, limits)`; the loop's own bounds still cap the run. (5)
`resolveDecisionOwner` (`session.ts:817-828`) takes the framed question (`state.framing?.question ??
node.brief`): the owner is the participant whose `decisions_owned` topics match most, ties and
no-match falling back to today's first-with-any rule; the DECIDE brief (:1801-1806) and record name the
topic. Must not change who may decide, `forge ask` (`AD_HOC_LIMITS` kept), block [6]'s tainted
rendering.

**Surface.** the files above, `bin.ts:524` (comment), `session.ts:412,811-828,1735-1812`; specs 16
§16.3 step 4 (L49), 05 §5.3, 13 §13.2.

**Spec.** 16 §16.3 step 4; 05 §5.3; 13 §13.2 F-DEBUG-1; Q215 decisions 1-2.

**Tests first.** `agent-loader.test.ts` replaced: `agent show`, `review`, `panel` refuse an id/file
mismatch (`RUN-056`) and propagate an `EMFILE`-class error; `doctor model-tiers` names such a file
unreadable; grep-test that `loadProjectAgent` no longer exists; `debug.test.ts` (:748): a fixture
diagnostician's limits appear on every recorded request; review/panel the same; `ask.test.ts` pins
`AD_HOC_LIMITS`; `forge-debug-real-project.test.ts:159-168` keeps FIX `exec: false`;
`session-roster.test.ts`: "which storage gives us consistency for the order model?" → data-architect
(`data.consistency` named), "how should we decompose the interfaces?" → architect, no match → first
with any topic.

**Mutation evidence.** `AD_HOC_LIMITS` restored at `debug.ts:92`: 20/600000/2 seen; topic matching
removed: the data-architect row; `loadProjectAgent` kept for `agent show`: the mismatch row.

**Depends on.** none; lands before P15 uses `readProjectAgent` or P15 imports it directly. **Size.** S.

**Discloses.** Topic matching is lexical; `forge ask` keeps `AD_HOC_LIMITS`.

## P33 — `registryTail(type)` in `@forge/schemas`, `outputGlob` built on it, and the loader refuses a mismatched registered output

**Mandate.** `loadAgentDefinition` (`packages/agents/src/schema/load.ts:111`) reports, beside
`checkArchitectNeverApproves` (:41) in `semanticIssues` (:104), any `outputs[]` entry whose `type` is a
core-registry type (`artifactTypeById`, `artifact-types.ts:194`) unless `schema` equals
`ARTIFACT_SCHEMAS[type].fileStem + '.schema.json'` (`json-schema/emit.ts:66`), `path` ends with
`registryTail(type)`, and `cardinality` is `many` exactly when the tail holds a placeholder and ABSENT
otherwise (the rule `test/agent-outputs-registry.test.ts:271` enforces; `single` (`schema.ts:28`)
refused on a registry type). `registryTail` is new in `@forge/schemas/registry`: the `pathTemplate`
minus its section root, `{id}-{slug}`/`{id}` → `<idPrefix>-*`, other placeholders → `*`; `outputGlob`
(`outputs.ts:122-140`) calls it with every existing result pinned byte-identical. Must not change any
agent's `outputs[]`, `outputPathCoveredBy`, `resolveStepClaim`, registry paths, Q224's seven-type
allowance.

**Surface.** `artifact-types.ts` (rows 21-75), `schemas/test/registry/artifact-types.test.ts`,
`outputs.ts` (isolated hunk), `engine/test/dispatch/outputs.test.ts` (:95), `load.ts`,
`agents/test/schema/load.test.ts`, `test/agent-outputs-registry.test.ts` (`CODE_OUTPUT` :183, :192,
:271), `test/greenfield-fixture-generated.test.ts` (no regeneration: agent YAML unchanged).

**Spec.** 05 §5.3, §5.9 (line 372); 18 §18.7; 15 §15.3.1.

**Tests first.** `load.test.ts`: an ADR output with `schema: prd.schema.json`, with
`docs/forge/kb/adrs/ADR-*.md`, with `cardinality` missing or `single` is an issue naming
`outputs[i].<field>` and the registry value; the registry form loads; `HandoffRecord` with `many` is
an issue; `ComponentSpec` and `Code` raise none; `registryTail('ADR')` = `decisions/ADR-*.md`,
`HandoffRecord` = `reports/handoffs.md`, `Diagram` = `*/views/*.mmd`, `Story` = `stories/STORY-*.md`;
`outputGlob(type, ROOTS)` equals the previous literal for EVERY registry type (a pinned table written
before the refactor); for every shipped agent copy, mutating one registered output's path, schema or
cardinality makes the loader fail (loader agrees with the repo test).

**Mutation evidence.** Tail check removed: load cases and the agreement test; `registryTail` keeping
`{id}`: the pinned table for every per-id type; `single` accepted: one.

**Depends on.** none. **Size.** S.

**Discloses.** Module-registered types (`ComponentSpec`, `fm-web/module.yaml:113`) are not checked;
overrides are validated only through `forge agent validate` on the resolved definition; the rule is
root-agnostic.

## P34 — A step with several unmerged predecessors is built on an in-lane merge of their heads onto the integration tip

**Mandate.** `resolveLaneBase` (`packages/engine/src/dispatch/lane-base.ts:42-85`) stops returning a
bare sha: the lane is ALWAYS created from the integration tip and every outermost same-scope
predecessor head (`sharesMergeScope`, contained heads dropped by `isAncestor`, today's candidate rule
:50-77) is merged INTO the new lane in plan order (the compiled node order `integrateSucceededLanes`
sweeps, never `dependsOn` order) with a new `VcsFacade.mergeIntoLane(handle, sha, message, resolver?)`
→ `packages/vcs/src/join.ts` `mergeIntoLane` = `git merge <sha> -m <message>` (fast-forward when the
head contains the tip, a merge commit with `Forge-Step`/`Forge-Run` trailers otherwise; NOT `--no-ff`,
so the one-predecessor case is byte-identical to today's stacking). `LaneCreated` is emitted AFTER the
last join with `payload.baseSha` = the lane HEAD then (what `enforceClaim` diffs against and resume
rolls back to), `stackedOn` when exactly one head fast-forwarded, `joinedFrom: [stepIds]` when a real
merge commit was made, `integrationTip` always; `unstackedPredecessors` disappears. A join conflict
follows the run's conflict policy as `processMergeCandidate` does (`merge-queue.ts:436-478`): `abort`
→ `git merge --abort`, the half-made lane removed, no session, `LANE-JOIN-CONFLICT` (class `conflict`)
naming files, head and lane; `agent`/`human` with no resolver → `VCS-MISSING-CONFLICT-RESOLVER`; a
resolver gets a `MergeConflictDescription` with the new lane as `worktreePath` and commits with the
trailers on `'resolved'`. `06` §6.4's stacked-lane bullet (L107-115) loses the `unstackedPredecessors`
sentence and gains the join sentence. Must not change contained-head dropping, `mergeLandingScope`,
the no-plan bare handler, the integration sweep, `already-integrated`/`VCS-LANE-REVERTED`, what claim
enforcement reverts. `git merge` reuses `commitInLane`'s environment (`vcs/src/commit.ts`).

**Surface.** `lane-base.ts` (:78-83), `steps.ts` `createLaneForStep` (~:123-147), `dispatch/{types,facades}.ts`,
new `vcs/src/join.ts` (+ index; no `mergeIntoLane` exists today), `commit.ts` (`assertSingleLine`),
`classify.ts` (:88 model), `reconstruct.ts:198-200` (no change), `swarm-review-step.ts:354-360`
(`reviewedLane` only for `stackedOn`; documented), `specs/06`; tests `engine/test/run/stacked-lanes.test.ts`
(:484 join, :517 diamond, :1006 crash/resume), new `vcs/test/join.test.ts`, `test/build-stage-lane-landing.test.ts`.

**Spec.** 06 §6.4 (L107-115), §6.5 step 2 (L129-133), §6.7, §6.8, §6.10; 10 §10.1; 18 §18.4 (L196);
20 §20.2 point 4.

**Tests first.** `c` (dependsOn [x, y]) sees both files; `LaneCreated` for `jn:c` has `joinedFrom`
`['jn:x','jn:y']`, `integrationTip`, `baseSha` = lane HEAD (a merge commit with both trailers), no
`stackedOn`; `mergedStepOrder` [x, y, c]; each trailer once in the integration history; `dependsOn:
['y','x']` still joins in plan order (second parent is y); three-way join; the diamond unchanged
(`stackedOn: b`, fast-forward); Q226 (e): chain `a → b` with an engine-integrated `x` landing between
→ `b` sees `x.txt` and `a.txt`, `stackedOn: 'a'`, `joinedFrom: ['a']`; unmoved tip keeps the existing
chain tests with `integrationTip` added; different scopes not joined; conflicting heads under `abort`
→ `LANE-JOIN-CONFLICT`, no session, no `LaneCreated`, no worktree or branch left, x/y untouched,
`classifyFailure` `conflict`; under `agent` with no resolver → `VCS-MISSING-CONFLICT-RESOLVER`, with a
fake resolver → a trailer-carrying join commit; strict claim `c.txt` reverts nothing joined; crash
after the first join before `LaneCreated` → orphan reclaimed (`MERGE_HEAD` worktree removable), one
`LaneCreated`; crash at `LaneCommitted` → rolled back to the join `baseSha`; `join.test.ts`:
fast-forward, merge commit, conflict `{kind:'conflict', files}` after abort, rejecting hook is
`VCS-GIT-OPERATION-FAILED`, newline in the step id refused; build-stage: S3 depending on S1 and S2
sees both before the merge, every lane lands once; spec text pinned.

**Mutation evidence.** No join: five tests; `dependsOn` order: one; `LaneCreated` before the join:
crash test; abort skipped: no-`MERGE_HEAD` assertion; `--no-ff`: diamond/chain; claim diffed against
the tip: strict case; classify mapping removed: `transient`.

**Depends on.** none; lands after P3 (the lanes wave follows enforcement). **Size.** M.

**Discloses.** A swarm-review whose base is a join reads the project checkout (no shipped workflow
reviews a join); `human` has no resolver; old logs' `unstackedPredecessors` ignored on resume; the
landing rebase still replays predecessor commits by patch-id until P35's `replayFrom`;
`reclaimOrphanedWorktrees` (`orchestrate.ts:98`) must abort a mid-merge first if git refuses.

## P35 — The merge queue takes a per-call resolver that knows the lane's step, replays only a stacked lane's own commits, caps resolutions

**Mandate.** (1) `MergeConflictDescription` (`vcs/src/merge-queue.ts:60-72`) gains `stepId`, `runId`
and `commit: {sha, subject, forgeStep?}` (`git rev-parse --verify REBASE_HEAD`, absent when not
mid-rebase). (2) `MergeCandidate`/`MergeCandidateLike` gain `replayFrom?`: `processMergeCandidate` runs
`git rebase --onto <integrationHead> <replayFrom>` so only the lane's own commits replay;
`runMergeStep` (`steps.ts:889`) sets it to the lane's `baseSha` when every `stackedOn`/`joinedFrom`
predecessor landed; the engine's `LaneHandle` therefore carries `baseSha?`, `stackedOn?`, `joinedFrom?`
(set at `steps.ts:283` and by `resumeRun` at `orchestrate.ts:358` from `laneOrigins`). This replaces a
`skip-commit` idea: a stale pre-resolution replay that applies cleanly would silently reintroduce
rejected content. (3) `MergeQueueFacade.process(candidate, checks, options?)` (`types.ts:200`) takes a
per-call `conflictResolver` preferred by `createMergeQueueFacade` (`facades.ts:394`) over its
constructor argument; `landLane` (`integrate.ts:143-154`) passes `ctx.conflictResolver`, a new
`ExecuteStepContext` field. (4) `maxResolutions` (default 5): past it the rebase aborts with
`conflict-unresolved` reason `resolution-cap` (the `MergeOutcome` union `types.ts:159-179` changes in
lockstep, type-asserted). (5) `landLane` emits `MergeConflict{reason:'resolved', files, commit}` before
`MergeCompleted`; the unresolved payload gains `files` and an optional `detail`. (6)
`RunEngineContext.conflictPolicy` (`run-engine.ts:74`) moves to `ExecuteStepContext`. Must not change
queue serialisation, `abort`, `already-integrated`, `forge merge`.

**Surface.** `merge-queue.ts` (:84-86, :227-229, :245-259, :436-478), `vcs/src/index.ts`,
`dispatch/{types,facades,integrate,steps}.ts`, `orchestrate.ts:358`, `run-engine.ts:74`; tests
`vcs/test/merge-queue.test.ts` (:480), `engine/test/dispatch/merge.test.ts`,
`engine/test/run/{lane-integration,stacked-lanes,run-engine}.test.ts`.

**Spec.** 06 §6.5 steps 1-2, §6.4 ("replays only its own"), §6.8; 18 §18.4 (L201); 20 §20.2 point 4.

**Tests first.** The resolver receives `stepId`, `runId` and the conflicting commit's sha/subject/
trailer; `replayFrom`: a lane built on a predecessor that landed by REBASE lands with `--onto` (no
predecessor commit replayed, one merge commit), the same fixture conflicts without it (pinned as the
reason); `replayFrom` outside the lane's history → `VCS-GIT-OPERATION-FAILED`, lane clean; more than
`maxResolutions` → aborted, clean, `resolution-cap`, resolver called exactly the cap; per-call resolver
used when the facade has none, constructor fallback, union assertion; `lane-integration.test.ts`
(:407): `MergeConflict{resolved}` then `MergeCompleted`; (:399) unchanged; stacked chain after a
resolved predecessor: the resolver is called ZERO times landing `b`; `ctx.conflictPolicy` read from
`ExecuteStepContext`.

**Mutation evidence.** Per-call resolver ignored: `VCS-MISSING-CONFLICT-RESOLVER`; plain `rebase`: the
rebased-predecessor test conflicts and the stacked test calls the resolver once; `replayFrom` set for
an unlanded predecessor: `MERGE-DEPENDENCY-NOT-LANDED` tests hold (pinned); cap removed: count 6;
resolved `MergeConflict` not emitted: order test; `stepId` dropped: description test.

**Depends on.** none; after P3. **Size.** M.

**Discloses.** Nothing calls the seam with a real session until P38 (the shipped default still fails
`VCS-MISSING-CONFLICT-RESOLVER`); `forge merge` keeps `abort` (`merge.ts:48`); `REBASE_HEAD` absence is
"unknown commit"; `asVcsLaneHandle` casts must keep the new optional fields.

## P36 — The swarm-review guard restores the reviewed lane on every path

**Mandate.** Verified: the read-only guard (`swarm-review-step.ts` ~:417-432, `hasChanges(reviewedLane,
base.value.sha)`) runs only after `dispatchAgentStep` returns; the catch (~:397-415) returns the adapter
failure without it, and a dirty lane on the success path fails the step but stays dirty, so a retry
fails again. One `restoreReviewedLane` runs on both paths (awaited, `finally`-shaped), resetting through
a new `VcsFacade.resetLane` → `resetLaneWorktree` (`vcs/src/lanes.ts:415`, `reset --hard` + `clean -fd`,
ignored files untouched; `resume/rollback.ts:21` already imports it), failing typed: `RUN-083` on the
success path, the adapter failure with the restored paths on the failure path. Q226 (g) is pinned, not
changed. Must not change what a perspective may write, `RUN-083`, committed content, the perspective
`cwd`.

**Surface.** `swarm-review-step.ts:370-432`, `dispatch/{types,facades}.ts`; tests
`swarm-review-step.test.ts` (:1408 dirty lane, :1357 cwd), `engine/test/dispatch/merge-checks.test.ts`.

**Spec.** 05 §5.5; 10 §10.6; 06 §6.4, §6.8.

**Tests first.** A perspective writing `stray.txt` then throwing → the adapter failure names
`stray.txt` as restored, lane clean at `base.value.sha`, no REVIEW file; a writing perspective that
returns → `RUN-083`, restored, and the same step re-run on the clean lane succeeds with `REVIEW-001.md`;
a tracked-file modification restored; ignored files survive; `merge-checks.test.ts` pins (g) with the
open question cited.

**Mutation evidence.** Restore on the success path only: the throw case finds `stray.txt`; skipped on
success: the retry case; `-fdx`: ignored-files case.

**Depends on.** none. **Size.** S.

**Discloses.** Q226 (f) second half (a merge removing a reviewed lane mid-review) unserialised,
unreachable in shipped workflows; (g), (h), (i) untouched.

## P37 — `forge config set <key> <value> --commit` commits exactly `.forge/config.yaml`; `intake:record-level` uses it

**Mandate.** `configSet(ctx, key, rawValue, {commit: true})` (`packages/cli/src/commands/config.ts:150`)
validates FIRST (the `CFG-001` refusal unchanged; `test/command-steps.test.ts:153-158` keeps
classifying), then before any write refuses `--commit` with `CFG-055` when the project is not a git
repository, `.forge/config.yaml` is untracked, or it already differs from HEAD (`getDirtyFiles`,
`vcs/src/git.ts:123`; remedy: commit or stash that edit); writes; then `commitPaths(cwd, {paths:
['.forge/config.yaml'], message, sign})` (new in `vcs/src/commit.ts` beside `commitInLane` :117, which
stages `-A` and is not reused) runs `git add -- <paths>` and `git commit -m <msg> -- <paths>`, is a
no-op returning HEAD when unchanged, honours `vcs.signCommits` (`schemas/src/config/schema.ts:305`),
handles an unborn HEAD (`isNoCommitsYetResult`, `git.ts:144`). The message is built by a sibling of
`formatCommitMessage` (:84) with optional trailers; inside a step `Forge-Step`/`Forge-Run` come from
P4's `FORGE_STEP_ID`/`FORGE_RUN_ID`. `bin.ts:1879` gains `'--commit': false`; the `--json` line (:1896)
gains `committed: {sha} | null`. `intake.workflow.yaml` `record-level` (:73) becomes `cd
"$FORGE_PROJECT_ROOT" && forge config set project.level "$FORGE_ANSWER_levelConfirmed" --commit` and
drops the echo; the greenfield fixture is regenerated. Must not change `forge run`'s `VCS-DIRTY-TREE`
for any other file (`git.ts:216`), `configSet`'s validation, the Q230 `execution.testCommands.<layer>`
route.

**Surface.** `commit.ts`, `git.ts`, new `vcs/test/commit-paths.test.ts`, `config.ts`, `bin.ts`,
`codes.ts`, `intake.workflow.yaml:65-73`, `fixtures/greenfield-service/.forge/workflows/intake.workflow.yaml`;
tests `cli/test/commands/config.test.ts`, new `cli/test/bin-config-commit.test.ts`,
`engine/test/dispatch/elicit.test.ts`, `test/intake-workflow.test.ts` (:444 flips; :342-359 locate the
integration worktree), `test/command-steps.test.ts`, `test/shipped-steps-dispatchable.test.ts`.

**Spec.** 03 §3.2 (`forge config` row, P1); 20 §20.2 S8; 18 §18.3; 06 §6.4 step 3; 10 §10.2 P0.

**Tests first.** `commitPaths` with a second dirty file commits only the named path, returns HEAD when
clean, refuses a path outside the repo, commits as the first commit on an unborn HEAD; `configSet
--commit` leaves `git status --porcelain` empty with subject `forge(config): set project.level`;
`CFG-055` with nothing written when differing, untracked, not a repo; an invalid value is still
`CFG-001` even in a non-git directory (order); unchanged value → `committed: null`; real subprocess
`--json` carries `committed.sha`; after the shipped `intake` with `--answers` the tree is clean,
`git log -1 --format=%B` holds `Forge-Step: record-level` and the run id, `project.level` is the
confirmed level, and `git merge --no-edit <integration branch>` is clean; the new string stays
ACCEPTED.

**Mutation evidence.** `git add -A`: the second-dirty-file test; guard removed: two cases; guard
before validation: classifier and order case; `--commit` ignored: intake and bin tests; trailers
dropped: the `git log` assertion.

**Depends on.** P4. **Size.** S.

**Discloses.** The commit lands on the checked-out branch while intake's outputs sit on the
integration branch (P9 turns divergence into a refusal; the merge is proven clean and the closing
message should name it — open question); a bad level still reports `CFG-001 ... line 0` (Q227 l);
`signCommits` unexercised in CI; POSIX-only strings.

## P38 — `conflictPolicy: agent` resolves a residual conflict with one confined session of the lane's own agent

**Mandate.** `createAgentConflictResolver(ctx)` (new `packages/engine/src/dispatch/conflict-resolver.ts`)
is set as `ctx.conflictResolver` by `runEngine` (the context copy at ~:459-484 that sets `stepGraph`)
so the shipped default works. Given a description: (a) the step not in `ctx.stepGraph` (a
`<node.id>:decide` lane) → `MERGE-RESOLVER-NO-STEP`; a `write: false` agent → `MERGE-RESOLVER-READ-ONLY`;
the step's remaining `limits.maxCostUsd` (ceiling minus the `UsageRecorded` sum for the step) zero →
`MERGE-RESOLVER-BUDGET`; each with no session. (b) ONE writable session through
`assembleAgentSession({node, ctx, agent, taskText, callerConfinesWrites: true, role:
'resolve-conflict'})` (`assemble.ts:55-75`, `mayWrite` :538) whose block [4] names each conflicted
path with its porcelain status, the step and brief, and the other side as the integration branch
(plus the last `Forge-Step` trailer touching each path when `git log -1
--format=%(trailers:key=Forge-Step) -- <path>` yields one); the diff arrives as fenced untrusted input;
`cwd` = `description.worktreePath`; the agent's own tools/model with `restrictGrantForTaint`; usage
recorded against the lane's step with session id `<stepId>:resolve-conflict`; prompt record persisted;
the session must not commit (a sibling of `runAgentWork`, `steps.ts` ~:321-362, without `commitInLane`).
(c) verify: no unmerged paths, no conflict markers, HEAD unchanged (`MERGE-RESOLVER-TREE-MOVED`), no
path outside the conflicted set (others restored, `MERGE-RESOLVER-OUT-OF-CLAIM`); any failure → the
queue aborts the rebase (or the join aborts the merge). (d) `'resolved'`: the queue stages and
continues; pre-checks and post-checks run unchanged (`merge-queue.ts:495-542`). `06` §6.5 step 2's
`agent` bullet (L130-131) is amended. Must not change `abort`, `human`, serialisation, `forge merge`,
perspective grants.

**Surface.** the new file, `run-engine.ts`, `assemble.ts`, `steps.ts`, `integrate.ts` (resolver detail
on the `MergeConflict` payload), `lane-base.ts`/`createLaneForStep` (join passes the resolver),
`classify.ts` (verify only), `specs/06` §6.5; tests new `engine/test/dispatch/conflict-resolver.test.ts`,
`lane-integration.test.ts`, `stacked-lanes.test.ts`, `test/build-stage-lane-landing.test.ts`.

**Spec.** 06 §6.5 step 2 (L129-133), steps 3-5, §6.7; 05 §5.3, §5.5; 20 §20.1, §20.5, §20.10; 18 §18.4.

**Tests first.** (flip :399) under the DEFAULT policy two lanes write `same.txt`; the later lane's agent
gets exactly one session with `cwd` = its worktree, `tools.write === true`, the step's model, a prompt
naming `same.txt` `UU`, the diff fenced, no command text; `MergeConflict{resolved}` then
`MergeCompleted{conflict-resolved}`; the branch holds the merged content; `UsageRecorded` and a prompt
record for `<stepId>:resolve-conflict`; the run completes. The session also writes `other.txt` →
restored, `MERGE-RESOLVER-OUT-OF-CLAIM`, rebase aborted, step fails `MERGE-CONFLICT-UNRESOLVED`, the
first lane stays integrated; markers left → unresolved; a session running `git commit` →
`MERGE-RESOLVER-TREE-MOVED`; adapter throws → unresolved, aborted; `fast`/`full` run after resolution
and a failing post-check reverts; read-only agent → no session; spent ceiling → `MERGE-RESOLVER-BUDGET`;
a join whose heads conflict: `c:resolve-conflict` then `c`, `LaneCreated` after the join commit;
tainted step's session carries the restricted grant; build-stage: two stories touching `CHANGELOG.md`
land with one resolution session; spec text pinned.

**Mutation evidence.** Resolver not set by `runEngine`: `VCS-MISSING-CONFLICT-RESOLVER`; out-of-claim
check removed: `other.txt` lands; marker check removed: `<<<<<<<` lands; HEAD check removed: a
session commit lands; refusals removed: session counts; checks bypassed: post-check revert case.

**Depends on.** P34, P35. **Size.** M.

**Discloses.** `human` still fails; `forge merge` never resolves; one session per conflicting commit,
at most 5 per candidate, the cap a `conflict` failure not a retry; a session with exec can wreck a
mid-rebase tree (abort is the recovery); a human's integration commit has no trailer so the prompt
names only file and diff.

## P39 — `mergeDecideLane` lands the DECIDE lane through `landLane` with the run's checks, policy and resolver

**Mandate.** `mergeDecideLane` (`session.ts:697-750`, today `ctx.mergeQueue.process({...
conflictPolicy: 'abort'}, {})` with hand-emitted events) becomes `resolveLaneChecks(ctx, ...)` +
`landLane(ctx, {eventStepId: node.id, laneStepId: laneId, lane, conflictPolicy: ctx.conflictPolicy ??
'abort', checks, skippedLayers})`; NOT `integrateLane` (it sets `eventStepId = laneStepId`,
`integrate.ts:290`, re-keying the events to `<node.id>:decide`). The DECIDE lane thus gets pre-checks,
post-checks, `MergeStarted`'s payload, `MergeReverted`, and typed failures with the lane kept;
`already-integrated` stays done. The doc comment at :667-696 is rewritten. Must not change
`cleanupPhaseLane`, outcome folding, the `:decide` id.

**Surface.** `session.ts`, `integrate.ts` (exported already), `dispatch/types.ts` (P35's field);
`engine/test/interaction/session.test.ts` (~:466).

**Spec.** 06 §6.5 steps 3, 5, L141-147; 16 §16.7; 18 §18.3, §18.4; 13 §13.1 F-TEST-1 rule 4.

**Tests first.** A DECIDE lane committing an ADR with `mergeChecks: {pre:'unit', post:'unit'}` and a
recording `node -e` command: run once in the DECIDE worktree and once in the tree; events
`MergeQueued`, `MergeStarted{preChecks:['execution.testCommands.unit'], ...}`, `MergeCompleted`,
`LaneRemoved`, all with the session step's `stepId`; a failing post-check reverts and fails
`MERGE-POST-CHECK-FAILED` with the ADR off the branch; `agent` policy with a fake resolver resolves,
`abort` fails `MERGE-CONFLICT-UNRESOLVED`; no `mergeChecks` → the old events minus the payload.

**Mutation evidence.** Old body restored: payload and revert cases; `integrateLane` used: the
`stepId` assertion; `'abort'` literal: the agent-policy case.

**Depends on.** P35. **Size.** S.

**Discloses.** The DECIDE lane's id is not in `ctx.stepGraph`, so P38 refuses it typed
(`MERGE-RESOLVER-NO-STEP`): a conflicting DECIDE lane still fails as data, now with checks.

## P40 — `forge merge` lands lanes through `landLane` with the checks the run would have applied, never none

**Mandate.** `forge merge --lane/--all` (`packages/cli/src/commands/run/merge.ts`: `laneCandidate` :48,
`mergeLane` :55 `facade.process(candidate, {})`) recompiles the run's plan from the manifest
(`workflowId` + `expressionContext`, as `resumeWorkflow` does at `resume.ts:70-112`; `readManifest`
:44 exported) and, for a lane in a `merge` step's `mergeLandingScope`, uses that step's
`policy.preChecks`/`postChecks`, otherwise `execution.mergeChecks`; no manifest → `execution.mergeChecks`;
a workflow that no longer compiles → fallback with a warning; `--pre-checks`/`--post-checks
<fast|full|layer|command>` override; nothing resolving to a command → `MERGE-CHECKS-UNCONFIGURED`
naming the keys (exit failure, nothing landed); the outcome JSON gains `checks: {pre, post,
skippedLayers}`. Landing goes through `landLane` via an exported `LandLaneDeps` (`telemetry`, `vcs`,
`mergeQueue`, `laneRegistry`, `retainLaneWorktrees`, `runId`, `testCommands`, `mergeChecks`) that
`ExecuteStepContext` satisfies structurally; the CLI builds one from the facades (never
`buildRunEngineContext`), so `forge status`/resume see the events. `conflictPolicy: 'abort'` stays.
Must not change `runMergeStep`, `integrateLane`, `already-integrated`, `--abort` (`USR-003`).

**Surface.** `merge.ts` (75 lines; `MergeContext` gains `config`, `workflowsRoot`, `commandEnv`),
`bin.ts:1172-1226` (`MERGE_FLAGS`), `resume.ts:44`, `integrate.ts` (`LandLaneDeps`, sequenced after
P35), `plan/merge-scope.ts` (read only); specs 03 §3.2.4 line 94, 06 §6.5; tests
`cli/test/commands/run/merge.test.ts` (:77), `cli/test/bin.test.ts`.

**Spec.** 06 §6.5 steps 3, 5, L141-147; 03 §3.2.4; 13 §13.1 F-TEST-1 rule 4; 18 §18.3, §18.4.

**Tests first.** A ready lane left by a run whose `merge` declares `fast`/`full` with `unit`/`typecheck`
configured: `--lane` runs `fast` in the lane and `full` in the tree, lands, lists labels and skipped
layers, events under the lane's step id; a failing pre-check does not land, `pre-check-failed` naming
the key, exit 1; a lane in no scope uses `execution.mergeChecks`; neither → `MERGE-CHECKS-UNCONFIGURED`
naming `execution.testCommands.*`; the overrides land and are named; no manifest → fallback;
unreadable → `RUN-054`; non-compiling → warning; `--all` per lane; `--pre-checks` without a value is
usage; `--abort` still `USR-003`.

**Mutation evidence.** `{}` passed again: recording assertion and the unconfigured case lands;
recompilation skipped: wrong set; refusal replaced by none: a lane lands; `facade.process` direct: no
`Merge*` events.

**Depends on.** P35. **Size.** M.

**Discloses.** `forge merge` never resolves a conflict; a stacked lane merged by hand keeps the full
rebase unless the log shows every predecessor `removed`; Q226 (g) pinned.

## P41 — An `elicit` question can `show` a register entry an earlier step produced

**Mandate.** `elicitQuestionSchema` (`workflow/schema.ts:49-66`, `.strict()`) accepts `show: {type,
subtype?}`. Before asking, `runElicit` (`dispatch/elicit.ts:167-270`) reads that register from
`ctx.integrationPath` (`types.ts:317`) under `docRootsOf(ctx)` (`outputs.ts:818`), selects by P7's
rule (`registerEntries` :390, `subtypeText` :411, `REGISTER_SCHEMAS` :289, exported through one new
`readRegisterEntries(tree, type, roots)`), takes the last entry and hands its fields to the `AskPort`
as `AskRequest.context: readonly string[]` (`types.ts:268`), printed by the terminal port through
`sanitizeRefusalText` before `promptLine` (`run/ask.ts:200-207`) and ignored by `--answers`;
`ElicitationRequested` records `shown: {type, subtype, id}`. Fail closed: `show.type` must be
`collection: true` and the step must depend transitively on a producer of that type and subtype
(`validateStructure`, `validate.ts:356`; `compilePlan`, `compile.ts:955`; codes
`elicit-show-not-a-register`/`elicit-show-not-produced` beside `duplicate-elicit-question`); not found
at run time fails the step with `RUN-105` before `ElicitationRequested`. `confirm-level`
(`intake.workflow.yaml:57-63`) gains `show: {type: HandoffRecord, subtype: level-proposal}`;
`propose-level.md` line 2 is reworded; fixtures regenerated. Must not change answer binding,
sanitisation, replay, `RUN-101/102`, the register reader's rules, any spec (P1's sentence).

**Surface.** `schema.ts`, `validate.ts`, `compile.ts`, `outputs.ts` (additive export), `elicit.ts`,
`dispatch/types.ts`, `run/ask.ts`, `codes.ts`, `intake.workflow.yaml`, `briefs/propose-level.md`, the
two fixture copies; tests `engine/test/dispatch/elicit.test.ts`, `engine/test/workflow/elicit-questions.test.ts`,
`cli/test/commands/run/ask.test.ts`, `test/intake-workflow.test.ts`, `test/workflows.test.ts`.

**Spec.** 10 §10.1 (P1's sentence), §10.2 P0; 18 §18.4, §18.7 (HandoffRecord, L288); 06 §6.4.

**Tests first.** `show` with `Epic`, an unknown type, or no producing ancestor is a structure and a
plan issue; the shipped `intake` parses and compiles (red: strict schema); with `reports/handoffs.md`
holding two entries `AskRequest.context` carries the last `level-proposal`'s id and `delivered` lines
and `ElicitationRequested` records `shown.id`; an entry only in the project root (not the integration
tree) fails `RUN-105` before the event; a replayed step reads nothing; a hostile entry reaches the
port one-line; the terminal prints the context sanitised before `[step 1/1]`, `--answers` prints
nothing; the recorded `intake:confirm-level` request contains the scripted `LEVEL_HANDOFF` text
(:127, :197-199) and the run completes.

**Mutation evidence.** Read from `ctx.projectRoot`: the intake test (the entry lives on the
integration branch, :342-359); `show` dropped from the schema: workflow tests; sanitisation removed:
ask test; not-found made a prompt: fail-closed test.

**Depends on.** P1, P37 (shared `intake.workflow.yaml` and fixture: a serialisation, not semantic).
**Size.** M.

**Discloses.** Registers only; no TUI renderer; the whole entry is shown, not the "verbatim proposal
document" the brief promised (reworded); `forge resume --answers` still cannot warn on a misspelt name.

## P42 — `forge agent validate` gains `output-ownership-overlap` and `unregistered-output-type`; the roster's `file_ownership` reconciled

**Mandate.** `agentValidateAll` (`packages/cli/src/commands/agent.ts:334`) adds, beside
`overlapFindings` (:140), `output-ownership-overlap` (error): the sample of an output type role A
declares (`outputPathCoveredBy`, `outputs.ts:162`, `*` read as `x`) lies inside role B's `exclusive:
true` glob; and `unregistered-output-type` (warning): a type neither the registry, `Code` (`src/**`)
nor a module's `provides.artifactTypes` (`fm-web/module.yaml:113`, `fm-core:314`) names. On the shipped
roster the error fires today on architect's exclusive `docs/forge/kb/decisions/**` vs `ADR` on
data-architect, platform, security, sre, fm-mobile/mobile, and `docs/forge/specs/interfaces/**` vs
`InterfaceContract` on both `integration-architect` copies; so architect drops BOTH globs
(`modules/fm-core/agents/architect.agent.yaml:84-90`, `specs/05` line 178 inside the fenced block,
`packages/agents/test/fixtures/architect.ts:83`), orchestrator drops the stale
`docs/forge/sessions/handoffs/**` (:59), em drops `docs/forge/kb/delivery/risks/**` and
`docs/forge/sessions/retros/**` (:65). `test/output-contract-known-gaps.test.ts` `OWNERSHIP_ONLY_STEPS`
(:110) gains the architect steps whose ownership no longer covers their output
(`shape-solution:select-architecture`, the second ADR step, `migrate:plan-migration`, the
InterfaceContract step). `agent.test.ts:242` becomes "no error, exactly the seven Q224 warnings".
Must not change `outputs[]`, `tools`, `kb_write`, `may_approve`, `exclusive: false` roles, registry
paths. Serialise with P1 on `specs/05`.

**Surface.** `agent.ts` (:124, :140-205, :311, :334), `bin.ts:296-306` (warnings exit 0), the three
agent files, `integration-architect.agent.yaml` (comment), `specs/05:178`, `fixtures/architect.ts`,
`a2-roster.test.ts`, `a3-roster.test.ts`, `agent.test.ts:228-246`, the known-gaps ratchet,
`fixtures/greenfield-service/.forge/agents/*` (regenerated: three files), `modules/*/module.yaml`.

**Spec.** 05 §5.3, §5.9; 06 §6.7 (L180-181); 15 §15.3.1, I11/CFG-504.

**Tests first.** A fixture where A is exclusive over `kb/decisions/**` and B declares `ADR` reports the
error naming both; the shipped roster reports no error (red until reconciled: seven pairs); an
unregistered fixture type warns, `Code` and `ComponentSpec` do not; the shipped warnings are exactly
Q224's seven; a3: no glob names `sessions/handoffs`, `sessions/retros`, `delivery/risks`; no exclusive
glob covers another role's sample; a2: the fenced block equals the fixture; the ratchet equals the
recomputed set (added steps logged).

**Mutation evidence.** `kb/decisions/**` restored: names five roles; `specs/interfaces/**` restored:
names both copies; orchestrator's glob restored: a3; `Code` exemption dropped: nine warnings.

**Depends on.** P1 (file serialisation). **Size.** M.

**Discloses.** A wildcard-section type (`Diagram`) is never inside a section glob (sre `delivery/views/**`
case stays open); how the validator learns module types in a project (`.forge/manifest.yaml` rows or
`modulesDir` on the context; else `ComponentSpec` is a false warning); dropping architect's claims
lets two ADR lanes run in parallel (P10 refuses a duplicate id); `Story.interfaces` and `kb_write`
stay unenforced.

## P43 — `forge upgrade` classifies every materialised regenerable file (current / stale / edited / missing)

**Mandate.** `runUpgrade` (`packages/cli/src/commands/upgrade/run-upgrade.ts`) plans before acting: a
read-only `planRegenerableContent(target, modulesDir)` in `init/write-tree.ts` shares the readers
`writeRegenerableContent` (:156-212) uses (`readResolvedAgents`, `init/content.ts:126`; P29's
techniques included) and, in the writer's order, classifies each copy as `current` (header hash,
`generated-header.ts:122`, equals `sha256` (`init/hash.ts:5`) of the shipped body), `stale` (body
matches its own header, shipped body differs), `edited` (body differs from its header: the conflict
path) or `missing`. `UpgradeReport` (`upgrade/types.ts:67-85`) gains `staleFiles`/`editedFiles`; the
dry-run branch (:96-104) sets `regenerated` true whenever any file is stale or missing, whatever the
version pair; `bin.ts` prints the count and first paths, `--json` the arrays. A real run writes stale
and missing silently (`run-upgrade.test.ts:243`) and edited through the conflict path. Must not change
the header format, conflict modes, `.forge/config.yaml`, the manifest rebuild, the order.

**Surface.** `run-upgrade.ts`, `upgrade/types.ts`, `write-tree.ts`, `content.ts`, `bin.ts`; tests
`run-upgrade.test.ts` (:68, :113, :243), new `cli/test/init/plan-regenerable.test.ts`, `bin.test.ts`.

**Spec.** 03 §3.3 (L148), §3.4 (L223); 05 §5.10 (L382).

**Tests first.** `.forge/agents/analyst.yaml` materialised from an older body reports, at an equal
version pair, `staleFiles: ['.forge/agents/analyst.yaml']` and `regenerated: true` (red: `false`
today); a hand-edited file is `edited`; a current project reports both empty and `false`; the real run
regenerates it and a second dry run reports none; the plan names exactly the writer's paths and writes
nothing; `upgrade --dry-run --json` carries `staleFiles`, the human line the count.

**Mutation evidence.** Body-vs-header only: stale-vs-current; edited classified stale; `regenerated`
tied to the version pair; plan ≠ writer set.

**Depends on.** P29. **Size.** S.

**Discloses.** Overrides in `.forge/overrides/agents` untouched and uncompared (05 §5.10); no doctor
rule (decision 21 names `upgrade`); `run-upgrade.test.ts`/`backup.test.ts` are load flakes (run alone).

## P44 — `FORGE_REQUEST_CONTEXT` resolved end to end (M13 P8)

**Mandate.** An agent step whose session ends with `FORGE_REQUEST_CONTEXT: <kb-id|query>` in
`SessionResult.controlTokens` (parsed already: `adapter-claude-code/src/session-result.ts:138`,
`testkit/src/fake-adapter.ts:560-565`) receives, through `ctx.adapter.resumeSession(sessionId,
ResumeRequest)` (`adapter-kit/src/types/session.ts:50-54`; used by the crash-resume branch at
`steps.ts:438-446`), a continuation whose prompt carries what `resolveContextRequest(query, kb.backend,
kb.tree, deps.kbPackBudgetTokens)` (`agents/src/context/resolve-context-request.ts:32-56`) resolved,
rendered as block [3] renders entries (`compile-prompt.ts:144-161`), heading-defanged
(`neutralizeBlockHeadings` :98) and control-token-stripped (`adapter-kit control-tokens/strip.ts:37`);
the request, resolution and exact continuation are written beside `prompt.md`
(`steps/<slug>/context-requests.json`, `expansion-<n>.md`); bounded (3 per session), served ids
skipped, stopped at `node.limits`, entered only when `ctx.adapter.capabilities().sessionResume` is
true AT CONTINUATION TIME (Claude Code reports it false until `system/init`, `capabilities.ts:48,99-106`).
The same loop serves `runParticipantSession` (`dispatch-agent-step.ts:66-124`, :118) with the
read-only grant. Why: `05` §5.4 point 4, §5.5 rule 2 and 12 shipped briefs tell agents to emit the
token and nothing reads it (every engine `controlTokens` occurrence is an empty constant:
`execute.ts:74`, `steps.ts:631`, `session.ts:1181`, `swarm-review-step.ts:85`, `orchestrate.ts:79,88`).
Must not change `resolveContextRequest`, the nine blocks or `prompt.md` bytes across continuations,
`assemble.ts` determinism, the operating contract, `ResumeRequest`/`resumeSession`, any grant, the
`EventType` union (the request rides in `SessionEvent`'s payload as `{kind:'context-request'}`). One
protocol line is appended to block [3] (the only prompt-text change; recorded as a contract change in
`test/determinism.test.ts` and `compile-prompt.test.ts:172,282,293`).

**Surface.** new `dispatch/context-expansion.ts`, `steps.ts` (`runAgentWork` :380-565, :459;
`UsageRecorded` :525-540 per adapter result, summed), `dispatch-agent-step.ts`, `dispatch/types.ts`
(:226, :250, :256), `assemble.ts` (:125-126 `resumePrompt` precedent), `result-record.ts` (:146/:174
precedent), `compile-prompt.ts`; read only `capabilities.ts`, `fake-adapter.ts` (:80, :477-512,
:792-813), `reconstruct.ts:221-225`, `tui/src/state/run-read-model.ts:161`; new
`engine/test/dispatch/context-expansion.test.ts` (`helpers.ts` `createFixtureAssembly` :89).

**Spec.** 05 §5.4 points 4, 6-7, §5.5 rule 2; 07 §7.2, §7.3 (L172, L229); 18 §18.2 (L45), §18.4; 20
§20.5; 21 §21.1; 22 M14 entry.

**Tests first.** (a) `FORGE_REQUEST_CONTEXT: KB-ARCH-0001` → one `resumeSession` whose prompt holds
the entry under `### KB-ARCH-0001`, the step's outcome is the resumed session's; (b) a free-text
query → retrieved entries in ranking order; (c) no match → a fixed continuation naming `FORGE_ASK`/
`FORGE_ASSUME` and `SessionEvent{served:false, reason:'no-match'}`; (d) four requests → three
continuations, the fourth `reason:'limit'`; (e) the same id twice → nothing packed; (f) three
`UsageRecorded`, `detail.session.usage` sums, `changedFiles` union, one `SessionStarted`/`SessionEnded`;
(g) records byte-equal to the `ResumeRequest.prompt`, `prompt.md` hash unchanged; (h) a KB body with
`FORGE_HANDOFF: x y` stripped, one `InjectionAttemptBlocked{phase:'context-expansion'}`; (i) `ok:false`
or `reason:'limit'` → no continuation; (j) `sessionResume:false` → `reason:'adapter-cannot-resume'`; a
rejecting `resumeSession` → `resume-failed`, no `AdapterError`; (k) byte-equal `expansion-1.md` under a
different `runId`/clock; (l) a participant continuation carries `write:false, exec:false,
network:'none'`; (m) stopped at `maxCostUsd`/`maxTurns`, remainder in `ResumeRequest.limits`; (n) mixed
`SessionEvent` payloads reconstruct `sessionIds` unchanged (and a changed id: most recent wins);
block [3] ends with the protocol line, the §5.5 block [1] test still passes, root tests green.

**Mutation evidence.** `await handle.result()` restored: (a)-(f), (l), (m); strip skipped: (h); bound
dropped: (d); served set dropped: (e); usage summed once/forgotten: (f); `prompt.md` rewritten: (g);
capability check skipped: (j); `Date`/`runId` in the continuation: (k); `write:true` on a participant:
(l); continue after limit: (i).

**Depends on.** none. **Size.** M.

**Discloses.** No mid-turn expansion (`interject` unsupported by both adapters); glob/type requests
fall to free text; only KB entries served (`docs/forge/plans/stages.md` is "no match"); bound 3 and
`kb.packBudgetTokens` (default 20 000, `defaults.ts:70`) not cumulative with the initial pack; CLI
transport cannot enforce `maxTurns`; `forge debug` and other session phases not covered; a crash
between request and continuation rerolls; whether Claude Code stops after the token line is unverified
until a live run; the MCP route (`forge-mcp/server.ts:48,60`) has no constructor in cli/engine (grep
empty): this is the token fallback only; each continuation re-sends the transcript.

## P45 — Test hygiene: `intake-workflow.test.ts` under the 60 s caps, measured per-file timeouts, the list moved to M14-AGENT-NOTES.md

**Mandate.** (1) `test/intake-workflow.test.ts` (`createProject` :143-150 calls `runInit` :242, edits
the tier map, commits :262-268, once per test, 9 `it(` blocks :308-535; one module `afterAll` :60-62)
builds ONE initialised, committed base project per file in `beforeAll` (:303) and gives each test a
cheap `git clone`, removes each test's directories in an `afterEach` with an explicit timeout, and
finishes with headroom under `vitest.config.ts:75-76` (60 000; `pool: 'forks'` :40) under load. (2)
Every file on the accepted list (`packages/engine/test/e2e/crash-resume.test.ts`,
`scripts/verify-success-criteria.test.ts`, `packages/kb/test/adopt/survey.test.ts`,
`packages/cli/test/commands/run/resume.test.ts`, `packages/engine/test/interaction/session.test.ts`,
`packages/tui/test/{ascii-matrix,env,linear}.test.ts*` plus the `components/ fuzz/ replay/ screens/
state/` subtrees, `packages/cli/test/commands/upgrade/{run-upgrade,backup}.test.ts`,
`test/workspace-floor.test.ts`, `packages/engine/test/adopt/verification.test.ts`) carries an explicit
timeout sized 3× its measured isolated run (precedent `test/agent-prompts-all-workflows.test.ts:288,856`,
`test/authoring-roles-run.test.ts:417,425`), capped at 600 000; the list with its numbers moves to
`process/plans/M14-AGENT-NOTES.md` (note the two rules numbered 14 at M13 notes lines 84 and 98). Must
not change the global caps (21 §21.1), any assertion, what `runInit` proves elsewhere
(`packages/cli/test/init/*`).

**Surface.** the files above, `vitest.config.ts` (read only), `scripts/run-tests.mjs` (the runner),
`process/plans/M13-AGENT-NOTES.md` rule 3 → `M14-AGENT-NOTES.md`.

**Spec.** 21 §21.1; 20 §20.2 S8.

**Tests first.** A guard asserting `runInit` is called exactly once per file (red: 9) and each test
starts on an independent clean repository; a per-test 20 s budget plus `afterEach` cleanup recorded
red under load (`run-tests.mjs run test/intake-workflow.test.ts` beside a parallel `pnpm typecheck`)
and green after; each listed file's isolated duration recorded in the Q entry; a file already over
60 s isolated is a defect, not padded.

**Mutation evidence.** Module `afterAll` and nine `runInit` calls restored: the guard fails; one
raised timeout lowered: that file fails under the load condition (run once for the record).

**Depends on.** none; last code piece before P46. **Size.** S.

**Discloses.** The list remains a list (honest budgets, not determinism under CPU starvation); the
allowlist-vs-zero-tolerance process decision stays the orchestrator's.

## P46 — Third live run: `plan-stage` at L1 on a throwaway project (orchestrator-run checkpoint)

**Mandate.** One real `forge run plan-stage --stage STAGE-1 --json` at L1 on a throwaway project outside
the repository ends `RunCompleted`: `po` writes Epics and Stories that land through the engine's
integration; both session steps (`estimation`: `em` with `po`+`architect`; `story-refinement`: `po`
with `architect`+`test-architect`; `session.ts:192-223`) decide through an agent owner and their DECIDE
lane merges (:668-750); `write-test-plan` lands its HandoffRecord and `docs/forge/specs/test-plan.md`;
`derive-run-plan` (`forge plan run-plan STAGE-1 --json`, inline) exits 0; G-Ready's four checks
(`story:dor`, `story:file-claim-overlap`, `story:unbound-acceptance-criteria`, `story:oversized`,
`G-Ready.gate.yaml`) are evaluated over ≥1 `status: ready` story and pass: `GateEvaluated{passed:true}`
then `GateApproved` (in-run approval is `report.approved = isApproved(result)`, `gates/report.ts:35`;
`runGateStep` reads no `approval.roles`, `gates/evaluate.ts` no `evidence:`). Run by the orchestrator
with the owner's key from the gitignored `.env`, loaded in a subshell for one command and never
printed, from a clean worktree of the M14 commit (M13 notes' verify-the-commit rule), budget-capped.
Must not run `forge init` with the repo as cwd, fix product code inside the checkpoint (findings become
Q entries and piece rows; one brief-only fix may be applied and the run repeated once), exceed the cap,
leave the key in any file, or depend on P44.

**Surface.** `plan-stage.workflow.yaml` (7 steps; `inputs: stageId required`), `G-Ready.gate.yaml`,
`briefs/{write-epics,write-stories,decompose-stages,scaffold-project}.md`, `defaults.ts` (:26, :28,
:56-59, :97 `quality.dodProfileDefault`), `init/parse-init-flags.ts`, `bin.ts` (`-C` :572-578, `spec new`
:2372-2399, `gate` :1127-1140), `packages/cli/bin/forge.mjs`, `session.ts` (`DEFAULT_SESSION_BOUNDS`
:94-100, $3; `ExecuteStepContext.sessionBounds` populated by nothing), `plan/compile.ts` (`DEFAULT_LIMITS`
:82; `stepLimitsSchema` `.strict()` with only `maxTurns`/`maxCostUsd`, `workflow/schema.ts:37-42`),
`run-engine.ts:110-141`; `SPEC-QUESTIONS.md` (`## Q<n> — M14 P9-3`), `GAUNTLET-LOG.md` (`## M14 P9-3`).

**Spec.** 10 §10.2 P5, §10.3, §10.1; 09 §9.3, §9.8; 16 §16.2, §16.3, §16.8; 20 §20.2 S8, §20.10 S9;
22 M14.

**Tests first (rehearsal, then recipe).** Before any key: the seed script against a `mktemp -d`
project leaves `--dry-run --json` at exit 0, and the seeded project driven through `runWorkflow` with
the strict fake adapter reaches `RunCompleted` with `GateApproved` (a throwaway script; no live run if
the fake cannot pass). Recipe: worktree of the M14 commit, `pnpm install --offline --frozen-lockfile`,
`pnpm typecheck`; `forge -C "$PROJ" init --yes --level L1 --platform claude-code --name planstage-live
--git-init`; confirm `models.tiers.balanced.claude-code`; `config set budget.perRunUsd 10`; `limits:
{maxCostUsd: 1.0, maxTurns: 40}` on the three agent steps in the materialised workflow (never
`wallClockMs`: the strict schema would fail to parse); seed `spec new Capability`, `spec new NFR`
(numeric target), `docs/forge/plans/stages.md` (`stages:` with `STAGE-1`), `engineering/dod-profiles.yaml`
matching `quality.dodProfileDefault` (P25's three-list shape), `kb sync`, commit everything. Live
command in a `set -a; . "$REPO/.env"; set +a` subshell writing to `$OUT` outside `$PROJ`; afterwards a
`grep -rlF` for the key value under `$PROJ`, `$OUT`, `$WT` must count 0. Pass criteria from
`events.ndjson` and the integration branch: `RunCompleted`; per agent step `LaneCreated ...
LaneReady StepSucceeded` then `MergeQueued MergeStarted MergeCompleted LaneRemoved`; both session
steps succeed with an agent DECIDE owner (no `NO_AGENT_SESSION`-shaped outcome); `derive-run-plan`
`errors: 0`; `ready-gate` `GateEvaluated{passed:true}` + `GateApproved`; ≥1 Epic and ≥1 `ready` Story
with an implementation `owner_role`, `test-plan.md` present; ZERO `PolicyViolation`. Every defect or
vacuous pass (G-Ready green with zero ready stories; approval with `roles: [human]` and no pause) is a
numbered finding with attempt, spend, duration and evidence; cumulative live spend recorded (P9 $0.3885
+ P9-2 $0.8381 so far). Clean-up removes the worktree and both directories.

**Mutation evidence.** Not a code piece; the rehearsal's fake run must FAIL the criteria when
`dod-profiles.yaml` is removed (stories stay `draft`, `definition-of-ready` returns early at
`validate-rules.ts:535`) and when `stages.md` lacks `STAGE-1` (`write-epics.md:2-3`: ask, never infer).

**Depends on.** every other piece landed (P3 for strict-fails-the-step observed live; P25 for the
profile shape; P9 for the run-start sync). **Size.** S.

**Discloses.** Not exercised: `build-stage`, stacked lanes, explicit `merge` nodes, `elicit` (unless
the intake path is taken), conflict resolution, a human approval pause, an agent-run approve refusal;
G-Ready's advisory `critique-stage-plan` is not dispatched; session bounds not configurable from
config (open item); single sample at `sonnet`; a failed final gate is not resumable past
(`run-engine.ts:134`); P44 evidence opportunistic only.

## Sequencing

```
P1 ──┬─ P2 ── P3 ──────────────────────────┐
     ├─ P4 ──┬─ P15 ── P19                 ├─ P34 ─┬─ P38
     │       ├─ P37 ── P41 (also P1)       │       │
     │       └─ P31 (also P27)             ├─ P35 ─┼─ P39
     ├─ P5 ──┬─ P24                        │       └─ P40
     │       └─ P26 (also P25)             └─ P36
     ├─ P25 (spec text from P1)
     ├─ P8 ── P10 ── P11 (also P1)
     ├─ P9 ── P22 (also P20)
     ├─ P14 ── P18
     ├─ P20
     ├─ P27 ── P30
     ├─ P29 ── P43
     ├─ P32 (before P15)
     └─ P42 (specs/05 after P1)
independent: P6 P7 P12 P13 P16 P17 P21 P23 P28 P33 P44 P45
P46 last
```

Waves, at most 4 concurrent pieces (the API-limit and server-rate-limit incidents of M13 are recorded
in `M13-AGENT-NOTES.md`; every piece runs scoped tests only, rule 2):

| Wave | Pieces | Note |
|---|---|---|
| 0 | P1 | spec text first; nothing else starts until it is committed |
| 1 | P2, P3, P4, P5 | enforcement core, the session marker, the test-path validator |
| 2 | P6, P7, P8, P9 | claims and outputs; the run-start sync (lanes' prerequisite) |
| 3 | P10, P11, P12, P13 | KB output contract; the two claim pieces that assert `RUN-104` |
| 4 | P14, P15, P16, P17 | gates I: verdict field, marked-shell refusal, waivers, GateReport |
| 5 | P18, P19, P20, P21 | gates II: merge reads the verdict, SoD rule, check files, declaration briefs |
| 6 | P22, P23, P24, P25 | module checks placed, deploy recorder, RCA path form, DoD `verify` |
| 7 | P26, P27, P28, P29 | story verify scoped, authored taint, confined stored commands, techniques |
| 8 | P30, P31, P32, P33 | provenance taint, tainted ADRs, session loaders, loader registry rule |
| 9 | P34, P35, P36, P37 | lanes (after enforcement): join, resolver plumbing, review restore, config commit |
| 10 | P38, P39, P40, P41 | agent resolver, DECIDE and manual merges with checks, elicit `show` |
| 11 | P42, P43, P44, P45 | roster reconcile, upgrade staleness, context expansion, test hygiene |
| 12 | P46 | the live run, after the full-suite check on a clean checkout |

Shared-file serialisation inside a wave: `outputs.ts` (P6, P8, P10, P11, P31, P33, P41: each an
isolated hunk; P33's `outputGlob` and P41's export are additive), `steps.ts` (P3, P4, P8, P10, P18,
P19, P34, P35, P38), `integrate.ts` (P18, P35, then P40), `intake.workflow.yaml` and its fixture (P37
then P41), `specs/05` (P1 then P42), `bin.ts` (P15, P16, P17, P23, P28, P37, P40, P43: each its own
region). A builder verifies the COMMIT in a clean worktree (rule 14/15) before reporting, which is what
catches a hunk that depended on another piece's uncommitted edit.

## Exit criteria

- Every piece P1-P46 landed with its two commits and logged as `## M14 P<n>` in
  `process/GAUNTLET-LOG.md`; every new decision, open question and disclosed limit in a Q entry
  (Q233 onwards, numbered at commit time).
- One full unscoped suite green on a CLEAN checkout of HEAD (a fresh worktree, `pnpm install
  --offline --frozen-lockfile`, `pnpm typecheck`, `pnpm run boundaries`, `pnpm lint`, the full
  `node scripts/run-tests.mjs run`) apart from the accepted load flakes as measured and listed by P45
  in `M14-AGENT-NOTES.md`; run by the orchestrator once, at the end.
- P46 completed: `plan-stage` at L1 ends `RunCompleted` with G-Ready evaluated for real over at least
  one `ready` story, both session steps decided by an agent owner, and the findings recorded.
- Every Q232 decision has the piece that implements it named in its Q entry; none re-opened.
- The `specs/22` M14 entry's acceptance bullets each have the test that proves them.

## Deferred past M14

- **OS-level confinement** (M13 P40, Q222 §8): PROVE, `forge kb verify` and `forge adopt` still run
  project code with the network open and the real `HOME`; P28's vet and scrub bound the command line
  and the process environment only; `network: none` is a text match. Needs macOS `sandbox-exec`, Linux
  namespaces/bwrap or a container.
- **`revertCheckScript`** (`rca/loop.ts:206`) runs shell `git` in the lane unguarded.
- **Enforcement only on adapter-reported changed files** (Q209/Q212/Q225); the same sandbox gap.
- **A `blocked` review retried by the implementer's loop** (decision 7's parenthetical): no engine
  primitive (`rerunFrom`); a blocked review escalates (P14 records the owner question).
- **`done` run by the merge queue** rather than a command step (P25 discloses it); a
  `review:blocking-findings == 0` command reading P14's verdict.
- **`Story.test_paths`** (M13-approved, unbuilt): P26 derives the list from `files_expected`.
- **Session bounds from `.forge/config.yaml`** (`ExecuteStepContext.sessionBounds` populated by
  nothing; P46 risk).
- **`Story.interfaces`**, `kb_write` and `file_ownership` run-time enforcement, `quorum > 1`,
  cross-run evidence in the SoD rule, whether a `kind: session` DECIDE is tainted (Q203 D8), which KB
  entries carry `sources[].kind: external` (08 §8.3 content), the MCP context route
  (07 §7.3 line 229), advisory critique dispatch, `forge doctor --security`, the `Diagram` wildcard
  ownership case, committing an in-run `GateReport` on a lane, a `human` conflict resolver, a config
  key for the trunk name, Q226 (f) second half and (g)-(i), the `KbWriter`-side `sources` lint on
  hand-written artifacts, `forge init` prompting for `paths.release`.

## Standing rules

`process/plans/M13-AGENT-NOTES.md` applies to M14 unchanged: nothing in it is renamed. In particular
rule 1 (synchronous commands, `node scripts/run-tests.mjs run <paths>`), rule 2 (scoped tests; the
orchestrator runs the one full suite at the end), rule 4 (no live key in any piece but P46), rule 13
(quote changed spec text in the Q entry; never reword `05` §5.5), and rule 15 (numbered 14 in the file,
the second rule 14: **verify the COMMIT, not the working tree** — a clean worktree of HEAD,
`pnpm install --offline --frozen-lockfile`, `pnpm typecheck` and the piece's key tests there, before
reporting and after any commit that isolated hunks). P45 copies the notes forward as
`M14-AGENT-NOTES.md` with the measured flake list; until then the M13 file is the reference.

## Open questions

Remaining after Q232 (each is recorded, not decided, by the piece named):

1. How a `blocked` review is retried after the fix: no `rerunFrom` primitive; escalate and re-run by
   hand (P14).
2. Whether `warn` should fail the step on a protected-path write (`06` §6.8 'forbidden path'); P3
   pins today's revert-and-succeed.
3. `paths.release`'s home (config vs the fm-mobile manifest, which has no config surface) (P12).
4. `warn` check semantics in `15` §15.7 (P20's reading; the owner may refuse `warn` at load) and the
   G-Verify placement of the five module checks (P22).
5. The `many` reservation block of 25 (gaps, not reuse) (P8).
6. Whether `sources` becomes schema-required with an `18` §18.7 migration (P11).
7. Whether a `kind: session` DECIDE is tainted like the panel decider (P31).
8. The closing message of an `intake` run naming the merge of the level commit with the integration
   branch (P37); `forge merge` reading the integration worktree while P9's fast-forward runs.
9. Full-suite tolerance policy: allowlist of measured flakes vs zero tolerance on a clean checkout
   (P45; the orchestrator's).
10. Where `done` runs long-term (command step vs merge queue) and the command behind
    `review:blocking-findings == 0` (P25).
