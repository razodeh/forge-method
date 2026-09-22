/**
 * Command steps that run no `forge` command at all. Pinned so a misspelt binary cannot pass unnoticed
 * (`test/command-steps.test.ts`, `PLAN-M13.md` P22). Every one of them is `inline: true` in its own
 * workflow file, confirmed by `test/command-steps-in-claim.test.ts` (`PLAN-M14.md` P2) rather than
 * assumed there.
 *
 * A plain data module, not a `.test.ts` file: `test/command-steps-in-claim.test.ts` needs this exact
 * list too, and importing a `describe`/`it`-bearing test file for one shared constant would run that
 * file's whole suite a second time as a side effect of the import (vitest registers every top-level
 * `describe` the moment the module loads) — a real, wasteful duplication this module avoids by holding
 * only the data both files need.
 */
export const NON_FORGE_STEPS: readonly string[] = [
  'build-stage:prepare',
  'intake:verify-constraints',
  'fm-service/contract-test-cycle.workflow.yaml:run-contract-tests',
  'fm-mobile/store-release.workflow.yaml:run-device-matrix-tests',
];
