/**
 * Companion declaration file for `./worker-ts-exec-argv.mjs`, so `packages/cli/src/commands/parity/
 * normalize-budget.ts` (a real, shipped production file, under its own isolated `tsconfig.json`)
 * type-checks this cross-boundary import without widening that project's own config.
 */
export declare function getWorkerTsExecArgv(): readonly string[];
