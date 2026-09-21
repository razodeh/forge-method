/**
 * `@forge/engine/rca` — F-DEBUG-1's own ten-phase RCA loop, real control flow.
 *
 * @see specs/13 §13.2 F-DEBUG-1
 * @see specs/13 §13.2 F-DEBUG-2
 * @see PLAN-M8.md P8
 */
export { detectForbiddenFixPattern, hashFixDiff } from './anti-thrash.ts';
export {
  MAX_FIX_ATTEMPTS,
  MAX_HYPOTHESIS_ROUNDS,
  MAX_REPRODUCTION_ATTEMPTS,
  MAX_WHYS,
  MIN_HYPOTHESES,
  WALL_CLOCK_MS,
} from './bounds.ts';
export {
  protectedFixGlobs,
  scanFixDiff,
  type FixChange,
  type FixScanRule,
  type FixScanViolation,
} from './fix-scan.ts';
export { scrubbedEnvironment } from '../dispatch/confined-command.ts';
export { runRcaLoop } from './loop.ts';
export { createRcaShell, type RcaShellOptions } from './shell.ts';
export type {
  DefectContext,
  RcaCommandOrigin,
  RcaCommandRefusal,
  RcaEvidenceBundle,
  RcaHypothesis,
  RcaLoopDeps,
  RcaLoopResult,
  RcaRecordDraft,
  RcaRefusedCommand,
  RcaShellResult,
  RcaSessionRequest,
  RcaUntrustedInput,
  RunRcaSession,
  RunRcaShell,
} from './types.ts';
