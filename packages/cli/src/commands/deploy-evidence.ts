/**
 * `forge deploy --dry-run` and `forge deploy --rollback-check`: the two `G-Deliver` checks over recorded delivery
 * evidence (`10` §10.3: "Deploy dry-run fails; rollback untested"; `14` §14.9: "Deploy dry-run passes; rollback
 * rehearsed in staging"; `14` §14.4 rule 2: "`G-Deliver` requires evidence that a rollback was executed successfully in
 * staging for this stage's changes"), added by `PLAN-M13.md` P26 (Q228).
 *
 * **FORGE has no deploy executor, by design** (`14` §14.3 rule 1, "the pipeline is the only path to production";
 * `deliver-stage.workflow.yaml`'s own comment; Q213). These commands never deploy, roll back, or run a configured
 * command. They read the records the pipeline leaves in `<reports>/deployments/` (the directory `14` §14.3 rule 7 says
 * stage results land in, and where `forge doctor --rule skeleton-deployed` reads its record, Q219), from the COMMITTED
 * project: a record that exists only in the working tree is not part of the repository, and reading through git means a
 * FIFO or a symlink at that path cannot hang or exhaust the check.
 *
 * **The env-less forms.** `forge deploy <env>` is the delivery workflow itself (`03` §3.2.5) and is unchanged. The two
 * forms here take no environment: the gate cannot name one, so they judge every environment the COMMITTED register
 * (`kb/delivery/environments.md`) records that a delivery targets. A target is any environment that is not positively a
 * development, preview, review, ephemeral, sandbox or local one, so free-text purposes ("live customer traffic") cannot
 * drop out by not saying "production". A rollback is rehearsed in every target that is not positively production
 * (`14` §14.4 rule 2: "in staging"): staging, uat, preprod and anything unclassifiable.
 *
 * **The records** (the specs name the requirement, not a file; the smallest self-describing shapes, Q228). Both are JSON,
 * `"v": 1`, named for the environment id:
 *
 *  - `<ENV-id>.dry-run.json`: `{v, kind: "dry-run", environment, outcome: "passed", sha, ran_at}`.
 *  - `<ENV-id>.rollback.json`: `{v, kind: "rollback", environment, outcome: "succeeded", from_sha, to_sha, rehearsed_at,
 *    health: {url, status, checked_at}}`.
 *
 * `sha`, `from_sha` and `to_sha` are commits in the history of the checked-out commit; a rollback goes from a commit back
 * to a different, earlier one (`to_sha` an ancestor of `from_sha`); instants carry a zone (a zone-less one would make the
 * ordering depend on the machine's `TZ`); the health check is a 2xx on the environment's own (non-local) host and is not
 * before the rehearsal it follows. No instant may be in the future (injected clock) and a dry run or rehearsal may not
 * predate the commit it records. The commit a record names (`sha`, `from_sha`) must be the current code: no file outside
 * the project's document roots changed between it and HEAD, so a record for older code is stale (`14` §14.4 rule 2, "for
 * this stage's changes"). Not checked: which commits belong to a stage (no artifact records that).
 *
 * **These records are self-attested.** The check proves each is present, well formed and consistent with the repository,
 * not that a dry run or a rollback happened; no spec defines a verifiable source. The honest bypass for a project whose
 * pipeline records neither is a Waiver on `G-Deliver` (`10` §10.3 rule 1). A rehearsal is not tied to the latest
 * deployment: a later deploy does not invalidate an earlier rehearsal.
 *
 * @see specs/10 §10.3
 * @see specs/14 §14.3, §14.4, §14.9
 * @see PLAN-M13.md P26
 */
import { SYSTEM_CLOCK, type Clock } from '@forge/core';
import { ArtifactDocument } from '@forge/core/artifacts';
import { environmentsFileSchema, type Environment } from '@forge/schemas';
import type { ProjectPaths } from '@forge/core/fs';
import { execa } from 'execa';

import { readCommittedTree, type CommittedTree } from './doctor/committed-tree.ts';
import {
  DEVELOPMENT_PURPOSE,
  ENVIRONMENTS_FILE,
  OTHER_ENVIRONMENT_PURPOSE,
  MAX_EVIDENCE_BYTES,
  commitExists,
  deployedUrl,
  isAncestorOfHead,
  parsesAsInstant,
  record,
} from './doctor/rules-delivery.ts';
import type { GateCheckOutcome, GateViolation } from './gate-check-output.ts';
import { compare, errorMessage, oneLine } from './spec/spec-files.ts';

export interface DeployEvidenceContext {
  readonly paths: ProjectPaths;
  readonly projectRoot: string;
  /** The KB root relative to the project (`paths.kb`). */
  readonly kbRoot: string;
  /** The reports root relative to the project (`paths.reports`), where deployment records live. */
  readonly reportsRoot: string;
  /** Roots holding project documents (KB, specs, plans, sessions, reports): a change there does not make a deployment
   * record stale. Defaults to the KB and reports roots. */
  readonly documentRoots?: readonly string[];
  /** Injected clock: a record may not be dated after it (R10). */
  readonly clock?: Clock;
}

const STAGING = /\b(?:staging|stage|uat|pre-?prod(?:uction)?|non-?prod(?:uction)?)\b/i;
const PRODUCTION = /\b(?:production|prod)\b/i;
const GIT_ENV = { GIT_NO_LAZY_FETCH: '1' } as const;
const SHA = /^[0-9a-f]{7,64}$/;
/** A pipeline's clock may run a little ahead of the machine that checks. */
const CLOCK_SKEW_MS = 5 * 60 * 1000;

/** An environment that is positively not a delivery target: the development environment, or a preview / local /
 * sandbox one. Everything else is a target, so an environment whose purpose is free text ("live customer traffic")
 * cannot drop out of the check by not saying "production" (the conservative reading, as `secrets-resolved`'s). */
const NON_DELIVERY = /\b(?:preview|review|ephemeral|sandbox|local)\b/i;
/** A negated mention ("not a sandbox", "never dev") says the opposite: it is removed before a purpose is read. */
const NEGATED = /\b(?:not|never|no|non)[\s-]+(?:an?\s+|the\s+)?[a-z-]+/gi;

/** `production`, `pre-production` and `non-production` all contain the word: only a bare production is production. */
function isProductionOnly(purpose: string): boolean {
  return (
    PRODUCTION.test(purpose.replace(/\b(?:pre|non)-?prod(?:uction)?\b/gi, ' ')) &&
    !STAGING.test(purpose)
  );
}

function isNonTarget(environment: Environment): boolean {
  const purpose = environment.purpose;
  const said = purpose.replace(NEGATED, ' ');
  if (isProductionOnly(purpose)) return false;
  if (DEVELOPMENT_PURPOSE.test(said) && !OTHER_ENVIRONMENT_PURPOSE.test(said)) return true;
  return NON_DELIVERY.test(said);
}

function isTarget(environment: Environment): boolean {
  return !isNonTarget(environment);
}

/** Where a rollback must be rehearsed (`14` §14.4 rule 2: staging): every target that is not positively production,
 * so an unclassifiable environment is not exempt. */
function isRehearsalTarget(environment: Environment): boolean {
  return isTarget(environment) && !isProductionOnly(environment.purpose);
}

function violation(subject: string, message: string, remedy: string): GateViolation {
  return { subject, message, remedy };
}

type Register =
  | { readonly ok: true; readonly environments: readonly Environment[] }
  | { readonly ok: false; readonly problems: readonly GateViolation[] };

/** The register as COMMITTED, like the records: editing `environments.md` without committing changes nothing. An
 * absent file is an empty register; one that does not parse is a violation. */
async function readRegister(
  ctx: DeployEvidenceContext,
  committed: CommittedTree,
): Promise<Register> {
  const file = `${ctx.kbRoot}/${ENVIRONMENTS_FILE}`;
  if (!committed.files.has(file)) return { ok: true, environments: [] };
  const problem = (why: string): Register => ({
    ok: false,
    problems: [
      violation(
        ENVIRONMENTS_FILE,
        `The environment register could not be read (${file}: ${oneLine(why)}).`,
        `Repair ${file} so every entry has all seven fields, and commit it, then run the check again.`,
      ),
    ],
  });
  const text = await committed.read(file);
  if (!text.ok) return problem(text.detail);
  try {
    const parsed = environmentsFileSchema.safeParse(
      ArtifactDocument.parse(text.text, file).frontMatter,
    );
    if (!parsed.success) return problem(parsed.error.issues[0]?.message ?? 'invalid');
    return {
      ok: true,
      environments: [...parsed.data.environments].sort((a, b) => compare(a.id, b.id)),
    };
  } catch (cause) {
    return problem(errorMessage(cause));
  }
}

/** The full object id `sha` names, or `undefined` when it is not a commit of this repository. */
async function resolveCommit(projectRoot: string, sha: string): Promise<string | undefined> {
  const result = await execa('git', ['rev-parse', '--verify', '--quiet', `${sha}^{commit}`], {
    cwd: projectRoot,
    reject: false,
    env: GIT_ENV,
  });
  return result.exitCode === 0 ? result.stdout.trim() : undefined;
}

async function isAncestor(projectRoot: string, older: string, newer: string): Promise<boolean> {
  const result = await execa('git', ['merge-base', '--is-ancestor', older, newer], {
    cwd: projectRoot,
    reject: false,
    env: GIT_ENV,
  });
  return result.exitCode === 0;
}

/** A commit id the record names: present, well formed, in this repository, and in the history of the checked-out
 * commit. Returns the problem, or `undefined` when it is fine. */
async function commitProblem(
  ctx: DeployEvidenceContext,
  file: string,
  field: string,
  value: unknown,
): Promise<string | undefined> {
  if (typeof value !== 'string' || !SHA.test(value)) {
    return `${file} has no "${field}" (7 to 64 lowercase hex characters) naming a commit`;
  }
  if (!(await commitExists(ctx.projectRoot, value))) {
    return `${file} ${field} names commit ${value}, which is not in this repository`;
  }
  if (!(await isAncestorOfHead(ctx.projectRoot, value))) {
    return `${file} ${field} names commit ${value}, which is not in the history of the checked-out commit`;
  }
  return undefined;
}

/** The committer time of a commit, in milliseconds. */
async function commitTime(projectRoot: string, sha: string): Promise<number | undefined> {
  const result = await execa('git', ['show', '-s', '--format=%ct', `${sha}^{commit}`], {
    cwd: projectRoot,
    reject: false,
    env: GIT_ENV,
  });
  const seconds = Number(result.stdout.trim());
  return result.exitCode === 0 && Number.isFinite(seconds) ? seconds * 1000 : undefined;
}

/** An instant with a zone, not in the future and not before `floor` (the commit it is about: a dry run or a rehearsal
 * cannot predate the code it ran on). */
async function instantProblem(
  ctx: DeployEvidenceContext,
  file: string,
  field: string,
  value: unknown,
  about?: { readonly sha: string; readonly name: string },
): Promise<string | undefined> {
  if (!parsesAsInstant(value)) return `${file} has no ISO-8601 "${field}" with a zone`;
  const at = Date.parse(String(value));
  if (at > Date.parse((ctx.clock ?? SYSTEM_CLOCK).now()) + CLOCK_SKEW_MS) {
    return `${file} ${field} is in the future`;
  }
  if (about !== undefined) {
    const floor = await commitTime(ctx.projectRoot, about.sha);
    if (floor === undefined)
      return `${file} the commit ${about.sha.slice(0, 10)} has no readable date`;
    if (at < floor) {
      return `${file} ${field} is before the commit it records (${about.name} ${about.sha.slice(0, 10)}): it cannot have run on code that did not exist yet`;
    }
  }
  return undefined;
}

/** The record is about the code as it is now: no file outside the project's documents changed between the commit it
 * names and HEAD (`14` §14.4 rule 2: "for this stage's changes"). A record for an older commit says nothing about the
 * current one, so the pipeline must record again. */
async function staleProblem(
  ctx: DeployEvidenceContext,
  file: string,
  field: string,
  sha: string,
): Promise<string | undefined> {
  // `.`, an empty or an escaping root would exclude the whole tree (or nothing): only real sub-paths are excluded.
  const roots = (ctx.documentRoots ?? [ctx.kbRoot, ctx.reportsRoot]).filter(
    (root) =>
      root !== '' && root !== '.' && !root.startsWith('/') && !root.split('/').includes('..'),
  );
  const result = await execa(
    'git',
    [
      'diff',
      '--no-renames',
      '--name-only',
      '--no-ext-diff',
      sha,
      'HEAD',
      '--',
      '.',
      ...roots.map((root) => `:(exclude,literal)${root}`),
    ],
    { cwd: ctx.projectRoot, reject: false, env: GIT_ENV, maxBuffer: 8 * 1024 * 1024 },
  );
  if (result.exitCode !== 0)
    return `${file} ${field} cannot be compared with HEAD (git diff failed)`;
  const changed = result.stdout.split('\n').filter((line) => line !== '');
  if (changed.length === 0) return undefined;
  return `${file} ${field} ${sha.slice(0, 10)} is out of date: ${String(changed.length)} file(s) outside the project documents changed since (first: ${oneLine(changed[0], 80)}), so it says nothing about the current code`;
}

async function readRecord(
  file: string,
  committed: CommittedTree,
  environment: Environment,
  kind: string,
): Promise<{ readonly evidence: Record<string, unknown> } | { readonly problem: string }> {
  const entry = committed.files.get(file);
  if (entry === undefined)
    return { problem: `no ${kind} record at ${file} (or it is not committed)` };
  if (entry.size > MAX_EVIDENCE_BYTES) {
    return {
      problem: `${file} is ${String(entry.size)} bytes, over the ${String(MAX_EVIDENCE_BYTES)} byte limit for a delivery record`,
    };
  }
  const text = await committed.read(file);
  if (!text.ok) return { problem: `${file} could not be read (${oneLine(text.detail)})` };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.text.replace(/^\uFEFF/, ''));
  } catch (cause) {
    return { problem: `${file} could not be read as JSON (${oneLine(errorMessage(cause))})` };
  }
  const evidence = record(parsed);
  if (evidence === undefined) return { problem: `${file} is not a JSON object` };
  if (evidence['v'] !== 1) return { problem: `${file} does not declare "v": 1` };
  if (evidence['kind'] !== kind) {
    return { problem: `${file} records kind ${oneLine(evidence['kind'], 40)}, not "${kind}"` };
  }
  if (evidence['environment'] !== environment.id) {
    return {
      problem: `${file} records environment ${oneLine(evidence['environment'], 40)}, not ${environment.id}`,
    };
  }
  return { evidence };
}

async function dryRunProblem(
  ctx: DeployEvidenceContext,
  committed: CommittedTree,
  environment: Environment,
  file: string,
): Promise<string | undefined> {
  const read = await readRecord(file, committed, environment, 'dry-run');
  if ('problem' in read) return read.problem;
  const { evidence } = read;
  if (evidence['outcome'] !== 'passed') {
    return `${file} records outcome ${oneLine(evidence['outcome'], 40)}, not "passed"`;
  }
  const sha = await commitProblem(ctx, file, 'sha', evidence['sha']);
  if (sha !== undefined) return sha;
  const stale = await staleProblem(ctx, file, 'sha', String(evidence['sha']));
  if (stale !== undefined) return stale;
  return instantProblem(ctx, file, 'ran_at', evidence['ran_at'], {
    sha: String(evidence['sha']),
    name: 'sha',
  });
}

async function rollbackProblem(
  ctx: DeployEvidenceContext,
  committed: CommittedTree,
  environment: Environment,
  file: string,
): Promise<string | undefined> {
  const where = deployedUrl(environment.url);
  if ('reason' in where) {
    return `${environment.id}'s ${where.reason}, so a rollback cannot have been rehearsed on it`;
  }
  const read = await readRecord(file, committed, environment, 'rollback');
  if ('problem' in read) return read.problem;
  const { evidence } = read;
  if (evidence['outcome'] !== 'succeeded') {
    return `${file} records outcome ${oneLine(evidence['outcome'], 40)}, not "succeeded"`;
  }
  for (const field of ['from_sha', 'to_sha'] as const) {
    const problem = await commitProblem(ctx, file, field, evidence[field]);
    if (problem !== undefined) return problem;
  }
  const from = await resolveCommit(ctx.projectRoot, String(evidence['from_sha']));
  const to = await resolveCommit(ctx.projectRoot, String(evidence['to_sha']));
  if (from === undefined || to === undefined)
    return `${file} names a commit that cannot be resolved`;
  if (from === to)
    return `${file} rolls back from a commit to itself (from_sha and to_sha are the same commit)`;
  if (!(await isAncestor(ctx.projectRoot, to, from))) {
    return `${file} to_sha is not an ancestor of from_sha: it is not a rollback to an earlier version`;
  }
  const stale = await staleProblem(ctx, file, 'from_sha', from);
  if (stale !== undefined) return stale;
  const rehearsed = await instantProblem(ctx, file, 'rehearsed_at', evidence['rehearsed_at'], {
    sha: from,
    name: 'from_sha',
  });
  if (rehearsed !== undefined) return rehearsed;
  const health = record(evidence['health']);
  if (health === undefined) return `${file} has no "health" record of a check after the rollback`;
  if (typeof health['url'] !== 'string') return `${file} health.url is missing`;
  const checked = deployedUrl(health['url']);
  if ('reason' in checked) return `${file} health.url: ${checked.reason}`;
  if (checked.host !== where.host) {
    return `${file} health.url is on ${checked.host}, not the environment's ${where.host}`;
  }
  const status = health['status'];
  if (typeof status !== 'number' || !Number.isInteger(status) || status < 200 || status > 299) {
    return `${file} health.status is ${oneLine(status, 20)}, not a 2xx response`;
  }
  const healthTime = await instantProblem(ctx, file, 'health.checked_at', health['checked_at']);
  if (healthTime !== undefined) return healthTime;
  if (Date.parse(String(health['checked_at'])) < Date.parse(String(evidence['rehearsed_at']))) {
    return `${file} health.checked_at is before rehearsed_at: the check was not made after the rollback`;
  }
  return undefined;
}

const remedyRegister = (kbRoot: string): string =>
  `Record each environment in ${kbRoot}/${ENVIRONMENTS_FILE} (an ENV entry whose purpose says what it is: staging, production, development), and commit it.`;

type Judge = (
  ctx: DeployEvidenceContext,
  committed: CommittedTree,
  environment: Environment,
  file: string,
) => Promise<string | undefined>;

async function check(
  ctx: DeployEvidenceContext,
  options: {
    readonly name: string;
    readonly suffix: string;
    readonly pick: (environment: Environment) => boolean;
    readonly none: string;
    readonly judge: Judge;
    readonly remedy: (environment: Environment, file: string) => string;
  },
): Promise<GateCheckOutcome> {
  const committed = await readCommittedTree(ctx.projectRoot);
  if (!committed.ok) {
    return {
      fields: { check: options.name, checked: 0 },
      violations: [
        violation(
          'repository',
          `The repository cannot be read (${oneLine(committed.detail)}), so neither the environment register nor any record can be found.`,
          'Run the check inside a git repository with at least one commit.',
        ),
      ],
    };
  }
  const register = await readRegister(ctx, committed.tree);
  if (!register.ok)
    return { fields: { check: options.name, checked: 0 }, violations: register.problems };
  const targets = register.environments.filter(options.pick);
  const violations: GateViolation[] = [];
  if (targets.length === 0) {
    violations.push(
      violation(
        'environment',
        `${options.none} Recorded: ${register.environments.map((environment) => environment.id).join(', ') || 'none'}.`,
        remedyRegister(ctx.kbRoot),
      ),
    );
    return { fields: { check: options.name, checked: 0 }, violations };
  }
  for (const environment of targets) {
    const file = `${ctx.reportsRoot}/deployments/${environment.id}.${options.suffix}.json`;
    const problem = await options.judge(ctx, committed.tree, environment, file);
    if (problem !== undefined) {
      violations.push(
        violation(
          environment.id,
          `${environment.id}: ${problem}.`,
          options.remedy(environment, file),
        ),
      );
    }
  }
  return {
    fields: {
      check: options.name,
      checked: targets.length,
      environments: targets.slice(0, 100).map((environment) => environment.id),
    },
    violations,
  };
}

/** `forge deploy --dry-run`: every delivery-target environment has a passing dry-run record. */
export async function deployDryRunCheck(ctx: DeployEvidenceContext): Promise<GateCheckOutcome> {
  return check(ctx, {
    name: 'deploy-dry-run',
    suffix: 'dry-run',
    pick: isTarget,
    none: 'No delivery target environment is recorded (every recorded environment is a development, preview or local one), so no deploy dry-run can have passed.',
    judge: dryRunProblem,
    remedy: (environment, file) =>
      `Run the pipeline's deploy dry run against ${environment.id} and record it as ${file} ({v:1, kind:"dry-run", environment:"${environment.id}", outcome:"passed", sha, ran_at}, committed), or record a Waiver (reason, owner, expiry) on G-Deliver.`,
  });
}

/** `forge deploy --rollback-check`: every staging environment has a successful rollback rehearsal record. */
export async function deployRollbackCheck(ctx: DeployEvidenceContext): Promise<GateCheckOutcome> {
  return check(ctx, {
    name: 'deploy-rollback-check',
    suffix: 'rollback',
    pick: isRehearsalTarget,
    none: 'No staging environment is recorded (none is a delivery target other than production), so no rollback can have been rehearsed in staging.',
    judge: rollbackProblem,
    remedy: (environment, file) =>
      `Rehearse a rollback in ${environment.id} through the pipeline and record it as ${file} ({v:1, kind:"rollback", environment:"${environment.id}", outcome:"succeeded", from_sha, to_sha, rehearsed_at, health:{url, status, checked_at}}, committed), or record a Waiver (reason, owner, expiry) on G-Deliver.`,
  });
}
