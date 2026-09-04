/**
 * Committed so `tools/lint-fixture/tsconfig.json` always has an input.
 *
 * Without it, `tsc -p` on this project exits with TS18003 ("No inputs were found") whenever no
 * fixture is momentarily on disk — which made the typecheck-coverage assertion in
 * `test/workspace-floor.test.ts` pass only when a sibling test file happened to be mid-lint. The
 * suite was green in parallel and red when run file-by-file.
 */
export const LINT_FIXTURE_PLACEHOLDER = 'placeholder';
