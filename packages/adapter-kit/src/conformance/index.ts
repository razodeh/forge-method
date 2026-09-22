/**
 * `@forge/adapter-kit/conformance` — `07` §7.6's 16-test adapter conformance suite. Reachable only
 * through this own subpath, deliberately *not* re-exported from the package's bare `.` entry the way
 * `types`/`events`/`grants`/`control-tokens` all are — this is the one piece that depends on `vitest` at
 * runtime, and a consumer who only wants e.g. `ToolGrant` should never transitively load a test
 * framework just for importing `@forge/adapter-kit` at all.
 *
 * @see specs/07 §7.6
 * @see SPEC-QUESTIONS.md Q60
 * @see PLAN-M4.md P4
 */
export {
  type ConformanceMcpFixture,
  type ConformanceOptions,
  type ConformanceResumeFixture,
  type ConformanceSecretProbeFixture,
  type ConformanceSkillFixture,
  type ConformanceStructuredFixture,
  CONFORMANCE_ENV_PROBE_VALUE,
  CONFORMANCE_ENV_PROBE_VAR,
  CONFORMANCE_EXEC_ALLOWED_COMMAND,
  CONFORMANCE_EXEC_CANARY_RELATIVE_PATH,
  CONFORMANCE_EXEC_DENIED_COMMAND,
  CONFORMANCE_WRITE_FILE_CONTENT,
  CONFORMANCE_WRITE_FILE_RELATIVE_PATH,
} from './fixtures.ts';
export { runAdapterConformanceSuite, SAFETY_CRITICAL_CONFORMANCE_IDS } from './suite.ts';
