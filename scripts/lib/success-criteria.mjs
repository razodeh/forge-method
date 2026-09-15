/**
 * SC1-SC11 (`01` §1.8, verbatim) evidence definitions and the pure evaluator logic.
 *
 * The standing lesson this whole build has already paid for twice (M10's real gap, M11's own final
 * check) is that "the aggregate suite is green" is not proof any *specific* claim holds — a suite can
 * be green while the one test that would have caught a regression never ran, was deleted, or was
 * quietly weakened. So each criterion below names the *real, specific* command(s) that constitute its
 * own literal proof (a real test file, a real `-t` pattern targeting the real `describe`/`it` blocks
 * that assert the literal SC text), not "some subset of `pnpm test` passed."
 *
 * Two shapes of criterion:
 *
 * - `mode: 'automated'` — every listed command is run for real; the SC is `PASS` iff every command
 *   exits 0, `FAIL` (naming the failing command) otherwise.
 * - `mode: 'disclosed'` — the SC's own literal text requires something this sandboxed, no-network,
 *   no-live-credential environment cannot supply (a live adapter session with billed API usage, or a
 *   real >=50k-LOC external repository with a real human maintainer to judge accuracy). Any partial
 *   automated commands that DO exist are still run and reported, but the overall verdict is always
 *   `DISCLOSED` — never fabricated as `PASS` — matching P5's benchmark-budget disclosure and P8's
 *   npm-availability disclosure, this milestone's own established precedent for real limitations.
 *
 * Kept separate from the CLI entrypoint (`../verify-success-criteria.mjs`) for the identical reason
 * `bench-ratchet.mjs`/`coverage-ratchet.mjs` are separated from their own CLI wrappers: pure decision
 * logic can be imported and unit-tested directly, with an injected fake `exec`, without spawning a
 * real subprocess for every test run — a check nobody has exercised is indistinguishable from one
 * that always passes.
 *
 * @see specs/01 §1.8
 * @see PLAN-M12.md P9
 */

/**
 * @typedef {object} SCCommand
 * @property {string} description
 * @property {readonly string[]} argv  - `[command, ...args]`, run with `cwd` = repo root.
 *
 * @typedef {object} SCDefinition
 * @property {string} id
 * @property {string} title
 * @property {string} literalText  - `01` §1.8's own literal SC wording.
 * @property {'automated'|'disclosed'} mode
 * @property {readonly SCCommand[]} commands
 * @property {string} [disclosure]  - required when `mode === 'disclosed'`: what exactly cannot be
 *   proven here and why.
 *
 * @typedef {object} SCCommandResult
 * @property {string} description
 * @property {readonly string[]} argv
 * @property {boolean} ok
 * @property {number|null} exitCode
 * @property {string} outputTail  - last portion of combined stdout+stderr, for evidence.
 *
 * @typedef {object} SCResult
 * @property {string} id
 * @property {string} title
 * @property {'PASS'|'FAIL'|'DISCLOSED'} verdict
 * @property {readonly SCCommandResult[]} commandResults
 * @property {string} [disclosure]
 */

/** @type {(argv: readonly string[]) => string[]} */
const run = (argv) => ['node', ...argv];
/** @type {(...args: readonly string[]) => string[]} */
const vitest = (...args) => run(['scripts/run-tests.mjs', 'run', ...args]);

/** @type {readonly SCDefinition[]} */
export const SUCCESS_CRITERIA = [
  {
    id: 'SC1',
    title: '`forge init` produces a complete Stage-1 (MVP) plan',
    literalText:
      '`npx forge-method init` on an empty directory, given a one-paragraph product idea, produces a ' +
      'complete Stage-1 (MVP) plan: Vision, PRD, NFRs, architecture ADR set, data model, repo/build ' +
      'strategy, test strategy, delivery plan, epics and stories — with a valid traceability matrix.',
    mode: 'automated',
    commands: [
      {
        description:
          'run-init.test.ts: real `runInit` end to end writes the full Stage-1 artifact set',
        argv: vitest('packages/cli/test/init/run-init.test.ts'),
      },
      {
        description: 'content.test.ts: every generated artifact has real, schema-valid content',
        argv: vitest('packages/cli/test/init/content.test.ts'),
      },
      {
        description:
          'bin.test.ts: `forge init` as a real dispatched subprocess against a real platform CLI ' +
          'preflight (PLAN-M12.md P1)',
        argv: vitest(
          'packages/cli/test/bin.test.ts',
          '-t',
          'forge init \\(real subprocess dispatch',
        ),
      },
      {
        description:
          'spec-graph.test.ts: SC1\'s own literal "valid traceability matrix" clause -- the real ' +
          '`SpecGraph.build` chain (CAP realises VIS, EPIC delivers CAP, STORY partOf EPIC, AC ' +
          'belongsTo STORY) plus its own real violation/orphan/cycle detection. Proven against the ' +
          'general builder every init-generated spec document must satisfy, not against one specific ' +
          "init run's own output -- no test in this repository chains `forge init`'s real output " +
          'directly through `SpecGraph.build` (a genuine, narrower gap than the other two commands ' +
          'above, recorded honestly here rather than overstated).',
        argv: vitest('packages/core/test/graph/spec-graph.test.ts'),
      },
      {
        description:
          "doctor/project.test.ts: `checkSpecGraph` -- the real gate check that runs SpecGraph's " +
          'traceability validation against real spec documents on disk (the mechanism `forge doctor` ' +
          'and gate enforcement actually call)',
        argv: vitest('packages/cli/test/commands/doctor/project.test.ts', '-t', 'checkSpecGraph'),
      },
    ],
  },
  {
    id: 'SC2',
    title: '`forge run build --stage mvp` across >=3 parallel lanes, clean-clone buildable',
    literalText:
      '`forge run build --stage mvp` executes that plan across >=3 parallel lanes and produces a ' +
      'repository that builds, passes its own generated test suite, and starts, from a clean clone, ' +
      'on a machine that never ran FORGE.',
    mode: 'disclosed',
    disclosure:
      'The orchestration mechanics that a >=3-lane build would depend on ARE proven for real by the ' +
      'commands below, against a fake (non-billing) adapter: `run-engine.test.ts` proves two fanned-out ' +
      'agent lanes genuinely run concurrently (both admitted before either commits) rather than ' +
      'sequentially; `scheduler-determinism.test.ts` proves the scheduling order is seed-deterministic ' +
      'across independent runs; `crash-resume.test.ts` proves a run survives a real SIGKILL mid-flight. ' +
      'A fresh critic round checked this claim concretely rather than letting it stand on inference: ' +
      'the highest lane-count actually exercised anywhere in the engine test suite is 2 ' +
      "(`fixture-workflow.ts`'s own `FIXTURE_ITEM_IDS` is exactly `['story-1', 'story-2']`), and " +
      "`s9-budget-enforcement.test.ts`'s own doc comment is explicit that its two-step scenario is " +
      'deliberately SEQUENTIAL, not concurrent fan-out ("A fanned-out/concurrent pair would not prove ' +
      'this"). So no test in this repository exercises 3 or more genuinely concurrent lanes at once -- ' +
      'only that the mechanism (scheduler + backpressure, whose own ceiling defaults to 8) carries no ' +
      '2-lane special case in its implementation, which is inference from reading the source, not a ' +
      'directly-run 3-lane proof. Combined with what this sandboxed, no-live-credential environment ' +
      "cannot verify at all -- the SC's own full literal claim end to end: a real platform adapter " +
      'actually *writing* a real Stage-1 plan into real, compiling source code across >=3 concurrently-' +
      'running lanes, checked out clean and built on a second machine, which requires a live, billed ' +
      'adapter session (`FORGE_LIVE=1` + a real credential) plus a scratch machine with no FORGE ' +
      'history -- this SC is reported DISCLOSED, matching the same structural gap SC4 and SC6 disclose.',
    commands: [
      {
        description:
          'run-engine.test.ts: two fanned-out agent lanes run genuinely concurrently, not sequentially',
        argv: vitest(
          'packages/engine/test/run/run-engine.test.ts',
          '-t',
          'runs the two fanned-out agent instances concurrently',
        ),
      },
      {
        description:
          'scheduler-determinism.test.ts: identical seed -> byte-identical multi-lane scheduling order',
        argv: vitest('packages/engine/test/e2e/scheduler-determinism.test.ts'),
      },
      {
        description:
          'crash-resume.test.ts (E3): SIGKILL mid-multi-lane-run, resumed without loss/dupe',
        argv: vitest('packages/engine/test/e2e/crash-resume.test.ts'),
      },
    ],
  },
  {
    id: 'SC3',
    title: 'Crash-resume: `kill -9` mid-run continues without loss or duplication',
    literalText:
      'The same project resumed after `kill -9` mid-run continues without losing or duplicating work, ' +
      'verified by an automated crash-resume test.',
    mode: 'automated',
    commands: [
      {
        description:
          'crash-resume.test.ts (E3): a real child process SIGKILLed at 20 randomised points across 20 ' +
          'independent runs, each resumed and compared byte-for-byte against an uninterrupted control run',
        argv: vitest('packages/engine/test/e2e/crash-resume.test.ts'),
      },
    ],
  },
  {
    id: 'SC4',
    title: '`forge adopt` on a real >=50k-LOC repo, maintainer-judged accurate',
    literalText:
      '`forge adopt` on a real existing repo (>=50k LOC) produces a KB whose architecture and data ' +
      "model sections are judged accurate by the repo's maintainer, and a drift report.",
    mode: 'disclosed',
    disclosure:
      "This SC's own literal proof is a human judgment call by a real external maintainer against a " +
      'real >=50k-LOC repository FORGE does not own or control — structurally outside what any script ' +
      'run in this sandbox (or any CI job) can supply or fabricate a substitute for. No smaller ' +
      'in-repo fixture stands in for this; doing so would misrepresent the SC as met when it is not. ' +
      'What IS real, automated evidence: the full seven-phase adopt pipeline (SURVEY through BASELINE) ' +
      'runs end to end against a real (smaller) fixture repository and writes every real report/' +
      'artifact to disk, including the size-gate that specifically activates >=50k-LOC handling. ' +
      'Closing this gap for real requires a live run against a real external repository with a ' +
      "willing maintainer, recorded outside this script's scope.",
    commands: [
      {
        description:
          'adopt.test.ts: the real, end-to-end standard-depth pipeline (SURVEY..BASELINE)',
        argv: vitest('packages/cli/test/commands/adopt.test.ts'),
      },
      {
        description: 'adopt-discover.test.ts: real repository discovery/inventory',
        argv: vitest('packages/cli/test/commands/adopt-discover.test.ts'),
      },
    ],
  },
  {
    id: 'SC5',
    title: 'Both platform adapters pass the conformance suite; swapping platforms changes nothing',
    literalText:
      'Both the Claude Code adapter and the generic declarative CLI adapter (`07` §7.5, run against a ' +
      'real scripted binary) pass the adapter conformance suite; swapping platforms via config changes ' +
      'no workflow, agent, or artifact.',
    mode: 'disclosed',
    disclosure:
      "This SC's own literal text is two clauses, and neither is fully proven by the commands below. " +
      'Clause 1 ("both ... pass the adapter conformance suite"): the shared adapter-kit conformance ' +
      "suite both adapters are built from, and the generic declarative adapter's own conformance suite " +
      '(against a real scripted binary, `07` §7.5) DO run and pass for real here. The Claude Code ' +
      "adapter's own two conformance files, however, contain nothing but their own FORGE_LIVE-gated " +
      'test (confirmed by reading both files in full: `cli.conformance.test.ts` and ' +
      '`sdk.conformance.test.ts` each define exactly one `describe` block, itself entirely live-gated) ' +
      '-- there is no non-live-safe assertion in either file, so a real run of them in this environment ' +
      'genuinely executes zero real conformance assertions for the Claude Code adapter specifically ' +
      '(shown below as a real, named FAIL from the "at least one test must actually pass" check, not ' +
      'silently masked as a pass). Clause 2 ("swapping platforms via config changes no workflow, agent, ' +
      'or artifact") has no corresponding test anywhere in this repository at all -- a repo-wide search ' +
      'for a test that generates a workflow/agent/artifact once, swaps the configured platform, ' +
      'regenerates, and diffs the two outputs for identity found none (confirmed concretely, not by ' +
      'assumption). Reported DISCLOSED rather than fabricated as PASS.',
    commands: [
      {
        description:
          'adapter-claude-code CLI conformance suite -- entirely FORGE_LIVE-gated, no non-live-safe ' +
          'test exists in this file; expected to show 0 real passes without a live credential (see ' +
          'disclosure)',
        argv: vitest('packages/adapter-claude-code/test/conformance/cli.conformance.test.ts'),
      },
      {
        description:
          'adapter-claude-code SDK conformance suite -- same total live gating, same expected 0 passes',
        argv: vitest('packages/adapter-claude-code/test/conformance/sdk.conformance.test.ts'),
      },
      {
        description: 'adapter-generic conformance suite against a real scripted binary (`07` §7.5)',
        argv: vitest(
          'packages/adapter-generic/test/conformance/generic-adapter.conformance.test.ts',
        ),
      },
      {
        description: 'adapter-kit shared conformance suite both adapters are built from',
        argv: vitest('packages/adapter-kit/test/conformance'),
      },
    ],
  },
  {
    id: 'SC6',
    title: '`forge debug <symptom>` finds and fixes a bug with no human diagnosis',
    literalText:
      'A deliberately introduced bug in the generated system is found and fixed by `forge debug ' +
      '<symptom>` with an RCA record and a regression test, with no human diagnosis.',
    mode: 'automated',
    commands: [
      {
        description:
          'debug.test.ts: real ten-phase debug loop against a deliberately-seeded bug, ends `recorded` ' +
          'with a real schema-valid RCA-### record and a real fix committed to a real lane, entirely ' +
          "via the loop's own hypothesis/reproduce/fix machinery -- no human-supplied diagnosis",
        argv: vitest(
          'packages/cli/test/commands/loop/debug.test.ts',
          '-t',
          'recorded \\(real RCA-### artifact',
        ),
      },
    ],
  },
  {
    id: 'SC7',
    title: 'Gate enforcement: a failing gate refuses stage advance, visibly in the TUI',
    literalText:
      'All gates are enforceable: an attempt to advance a stage with a failing gate is refused, and the ' +
      "refusal is visible in the TUI with the failing check's output.",
    mode: 'automated',
    commands: [
      {
        description:
          'gate.test.ts (engine): `runGateStep` -- the real, run-blocking mechanism. A gate with a ' +
          'failing deterministic check produces a failed StepOutcome and emits GateRejected, which is ' +
          'what actually stops a run from advancing past it (SC7\'s own literal "an attempt to advance ' +
          'a stage with a failing gate is refused" clause). A fresh critic round found the previously ' +
          'cited `gate-commands.test.ts` command does NOT prove this -- `gateApprove` is an ' +
          'unconditional event-append with no check of the report at all, and `gateCheck` only reports ' +
          '`passed: false`, read-only, without refusing or blocking anything itself.',
        argv: vitest(
          'packages/engine/test/dispatch/gate.test.ts',
          '-t',
          'a gate with a failing deterministic check produces a failed outcome, emitting GateRejected',
        ),
      },
      {
        description:
          'gate-commands.test.ts: `gateCheck` reports `passed: false` for a real, failing shell check ' +
          '(the read-only evaluation the CLI and TUI both call to learn a gate is failing)',
        argv: vitest(
          'packages/cli/test/commands/run/gate-commands.test.ts',
          '-t',
          'evaluates a real gate with a real, failing shell check',
        ),
      },
      {
        description:
          "gates.test.tsx: the TUI's <GatesScreen> emits zero approve commands and renders the real " +
          'refusal reason when any deterministic check is failing',
        argv: vitest(
          'packages/tui/test/screens/gates.test.tsx',
          '-t',
          'emits nothing at all when any deterministic check is failing',
        ),
      },
    ],
  },
  {
    id: 'SC8',
    title: 'Cost ledger accuracy within 5%; budget caps abort runs',
    literalText:
      'Cost ledger accuracy: reported spend per run is within 5% of the sum of adapter-reported costs, ' +
      'and budget caps abort runs.',
    mode: 'automated',
    commands: [
      {
        description:
          'ledger.test.ts: `projectLedger`/`attributedSpend` reproduce the adapter-reported figure ' +
          'exactly (0% drift by construction -- a direct sum of real UsageRecorded events, never an ' +
          'estimate re-derivation), including multi-retry attribution',
        argv: vitest('packages/telemetry/test/ledger.test.ts'),
      },
      {
        description:
          's9-budget-enforcement.test.ts: a real perRunUsd cap halts a real run (RunFailed + ' +
          'BudgetBreached) before its next dependent step actually spends anything',
        argv: vitest(
          'packages/engine/test/security/s9-budget-enforcement.test.ts',
          '-t',
          'genuinely halts the run before its second, dependent step',
        ),
      },
      {
        description: 'breach.test.ts: a period-level breach always refuses a new run',
        argv: vitest('packages/engine/test/budget/breach.test.ts'),
      },
    ],
  },
  {
    id: 'SC9',
    title:
      'Org house-standards overlay: apply to a second project, survive a minor-version upgrade',
    literalText:
      'An organisation can express its house standards ... entirely in `.forge/overrides/`, share it ' +
      'as one overlay bundle, and apply it to a second project in one command. A minor-version upgrade ' +
      'preserves all of it and reports anything that no longer applies.',
    mode: 'disclosed',
    disclosure:
      'Applying a real overlay bundle to a project in one command IS proven for real below ' +
      '(`overlayAdd`, run twice against two independently-created temp projects, sharing one manifest ' +
      "shape with `moduleAdd`). What this repository's test suite does NOT contain is a single test " +
      'that chains that install onto a subsequent `forge upgrade` across a real minor-version bump and ' +
      'asserts the overlay survives AND that any-no-longer-applicable piece of it is reported by name -- ' +
      '`run-upgrade.test.ts` exercises regenerable-file conflict resolution (P3) but no overlay-specific ' +
      'preservation/staleness-reporting scenario. Recorded here rather than silently assumed proven.',
    commands: [
      {
        description:
          'overlay.test.ts: a real local overlay bundle installs end to end (manifest row + ' +
          '.forge/overlays content) in one command, sharing one manifest with moduleAdd',
        argv: vitest('packages/cli/test/commands/overlay.test.ts'),
      },
      {
        description:
          'run-upgrade.test.ts: `forge upgrade` regenerates/reconciles real project state',
        argv: vitest('packages/cli/test/commands/upgrade/run-upgrade.test.ts'),
      },
    ],
  },
  {
    id: 'SC10',
    title: 'Every taxonomy diagram exists, parses, and matches regeneration',
    literalText:
      'Every diagram required by the taxonomy (`08` §8.11.3) exists, parses, and — for generated ' +
      'diagrams — matches regeneration, so an architecture change that skips the diagram fails the gate.',
    mode: 'automated',
    commands: [
      {
        description: 'diagram.test.ts: the diagram artifact schema, real Mermaid parse validation',
        argv: vitest('packages/schemas/test/artifacts/diagram.test.ts'),
      },
      {
        description:
          'doctor/diagrams.test.ts: `checkDiagrams` -- validates every diagram actually present in ' +
          'the KB tree (parses, non-trivial caption, no orphan nodes), fails hard on a real invalid one',
        argv: vitest('packages/cli/test/commands/doctor/diagrams.test.ts'),
      },
      {
        description:
          'lint.test.ts (`diagram:required`): SC10\'s own literal "an architecture change that skips ' +
          'the diagram fails the gate" clause -- the real taxonomy-coverage rule (`08` §8.11.3) flags ' +
          'a missing required diagram at L2+ and is clean once the required diagram sources exist',
        argv: vitest('packages/kb/test/lint/lint.test.ts', '-t', 'diagram:required'),
      },
      {
        description: 'diagram.test.ts (cli): `forge diagram` regeneration matches or reports drift',
        argv: vitest('packages/cli/test/commands/diagram.test.ts'),
      },
    ],
  },
  {
    id: 'SC11',
    title: 'Every guardrail invariant I1-I12 enforced at compile time, refusal proven by test',
    literalText:
      'Every guardrail invariant (`15` §15.10, I1–I12) is enforced at compile time with a test proving ' +
      'a malicious or careless overlay is refused with the specific error code.',
    mode: 'automated',
    commands: [
      {
        description: 'separation.test.ts: I1 (CFG-501), I2 (CFG-502)',
        argv: vitest('packages/extensions/test/invariants/separation.test.ts'),
      },
      {
        description: 'gates.test.ts: I3 (GATE-501), I4 (GATE-502), I5 (GATE-503)',
        argv: vitest('packages/extensions/test/invariants/gates.test.ts'),
      },
      {
        description: 'traceability.test.ts: I6 (SPEC-501)',
        argv: vitest('packages/extensions/test/invariants/traceability.test.ts'),
      },
      {
        description:
          'security.test.ts: I7, I8, I9 -- registered as `CFG-507`/`CFG-508`/`CFG-509`, not the ' +
          "`SEC-501`/`SEC-502`/`SEC-503` codes `15` §15.10's own table gives them. A pre-existing, " +
          "already-recorded spec/implementation drift (`SPEC-QUESTIONS.md` Q40: `@forge/core/errors`' " +
          'closed error-code-prefix union has no `SEC` member at all, so I7-I9 shifted to `CFG` at ' +
          'M2 P8) -- not something this piece introduced or is in scope to resolve, but stated here ' +
          "with the real, currently-tested codes rather than the spec table's literal (untestable) ones.",
        argv: vitest('packages/extensions/test/invariants/security.test.ts'),
      },
      {
        description: 'governance.test.ts: I10 (CFG-503), I11 (CFG-504), I12 (CFG-505)',
        argv: vitest('packages/extensions/test/invariants/governance.test.ts'),
      },
      {
        description: 'run.test.ts: cross-invariant run-time wiring (I12 roster/level interaction)',
        argv: vitest('packages/extensions/test/invariants/run.test.ts'),
      },
    ],
  },
];

/** @param {readonly string[]} argv */
function isVitestCommand(argv) {
  return argv.some((part) => part.includes('run-tests.mjs'));
}

/**
 * True iff vitest's own real summary output reports at least one test that actually PASSED (not
 * merely "ran" and not merely "skipped" -- a `-t` pattern matching zero tests reports every test in
 * the file as skipped, with exit code 0, and never prints a "N passed" line at all). Exported so
 * `verify-success-criteria.test.ts` can assert this directly against real vitest output strings
 * captured from this repository, not a guessed format.
 *
 * @param {string} output
 */
export function hasRealPassedTests(output) {
  const match = /\bTests\s+(\d+)\s+passed\b/.exec(output);
  return match !== null && Number(match[1]) > 0;
}

/**
 * Runs one criterion's commands with the given `exec` (injectable so the pure evaluator can be
 * tested without spawning real subprocesses). `exec(argv) -> { ok, exitCode, output }`.
 *
 * @param {SCDefinition} definition
 * @param {(argv: readonly string[]) => { ok: boolean; exitCode: number|null; output: string }} exec
 * @returns {SCResult}
 */
export function evaluateCriterion(definition, exec) {
  /** @type {SCCommandResult[]} */
  const commandResults = [];
  let allOk = true;

  for (const command of definition.commands) {
    const { ok: execOk, exitCode, output } = exec(command.argv);
    let ok = execOk;
    let outputTail = output;

    // A `-t <pattern>`-filtered vitest run that matches zero tests exits 0 ("every test was filtered
    // out, none ran") -- indistinguishable from a real pass by exit code alone. Any command built by
    // this module's own `vitest()` helper (every SUCCESS_CRITERIA command is) is therefore only a real
    // PASS when vitest's own summary reports at least one test actually *passed*, not merely skipped.
    // Without this check a routine rename of the exact `it(...)` title a `-t` pattern targets would
    // silently turn "this SC's proof ran and passed" into "this SC's proof never ran at all" while
    // still reporting PASS -- confirmed concretely (not assumed) against a real vitest invocation.
    if (execOk && isVitestCommand(command.argv) && !hasRealPassedTests(output)) {
      ok = false;
      outputTail =
        `${output}\n\n[verify-success-criteria] REFUSED: exit 0 but no test actually passed -- ` +
        `the -t pattern (or file target) matched zero real tests. This proves nothing; treated as FAIL.`;
    }

    if (!ok) allOk = false;
    commandResults.push({
      description: command.description,
      argv: command.argv,
      ok,
      exitCode,
      outputTail: outputTail.length > 2000 ? outputTail.slice(-2000) : outputTail,
    });
  }

  /** @type {'PASS'|'FAIL'|'DISCLOSED'} */
  let verdict;
  if (definition.mode === 'disclosed') {
    verdict = 'DISCLOSED';
  } else {
    verdict = allOk ? 'PASS' : 'FAIL';
  }

  return {
    id: definition.id,
    title: definition.title,
    verdict,
    commandResults,
    ...(definition.disclosure ? { disclosure: definition.disclosure } : {}),
  };
}

/**
 * Runs every criterion in order and returns the full report plus an overall exit code: 0 iff no
 * `automated` criterion FAILed (a `DISCLOSED` verdict never fails the run -- it is an honest report,
 * not a defect).
 *
 * @param {readonly SCDefinition[]} definitions
 * @param {(argv: readonly string[]) => { ok: boolean; exitCode: number|null; output: string }} exec
 */
export function evaluateAll(definitions, exec) {
  const results = definitions.map((definition) => evaluateCriterion(definition, exec));
  const failed = results.filter((result) => result.verdict === 'FAIL');
  return { results, exitCode: failed.length === 0 ? 0 : 1, failed };
}

/** @param {readonly SCResult[]} results */
export function formatReport(results) {
  const lines = [];
  for (const result of results) {
    const badge =
      result.verdict === 'PASS' ? 'PASS' : result.verdict === 'FAIL' ? 'FAIL' : 'DISCLOSED';
    lines.push(`${result.id} [${badge}] ${result.title}`);
    for (const cmd of result.commandResults) {
      lines.push(`  - ${cmd.ok ? 'ok  ' : 'FAIL'} ${cmd.description}`);
      lines.push(`         $ ${cmd.argv.join(' ')} (exit ${String(cmd.exitCode)})`);
      if (!cmd.ok) {
        for (const outLine of cmd.outputTail.split('\n').slice(-15)) {
          lines.push(`         | ${outLine}`);
        }
      }
    }
    if (result.disclosure) {
      lines.push(`  disclosure: ${result.disclosure}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}
