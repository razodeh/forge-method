/**
 * `runTranslatorProof` -- `13` F-TEST-11's own translator proof: the one deterministic harness by
 * which any format that is not a built-in `TEST_REPORT_FORMATS` entry, whether hand- or
 * agent-written, is ever trusted. Runs the project's real test command, with a real,
 * deliberately-failing probe test added to it, and checks the resulting canonical report against the
 * run's own real, independent signals -- never the translator's own say-so.
 *
 * **The probe is mandatory, not an optional extra check.** `process/plans/PLAN-M17.md` P6's own named
 * mutation evidence is exactly this: a translator (or a built-in-format run) that reports every test
 * as `'pass'`, run against a project whose real baseline already has zero genuine failures, is
 * INDISTINGUISHABLE from a correct one by checks 1/2/4/5 alone -- the real exit code is 0 either way,
 * the (vacuous) report is schema-valid, deterministic and non-empty either way. Only forcing a real
 * failure to exist (the probe) gives checks 2 and 3 anything to actually catch it with. There is
 * therefore no `TranslatorProofInput` shape that omits a probe and still reaches `{ok: true}` --
 * `runTestAdoptCommand`/`adopt.ts` can propose a configuration with no proof at all (a bare
 * detection), but cannot produce a PASSING proof without one.
 *
 * **What each check actually inspects (`13` F-TEST-11's own five, applied against ONE real
 * probe-injected run of `command.run`, independently captured, plus a second run for determinism,
 * plus a THIRD, pre-probe baseline run check 3 also reads -- see point 3).**
 * Numbered to match the spec text exactly; EVALUATED in a different order (1, then 5, then 2, 3, 4)
 * -- check 5 runs right after schema validity, before checks 2 and 3. A fresh critic round confirmed
 * directly that BOTH of the other checks, not only check 3, have their own vacuous-overlap hazard
 * with an empty report, each in a different branch: check 3's probe-by-exact-name lookup is
 * trivially absent from a wholly empty report regardless of exit code; check 2's own
 * `exitCode !== 0 && !hasFail` branch ALSO fires on a wholly empty report whenever the real run's own
 * exit code is non-zero (the ordinary case, since the probe genuinely fails). Running check 5 last,
 * in literal spec order, would therefore make it unreachable as its own, distinct, by-number outcome
 * in EITHER exit-code shape -- caught at check 2 when the real exit code is non-zero, at check 3
 * when a lenient/broken runner always exits 0 regardless (this file's own dedicated mutation-evidence
 * test exercises exactly that second shape).
 * 1. *Schema validity* -- `runStructuredTestLayer`'s own `outcome: 'ran'` IS this check's pass
 *    condition: for a declared `translate`, that path already runs real `parseForgeTestReport`
 *    validation (`reporter.ts`'s own `runTranslator`) before ever returning `'ran'`; for a bare
 *    built-in format, every parser in `parsers/*.ts` constructs its result as a real
 *    `ForgeTestReportEntry[]` by TypeScript construction, a stronger guarantee than a redundant
 *    runtime re-validation of data this codebase's own type system already proves well-shaped.
 * 2. *Count reconciliation* -- the real run's own exit code (captured independently, by this module,
 *    never read off the translated report) is cross-checked against whether the canonical report
 *    contains a `'fail'`. A recognisable printed summary line (TAP's `# pass`/`# fail`, or a generic
 *    `"N passed"`/`"N failed"`) is cross-checked too, but only when one is actually found in the raw
 *    captured stdout -- there is no universal "summary line" shape across arbitrary raw formats, so
 *    this half of the check is best-effort and silently not-applicable otherwise, never a failure for
 *    a format that simply prints no such line.
 * 3. *The injected-failure probe* -- `probe.expectedName` must appear in the canonical report with
 *    `status: 'fail'`; `probe.expectedFile`, when given, is compared against the reported `file` only
 *    when the report actually carries one (a format that structurally cannot attribute files, e.g.
 *    TAP, never fails this half). ALSO: no OTHER test's status may differ between this run and a
 *    real baseline run taken BEFORE the probe was ever written to disk -- a fresh critic round built
 *    a real fixture proving the gap this closes: a translator that reports the probe correctly but
 *    SWAPS two unrelated real tests' own statuses (laundering a real failure as a pass, or framing an
 *    innocent pass as a failure) keeps every total balanced and the probe itself correct, so checks
 *    1/2/4/5 and the probe's own name/status/file alone all pass it. Comparing against a real,
 *    pre-probe baseline catches any such swap that is sensitive to the probe's own presence (an
 *    off-by-one or by-array-index translator bug, for instance, which shifts once one more entry --
 *    the probe -- is added to whatever it iterates). **Disclosed, not solved:** a translator whose
 *    mislabelling is a fixed, probe-independent function of a test's own stable name (e.g. "always
 *    swap the tests literally named X and Y, whatever else is present") produces the IDENTICAL wrong
 *    result in the baseline run too, so this check cannot see it -- closing that case completely would
 *    need the caller to supply ground truth for a meaningful sample of the REAL suite, not only one
 *    deliberately-failing probe, which this harness deliberately does not ask of whoever is proposing
 *    a configuration. `13` F-TEST-11 itself does not name this residual limit; it is recorded here as
 *    the honest boundary of what an injected probe (however many) can ever prove about tests it is
 *    not.
 * 4. *Determinism* -- a second, independent run of the identical command must yield the identical
 *    canonical report (`TestOutcome` carries no `durationMs` at all, so "ignoring durations" is true
 *    by construction, not a field this check has to mask).
 * 5. *The zero-tests guard* -- the canonical report is never empty once a probe was added to the run.
 *
 * **The "scratch lane" is the real project tree, not a separate worktree.** The probe is written with
 * `writeNewFileAtomic` (refusing, `RUN-158`, rather than silently overwriting a real file that happens
 * to share its path) and removed in a `finally` block. `QUALITY-BAR.md` R12 already requires every
 * host-project write to be containment-checked and atomic regardless of where it happens; the heavier
 * git-worktree lane `hunk-mutation.ts`/`binding.ts` use exists to REVERT real, pre-existing source
 * under test, a mutation this harness never performs -- it only adds one new, caller-named file and
 * takes it away again, which needs no worktree to be correct.
 *
 * **A SIGKILL between writing the probe and this function's own `finally` is reclaimed on the NEXT
 * call, not left behind forever.** A fresh critic round confirmed this directly with a real
 * detached-child-process SIGKILL repro (the same pattern `binding-sigkill.test.ts`/
 * `hunk-mutation-sigkill.test.ts` already use for the comparable git-worktree case) -- there is no
 * way to run cleanup code during an unstoppable kill itself, so a durable marker
 * (`PROOF_LOCK_REL_PATH`, `writeFileAtomic`, fsync'd before rename) records exactly which probe path
 * this invocation is about to write BEFORE it writes it; `reclaimStaleProbe` reads that marker back
 * at the START of every invocation (including the very next one after a crash) and removes whatever
 * it names before doing anything else. `adopt-agent.ts`'s own round loop (below) is this function's
 * one real production caller, so this path is genuinely reachable, not merely theoretical.
 *
 * **A model-reported probe colliding with its OWN, undeletable-by-it, same-round leftover is
 * reclaimed automatically, right before the write that would otherwise refuse it (M17 P21, a real
 * live-run defect, live-run fix 9).** `adopt-agent.ts`'s own round loop (P7's real caller, above)
 * runs this function inside a fresh `createLaneWorktree` checkout every round; a live agent session
 * that creates a probe file, watches it fail, then genuinely cannot delete it again (`rm`/
 * `git clean` are not in its own granted exec patterns, and non-interactive mode has no escalation
 * path) has no choice but to disclose the leftover and report the same path anyway. Reclaiming it
 * is still safe, and never reopens `Q348`'s own, separately-real incident (a model reporting a
 * genuinely pre-existing, already-committed project file), because `reclaimLaneLeftoverProbe`
 * (below) only ever removes a path it independently confirms is UNTRACKED in `cwd`'s own real git
 * state -- a structural fact about this round's own fresh lane, not a filename heuristic, and a
 * check that degrades to a safe no-op (never a deletion) the moment `cwd` is not a git repository
 * at all, exactly preserving this function's own "needs no worktree to be correct" design above for
 * every caller that genuinely has none.
 *
 * @see specs/13 F-TEST-11
 * @see specs/22 M17 P6
 */
import { createHash } from 'node:crypto';
import type { Stats } from 'node:fs';
import { lstat, rm } from 'node:fs/promises';

import { execa } from 'execa';

import { ForgeError } from '@forge/core/errors';
import { readTextFile, writeFileAtomic, writeNewFileAtomic } from '@forge/core/fs';
import type { AbsolutePath, ProjectPaths } from '@forge/core/fs';
import {
  ADOPT_TESTS_VET_GRANT,
  commandWords,
  runShellCommand,
  vetProposedCommand,
} from '@forge/engine/dispatch';
import type { StructuredTestCommand } from '@forge/schemas/config';

import {
  DEFAULT_TEST_RUN_TIMEOUT_MS,
  runStructuredTestLayer,
  type TestOutcome,
} from './reporter.ts';

/**
 * A deliberately failing test, written in the runner's own idiom and supplied by whoever proposed
 * the configuration (a human, or P7's `adopt-tests` agent) -- `13` F-TEST-11 check 3's own probe.
 * `path` is project-relative and must not already exist (this module refuses, `RUN-158`, rather than
 * overwrite it); it must be somewhere the configured command's own test discovery will actually find
 * it (a convention only the caller -- who knows this project's own glob/discovery rules -- can know,
 * never this module).
 */
export interface InjectedProbe {
  readonly path: string;
  readonly content: string;
  /** The exact `TestOutcome.name` the canonical report must carry this probe under. */
  readonly expectedName: string;
  /** The exact `TestOutcome.file` this probe's format is expected to attribute, in whatever shape
   * THIS command's format/translator reports `file` under (an absolute path, a dotted module path, a
   * package import path -- `reporter.ts`'s own `TestOutcome.file` doc comment has the full list; this
   * field is never normalised). Omitted when the format is not expected to carry file attribution at
   * all -- the comparison is skipped whenever the reported outcome has no `file` of its own, so a
   * format that structurally cannot attribute files never fails this half of check 3. */
  readonly expectedFile?: string;
}

/** Which of `13` F-TEST-11's five checks failed -- `1`-indexed to match the spec text exactly, so a
 * refusal's own `failedCheck` is directly cross-referenceable against it. */
export type ProofCheckNumber = 1 | 2 | 3 | 4 | 5;

/** `runTranslatorProof`'s own inputs. `translatorContent`, when given, is the translator script's
 * real, current bytes (`command.translate`'s own target file's content) -- `subjectHash` is computed
 * from it; omitted for a bare built-in-format command, which has no translator script to hash at all.
 * `runnerVersion` is caller-supplied -- the caller (`adopt-agent.ts`'s round loop) has ALREADY
 * vetted and really executed `runnerVersionCommand` itself (`captureRunnerVersion`, below) to obtain
 * it, never trusted it as the model's own free-text claim -- this keeps the harness a pure function
 * of its real inputs, with no opinion of its own about how a runner's version is obtained.
 * `runnerVersionCommand` is the exact command that produced `runnerVersion`, carried through
 * unexamined so `adopt.ts`'s own `evaluateTestAdoptionApproval` can re-run the IDENTICAL command
 * later to check the second half of `10` §10.3 rule 8 ("and the detected runner's own current
 * version") -- this was `10` §10.3 rule 8's own disclosed, unsolved half (`SPEC-QUESTIONS.md`
 * Q333); `captureRunnerVersion`'s own doc comment has the real mechanism that closes it.
 * `now`, per `QUALITY-BAR.md` R10, is an injected clock, never a direct `Date.now()`/`new Date()`
 * call in this file. */
export interface TranslatorProofInput {
  readonly command: StructuredTestCommand;
  readonly cwd: string;
  readonly paths: ProjectPaths;
  readonly createTempPath: () => string;
  readonly probe: InjectedProbe;
  readonly translatorContent?: string;
  readonly runnerVersion: string;
  readonly runnerVersionCommand: string;
  readonly now: () => string;
  /** The real environment every real run of `command.run` below executes with (`bin.ts`'s own
   * `realEnvSnapshot()`, R10). Absent (a bare, env-less test call): every `runShellCommand`/
   * `runStructuredTestLayer` call below keeps `shell: true` unconditionally — its own pre-existing
   * fallback, never a regression; only a caller that supplies a real one gets `resolvePosixShell`
   * consulted for it on Windows. */
  readonly env?: Readonly<Record<string, string>>;
}

/** The proof's own result -- `ok: true` carries the evidence `adopt.ts`'s staged proposal record
 * pins (`subjectHash`/`runnerVersion`/`runnerVersionCommand`/`checkedAt`, `13` F-TEST-11's own
 * "pinned to the translator's content hash and the runner's version"); `ok: false` is a typed
 * refusal naming the ONE check that failed, never a partial or best-effort pass, and still carries
 * the same evidence so a caller can tell a stale, outdated refusal from a fresh one. */
export type TranslatorProofResult =
  | {
      readonly ok: true;
      readonly subjectHash: string;
      readonly runnerVersion: string;
      readonly runnerVersionCommand: string;
      readonly checkedAt: string;
    }
  | {
      readonly ok: false;
      readonly failedCheck: ProofCheckNumber;
      readonly reason: string;
      readonly subjectHash: string;
      readonly runnerVersion: string;
      readonly runnerVersionCommand: string;
      readonly checkedAt: string;
    };

/** A real canonical serialisation -- object keys sorted recursively, so two semantically-identical
 * `StructuredTestCommand` values (differing only in which order their own keys happen to be built
 * in) hash identically. A fresh critic round confirmed `JSON.stringify` alone does not have this
 * property (it preserves insertion order), which would otherwise invalidate a passing proof's own
 * pin the moment the SAME command is merely reserialised -- a real re-staging, a config reformat --
 * with no semantic change to the subject at all. */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const record = value as Readonly<Record<string, unknown>>;
    const keys = Object.keys(record).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/** `13` F-TEST-11's own "pinned to the translator's own content hash" -- the translator script's real
 * bytes when one is declared; otherwise the proposed command's own canonical JSON (`canonicalJson`,
 * above), so a bare built-in-format proof still invalidates when the PROPOSAL itself changes (a
 * different `run`/`format`/`scope` is not the same proof subject, even with no translator to hash),
 * but reserialising the SAME proposal never spuriously does. */
export function computeProofSubjectHash(
  command: StructuredTestCommand,
  translatorContent?: string,
): string {
  const basis = translatorContent ?? canonicalJson(command);
  return createHash('sha256').update(basis).digest('hex');
}

/** `captureRunnerVersion`'s own result -- `ok: false` names why no real version could be captured
 * (a vet refusal, a timeout, or a command that printed nothing on either stream), never a thrown
 * exception: both of this function's two callers (`adopt-agent.ts`'s round loop, `adopt.ts`'s
 * `evaluateTestAdoptionApproval`) already have an established, typed way to turn "could not verify
 * this" into their own real outcome, and a throw here would force each to invent a redundant
 * try/catch around what is, for both of them, an ordinary, expected-to-sometimes-fail result.
 * `timedOut` is `true` only for the real timeout case -- carried as its own field, not folded into
 * `reason` text, so a caller building round feedback (`adopt-agent.ts`) can tell "this ran out of
 * time" (not necessarily the wrong command -- a fresh critic round traced a real, non-theoretical
 * cause: a fresh lane has no `node_modules` at all, `createLaneWorktree` is a plain `git worktree
 * add` that never installs one, so `npx vitest --version` can genuinely need to hit the real
 * registry, the identical cold-resolution risk `command.run` itself is already given up to
 * `DEFAULT_TEST_RUN_TIMEOUT_MS` for) apart from "this produced no usable output at all" (a
 * genuinely wrong command), without parsing its own prose. */
export type RunnerVersionCapture =
  | { readonly ok: true; readonly runnerVersion: string }
  | { readonly ok: false; readonly reason: string; readonly timedOut?: true };

/** The three package managers whose own CLI can intercept a trailing version flag meant for the
 * underlying test framework (`captureRunnerVersion`'s own doc comment, `SPEC-QUESTIONS.md` Q333
 * critic round 4; re-verified and rebuilt round 5 -- see `PACKAGE_MANAGER_VERSION_TRAP_FLAGS` below).
 * `bun` is deliberately not here: it is not in `ADOPT_TESTS_EXEC_PATTERNS` at all (no `bun test*`/
 * `bun run test*` pattern exists), so this shape cannot even be proposed for it under this grant --
 * nothing to refuse. */
const PACKAGE_MANAGER_VERSION_PROBE_VERBS: ReadonlySet<string> = new Set(['npm', 'pnpm', 'yarn']);

/**
 * Which `(program, form)` pair actually traps -- and with which exact flags -- re-derived ENTIRELY
 * from real execution (round 5), through the identical mechanism `runShellCommand` itself uses
 * (`execa(command, { cwd, shell: true, reject: false })`), against a real `package.json` whose
 * `"test"` script is a tiny program that echoes back its own received `argv` -- never assumed from
 * round 4's own, now-corrected, claims. The real table, confirmed live for npm 11.1.0/pnpm 9.15.5/
 * yarn classic 1.22.22 (the versions actually installed in this repo):
 *
 * | program | form (`test` / `run test`) | `--version` | `-v`   | `-V`                         |
 * |---------|-----------------------------|-------------|--------|------------------------------|
 * | npm     | bare                        | TRAP        | TRAP   | safe (see note 1)            |
 * | npm     | `run`                       | TRAP        | TRAP   | safe (see note 1)            |
 * | pnpm    | bare                        | TRAP        | TRAP   | TRAP (see note 2)            |
 * | pnpm    | `run`                       | safe        | safe   | safe                         |
 * | yarn    | bare                        | safe        | safe   | safe                         |
 * | yarn    | `run`                       | safe        | safe   | safe                         |
 *
 * "TRAP" = confirmed live: the real test script never runs at all; "safe" = confirmed live: the real
 * script DOES run, receiving the flag as a genuine `argv` token (or, for pnpm's `-V`/npm's `-V`, the
 * flag is absent from its own `argv` -- still "safe" in the one sense this module cares about: no
 * wrong version is ever silently captured, because the real script still runs and its real output,
 * not a package manager's own version string, is what gets captured).
 *
 * Note 1 -- npm recognises only lowercase `-v`/`--version` as its own global "print version and
 * exit" flag; `-V` (capital) is not one of npm's own flags at all (confirmed: a bare `npm -V` at the
 * top level, with no subcommand, prints npm's usage text, not a version, and exits `1`). npm's own
 * argv handling for `npm test`/`npm run test` silently DROPS any unrecognised flag that appears
 * before a literal `--` (confirmed: `npm test --versionish` runs the real script with an EMPTY
 * `argv`, the unrecognised flag simply vanishes) rather than forwarding it -- so `npm test -V` runs
 * the real script (with `-V` silently absorbed, not forwarded) rather than printing npm's own
 * version. Unhelpful as a version probe, perhaps, but not the dangerous "silently captures the wrong
 * thing as if it were right" shape this check exists to close, so it is deliberately not refused.
 *
 * Note 2 -- pnpm does not recognise `-V` either (confirmed: a bare `pnpm -V` at the top level also
 * errors), but UNLIKE npm, pnpm's own argv parser treats an unrecognised short flag in this exact
 * position as a hard error: `pnpm test -V` exits `1` with `"ERROR  Unknown option: 'V'"` on stderr,
 * the real script never running at all -- a different MECHANISM from `--version`/`-v` (an error, not
 * a leaked version), but the identical practical hazard: `captureRunnerVersion`'s own stdout-then-
 * stderr fallback would otherwise silently return that error text as if it were a real
 * `runnerVersion`. `-V` is therefore included in pnpm's own bare-form trap set even though, strictly,
 * nothing is "the package manager's own version" here.
 *
 * Every one of the "TRAP"/"safe" cells above was independently reconfirmed with the flag placed in
 * every token position among extra, non-flag tokens (`pnpm test -x --version`, `pnpm test --version
 * -x`, `npm run test a b -v c`, ...) and in both relative orders against a SECOND flag
 * (`yarn test -v -V --version`) -- a trap never became safe, and a safe form never became a trap,
 * regardless of where the flag sat or what else surrounded it. This is exactly why
 * `isPackageManagerVersionProbe` (below) scans every token, not merely an assumed fixed position --
 * round 4's own exact-tail-length check was bypassable by adding one harmless extra token
 * (`npm test --version --extra` still silently printed npm's own version despite failing that
 * length check), the actual security gap this round closes.
 *
 * Round 4's own claim that this was "confirmed live for all three [package managers]" was FALSE for
 * yarn: no test in that round actually executed `yarn test --version` and checked whose version came
 * out (the live-execution test that existed deliberately omitted the version flag). Yarn classic
 * 1.22.22 forwards `--version`/`-v`/`-V` to the real script, in BOTH the bare and `run test` forms,
 * exactly like an ordinary script argument -- round 4's refusal of all yarn shapes was a pure
 * usability regression with no actual safety behind it, now corrected. Round 4 also refused pnpm's
 * `run test` form outright, which round 5 found is equally wrong: pnpm forwards all three flags
 * correctly in that form too.
 */
const PACKAGE_MANAGER_VERSION_TRAP_FLAGS: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ['npm bare', new Set(['--version', '-v'])],
  ['npm run', new Set(['--version', '-v'])],
  ['pnpm bare', new Set(['--version', '-v', '-V'])],
  ['pnpm run', new Set()],
  ['yarn bare', new Set()],
  ['yarn run', new Set()],
]);

/**
 * Whether `command` is `(npm|pnpm|yarn) (run )?test ...` with one of that EXACT `(program, form)`
 * pair's own confirmed trap flags (`PACKAGE_MANAGER_VERSION_TRAP_FLAGS` above) appearing anywhere
 * among the tokens between `test` and either the end of the command or a literal `--` separator,
 * whichever comes first -- never merely the immediately-following token, and never a fixed tail
 * length, so one harmless extra token on either side of the flag (`npm test --version --extra`,
 * `npm test --extra --version`, `npm run test a b -v c`) can never silently evade this (round 4's own
 * bypass, closed here). A literal `--` ends the scan because everything after it is forwarded
 * verbatim to the real script by the package manager itself, never parsed as the package manager's
 * own flag (confirmed live for every one of npm/pnpm/yarn, both forms: `npm test -- --version` runs
 * the real script with `--version` as a genuine `argv` token, never npm's own version). Parsed with
 * `commandWords` (`confined-command.ts`'s own syntax stage, already run by `vetProposedCommand`
 * above) rather than a raw string match, so this cannot be fooled by extra whitespace or a quoting
 * shape the real vet itself would not have accepted either.
 */
function isPackageManagerVersionProbe(command: string): boolean {
  const words = commandWords(command);
  if (words === undefined) return false;
  const [program, ...rest] = words;
  if (program === undefined || !PACKAGE_MANAGER_VERSION_PROBE_VERBS.has(program)) return false;
  const isRunForm = rest[0] === 'run';
  const afterRun = isRunForm ? rest.slice(1) : rest;
  if (afterRun[0] !== 'test') return false;
  const trapFlags = PACKAGE_MANAGER_VERSION_TRAP_FLAGS.get(
    `${program} ${isRunForm ? 'run' : 'bare'}`,
  );
  if (trapFlags === undefined || trapFlags.size === 0) return false;
  const tail = afterRun.slice(1);
  const literalSeparatorIndex = tail.indexOf('--');
  const scanned = literalSeparatorIndex === -1 ? tail : tail.slice(0, literalSeparatorIndex);
  return scanned.some((word) => trapFlags.has(word));
}

/**
 * Executes `runnerVersionCommand` for real at `cwd`, bounded by `timeoutMs`, and returns its own
 * real, current output as the runner's version -- the one, previously-missing mechanism `10` §10.3
 * rule 8's own second half ("and the detected runner's own current version") needs, closing
 * `SPEC-QUESTIONS.md` Q333's own disclosed gap (verified, not merely accepted: before this,
 * `runnerVersion` was the model's own bare, unverified free-text claim in `adopt-agent.ts`'s
 * structured response -- never independently obtained by FORGE at all, the identical "self-reported,
 * trusted on its word" shape `13` F-TEST-11's own Decision 1 already refused to accept for the
 * command FORGE actually runs).
 *
 * **`timeoutMs` is the caller's own real risk budget, never a fixed guess here.** A first version of
 * this function picked its own fixed, short bound (30s) -- a fresh critic round found this a real,
 * not merely theoretical, asymmetry: `runnerVersionCommand` faces the IDENTICAL cold-resolution risk
 * `command.run` itself does (a fresh, `node_modules`-less lane, `npx` hitting the real registry),
 * which is exactly why `command.run` is already given up to `DEFAULT_TEST_RUN_TIMEOUT_MS` (20
 * minutes) by default. Both real callers now pass `command.timeoutMs ?? DEFAULT_TEST_RUN_TIMEOUT_MS`
 * -- the SAME effective bound the real run this version command accompanies already gets, never a
 * smaller, independently-chosen one that could time out first on the exact same cold state.
 *
 * **Vets first, every call, independently of whatever vetted it before.** `runnerVersionCommand` is
 * still a model-proposed string that is about to be really executed, so it is held to the IDENTICAL
 * `ADOPT_TESTS_VET_GRANT`/`vetProposedCommand` containment check every other live-executed field in
 * this flow already is (`vetProposedTestCommand`'s own doc comment) -- never trusted merely because
 * it passed that same check once before, at proof time, under a DIFFERENT root (the lane, not the
 * real project `evaluateTestAdoptionApproval` re-checks it against later). A refusal here is real,
 * actionable data for the caller (a hard stop at proof time, a "cannot re-verify" refusal at check
 * time), never silently swallowed.
 *
 * **Stdout first, stderr as a fallback, never both.** Most conventional `--version` invocations
 * print to stdout; a few tools print it to stderr instead (several Java-ecosystem wrappers do) --
 * falling back only when stdout is empty, rather than concatenating both, keeps the captured value
 * exactly what a human reading the SAME command's own terminal output would see, never a
 * two-stream splice nothing printed as one string.
 *
 * `ok: false` (never a thrown exception) for: a vet refusal; a real timeout (`timedOut: true`); or a
 * command that produced no output on either stream (an unconventional tool whose actual version flag
 * differs from what was proposed, say) -- any of these is the proposed command's own problem, never
 * this function's to paper over with a guess.
 *
 * **Refuses a CONFIRMED-TRAP `(npm|pnpm|yarn) (run )?test ...` shape outright, after the vet above,
 * before ever running it (`SPEC-QUESTIONS.md` Q333, critic round 4; re-verified and rebuilt round
 * 5).** `ADOPT_TESTS_EXEC_PATTERNS` (`npm test*`/`pnpm test*`/`yarn test*`/the `run test` forms)
 * genuinely ALLOWS this shape, and `vetProposedCommand` genuinely EXECUTES it --
 * `vetNetworkAndArguments`'s own shared `PACKAGE_MANAGERS` check exempts a bare `test`/`run test`
 * verb for npm/pnpm/yarn specifically (unlike `cargo`, which it refuses unconditionally). The problem
 * is not the vet: it is that npm's and pnpm's own CLI can intercept a trailing `--version`/`-v`/`-V`
 * before the project's real test script ever runs at all, silently returning the PACKAGE MANAGER's
 * own version (or, for pnpm's `-V`, a parse error) as if it were the real one.
 *
 * **Not all three package managers, and not both forms, actually do this -- round 4's own blanket
 * refusal of every npm/pnpm/yarn shape, and its own claim this was "confirmed live for all three,"
 * were both wrong, corrected round 5 by real execution against a real `package.json` (see
 * `PACKAGE_MANAGER_VERSION_TRAP_FLAGS`'s own doc comment, below, for the full re-derived table and
 * the live-execution evidence behind every cell of it).** Only npm (both the bare and `run test`
 * form, for `--version`/`-v`) and pnpm's BARE form (`--version`/`-v`/`-V`) are real traps. pnpm's
 * explicit `run test` form forwards the flag to the real script correctly, and yarn classic 1.22.22
 * (the version installed in this repo) forwards it correctly in BOTH forms -- refusing those was a
 * pure usability regression with no actual safety behind it. `isPackageManagerVersionProbe` below
 * scans every token between `test` and a literal `--` (never a fixed tail length, which round 4's own
 * check used and which one extra token -- `npm test --version --extra` -- was enough to bypass while
 * npm still genuinely intercepted for real), so an ordinary `npm test`/`pnpm test` used as the real
 * `run`/`filter` field is never touched by this check regardless -- those fields are never passed to
 * this function at all (its two real callers, `adopt-agent.ts`'s round loop and `adopt.ts`'s
 * `evaluateTestAdoptionApproval`, pass only `runnerVersionCommand`). Deliberately placed here rather
 * than in `confined-command.ts`'s own `vetNetworkAndArguments`/`PACKAGE_MANAGERS` (shared
 * infrastructure every other grant role is also vetted against -- too broad a blast radius for this
 * one field) -- a small, self-contained refusal scoped entirely to this one call, reached by both of
 * this function's real callers so neither can independently drift out of sync with the other.
 */
export async function captureRunnerVersion(
  runnerVersionCommand: string,
  cwd: string,
  timeoutMs: number,
): Promise<RunnerVersionCapture> {
  const refusal = await vetProposedCommand(runnerVersionCommand, ADOPT_TESTS_VET_GRANT, cwd);
  if (refusal !== undefined) {
    return { ok: false, reason: refusal.detail };
  }
  if (isPackageManagerVersionProbe(runnerVersionCommand)) {
    return {
      ok: false,
      reason:
        `"${runnerVersionCommand}" asks the package manager for ITS OWN version, not the test ` +
        "framework's: confirmed live, this exact (program, form) pair either intercepts the flag " +
        "and prints the package manager's own version, or fails outright, before the project's " +
        'real test script ever runs. Propose the framework\'s own version flag instead (e.g. "npx ' +
        'vitest --version"), use "pnpm run test --version"/"yarn test --version" (confirmed to ' +
        'forward correctly), or fall back to "cat package.json".',
    };
  }
  const result = await runShellCommand(runnerVersionCommand, cwd, undefined, { timeoutMs });
  if (result.timedOut === true) {
    return {
      ok: false,
      reason: `the command did not complete within ${String(timeoutMs)}ms.`,
      timedOut: true,
    };
  }
  const stdout = result.stdout.trim();
  const captured = stdout !== '' ? stdout : result.stderr.trim();
  if (captured === '') {
    return { ok: false, reason: 'the command produced no output on stdout or stderr.' };
  }
  return { ok: true, runnerVersion: captured };
}

/** `runTranslatorProof`'s own crash-recovery marker (`PROOF_LOCK_REL_PATH`, below) -- names exactly
 * which probe path an invocation is about to write, read back by the NEXT invocation to reclaim a
 * probe a SIGKILL left behind between writing it and this file's own `finally` cleanup. */
interface ProofProbeLock {
  readonly probePath: string;
}

function isProofProbeLock(value: unknown): value is ProofProbeLock {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Readonly<Record<string, unknown>>)['probePath'] === 'string'
  );
}

/** Committed nowhere -- a transient, `.forge/`-scoped marker this module alone reads and writes,
 * never a project artifact `13` F-TEST-11 itself names. Lives alongside the staged proposals
 * (`adopt.ts`'s own `PROPOSAL_ROOT`) rather than under `.forge/state/`, which `resolveWithin`'s own
 * deny list reserves for the run's internal event log and lock file, neither of which this is. */
const PROOF_LOCK_REL_PATH = '.forge/test-adopt/.proof-probe.lock.json';

/** Reclaims a probe a PRIOR `runTranslatorProof` invocation left behind on disk after being
 * SIGKILLed between writing it and reaching its own `finally` -- confirmed necessary by a fresh
 * critic round's own real detached-child-process SIGKILL repro (this file's own doc comment has the
 * full reasoning). Reads `PROOF_LOCK_REL_PATH` back; when it names a real, readable marker, removes
 * the probe path it recorded and the marker itself before this invocation writes anything of its
 * own. Never throws: an absent or unreadable marker means nothing to reclaim, the ordinary case for
 * every invocation that was not itself killed mid-run. */
async function reclaimStaleProbe(paths: ProjectPaths): Promise<void> {
  const lockPath = paths.resolveWithin(PROOF_LOCK_REL_PATH);
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readTextFile(lockPath));
  } catch {
    return;
  }
  if (isProofProbeLock(parsed)) {
    try {
      await rm(paths.resolveWithin(parsed.probePath), { force: true });
    } catch {
      // A recorded path that no longer resolves safely (CFG-003/CFG-004) leaves nothing more this
      // function can remove -- the stale probe, whatever became of it, is not this call's problem.
    }
  }
  await rm(lockPath, { force: true });
}

/** Whether `relativePath` is confirmed UNTRACKED in the real git repository rooted at `cwd` --
 * `true` only for `git`'s own documented "a real repo, but this exact pathspec matches no file(s)
 * known to git" outcome (`git ls-files --error-unmatch`'s own exit code `1`); `false` for every
 * other outcome, including the positive "this path IS tracked" case (exit `0`) and every case this
 * function cannot actually confirm one way or the other (`cwd` is not a git repository at all --
 * exit `128` -- the `git` binary itself is missing, or any other spawn surprise). Deliberately
 * fails CLOSED: a caller only ever uses `true` here as a licence to delete something, so "I don't
 * know" and "it IS tracked" must collapse to the identical, safe answer (`false`, meaning: leave it
 * alone, exactly like a plain, non-git project tree always has). Confirmed directly, with a real
 * `git init`/`add`/`commit` repo plus a real `git worktree add` lane off it (this fix's own real
 * experiment, not an assumption): a tracked file exits `0`, an untracked one exits `1` with git's
 * own "did not match any file(s) known to git" on stderr, and a bare non-repo directory exits `128`
 * with "fatal: not a git repository" -- three genuinely distinct, never-ambiguous outcomes.
 *
 * `--literal-pathspecs` (a top-level `git` flag, checked separately, by real experiment, to behave
 * identically to its absence for every ordinary path this module ever sees): `relativePath` is a
 * model-reported string, never one this module controls, so a caller could in principle report a
 * value starting with git's own pathspec-magic syntax (`:(exclude)...`, `:(icase)...`, ...) --
 * disabling it closes even the theoretical possibility of such a string being interpreted as
 * anything other than one literal, ordinary path, the identical property `lstat`/`rm` below
 * already have for free (plain filesystem joins, never pathspec-aware). */
async function isConfirmedUntrackedInGit(cwd: string, relativePath: string): Promise<boolean> {
  try {
    const result = await execa(
      'git',
      ['--literal-pathspecs', 'ls-files', '--error-unmatch', '--', relativePath],
      { cwd, reject: false },
    );
    return result.exitCode === 1;
  } catch {
    return false;
  }
}

/** Reclaims `probePath` -- BEFORE `writeNewFileAtomic` ever attempts to write it -- when, and only
 * when, it is this round's OWN leftover from the live agent session that ran in this exact `cwd`
 * just before this call: something the model's own tool-use wrote to disk during investigation
 * (a deliberately-failing probe, per the brief), then tried and failed to delete again (`rm`/
 * `git clean` are not in `ADOPT_TESTS_EXEC_PATTERNS`, so a live, non-interactive session has
 * genuinely no tool of its own that can unlink a file it created), and finally reported anyway
 * rather than silently drop the disclosure (M17 P21, a real live-run defect, live-run fix 9).
 *
 * **Why "untracked in `cwd`'s own git state" is the right, and only, signal, not a heuristic.**
 * `runTranslatorProof`'s one production caller (`adopt-agent.ts`) always runs this inside a FRESH
 * `createLaneWorktree` checkout (`@forge/vcs`'s own `git worktree add -b <branch> <path>
 * <resolvedBase>`): by construction, the only things that can ever exist on disk in that lane are
 * (a) whatever was already committed into the checked-out revision -- genuinely TRACKED, by
 * definition -- and (b) whatever THIS round's own live session wrote during investigation, which is
 * necessarily UNTRACKED (nothing else in this flow ever runs `git add`/`git commit` inside the
 * lane). "Untracked" is therefore not a proxy or a best guess for "the model's own this-round
 * leftover" -- it is the literal, structural definition of it, confirmed against the real
 * `createLaneWorktree` source and a real worktree experiment, not merely asserted.
 *
 * **Why this cannot reopen `Q348`.** `Q348`'s own incident (`process/SPEC-QUESTIONS.md`) is a model
 * reporting a REAL, already-committed project file (`specs/strings.spec.js`, in the fixture that
 * motivated it) as its probe path -- exactly the TRACKED case this function returns `false` for,
 * every time, by construction: a committed file is never untracked in the lane that checked it out.
 * `writeNewFileAtomic`'s own refusal (`RUN-158`) is therefore completely unchanged for that case --
 * this function removes nothing and `runTranslatorProof` proceeds exactly as it did before this fix.
 *
 * **Why this does not need, and deliberately avoids, a new model-grantable `rm`/`git clean`.**
 * Granting either as a live exec pattern (`ADOPT_TESTS_EXEC_PATTERNS`) would hand the model itself a
 * new, narrowly-scoped but real file-deletion capability, reopening a DIFFERENT, separate concern
 * (`Q347`'s own live-exec permission-boundary investigation) for a problem FORGE's own code can
 * instead close with zero new capability granted to the model at all: this check runs entirely in
 * FORGE's own process, against FORGE's own read of the lane's real git state, never through any
 * tool the model itself invokes.
 *
 * Never throws: a reported path that no longer resolves safely, names a directory rather than a
 * plain file (a live session's own tool-use can only ever have written a FILE as its probe, per the
 * brief, so anything else at this path is not this step's leftover to remove at all), or hits any
 * other surprise, leaves nothing for THIS step to remove -- `writeNewFileAtomic` right after it is
 * still the one real, load-bearing check, exactly as before this fix. A first version of this
 * function reclaimed ANY untracked path regardless of type, which crashed the whole round loop
 * uncaught (`rm` with no `recursive: true` throwing `ERR_FS_EISDIR` on a directory, never caught as
 * `RUN-114`/`RUN-158`/`CFG-003`/`CFG-004`) -- a real regression TWO independent critics each found
 * by direct, reproduced experiment, worse than this fix's own starting point (that collision used to
 * reach `writeNewFileAtomic` and refuse cleanly, the same as any other). Fixed by checking the real
 * file TYPE, not just existence, and by never letting the removal step itself throw past this
 * function's own boundary. */
async function reclaimLaneLeftoverProbe(
  cwd: string,
  probePath: AbsolutePath,
  relativePath: string,
): Promise<void> {
  let stats: Stats;
  try {
    stats = await lstat(probePath);
  } catch {
    return;
  }
  if (!stats.isFile()) return;
  if (!(await isConfirmedUntrackedInGit(cwd, relativePath))) return;
  try {
    await rm(probePath, { force: true });
  } catch {
    // Left for `writeNewFileAtomic` to refuse, exactly as before this fix -- this step's own job is
    // a best-effort cleanup, never a second place the caller's own collision check can be bypassed.
  }
}

/** Best-effort pass/fail totals read off a raw run's own captured stdout, for check 2's optional
 * summary-line half -- TAP's own `# pass N`/`# fail N` lines, else a generic `"N passed"`/`"N
 * failed"` pattern common to many ad hoc and script-based runners. `undefined` when neither is
 * found, which this module's own caller treats as "not applicable", never as a failure. */
function extractSummaryCounts(
  raw: string,
): { readonly pass: number; readonly fail: number } | undefined {
  const tapPass = /^#\s*pass\s+(\d+)/im.exec(raw);
  if (tapPass !== null) {
    const tapFail = /^#\s*fail\s+(\d+)/im.exec(raw);
    return { pass: Number(tapPass[1]), fail: tapFail === null ? 0 : Number(tapFail[1]) };
  }
  const genericPass = /(\d+)\s+passed\b/i.exec(raw);
  if (genericPass !== null) {
    const genericFail = /(\d+)\s+failed\b/i.exec(raw);
    return {
      pass: Number(genericPass[1]),
      fail: genericFail === null ? 0 : Number(genericFail[1]),
    };
  }
  return undefined;
}

function countByStatus(outcomes: readonly TestOutcome[], status: TestOutcome['status']): number {
  return outcomes.filter((outcome) => outcome.status === status).length;
}

/**
 * Runs `input.command`'s own translator proof (`13` F-TEST-11) -- see this file's own doc comment
 * for what each of the five checks actually inspects. Never throws for an ordinary proof failure
 * (every one of the five is a real, typed `{ok: false, failedCheck, reason}`); a genuine
 * infrastructure failure propagates as a real `ForgeError` -- `RUN-158` when the probe's own path
 * already exists, or whatever `ProjectPaths.resolveWithin` already raises (`CFG-003`/`CFG-004`) for
 * a path escape.
 */
export async function runTranslatorProof(
  input: TranslatorProofInput,
): Promise<TranslatorProofResult> {
  const {
    command,
    cwd,
    paths,
    createTempPath,
    probe,
    translatorContent,
    runnerVersion,
    runnerVersionCommand,
    now,
    env,
  } = input;
  const subjectHash = computeProofSubjectHash(command, translatorContent);
  const checkedAt = now();
  const fail = (failedCheck: ProofCheckNumber, reason: string): TranslatorProofResult => ({
    ok: false,
    failedCheck,
    reason,
    subjectHash,
    runnerVersion,
    runnerVersionCommand,
    checkedAt,
  });

  const timeoutMs = command.timeoutMs ?? DEFAULT_TEST_RUN_TIMEOUT_MS;
  const probePath = paths.resolveWithin(probe.path);
  const lockPath = paths.resolveWithin(PROOF_LOCK_REL_PATH);

  // Reclaims whatever a PRIOR, SIGKILLed invocation left behind before this one writes anything of
  // its own (this file's own doc comment has the full reasoning) -- always first, even though this
  // invocation's own probe path may differ from whatever is reclaimed here.
  await reclaimStaleProbe(paths);

  // Check 3's own baseline half (below) needs the project's real, PRE-probe behaviour -- captured
  // before the probe exists on disk at all, never after.
  const baselineRun = await runStructuredTestLayer(
    command,
    cwd,
    paths,
    createTempPath,
    undefined,
    env,
  );

  // The marker is written and fsync'd (`writeFileAtomic`) BEFORE the probe itself, so a SIGKILL at
  // any point from here onward always leaves a marker naming a probe path the next invocation can
  // find and remove -- never the reverse (a probe with no marker, which nothing would ever reclaim).
  await writeFileAtomic(lockPath, JSON.stringify({ probePath: probe.path }));
  try {
    // Reclaims `probePath` when, and only when, it is THIS round's own untracked leftover in `cwd`'s
    // own real git state -- a model-reported probe path colliding with its own already-created, but
    // undeletable-by-it, scratch file (M17 P21, live-run fix 9; `reclaimLaneLeftoverProbe`'s own doc
    // comment has the full reasoning, including why a genuinely TRACKED collision, `Q348`'s own
    // incident, is never touched here and still reaches `writeNewFileAtomic`'s own `RUN-158` below,
    // completely unchanged).
    await reclaimLaneLeftoverProbe(cwd, probePath, probe.path);
    // `writeNewFileAtomic`, not `writeFileAtomic`: a probe path that already names a real file is a
    // caller mistake (it would silently stand in for -- and then this function would delete --
    // content that was never the caller's scratch probe at all), refused rather than clobbered. The
    // lock is removed before this re-throws: nothing was actually written yet, so there is nothing
    // for a future invocation to reclaim, and leaving the marker behind would make it wrongly delete
    // the REAL, pre-existing file this threw about in the first place.
    await writeNewFileAtomic(probePath, probe.content);
  } catch (cause) {
    await rm(lockPath, { force: true });
    // `writeNewFileAtomic`'s own `RUN-114` is written for the `MutationEvidence`/`EvidenceBundle`
    // append-only family ("a new id or timestamp") and reads as nonsense for a probe collision,
    // which is neither append-only nor identified by an id or a timestamp -- a fresh critic round
    // flagged this directly. Re-thrown as `RUN-158`, naming the real cause, with the original
    // preserved as `cause`; anything else (a path escape, `CFG-003`/`CFG-004`) passes through as-is.
    if (cause instanceof ForgeError && cause.code === 'RUN-114') {
      throw new ForgeError('RUN-158', { path: probe.path }, { cause });
    }
    throw cause;
  }
  try {
    // Captured independently of `runStructuredTestLayer`'s own translate/parse pipeline -- the one
    // signal every check below cross-validates the canonical report against, never read off the
    // translator's own output (which is exactly what this harness exists to not trust blindly).
    const raw = await runShellCommand(command.run, cwd, env, { timeoutMs });
    const firstRun = await runStructuredTestLayer(
      command,
      cwd,
      paths,
      createTempPath,
      undefined,
      env,
    );
    const secondRun = await runStructuredTestLayer(
      command,
      cwd,
      paths,
      createTempPath,
      undefined,
      env,
    );

    // Check 1 -- schema validity (this file's own doc comment, point 1).
    if (firstRun.outcome !== 'ran') {
      return fail(
        1,
        `the configured layer did not produce a schema-valid forge-test-report at all: ${firstRun.message}.`,
      );
    }
    const outcomes = firstRun.report.outcomes;

    // Check 5 -- the zero-tests guard, evaluated here (right after schema validity), deliberately
    // out of literal spec order -- this file's own doc comment explains why, for both of the other
    // checks it would otherwise be shadowed by.
    if (outcomes.length === 0) {
      return fail(
        5,
        'the canonical report contains zero tests, even though the injected-failure probe was added to this run (the zero-tests guard).',
      );
    }

    // Check 2 -- count reconciliation. The exit-code half is mandatory (unless the real run itself
    // timed out, in which case there is no real exit code to reconcile against at all, and the
    // remaining checks below -- especially check 3 -- already fail the proof honestly on their own
    // terms). The summary-line half is best-effort.
    if (raw.timedOut !== true) {
      const hasFail = outcomes.some((outcome) => outcome.status === 'fail');
      if (raw.exitCode === 0 && hasFail) {
        return fail(
          2,
          'the real run exited 0 (success) but the canonical report contains a "fail" outcome -- counts do not reconcile.',
        );
      }
      if (raw.exitCode !== 0 && !hasFail) {
        return fail(
          2,
          `the real run exited ${String(raw.exitCode)} (failure) but the canonical report contains no "fail" outcome at all -- counts do not reconcile.`,
        );
      }
      const summary = extractSummaryCounts(raw.stdout);
      if (summary !== undefined) {
        const reportedPass = countByStatus(outcomes, 'pass');
        const reportedFail = countByStatus(outcomes, 'fail');
        if (summary.pass !== reportedPass || summary.fail !== reportedFail) {
          return fail(
            2,
            `the real run's own printed summary reports pass=${String(summary.pass)}/fail=${String(summary.fail)}, but the canonical report counts pass=${String(reportedPass)}/fail=${String(reportedFail)}.`,
          );
        }
      }
    }

    // Check 3 -- the injected-failure probe, by exact name (this file's own doc comment, point 3).
    const probeOutcome = outcomes.find((outcome) => outcome.name === probe.expectedName);
    if (probeOutcome === undefined) {
      return fail(
        3,
        `the injected-failure probe ("${probe.expectedName}") does not appear in the canonical report by its exact name at all.`,
      );
    }
    if (probeOutcome.status !== 'fail') {
      return fail(
        3,
        `the injected-failure probe ("${probe.expectedName}") is reported as "${probeOutcome.status}", not "fail".`,
      );
    }
    if (
      probe.expectedFile !== undefined &&
      probeOutcome.file !== undefined &&
      probeOutcome.file !== probe.expectedFile
    ) {
      return fail(
        3,
        `the injected-failure probe's file attribution ("${probeOutcome.file}") does not match the expected file ("${probe.expectedFile}").`,
      );
    }
    // Check 3, extended -- no OTHER test's own status may differ from a real, pre-probe baseline
    // (this file's own doc comment, point 3, has the full reasoning and the disclosed residual
    // limit). Best-effort: a baseline that itself could not be read (`outcome !== 'ran'`) leaves
    // nothing real to compare against, so this half is skipped rather than failed on its own.
    if (baselineRun.outcome === 'ran') {
      const baselineStatusByName = new Map(
        baselineRun.report.outcomes.map((outcome) => [outcome.name, outcome.status]),
      );
      for (const outcome of outcomes) {
        if (outcome.name === probe.expectedName) continue;
        const baselineStatus = baselineStatusByName.get(outcome.name);
        if (baselineStatus !== undefined && baselineStatus !== outcome.status) {
          return fail(
            3,
            `"${outcome.name}" is reported as "${outcome.status}" with the probe added, but was "${baselineStatus}" on a real baseline run taken before the probe existed -- nothing about adding an unrelated test should change this one's own status, so the translator may be misattributing results between tests.`,
          );
        }
      }
    }

    // Check 4 -- determinism: a second, independent run must yield the identical canonical report.
    if (secondRun.outcome !== 'ran') {
      return fail(
        4,
        `the second (determinism) run did not produce a report at all: ${secondRun.message}.`,
      );
    }
    if (JSON.stringify(secondRun.report.outcomes) !== JSON.stringify(outcomes)) {
      return fail(
        4,
        'two consecutive runs of the identical command produced different canonical reports.',
      );
    }

    return { ok: true, subjectHash, runnerVersion, runnerVersionCommand, checkedAt };
  } finally {
    await rm(probePath, { force: true });
    await rm(lockPath, { force: true });
  }
}
