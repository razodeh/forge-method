/**
 * `forge deploy record <dry-run|rollback|deployment>`: a validating writer for the delivery records
 * `deploy-evidence.ts` (`forge deploy --dry-run`/`--rollback-check`) and `doctor/rules-delivery.ts`
 * (`skeletonDeployedViolations`, `G-Foundation`'s `skeleton-deployed` rule) read back (`PLAN-M14.md` P23).
 *
 * **Why this exists.** Before this piece, the only way a real pipeline could produce
 * `docs/forge/reports/deployments/<ENV-id>.{dry-run,rollback}.json` or `<ENV-id>.json` was to hand-author JSON —
 * easy to get subtly wrong (an unzoned instant, a `to_sha` that is not actually an ancestor, a health check on the
 * wrong host) in a way nothing catches until the *next* gate run, far from the mistake. This command validates a
 * proposed record with the exact same field-level rules the checks apply — `STAGING`, `isTarget`,
 * `isRehearsalTarget`, `isAncestor`, `commitProblem`, `instantProblem` and `rollbackProblem`, exported from
 * `deploy-evidence.ts` for exactly this reuse — and writes nothing at all if any of them fails (`14` §14.3
 * rule 7's "machine-readable results" are worthless if a broken one can land).
 *
 * **What is NOT checked here.** Staleness (`14` §14.4 rule 2, "for this stage's changes") is a property of the
 * record *relative to the commit history at the moment the check reads it*, not at the moment it is written: a
 * record written against the current `HEAD` is never stale yet, and a later commit is what can make it so — that
 * is the checks' job on every subsequent run, not this command's job once. `record rollback` does still run the
 * check's own `staleProblem` internally (bundled inside the reused `rollbackProblem`), which is harmless and
 * correct: at write time `from_sha` is ordinarily `HEAD` itself (zero diff), so it passes; the moment a later
 * commit changes something outside the document roots, the *check* reports it stale, exactly per the Discloses.
 *
 * **Which environments each form accepts.** `dry-run` requires a real delivery-*target* environment (`isTarget`,
 * matching `deployDryRunCheck`'s own `pick`). `rollback` requires a *rehearsal*-target environment
 * (`isRehearsalTarget`, matching `deployRollbackCheck`'s own `pick`: a target that is not positively
 * production, `14` §14.4 rule 2 "in staging") — NOT plain `isTarget` (a critic round proved live that gating
 * on plain `isTarget` let this write a "successful" rollback record for a pure-production environment that
 * `deployRollbackCheck` would then silently never read at all, reporting "no staging environment recorded" as
 * if nothing had been written). `deployment` accepts ANY registered environment, target or not: its shape
 * (`14` §14.4 rule 5's generic "deployments are recorded") is what `skeletonDeployedViolations` reads for the
 * *development* environment specifically (`11` F-INIT-7) — filtering `deployment` by `isTarget` (which excludes
 * dev) would make it impossible to ever record the one deployment `G-Foundation` actually asks for.
 *
 * **`--health-status`.** Arrives as a CLI string; a well-formed integer is written as a JSON number (what the
 * checks require), anything else is written through unparsed. Either way, the checks' own `typeof status !==
 * 'number'`/2xx-range test is what produces the refusal message, so a malformed value is diagnosed identically
 * whether it is caught here or later by the check.
 *
 * **`recordDeployment` is stricter than `deploymentProblem` on `deployed_at`/`health.checked_at`, deliberately.**
 * The check this kind models (`doctor/rules-delivery.ts`'s `deploymentProblem`) only runs bare `parsesAsInstant`
 * on those two fields (format only, no future or floor check) — but `recordDeployment` runs the fuller
 * `instantProblem` (format, not-in-the-future, and, for `deployed_at`, not-before-the-commit), matching what
 * `dry-run`/`rollback` already enforce for their own instants. This is the mandate's own general instant rule
 * ("zoned instants, not future by the injected clock, not before the commit") applied uniformly rather than
 * only where the read-side check happens to enforce it; it is strictly safe-direction (it can only refuse a
 * record `deploymentProblem` would have accepted, never accept one it would refuse), disclosed here per a
 * critic round's finding since nothing else in this file said so explicitly.
 *
 * @see specs/03 §3.2.5
 * @see specs/10 §10.3
 * @see specs/14 §14.3, §14.4, §14.9
 * @see specs/11 F-INIT-7
 * @see PLAN-M14.md P23
 */
import { ArtifactDocument } from '@forge/core/artifacts';
import { writeFileAtomic } from '@forge/core/fs';
import { environmentsFileSchema, type Environment } from '@forge/schemas';

import {
  commitProblem,
  instantProblem,
  isRehearsalTarget,
  isTarget,
  rollbackProblem,
  type DeployEvidenceContext,
} from './deploy-evidence.ts';
import { readCommittedTree, type CommittedTree } from './doctor/committed-tree.ts';
import { deployedUrl, ENVIRONMENTS_FILE } from './doctor/rules-delivery.ts';
import { errorMessage, oneLine } from './spec/spec-files.ts';

/** Identical shape to the checks' own context (`paths`, `projectRoot`, `kbRoot`, `reportsRoot`, an optional
 * `documentRoots` this writer never reads, and an optional injected `clock`) — reused directly rather than
 * declared again, so a write and the check that later reads it always agree on what "now" and "this project"
 * mean. */
export type DeployRecordContext = DeployEvidenceContext;

export interface DryRunFields {
  readonly env: string;
  readonly sha: string;
  readonly ranAt: string;
}

export interface RollbackFields {
  readonly env: string;
  readonly fromSha: string;
  readonly toSha: string;
  readonly rehearsedAt: string;
  readonly healthUrl: string;
  readonly healthStatus: string;
  readonly healthCheckedAt: string;
}

export interface DeploymentFields {
  readonly env: string;
  readonly sha: string;
  readonly deployedAt: string;
  readonly healthUrl: string;
  readonly healthStatus: string;
  readonly healthCheckedAt: string;
}

export type DeployRecordOutcome =
  | { readonly ok: true; readonly written: string }
  | { readonly ok: false; readonly message: string; readonly remedy: string };

function refuse(message: string, remedy: string): DeployRecordOutcome {
  return { ok: false, message, remedy };
}

const REPOSITORY_REMEDY = 'Run the command inside a git repository with at least one commit.';

const DRY_RUN_REMEDY =
  'Provide a real --env <ENV-id> recorded (and committed) in kb/delivery/environments.md as a delivery-target ' +
  "environment, --sha naming a commit in this repository's history, and --ran-at as a zoned ISO-8601 instant " +
  'that is not in the future and not before that commit.';

const ROLLBACK_REMEDY =
  'Provide a real --env <ENV-id> recorded (and committed) in kb/delivery/environments.md as a delivery-target ' +
  "environment, --from-sha and --to-sha naming commits in this repository's history with --to-sha a strict " +
  'ancestor of --from-sha, --rehearsed-at as a zoned ISO-8601 instant that is not in the future and not before ' +
  "--from-sha, and --health-url/--health-status/--health-checked-at showing a 2xx response on the environment's " +
  'own (non-local) host at or after --rehearsed-at.';

const DEPLOYMENT_REMEDY =
  'Provide a real --env <ENV-id> recorded (and committed) in kb/delivery/environments.md, --sha naming a commit ' +
  "in this repository's history, --deployed-at as a zoned ISO-8601 instant that is not in the future and not " +
  'before that commit, and --health-url/--health-status/--health-checked-at showing a 2xx response on the ' +
  "environment's own (non-local) host at or after --deployed-at.";

/** The `isTarget`/`isRehearsalTarget` eligibility gate `resolveEnvironment` applies for a kind, paired with the
 * refusal text naming what disqualifies an environment — kept together so the message always matches the exact
 * predicate actually enforced (a critic round found `recordRollback` enforcing plain `isTarget` while its
 * refusal text and its remedy both already read as if the narrower `isRehearsalTarget` applied, which made the
 * bug read as intentional instead of a mismatch). `undefined` (used by `deployment`, see the module doc
 * comment) means every registered environment is eligible. */
interface EnvironmentGate {
  readonly matches: (environment: Environment) => boolean;
  readonly disqualifies: string;
}

const TARGET_GATE: EnvironmentGate = {
  matches: isTarget,
  disqualifies: 'a development, preview, review, ephemeral, sandbox or local one',
};

const REHEARSAL_TARGET_GATE: EnvironmentGate = {
  matches: isRehearsalTarget,
  disqualifies:
    'a development, preview, review, ephemeral, sandbox, local, or (positively) production one -- rollback ' +
    'is rehearsed in staging, not production (14 §14.4 rule 2)',
};

/** The registered environment named `envId`, read from the COMMITTED register exactly like the checks read it
 * (`readCommittedTree`: an uncommitted edit to `environments.md` changes nothing here) — or the reason it cannot
 * be used. `gate` mirrors the corresponding check's own `pick` exactly (see `EnvironmentGate`'s own doc
 * comment); `deployment` passes `undefined` (see the module doc comment on why). */
async function resolveEnvironment(
  ctx: DeployRecordContext,
  committed: CommittedTree,
  envId: string,
  gate: EnvironmentGate | undefined,
): Promise<
  | { readonly ok: true; readonly environment: Environment }
  | { readonly ok: false; readonly message: string }
> {
  const file = `${ctx.kbRoot}/${ENVIRONMENTS_FILE}`;
  if (!committed.files.has(file)) {
    return { ok: false, message: `no environment ${envId} is recorded (${file} is not committed)` };
  }
  const text = await committed.read(file);
  if (!text.ok) {
    return {
      ok: false,
      message: `the environment register could not be read (${file}: ${oneLine(text.detail)})`,
    };
  }
  let issue: string | undefined;
  let environments: readonly Environment[] = [];
  try {
    const parsed = environmentsFileSchema.safeParse(
      ArtifactDocument.parse(text.text, file).frontMatter,
    );
    if (parsed.success) environments = parsed.data.environments;
    else issue = parsed.error.issues[0]?.message ?? 'invalid';
  } catch (cause) {
    issue = errorMessage(cause);
  }
  if (issue !== undefined) {
    return {
      ok: false,
      message: `the environment register could not be read (${file}: ${oneLine(issue)})`,
    };
  }
  const environment = environments.find((candidate) => candidate.id === envId);
  if (environment === undefined) {
    return { ok: false, message: `no environment ${envId} is recorded in ${file}` };
  }
  if (gate !== undefined && !gate.matches(environment)) {
    return {
      ok: false,
      message: `${envId} is not a delivery-target environment for this record (${file}: its purpose is ${gate.disqualifies})`,
    };
  }
  return { ok: true, environment };
}

/** An in-memory `CommittedTree` holding exactly one proposed (not-yet-written) file, so the checks' own
 * `rollbackProblem` (which reads through a `CommittedTree`) can validate a record before it exists anywhere on
 * disk or in git — the record this writer is *about* to write, never one already committed. */
function proposedTree(file: string, text: string): CommittedTree {
  return {
    files: new Map([[file, { oid: '0'.repeat(40), size: Buffer.byteLength(text, 'utf8') }]]),
    read: (path: string) =>
      Promise.resolve(
        path === file ? { ok: true, text } : { ok: false, detail: `${path} is not committed` },
      ),
  };
}

/** A `--health-status` CLI string, written as the JSON number the checks require when it looks like an integer,
 * or passed through unparsed otherwise — either way, the checks' own `typeof status !== 'number'` (or 2xx-range)
 * test is what produces the refusal, so a malformed value reads identically whether this command or a later
 * check catches it. */
function coerceStatus(raw: string): number | string {
  return /^-?\d+$/.test(raw) ? Number(raw) : raw;
}

async function readRepository(
  ctx: DeployRecordContext,
): Promise<
  | { readonly ok: true; readonly tree: CommittedTree }
  | { readonly ok: false; readonly outcome: DeployRecordOutcome }
> {
  const committed = await readCommittedTree(ctx.projectRoot);
  if (!committed.ok) {
    return {
      ok: false,
      outcome: refuse(`the repository cannot be read (${committed.detail})`, REPOSITORY_REMEDY),
    };
  }
  return { ok: true, tree: committed.tree };
}

/** `forge deploy record dry-run --env <ENV-id> --sha <commit> --ran-at <instant>`: writes
 * `<reportsRoot>/deployments/<ENV-id>.dry-run.json`, the shape `deployDryRunCheck` reads. */
export async function recordDryRun(
  ctx: DeployRecordContext,
  fields: DryRunFields,
): Promise<DeployRecordOutcome> {
  const repository = await readRepository(ctx);
  if (!repository.ok) return repository.outcome;
  const resolved = await resolveEnvironment(ctx, repository.tree, fields.env, TARGET_GATE);
  if (!resolved.ok) return refuse(resolved.message, DRY_RUN_REMEDY);

  const file = `${ctx.reportsRoot}/deployments/${fields.env}.dry-run.json`;
  const shaProblem = await commitProblem(ctx, file, 'sha', fields.sha);
  if (shaProblem !== undefined) return refuse(shaProblem, DRY_RUN_REMEDY);
  const ranAtProblem = await instantProblem(ctx, file, 'ran_at', fields.ranAt, {
    sha: fields.sha,
    name: 'sha',
  });
  if (ranAtProblem !== undefined) return refuse(ranAtProblem, DRY_RUN_REMEDY);

  const evidence = {
    v: 1,
    kind: 'dry-run',
    environment: fields.env,
    outcome: 'passed',
    sha: fields.sha,
    ran_at: fields.ranAt,
  };
  await writeFileAtomic(ctx.paths.resolveWithin(file), `${JSON.stringify(evidence, null, 2)}\n`);
  return { ok: true, written: file };
}

/** `forge deploy record rollback --env --from-sha --to-sha --rehearsed-at --health-url --health-status
 * --health-checked-at`: writes `<reportsRoot>/deployments/<ENV-id>.rollback.json`, the shape
 * `deployRollbackCheck` reads. Validated by literally running the exported `rollbackProblem` against an
 * in-memory tree holding the proposed record — the write happens only if that comes back clean. */
export async function recordRollback(
  ctx: DeployRecordContext,
  fields: RollbackFields,
): Promise<DeployRecordOutcome> {
  const repository = await readRepository(ctx);
  if (!repository.ok) return repository.outcome;
  const resolved = await resolveEnvironment(
    ctx,
    repository.tree,
    fields.env,
    REHEARSAL_TARGET_GATE,
  );
  if (!resolved.ok) return refuse(resolved.message, ROLLBACK_REMEDY);

  const file = `${ctx.reportsRoot}/deployments/${fields.env}.rollback.json`;
  const evidence = {
    v: 1,
    kind: 'rollback',
    environment: fields.env,
    outcome: 'succeeded',
    from_sha: fields.fromSha,
    to_sha: fields.toSha,
    rehearsed_at: fields.rehearsedAt,
    health: {
      url: fields.healthUrl,
      status: coerceStatus(fields.healthStatus),
      checked_at: fields.healthCheckedAt,
    },
  };
  const text = `${JSON.stringify(evidence, null, 2)}\n`;
  const problem = await rollbackProblem(ctx, proposedTree(file, text), resolved.environment, file);
  if (problem !== undefined) return refuse(problem, ROLLBACK_REMEDY);

  await writeFileAtomic(ctx.paths.resolveWithin(file), text);
  return { ok: true, written: file };
}

/** `forge deploy record deployment --env --sha --deployed-at --health-url --health-status --health-checked-at`:
 * writes `<reportsRoot>/deployments/<ENV-id>.json`, the shape `skeletonDeployedViolations` (`G-Foundation`'s
 * `skeleton-deployed` rule, `doctor/rules-delivery.ts:243-300`) reads. No `isTarget` filter (see the module doc
 * comment): any registered environment, dev included, can be recorded. */
export async function recordDeployment(
  ctx: DeployRecordContext,
  fields: DeploymentFields,
): Promise<DeployRecordOutcome> {
  const repository = await readRepository(ctx);
  if (!repository.ok) return repository.outcome;
  const resolved = await resolveEnvironment(ctx, repository.tree, fields.env, undefined);
  if (!resolved.ok) return refuse(resolved.message, DEPLOYMENT_REMEDY);

  const file = `${ctx.reportsRoot}/deployments/${fields.env}.json`;
  const where = deployedUrl(resolved.environment.url);
  if ('reason' in where) {
    return refuse(
      `${fields.env}'s ${where.reason}, so a deployment cannot have been recorded for it`,
      DEPLOYMENT_REMEDY,
    );
  }

  const shaProblem = await commitProblem(ctx, file, 'sha', fields.sha);
  if (shaProblem !== undefined) return refuse(shaProblem, DEPLOYMENT_REMEDY);
  const deployedAtProblem = await instantProblem(ctx, file, 'deployed_at', fields.deployedAt, {
    sha: fields.sha,
    name: 'sha',
  });
  if (deployedAtProblem !== undefined) return refuse(deployedAtProblem, DEPLOYMENT_REMEDY);

  const status = coerceStatus(fields.healthStatus);
  const checked = deployedUrl(fields.healthUrl);
  if ('reason' in checked)
    return refuse(`${file} health.url: ${checked.reason}`, DEPLOYMENT_REMEDY);
  if (checked.host !== where.host) {
    return refuse(
      `${file} health.url is on ${checked.host}, not the environment's ${where.host}`,
      DEPLOYMENT_REMEDY,
    );
  }
  if (typeof status !== 'number' || !Number.isInteger(status) || status < 200 || status > 299) {
    return refuse(
      `${file} health.status is ${oneLine(status, 20)}, not a 2xx response`,
      DEPLOYMENT_REMEDY,
    );
  }
  const checkedAtProblem = await instantProblem(
    ctx,
    file,
    'health.checked_at',
    fields.healthCheckedAt,
  );
  if (checkedAtProblem !== undefined) return refuse(checkedAtProblem, DEPLOYMENT_REMEDY);
  if (Date.parse(fields.healthCheckedAt) < Date.parse(fields.deployedAt)) {
    return refuse(
      `${file} health.checked_at is before deployed_at: the check was not made after the deployment`,
      DEPLOYMENT_REMEDY,
    );
  }

  const evidence = {
    v: 1,
    environment: fields.env,
    outcome: 'succeeded',
    sha: fields.sha,
    deployed_at: fields.deployedAt,
    health: { url: fields.healthUrl, status, checked_at: fields.healthCheckedAt },
  };
  await writeFileAtomic(ctx.paths.resolveWithin(file), `${JSON.stringify(evidence, null, 2)}\n`);
  return { ok: true, written: file };
}
