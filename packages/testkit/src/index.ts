/**
 * `@forge/testkit` — `FakePlatformAdapter`, the one in-memory, fully spec-compliant `PlatformAdapter`
 * every other future FORGE package tests against instead of a real, costly, non-deterministic coding
 * platform.
 *
 * @see specs/07 §7.2
 * @see PLAN-M4.md P5
 */
export { FAKE_MODEL_ID, FakePlatformAdapter, withCapabilities, type FakeFailureKind } from './fake-adapter.ts';
export type { SessionRequestMatcher } from './matcher.ts';
export { replayFromNdjson } from './ndjson.ts';
export type {
  FakeSessionScript,
  FakeSessionScriptErrorInfo,
  ScriptedFileWrite,
} from './script.ts';
