/**
 * `@forge/schemas/migrations` — the schema migration runner.
 *
 * @see specs/18 §18.9
 * @see PLAN-M1.md P10
 */
export { applyMigrations } from './apply.ts';
export { evidenceBundle1To2 } from './evidence-bundle-1-to-2.ts';
export { mutationEvidence1To2 } from './mutation-evidence-1-to-2.ts';
export { planMigrations } from './plan.ts';
export { MIGRATIONS, validateMigrationRegistry } from './registry.ts';
export type {
  ApplyMigrationsResult,
  Migration,
  MigratableDocument,
  MigrationPlan,
  MigrationPlanFailureReason,
  MigrationRegistryFailureReason,
  MigrationStepFailure,
  PlanMigrationsResult,
  ValidateMigrationRegistryResult,
} from './types.ts';
