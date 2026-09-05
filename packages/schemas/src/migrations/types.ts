/**
 * `Migration`, `MigratableDocument` — the shapes `18` §18.9's schema migrations are built from.
 *
 * @see specs/18 §18.9
 * @see PLAN-M1.md P10
 * @see SPEC-QUESTIONS.md Q27
 */
import type { ArtifactTypeId } from '../registry/artifact-types.ts';

/**
 * The artifact document a migration transforms. `type` is carried alongside `frontmatter` (not read
 * back out of it) so `applyMigrations` can check a step's `types` against it without unsafely reading
 * an `unknown`-typed `frontmatter.type` — see `applyMigrations`'s doc comment for why that check
 * exists at all.
 */
export interface MigratableDocument {
  readonly type: ArtifactTypeId;
  readonly frontmatter: Readonly<Record<string, unknown>>;
  readonly body: string;
}

/**
 * One versioned transformation of a `MigratableDocument`, per `18` §18.9.
 *
 * `up`/`down` must be pure: no FS, no network, no clock — `document in, document out`. Per
 * `SPEC-QUESTIONS.md` Q27, `applyMigrations` deep-freezes the document it passes in, which catches
 * one specific way a migration can fail to be pure — mutating its own input, as `18` §18.9's own
 * illustrative style does — by throwing rather than silently corrupting shared state. It cannot and
 * does not catch a migration that reads the clock, the filesystem, or the network without touching
 * its input; write `up`/`down` to return a new object instead, and to read nothing but `doc`.
 *
 * `reversible` and `down` must agree: a `reversible: true` migration without a `down`, or a
 * `reversible: false` migration that defines one, is refused — see `validateMigrationRegistry`.
 */
export interface Migration {
  readonly from: number;
  readonly to: number;
  readonly types: readonly ArtifactTypeId[];
  readonly description: string;
  readonly reversible: boolean;
  up(doc: MigratableDocument): MigratableDocument;
  down?(doc: MigratableDocument): MigratableDocument;
}

/** Why a candidate migration registry was refused — always independent of any particular query. */
export type MigrationRegistryFailureReason =
  | {
      readonly kind: 'reversible-without-down';
      readonly migration: Migration;
    }
  | {
      readonly kind: 'irreversible-with-down';
      readonly migration: Migration;
    }
  | {
      readonly kind: 'duplicate-step';
      readonly type: ArtifactTypeId;
      readonly from: number;
      readonly to: number;
      readonly first: Migration;
      readonly second: Migration;
    };

/** Whether a candidate migration registry is well-formed, per `validateMigrationRegistry`. */
export type ValidateMigrationRegistryResult =
  | { readonly success: true }
  | { readonly success: false; readonly reason: MigrationRegistryFailureReason };

/** A resolved, directional sequence of migrations, ready to hand to `applyMigrations`. */
export interface MigrationPlan {
  /** `'up'` calls each step's `up`; `'down'` calls each step's `down`, already reverse-ordered. */
  readonly direction: 'up' | 'down';
  readonly steps: readonly Migration[];
}

/** Why `planMigrations` could not resolve a chain from `fromVersion` to `toVersion`. */
export type MigrationPlanFailureReason =
  | MigrationRegistryFailureReason
  | {
      readonly kind: 'gap';
      readonly type: ArtifactTypeId;
      /** The `from` version of the missing step. The chain has no migration bridging this version. */
      readonly missingFrom: number;
    }
  | {
      readonly kind: 'not-reversible';
      readonly type: ArtifactTypeId;
      readonly migration: Migration;
    };

/** `planMigrations`'s result: a resolved `MigrationPlan`, or why one could not be resolved. */
export type PlanMigrationsResult =
  | { readonly success: true; readonly plan: MigrationPlan }
  | { readonly success: false; readonly reason: MigrationPlanFailureReason };

/** Why applying a resolved plan failed partway through. */
export interface MigrationStepFailure {
  readonly migration: Migration;
  readonly cause: unknown;
}

/** `applyMigrations`'s result: the migrated document and what ran, or where it stopped and why. */
export type ApplyMigrationsResult =
  | {
      readonly success: true;
      readonly document: MigratableDocument;
      readonly applied: readonly Migration[];
      readonly skipped: readonly Migration[];
    }
  | {
      readonly success: false;
      readonly failure: MigrationStepFailure;
      readonly appliedBeforeFailure: readonly Migration[];
    };
