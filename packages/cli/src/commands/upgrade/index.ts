/**
 * `@forge/cli/upgrade` — `03` §3.4's own seven-step upgrade procedure.
 *
 * @see specs/03 §3.4
 */
export { createBackup } from './backup.ts';
export { applyArtifactMigrations, planArtifactMigrations } from './migrate-artifacts.ts';
export { runUpgrade } from './run-upgrade.ts';
export { compareVersions } from './version.ts';
export type { DocumentMigrationPlan, UpgradeDeps, UpgradeOptions, UpgradeReport } from './types.ts';
export type { PlannedDocumentMigration } from './migrate-artifacts.ts';
