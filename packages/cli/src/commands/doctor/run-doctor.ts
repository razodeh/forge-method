/**
 * `runDoctor` — `03` §3.7's own full checklist, assembled into one real `DoctorReport`.
 *
 * @see specs/03 §3.7
 * @see PLAN-M6.md C6
 */
import { renderCause } from '@forge/core';
import type { ProjectPaths } from '@forge/core/fs';
import type { PlatformAdapter } from '@forge/adapter-kit/types';
import type { ForgeConfig } from '@forge/schemas/config';

import { kbSync } from '../kb.ts';
import {
  checkDiskSpace,
  checkGitIdentity,
  checkGitVersion,
  checkNodeVersion,
  checkPackageManager,
  checkPlatformAdapter,
} from './environment.ts';
import {
  checkDanglingLaneBranches,
  checkOrphanedWorktrees,
  checkStaleLock,
} from './locks-and-worktrees.ts';
import { checkConfigValidity, checkKbLint, checkManifest, checkSpecGraph } from './project.ts';
import { checkDiagrams } from './diagrams.ts';
import { checkModelTiers } from './model-tiers.ts';
import { checkSecretReferences } from './secrets.ts';
import { applyDoctorFix } from './fix.ts';
import type { DoctorCheck, DoctorFixResult, DoctorReport } from './types.ts';
import { workflowValidateAll, type WorkflowCommandContext } from '../workflow.ts';

const AGENTS_ROOT = '.forge/agents';
const WORKFLOWS_ROOT = '.forge/workflows';
const CHECKS_ROOT = '.forge/checks';

/** `workflow-claims` — `03` §3.7's checklist plus `06` §6.7's empty-claim rule made visible for a
 * project's *own* customised workflows (`SPEC-QUESTIONS.md` Q225/Q232 decision 6, `PLAN-M14.md` P7).
 * `forge workflow validate --all` fails the identical defect with an *error* (`write-without-claim`);
 * here it is only ever a `warning` — `forge doctor` never blocks a project's build over its own
 * workflow customisation, and a project a pre-`PLAN-M13.md` P36 `forge init` laid down genuinely has
 * this shape in all nine formerly-empty-claim steps until `forge upgrade` regenerates them, which must
 * not become a hard failure a project cannot run past. Reuses `workflowValidateAll` unchanged — the
 * exact real check `forge workflow validate --all` runs — so the two can never disagree about what
 * counts as an offender; a workflow this check cannot even parse is reported by the existing
 * `runChecks` crash-to-`hard`-check fallback below, not swallowed here. */
async function checkWorkflowClaims(paths: ProjectPaths): Promise<DoctorCheck> {
  const ctx: WorkflowCommandContext = {
    paths,
    workflowsRoot: WORKFLOWS_ROOT,
    agentsRoot: AGENTS_ROOT,
    checksRoot: CHECKS_ROOT,
  };
  const results = await workflowValidateAll(ctx);
  const offenders: string[] = [];
  for (const [workflowId, issues] of results) {
    for (const issue of issues) {
      if (issue.code === 'write-without-claim') {
        offenders.push(`${workflowId}:${issue.stepId ?? '(unidentified)'}`);
      }
    }
  }
  const ok = offenders.length === 0;
  return {
    id: 'workflow-claims',
    ok,
    severity: 'warning',
    message: ok
      ? 'Workflow claims: every write-capable agent step declares outputs or a produces glob.'
      : `Workflow claims: ${String(offenders.length)} write-capable agent step(s) declare neither outputs nor produces, so they run and change nothing: ${offenders.join(', ')}.`,
    ...(ok
      ? {}
      : {
          fix: 'Run `forge upgrade` to regenerate a stale shipped workflow, or add `produces:`/`outputs:` to the named step naming what it writes.',
        }),
  };
}

export interface DoctorOptions {
  readonly paths: ProjectPaths;
  readonly projectRoot: string;
  readonly config: ForgeConfig;
  /** No concrete `PlatformAdapter` exists anywhere in this codebase yet — injected, optional, the
   * identical stance every other real caller in this milestone already takes. */
  readonly adapter?: PlatformAdapter;
  /** A real environment snapshot, injected rather than read ambiently (`QUALITY-BAR.md` R10) — the
   * identical stance `SessionRequest.env` already takes for the identical reason. */
  readonly env: Readonly<Record<string, string>>;
  /** `process.version`, injected — a real host fact R10 forbids reading ambiently inside business
   * logic; the one real caller allowed to read it is the CLI entry point itself. */
  readonly processVersion: string;
  /** `--rebuild-index` — invokes `@forge/kb`'s own real, already-built `rebuildIndex(tree, backend)`
   * (via `../kb.ts`'s own `kbSync`, the exact wrapper `forge kb sync` already uses) once, before any
   * check runs, so a check that happens to read the freshly-rebuilt index sees current data. A
   * genuinely corrupted on-disk *index file* needs no special detection here at all: `@forge/kb`'s own
   * `openKbIndex` already degrades a corrupt or unreadable backend to a fresh, empty one rather than
   * throwing (`packages/kb/src/db/open.ts`/`json-backend.ts`). A broken *storage location*
   * (`.forge/state` occupied by a plain file, or unwritable) is a real, different failure `openKbIndex`
   * does still throw for (`KB-012`) — degraded, here, into its own single failed `rebuild-index`
   * `DoctorCheck` rather than rejecting the whole `runDoctor` call, matching `runChecks`'s own
   * "never throws" contract for every other real check. */
  readonly rebuildIndex?: boolean;
  /** `--fix` — after checks run, apply `./fix.ts`'s own real, safe, automatic remediation to every
   * check that failed, then re-run every check so `checks`/`ok` above reflect the real, current
   * post-fix state. `fixes` on the returned `DoctorReport` records what was attempted for each
   * originally-failing check, including an honest `applied: false` for the (majority of) checks with
   * no safe automatic fix. */
  readonly fix?: boolean;
}

/** One real check's own id, paired with its promise — needed so a check that throws instead of
 * returning (a genuinely unhealthy project: malformed Mermaid source, a corrupted lock file, a git
 * failure) still degrades to its own single failed `DoctorCheck` rather than aborting every other
 * check's own real result via a bare `Promise.all` rejection. */
interface NamedCheck {
  readonly id: string;
  readonly promise: Promise<DoctorCheck>;
}

async function runChecks(options: DoctorOptions): Promise<DoctorCheck[]> {
  const { paths, projectRoot, config, adapter, env, processVersion } = options;
  const kbRoot = config.paths.kb;
  const specsRoot = config.paths.specs;

  const named: readonly NamedCheck[] = [
    { id: 'node-version', promise: Promise.resolve(checkNodeVersion(processVersion)) },
    { id: 'package-manager-pnpm', promise: checkPackageManager('pnpm') },
    { id: 'package-manager-npm', promise: checkPackageManager('npm') },
    { id: 'git-version', promise: checkGitVersion() },
    { id: 'git-identity', promise: checkGitIdentity(projectRoot) },
    { id: 'platform-adapter', promise: checkPlatformAdapter(adapter, projectRoot, env) },
    { id: 'disk-space', promise: checkDiskSpace(projectRoot) },
    { id: 'config-validity', promise: checkConfigValidity(paths) },
    { id: 'manifest-structure', promise: checkManifest(paths) },
    {
      id: 'kb-lint',
      promise: checkKbLint({ paths, kbRoot, specsRoot, level: config.project.level }),
    },
    {
      id: 'spec-graph',
      // `agentsRoot`: `forge spec validate` also refuses a Story whose owner is not an implementation role (`PLAN-M13.md` P36), and
      // this check reports what that command reports.
      promise: checkSpecGraph({ paths, specsRoot, kbRoot, agentsRoot: AGENTS_ROOT }),
    },
    { id: 'stale-lock', promise: checkStaleLock(paths) },
    { id: 'orphaned-worktrees', promise: checkOrphanedWorktrees(projectRoot) },
    { id: 'dangling-lane-branches', promise: checkDanglingLaneBranches(projectRoot) },
    { id: 'diagrams', promise: checkDiagrams(paths, kbRoot) },
    { id: 'secret-references', promise: checkSecretReferences(paths, env) },
    { id: 'model-tiers', promise: checkModelTiers(paths, config, adapter) },
    { id: 'workflow-claims', promise: checkWorkflowClaims(paths) },
  ];

  return Promise.all(
    named.map(async ({ id, promise }): Promise<DoctorCheck> => {
      try {
        return await promise;
      } catch (cause: unknown) {
        // `renderCause` only ever returns `undefined` for a literal `throw undefined` — not a real
        // shape any check in this module produces — so no fallback branch is added here to cover.
        return {
          id,
          ok: false,
          severity: 'hard',
          message: `Check crashed instead of completing: ${String(renderCause(cause))}.`,
        };
      }
    }),
  );
}

export async function runDoctor(options: DoctorOptions): Promise<DoctorReport> {
  const { paths, projectRoot, config, fix, rebuildIndex } = options;

  // Never allowed to throw out of `runDoctor` — every one of `runChecks`'s own checks already
  // degrades a genuine crash into its own single failed `DoctorCheck` rather than aborting the whole
  // report (see `runChecks`'s own per-check try/catch above); a fresh gauntlet critic round found this
  // call was the one real exception, an unguarded `await kbSync(...)` that let a real, documented
  // `openKbIndex` failure (`KB-012`: `.forge/state` blocked by a stray file, or unwritable) reject the
  // whole `runDoctor` call outright. Degraded here into the identical shape every other crashing check
  // already produces, so a caller sees one honest failed check instead of an uncaught rejection.
  let rebuildIndexFailure: DoctorCheck | undefined;
  if (rebuildIndex) {
    try {
      await kbSync({
        paths,
        kbRoot: config.paths.kb,
        specsRoot: config.paths.specs,
        level: config.project.level,
      });
    } catch (cause: unknown) {
      rebuildIndexFailure = {
        id: 'rebuild-index',
        ok: false,
        severity: 'hard',
        message: `Rebuilding the KB index crashed instead of completing: ${String(renderCause(cause))}.`,
      };
    }
  }

  const withRebuildIndexResult = async (): Promise<DoctorCheck[]> => [
    ...(rebuildIndexFailure === undefined ? [] : [rebuildIndexFailure]),
    ...(await runChecks(options)),
  ];

  const checks = await withRebuildIndexResult();

  if (!fix) {
    const ok = checks.every((c) => c.ok || c.severity !== 'hard');
    return { v: 1, ok, checks };
  }

  // Sequential, deliberately not `Promise.all`: some real fixes (`git worktree remove`) mutate the
  // same real repository, and running them concurrently risks racing against each other at the git
  // level for no real benefit (a fix pass is not a hot path). Computed once, from the pre-fix `checks`
  // above — each individual fix function re-derives its own current on-disk state before acting
  // (`fixStaleLock`/`fixOrphanedWorktrees` both re-read, never trust this list's own snapshot), so a
  // fix already applied by an earlier iteration in this same loop cannot be attempted twice from a
  // stale entry here.
  const fixes: DoctorFixResult[] = [];
  for (const failedCheck of checks.filter((c) => !c.ok)) {
    fixes.push(await applyDoctorFix(failedCheck, paths, projectRoot));
  }
  // `rebuild-index` is never re-attempted here (`--fix` has no safe automatic remedy for a rebuild
  // that itself crashed — the `applyDoctorFix` default case already reports that honestly above), but
  // it still belongs in the final, post-fix report if it never got any better.
  const fixedChecks = await withRebuildIndexResult();
  const ok = fixedChecks.every((c) => c.ok || c.severity !== 'hard');
  return { v: 1, ok, checks: fixedChecks, fixes };
}
