/**
 * Types for `@forge/cli/upgrade` — `03` §3.4's own seven-step upgrade procedure.
 *
 * @see specs/03 §3.4
 * @see PLAN-M6.md C7
 */
import type { Clock } from '@forge/core';
import type { PlatformAdapter } from '@forge/adapter-kit/types';
import type { ForgeConfig } from '@forge/schemas/config';
import type { ArtifactTypeId } from '@forge/schemas';
import type { Migration } from '@forge/schemas/migrations';

import type { DoctorReport } from '../doctor/index.ts';

export interface UpgradeOptions {
  /** Prints the real, computed plan and writes nothing at all — proven by a real
   * filesystem-untouched assertion, not merely "the option is parsed" (`03` §3.4's own Check). */
  readonly dryRun?: boolean;
  /** Pins the target version explicitly. Omitted, resolves to this installation's own currently
   * running `@forge/agents` package version (the same source `buildManifest` itself already reads,
   * so an upgrade with no `--to` moves a project to exactly what a fresh `forge init` would write
   * today). A version older than the manifest's own installed version is refused (`CFG-018`). */
  readonly to?: string;
}

/** `runUpgrade`'s own required collaborators, injected rather than read ambiently — the identical
 * `QUALITY-BAR.md` R10 discipline `runInit`/`runDoctor` already follow for `env`/`processVersion`/
 * `adapter`, extended here with `clock` (`03` §3.4 step 3's own backup timestamp) and `migrations`
 * (defaults to the real `@forge/schemas/migrations` registry; overridable so a test can exercise the
 * real chain-resolution/apply mechanism against a synthetic fixture before any real product migration
 * ships — the identical "pass a fixture array" precedent `planMigrations` itself already documents). */
export interface UpgradeDeps {
  readonly modulesDir: string;
  readonly specsRoot: string;
  readonly config: ForgeConfig;
  readonly env: Readonly<Record<string, string>>;
  readonly processVersion: string;
  readonly adapter?: PlatformAdapter;
  readonly clock?: Clock;
  readonly migrations?: readonly Migration[];
}

/** One real artifact document's own migration plan — always present in `UpgradeReport.
 * migratedDocuments` even when `stepCount` is `0` (nothing to do for this document), so a dry-run
 * report can show "checked N documents, M need migrating" rather than only the ones that changed. */
export interface DocumentMigrationPlan {
  readonly path: string;
  readonly type: ArtifactTypeId;
  readonly fromSchemaVersion: number;
  readonly toSchemaVersion: number;
  readonly stepCount: number;
}

export interface UpgradeReport {
  readonly v: 1;
  readonly dryRun: boolean;
  readonly installedVersion: string;
  readonly targetVersion: string;
  /** Present only for a real (non-dry-run) upgrade that actually wrote a backup. */
  readonly backupPath?: string;
  readonly migratedDocuments: readonly DocumentMigrationPlan[];
  /** Whether the regenerable directories were (real run) or would be (dry run, when any document or
   * the module/template version itself has drifted) rewritten. */
  readonly regenerated: boolean;
  /** `03` §3.4 step 6: "re-run `forge doctor`." Present only for a real (non-dry-run) upgrade. */
  readonly doctor?: DoctorReport;
}
