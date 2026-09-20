/**
 * `@forge/cli/doctor` — `03` §3.7's prerequisite detection and remediation.
 *
 * @see specs/03 §3.7
 */
export { runDoctor, type DoctorOptions } from './run-doctor.ts';
export { applyDoctorFix } from './fix.ts';
export { checkModelTiers } from './model-tiers.ts';
export type { CheckSeverity, DoctorCheck, DoctorFixResult, DoctorReport } from './types.ts';
