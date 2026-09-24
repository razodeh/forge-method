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

import type { ConflictResolutionMode } from '../../generated-header.ts';
import type { WrittenFile } from '../../init/index.ts';
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
  /** `--on-conflict <mode>`: how step 5's regeneration resolves a regenerable file whose real,
   * recorded hash no longer matches its current content (`03` §3.3's own "modified hash" rule, which
   * `03` §3.4 step 5 inherits verbatim: it reuses the identical `writeRegenerableContent` call `init`
   * does). Omitted, prompts interactively — see `@forge/cli/generated-header`'s
   * `resolveGeneratedConflict`. Ignored on a `dryRun` (nothing is written either way). */
  readonly onConflict?: ConflictResolutionMode;
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
  /** Overrides the real terminal streams a real conflict prompt reads from/writes to (default
   * `process.stdin`/`process.stdout`) — the same injected-I/O discipline `env` already follows here,
   * extended so a test can drive/observe a real upgrade conflict prompt without a real TTY. */
  readonly conflictInput?: NodeJS.ReadableStream;
  readonly conflictOutput?: NodeJS.WritableStream;
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
  /** `PLAN-M14.md` P43's own real, read-only plan (`init/write-tree.ts`'s `planRegenerableContent`),
   * computed before the dry-run/full-run branch either way: every already-materialised regenerable
   * file whose body still matches its own recorded header (a human never touched it) but whose shipped
   * content has since changed. A real run overwrites these silently, no conflict resolution triggered
   * (`writeGenerated` never treats an undrifted file as a conflict). Always present, empty when
   * nothing is stale — including a project whose installed and target versions are identical: staleness
   * is a real, per-file body/header comparison, never inferred from the version pair alone. */
  readonly staleFiles: readonly string[];
  /** The identical plan's own `'edited'` files: a real, detected local edit (the file's own body no
   * longer matches its recorded header hash) that a real run resolves through `03` §3.3's own
   * `keep-mine`/`take-theirs`/`merge`/`show-diff` conflict path, never a silent overwrite. Always
   * present, empty when nothing has been hand-edited. Deliberately excluded from `regenerated` below:
   * the conflict path may resolve to `keep-mine` (nothing written), so an edit alone never forces it. */
  readonly editedFiles: readonly string[];
  /** The identical plan's own `'missing'` files: nothing real on disk yet at that regenerable path (a
   * brand-new content kind a newer version introduced, or a file a human deleted outright) — a real
   * run creates these silently, exactly like `staleFiles`. Always present, empty when nothing is
   * missing. Critic round 1 finding (M14 P43): without this field a real `regenerated: true` caused
   * *only* by missing files was invisible everywhere (no report field, nothing for `bin.ts` to print). */
  readonly missingFiles: readonly string[];
  /** Whether the regenerable directories were (real run) or would be (dry run, when any document
   * needs migrating, the module/template version itself has drifted, or `staleFiles`/`missingFiles` is
   * non-empty in the plan above — `PLAN-M14.md` P43: real, whatever the version pair) rewritten. */
  readonly regenerated: boolean;
  /** Every regenerable file step 5 actually touched, `WrittenFile.conflict` naming the real
   * resolution mode wherever a hash drift was found. Present only for a real (non-dry-run) upgrade —
   * a dry run computes `regenerated` without ever reading, let alone resolving, a single file's real
   * conflict state. */
  readonly regeneratedFiles?: readonly WrittenFile[];
  /** `03` §3.4 step 6: "re-run `forge doctor`." Present only for a real (non-dry-run) upgrade. */
  readonly doctor?: DoctorReport;
}
