/**
 * `@forge/schemas/migrations` — the schema migration runner.
 *
 * @see specs/18 §18.9
 * @see PLAN-M1.md P10
 */
export { applyMigrations } from './apply.ts';
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
