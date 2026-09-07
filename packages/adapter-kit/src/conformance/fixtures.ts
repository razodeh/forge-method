/**
 * `ConformanceOptions` and the small set of fixed, suite-owned constants a caller's own fixture prompts
 * reference — a generic, adapter-agnostic suite cannot itself supply a natural-language prompt that
 * reliably elicits a specific behaviour from an arbitrary adapter (a scripted fake adapter and a real
 * platform need different literal text for the same effect), so every behaviour C1–C16 needs elicited
 * is a caller-supplied fixture instead.
 *
 * @see specs/07 §7.6
 * @see SPEC-QUESTIONS.md Q60
 * @see PLAN-M4.md P4
 */
import type { JSONSchema } from '../types/json-schema.ts';
import type { GrantedMcpServer, ResolvedSkill } from '../types/provisioning.ts';

/** C2/C3/C12/C14's own shared "did a file actually get written" fixture: the relative path (from the
 * session's `cwd`) and content a `writeFilePrompt` should elicit the adapter to create. */
export const CONFORMANCE_WRITE_FILE_RELATIVE_PATH = 'conformance-write-test.txt';
export const CONFORMANCE_WRITE_FILE_CONTENT = 'forge-conformance-marker';

/** C4's own fixture, `07` §7.6's own literal worked example, not invented: `exec:["echo *"]` permits
 * `echo hi`, blocks `rm -rf`. `execPrompt` should ask the adapter to run both. The denied command
 * targets the canary file below, which "denied" is asserted against (its continued existence), since no
 * field of `AdapterEvent`'s `tool.call` variant names the command in a typed way (`SPEC-QUESTIONS.md`
 * Q60 point 3). */
export const CONFORMANCE_EXEC_ALLOWED_COMMAND = 'echo hi';
export const CONFORMANCE_EXEC_CANARY_RELATIVE_PATH = 'conformance-canary.txt';
export const CONFORMANCE_EXEC_DENIED_COMMAND = `rm -rf ${CONFORMANCE_EXEC_CANARY_RELATIVE_PATH}`;

export interface ConformanceStructuredFixture {
  readonly schema: JSONSchema;
  readonly prompt: string;
  /** `JSONSchema` is deliberately opaque (`SPEC-QUESTIONS.md` Q58 point 6) — this package has no real
   * JSON Schema validator to check `SessionResult.structured` against the schema itself, so the caller
   * supplies the check directly. */
  isValid(value: unknown): boolean;
}

export interface ConformanceResumeFixture {
  readonly initialPrompt: string;
  /** Run in the *resumed* session; its own expected answer must depend on something only visible in
   * `initialPrompt`'s own session, for C9 to actually prove context retention rather than coincidence. */
  readonly probePrompt: string;
  readonly expectedFragment: string;
}

export interface ConformanceMcpFixture {
  /** `grantedTools` should list only `allowedToolName`. */
  readonly server: GrantedMcpServer;
  readonly allowedToolName: string;
  readonly deniedToolName: string;
  /** Elicits a session that attempts to call both tools by name. */
  readonly prompt: string;
}

export interface ConformanceSkillFixture {
  readonly skill: ResolvedSkill;
  /** Elicits a session that would surface `expectedFragment` in its own output if the skill's own
   * content was genuinely visible to it. */
  readonly prompt: string;
  readonly expectedFragment: string;
}

/** C13's own fixture. `@forge/adapter-kit`'s production code cannot read or write `process.env`, or
 * use `node:crypto` randomness, itself (both banned outright by this repo's own R10 lint rules, with
 * no per-package exemption — `SPEC-QUESTIONS.md` Q60's own addendum), so establishing "a secret exists
 * somewhere a non-compliant adapter's child process could plausibly inherit it from" is the caller's
 * job, done in the caller's own `*.test.ts` file (which the same rules exempt) — this fixture is just
 * the resulting value plus a prompt that elicits an attempt to read it back. */
export interface ConformanceSecretProbeFixture {
  /** The value the caller has ensured is present somewhere a non-compliant adapter's own child process
   * could plausibly inherit it from (e.g. the calling test file's own `process.env`), but that this
   * suite deliberately never includes in any `SessionRequest.env` it constructs. Any sufficiently
   * distinctive string works — this does not need to be unpredictable, since the suite is testing a
   * cooperative-but-possibly-buggy adapter, not defending against an adversary who could guess it. */
  readonly value: string;
  /** Elicits a session that tries to read/print an env var this suite never grants. */
  readonly prompt: string;
}

export interface ConformanceOptions {
  /** A fresh, empty, isolated directory for one session's own `cwd`; not deleted afterward by the
   * suite (caller owns cleanup, matching this codebase's own scratch-directory conventions elsewhere). */
  createScratchDir(): Promise<string>;
  /** Accepted by `capabilities()`/`listModels()`/`startSession()`. */
  readonly validModel: string;
  /** Guaranteed to make a session fail with a typed, non-retryable error (C11). */
  readonly invalidModel: string;
  /** Elicits at least one non-empty text response; no other requirement (C1, C7). */
  readonly helloPrompt: string;
  /** Elicits a session that creates a file at `CONFORMANCE_WRITE_FILE_RELATIVE_PATH` (relative to
   * `cwd`) containing `CONFORMANCE_WRITE_FILE_CONTENT` (C2, C3, C12, C14). */
  readonly writeFilePrompt: string;
  /** Elicits a session likely to still be "in progress" — more turns than a small `maxTurns` would
   * allow, or simply not yet finished shortly after starting — for the limits (C6) and abort (C5)
   * tests. */
  readonly manyTurnsPrompt: string;
  /** Elicits a session that attempts to run both `CONFORMANCE_EXEC_ALLOWED_COMMAND` and
   * `CONFORMANCE_EXEC_DENIED_COMMAND`, under an `exec: ['echo *']` grant (C4). A canary file at
   * `CONFORMANCE_EXEC_CANARY_RELATIVE_PATH` is written by the suite before the session starts. */
  readonly execPrompt: string;
  /** C13's own fixture — see `ConformanceSecretProbeFixture`. Required, not optional: C13 is
   * safety-critical (`SAFETY_CRITICAL_CONFORMANCE_IDS`), so every adapter under test must be able to
   * exercise it, unlike the genuinely optional capability-gated fixtures below. */
  readonly secretProbe: ConformanceSecretProbeFixture;
  /** Elicits a session whose output contains a `FORGE_ASK`-shaped control token (C10). */
  readonly controlTokenPrompt: string;
  /** Only exercised if `capabilities().structuredOutput` (C8). */
  readonly structured?: ConformanceStructuredFixture;
  /** Only exercised if `capabilities().sessionResume` (C9). */
  readonly resume?: ConformanceResumeFixture;
  /** Only exercised if the adapter implements `provisionMcp` (C16). */
  readonly mcp?: ConformanceMcpFixture;
  /** Only exercised if the adapter implements `provisionSkills` (C15). */
  readonly skill?: ConformanceSkillFixture;
}
