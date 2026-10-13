/**
 * The shared contract every built-in `forge-test-report` parser (`13` F-TEST-7 point 2, `18` §18.3)
 * implements: `raw` tool output in, either a real (possibly empty) list of `09` §9.5 entries, or a
 * real, diagnosable reason it could not be read as this parser's own format — never a thrown
 * exception. Emptiness is never a failure here: a project's own zero-tests guard
 * (`loop/test/run.ts`) is the one place that decision is made, uniformly, for every format.
 *
 * @see specs/09 §9.5
 * @see specs/13 F-TEST-7 point 2
 * @see specs/22 M17 P3
 */
import type { ForgeTestReportEntry } from '@forge/schemas';

/** A built-in parser's own result — one shape for all six formats. */
export type ParseResult =
  | { readonly ok: true; readonly tests: readonly ForgeTestReportEntry[] }
  | { readonly ok: false; readonly message: string };

/** A built-in parser: raw tool output in, a `ParseResult` out. Never throws. */
export type TestReportParser = (raw: string) => ParseResult;
