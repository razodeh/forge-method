/**
 * `secrets-resolved` (`G-Deliver`) and `skeleton-deployed` (`G-Foundation`), `PLAN-M13.md` P25.
 *
 * `skeleton-deployed` closes a gap between the specs and the shipped gate: `11` F-INIT-7 ("the walking skeleton ...
 * deployed by the pipeline to a dev environment. `G-Foundation` verifies exactly this") and `14` §14.9
 * ("G-Foundation: Walking skeleton deploys to a real environment via the pipeline") say the gate verifies a
 * deployed skeleton, and `G-Foundation.gate.yaml` had four checks and none of them was deployment. The owner kept
 * the requirement (P11 question 8): a check, coverable by a recorded Waiver on a project with no environment yet.
 *
 * @see specs/11 F-INIT-7
 * @see specs/14 §14.4, §14.9
 * @see PLAN-M13.md P25
 */
import { pathExists } from '@forge/core/fs';
import { parseKbTree } from '@forge/kb/schema';
import type { Environment } from '@forge/schemas';
import { execa } from 'execa';

import { readCommittedTree } from './committed-tree.ts';
import { scanSecretReferences } from './secrets.ts';
import type { DoctorRuleContext, DoctorRuleViolation } from './rules.ts';

function violation(subject: string, message: string, remedy: string): DoctorRuleViolation {
  return { subject, message, remedy };
}

/** `14` §14.7 item 6 / `10` §10.3 "secrets unresolved". Every `${secret:NAME}` reference in the project's own
 * configuration and documents resolves to a variable that is set and non-empty in the environment the check runs
 * in. Values are never read into a result: only names are reported (`03` §3.7). */
export async function secretsResolvedViolations(
  ctx: DoctorRuleContext,
): Promise<readonly DoctorRuleViolation[]> {
  const scan = await scanSecretReferences(ctx.paths, ctx.env, true);
  return scan.unresolved.map((name) =>
    violation(
      `secret:${name}`,
      `\${secret:${name}} is referenced but the environment variable ${name} is unset or empty in the environment this check runs in.`,
      `Set ${name} in the environment (from the secret manager the Environment entry names) and run the check again.`,
    ),
  );
}

// ---------------------------------------------------------------------------------------------------------------
// skeleton-deployed
// ---------------------------------------------------------------------------------------------------------------

/** An environment whose `purpose` says it is the development environment. Word-bounded, so `device` and `devops`
 * do not match; the local one the scaffold records ("Local development") matches too and is excluded by its URL. */
const DEVELOPMENT_PURPOSE = /\b(dev|development)\b/i;

/** A purpose that also names another environment ("Production (never dev)") is not the development environment. */
const OTHER_ENVIRONMENT_PURPOSE = /\b(prod|production|staging|stage|preview|uat)\b/i;

const ENVIRONMENTS_FILE = 'delivery/environments.md';

/** A deployment record is a few hundred bytes; this is a ceiling, not a target. */
const MAX_EVIDENCE_BYTES = 1024 * 1024;

/** The IPv4 address an IPv4-mapped or IPv4-compatible IPv6 host (`::ffff:7f00:1`, `::ffff:127.0.0.1`, `::7f00:1`) stands for, so the local-address
 * test below cannot be dodged by spelling. */
function mappedIpv4(host: string): string | undefined {
  const dotted = /^::(?:ffff:)?(\d{1,3}(?:\.\d{1,3}){3})$/.exec(host);
  if (dotted?.[1] !== undefined) return dotted[1];
  const hex = /^::(?:ffff:)?([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(host);
  if (hex?.[1] === undefined || hex[2] === undefined) return undefined;
  const high = parseInt(hex[1], 16);
  const low = parseInt(hex[2], 16);
  return `${String(high >> 8)}.${String(high & 255)}.${String(low >> 8)}.${String(low & 255)}`;
}

/** An address that cannot be a deployed environment: loopback, unspecified, link-local, mDNS, a single-label name.
 * Private RFC 1918 ranges are NOT here: a development environment on a company network is a real deployment. */
function isLoopbackOrLocalHost(host: string): boolean {
  if (host === '') return true;
  const mapped = mappedIpv4(host);
  if (mapped !== undefined) return isLoopbackOrLocalHost(mapped);
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
    return host.startsWith('127.') || host.startsWith('0.') || host.startsWith('169.254.');
  }
  if (host.includes(':')) return host === '::1' || host === '::' || /^fe[89ab][0-9a-f]:/.test(host);
  return (
    !host.includes('.') ||
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host === 'host.docker.internal'
  );
}

/** The lower-case host of a URL without its port or IPv6 brackets. `URL.host` (with the port) is stripped here
 * rather than reading `URL.hostname`, which the R10 lint rule treats as a machine fact (it is not one for a URL). */
function hostOf(url: URL): string {
  return url.host
    .toLowerCase()
    .replace(/:\d+$/, '')
    .replace(/^\[|\]$/g, '')
    .replace(/\.+$/, '');
}

/** The URL of a real, reachable-in-principle deployed environment, or a reason it is not one. */
function deployedUrl(url: string): { readonly host: string } | { readonly reason: string } {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { reason: `its url ${JSON.stringify(url)} is not a URL` };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { reason: `its url ${JSON.stringify(url)} is not an http(s) URL` };
  }
  const host = hostOf(parsed);
  if (isLoopbackOrLocalHost(host)) {
    return {
      reason: `its url ${JSON.stringify(url)} is a local address, not a deployed environment`,
    };
  }
  return { host };
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/** An ISO-8601 instant WITH a zone (`Z` or an offset). A timestamp with none is read in the local zone by
 * `Date.parse`, so the verdict of comparing two of them would depend on the machine's `TZ` (R10). */
function parsesAsInstant(value: unknown): boolean {
  return (
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})$/.test(value) &&
    !Number.isNaN(Date.parse(value))
  );
}

/** Never fetch from a promisor remote to answer a question about a local repository: the check reads project state
 * and must not touch the network. */
const GIT_ENV = { GIT_NO_LAZY_FETCH: '1' } as const;

async function commitExists(projectRoot: string, sha: string): Promise<boolean> {
  const result = await execa('git', ['cat-file', '-e', `${sha}^{commit}`], {
    cwd: projectRoot,
    reject: false,
    env: GIT_ENV,
  });
  return result.exitCode === 0;
}

/** Whether `sha` is in the history of the checked-out commit: a deployment of a commit that is not part of this
 * project's history says nothing about it. */
async function isAncestorOfHead(projectRoot: string, sha: string): Promise<boolean> {
  const result = await execa('git', ['merge-base', '--is-ancestor', sha, 'HEAD'], {
    cwd: projectRoot,
    reject: false,
    env: GIT_ENV,
  });
  return result.exitCode === 0;
}

/** What is wrong with the recorded deployment of `environment`, or `undefined` when it proves a successful,
 * healthy deployment of a commit that exists. The record's location and fields are P25's (Q219): `14` §14.4 rule 5
 * says deployments are recorded (artifact, SHA, outcome) and §14.3 rule 7 says stage results land in
 * `docs/forge/reports/`, but neither defines a file. */
async function deploymentProblem(
  ctx: DoctorRuleContext,
  environment: Environment,
  host: string,
  evidencePath: string,
): Promise<string | undefined> {
  // The record is read from the committed project, like the clean-clone rules read it: a file that only exists in the
  // working tree is not part of the repository, and reading it through git also means a FIFO or a symlink to
  // `/dev/zero` at that path cannot hang or exhaust the check.
  const committed = await readCommittedTree(ctx.projectRoot);
  if (!committed.ok) return `the repository cannot be read (${committed.detail})`;
  const file = committed.tree.files.get(evidencePath);
  if (file === undefined) {
    const present = await pathExists(ctx.paths.resolveWithin(evidencePath));
    return present
      ? `${evidencePath} exists but is not committed`
      : `no deployment record at ${evidencePath}`;
  }
  if (file.size > MAX_EVIDENCE_BYTES) {
    return `${evidencePath} is ${String(file.size)} bytes, over the ${String(MAX_EVIDENCE_BYTES)} byte limit for a deployment record`;
  }
  const text = await committed.tree.read(evidencePath);
  if (!text.ok) return `${evidencePath} could not be read (${text.detail})`;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.text.replace(/^\uFEFF/, ''));
  } catch (cause) {
    return `${evidencePath} could not be read as JSON (${cause instanceof Error ? cause.message : String(cause)})`;
  }
  const evidence = record(parsed);
  if (evidence === undefined) return `${evidencePath} is not a JSON object`;
  if (evidence['v'] !== 1) return `${evidencePath} does not declare "v": 1`;
  if (evidence['environment'] !== environment.id) {
    return `${evidencePath} records environment ${JSON.stringify(evidence['environment'])}, not ${environment.id}`;
  }
  if (evidence['outcome'] !== 'succeeded') {
    return `${evidencePath} records outcome ${JSON.stringify(evidence['outcome'])}, not "succeeded"`;
  }
  const sha = evidence['sha'];
  if (typeof sha !== 'string' || !/^[0-9a-f]{7,64}$/.test(sha)) {
    return `${evidencePath} has no "sha" (7 to 64 lowercase hex characters) naming the deployed commit`;
  }
  if (!(await commitExists(ctx.projectRoot, sha))) {
    return `${evidencePath} names commit ${sha}, which is not in this repository`;
  }
  if (!(await isAncestorOfHead(ctx.projectRoot, sha))) {
    return `${evidencePath} names commit ${sha}, which is not in the history of the checked-out commit`;
  }
  if (!parsesAsInstant(evidence['deployed_at'])) {
    return `${evidencePath} has no ISO-8601 "deployed_at"`;
  }
  const health = record(evidence['health']);
  if (health === undefined) return `${evidencePath} has no "health" record of a post-deploy check`;
  if (typeof health['url'] !== 'string') return `${evidencePath} health.url is missing`;
  const checked = deployedUrl(health['url']);
  if ('reason' in checked) return `${evidencePath} health.url: ${checked.reason}`;
  if (checked.host !== host) {
    return `${evidencePath} health.url is on ${checked.host}, not the environment's ${host}`;
  }
  const status = health['status'];
  if (typeof status !== 'number' || !Number.isInteger(status) || status < 200 || status > 299) {
    return `${evidencePath} health.status is ${JSON.stringify(status)}, not a 2xx response`;
  }
  if (!parsesAsInstant(health['checked_at'])) {
    return `${evidencePath} has no ISO-8601 "health.checked_at"`;
  }
  if (Date.parse(String(health['checked_at'])) < Date.parse(String(evidence['deployed_at']))) {
    return `${evidencePath} health.checked_at is before deployed_at: the check was not made after the deployment`;
  }
  return undefined;
}

const SKELETON_REMEDY =
  'Deploy the walking skeleton to a development environment through the pipeline, record that environment as an ENV entry in kb/delivery/environments.md and the deployment as docs/forge/reports/deployments/<ENV-id>.json (see Q219 for the fields), or record a Waiver (reason, owner, expiry) on G-Foundation if no environment exists yet.';

/** `11` F-INIT-7 / `14` §14.9: "the walking skeleton ... deployed by the pipeline to a dev environment". Passes when
 * an `Environment` entry for a development environment has a real (non-local) URL AND a deployment record shows a
 * succeeded deployment of a commit in this repository with a 2xx health check on that environment's host. The entry
 * alone is not enough: an ENV entry describes an environment, it does not show anything was deployed to it. */
export async function skeletonDeployedViolations(
  ctx: DoctorRuleContext,
): Promise<readonly DoctorRuleViolation[]> {
  const tree = await parseKbTree(ctx.paths, ctx.kbRoot);
  const unreadable = tree.errors.filter(
    (error) => error.path === ENVIRONMENTS_FILE || error.path === ctx.kbRoot,
  );
  if (unreadable.length > 0) {
    return unreadable.map((error) =>
      violation(
        ENVIRONMENTS_FILE,
        `The environment register could not be read (${error.path}: ${error.message}).`,
        `Repair ${ctx.kbRoot}/${ENVIRONMENTS_FILE} so every entry has all seven fields, then run the check again.`,
      ),
    );
  }
  const environments = tree.entries.flatMap((entry) =>
    entry.kind === 'environments-file' ? entry.value.environments : [],
  );
  if (environments.length === 0) {
    return [
      violation(
        'environment',
        `No Environment entry is recorded (${ctx.kbRoot}/${ENVIRONMENTS_FILE}), so no walking skeleton has been shown deployed.`,
        SKELETON_REMEDY,
      ),
    ];
  }
  const development = environments.filter(
    (environment) =>
      DEVELOPMENT_PURPOSE.test(environment.purpose) &&
      !OTHER_ENVIRONMENT_PURPOSE.test(environment.purpose),
  );
  if (development.length === 0) {
    return [
      violation(
        'environment',
        `No Environment entry is a development environment (none has a purpose that says dev or development). Recorded: ${environments.map((environment) => environment.id).join(', ')}.`,
        SKELETON_REMEDY,
      ),
    ];
  }

  const violations: DoctorRuleViolation[] = [];
  const local: string[] = [];
  for (const environment of [...development].sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  )) {
    const where = deployedUrl(environment.url);
    if ('reason' in where) {
      local.push(`${environment.id} (${where.reason})`);
      continue;
    }
    const evidencePath = `${ctx.reportsRoot}/deployments/${environment.id}.json`;
    const problem = await deploymentProblem(ctx, environment, where.host, evidencePath);
    if (problem === undefined) return [];
    violations.push(violation(environment.id, `${environment.id}: ${problem}.`, SKELETON_REMEDY));
  }
  if (violations.length === 0) {
    violations.push(
      violation(
        'environment',
        `Only local development environments are recorded: ${local.join('; ')}. The walking skeleton has not been deployed to a real environment.`,
        SKELETON_REMEDY,
      ),
    );
  }
  return violations;
}
