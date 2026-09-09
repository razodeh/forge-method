/**
 * `forge agent <list|show|new|validate|compile>` plus `override|diff|reset` (`05` §5.9/§5.10) —
 * `03` §3.2.8.
 *
 * `validate --all` is `PLAN-M6.md`'s own literal M6 exit-test line
 * (`pnpm forge agent validate --all`) — it must be real and pass cleanly, zero findings, against the
 * real, complete A2/A3 roster, not merely exist.
 *
 * @see specs/03 §3.2.8
 * @see specs/05 §5.9
 * @see specs/05 §5.10
 */
import { rm } from 'node:fs/promises';

import {
  ForgeError,
  listDirEntriesSorted,
  pathExists,
  readTextFile,
  writeFileAtomic,
  type ProjectPaths,
} from '@forge/core';
import { loadAgentDefinition } from '@forge/agents/schema';
import type { AgentDefinition, AgentIssue } from '@forge/agents/schema';
import { globsOverlap } from '@forge/engine/plan';
import { FRAMEWORK_INDEX, SKILL_INDEX } from '@forge/templates';
import type { PlatformAdapter } from '@forge/adapter-kit/types';
import type { InstalledAsset } from '@forge/adapter-kit/types';
import * as YAML from 'yaml';

import { loadProjectAgent } from './loop/agent-loader.ts';

export interface AgentCommandContext {
  readonly paths: ProjectPaths;
  readonly agentsRoot: string;
}

interface AgentFileEntry {
  readonly id: string;
  readonly relPath: string;
}

async function listAgentFiles(ctx: AgentCommandContext): Promise<readonly AgentFileEntry[]> {
  if (!(await pathExists(ctx.paths.resolveWithin(ctx.agentsRoot)))) return [];
  const entries = await listDirEntriesSorted(ctx.paths.resolveWithin(ctx.agentsRoot));
  return entries
    .filter((entry) => !entry.isDirectory && entry.name.endsWith('.yaml'))
    .map((entry) => ({
      id: entry.name.replace(/\.yaml$/, ''),
      relPath: `${ctx.agentsRoot}/${entry.name}`,
    }));
}

/** `list` — every real, materialized agent id under `<agentsRoot>/`. */
export async function agentList(ctx: AgentCommandContext): Promise<readonly string[]> {
  return (await listAgentFiles(ctx)).map((entry) => entry.id);
}

/** `show <id>` — one real, materialized agent definition. */
export async function agentShow(ctx: AgentCommandContext, id: string): Promise<AgentDefinition> {
  return loadProjectAgent(ctx.paths, ctx.agentsRoot, id);
}

const AGENT_TEMPLATE = (id: string, name: string): string =>
  YAML.stringify({
    id,
    name,
    version: '1.0.0',
    tier: 'core',
    mandate: 'Describe this role’s real mandate.',
    decisions_owned: [],
    persona: {
      voice: 'plain',
      stance: 'pragmatic',
      disagreement_style: 'states the concern directly',
    },
    inputs: { required: [] },
    outputs: [{ type: 'Report', schema: 'report.schema.json', path: 'report.md' }],
    kb_write: [],
    tools: { read: true, write: false, network: false, git_commit: 'none', deploy: false },
    model: { tier: 'balanced', thinking: 'low' },
    limits: { max_turns: 20, wall_clock_ms: 600_000, max_cost_usd: 5 },
    parallel_safety: { file_ownership: [], exclusive: false },
    gates: { produces_evidence_for: [], may_approve: [] },
    prompt: { system: `Describe ${name}'s real system prompt here.` },
  } satisfies AgentDefinition);

/** `new <id>` — a real, minimal, schema-valid `AgentDefinition`, scaffolded and written to
 * `<agentsRoot>/<id>.yaml` (`05` §5.9's own "scaffolds from a template with all required fields"). No
 * real agent-definition template exists in `@forge/templates` (`TEMPLATE_INDEX` covers spec-tree
 * artifact types only) — this hand-authors the scaffold directly, the same real, minimal-defaults
 * approach `doctor/helpers.ts`'s own fixture manifest already establishes for the identical "no
 * shipped template exists, build one honestly by hand" shape. */
export async function agentNew(
  ctx: AgentCommandContext,
  id: string,
  name: string,
): Promise<string> {
  const relPath = `${ctx.agentsRoot}/${id}.yaml`;
  if (await pathExists(ctx.paths.resolveWithin(relPath))) {
    throw new ForgeError('CFG-001', { path: relPath, line: 0 });
  }
  await writeFileAtomic(ctx.paths.resolveWithin(relPath), AGENT_TEMPLATE(id, name));
  return relPath;
}

export interface AgentValidationFinding {
  readonly agentId: string;
  readonly severity: 'error' | 'warning';
  readonly code: string;
  readonly message: string;
}

function issueToFinding(agentId: string, issue: AgentIssue): AgentValidationFinding {
  return { agentId, severity: 'error', code: 'schema', message: `${issue.path}: ${issue.message}` };
}

/** `05` §5.9's own kb-write-overlap and file-ownership-overlap checks, run once across the whole real
 * roster (each pair checked once, not twice). `kb_write` has no `shared`-declaration field anywhere in
 * the real, currently-shipped `AgentDefinition` schema (confirmed directly), so — unlike
 * `file_ownership`, which only overlaps against another agent's own `exclusive: true` claim — every
 * real `kb_write` overlap is reported here, unconditionally; see `SPEC-QUESTIONS.md`. */
function overlapFindings(agents: readonly AgentDefinition[]): readonly AgentValidationFinding[] {
  const findings: AgentValidationFinding[] = [];
  for (let i = 0; i < agents.length; i++) {
    for (let j = i + 1; j < agents.length; j++) {
      const a = agents[i];
      const b = agents[j];
      if (a === undefined || b === undefined) continue;

      for (const globA of a.kb_write) {
        for (const globB of b.kb_write) {
          if (globsOverlap(globA, globB)) {
            // Reported against *both* real agents in the pair -- not just `a` -- so `validate <id>`
            // (which filters to one agent's own findings) surfaces this real overlap regardless of
            // which of the two ids a caller actually asks about.
            findings.push({
              agentId: a.id,
              severity: 'error',
              code: 'kb-write-overlap',
              message: `kb_write ${JSON.stringify(globA)} overlaps ${b.id}'s ${JSON.stringify(globB)}.`,
            });
            findings.push({
              agentId: b.id,
              severity: 'error',
              code: 'kb-write-overlap',
              message: `kb_write ${JSON.stringify(globB)} overlaps ${a.id}'s ${JSON.stringify(globA)}.`,
            });
          }
        }
      }

      const eitherExclusive = a.parallel_safety.exclusive || b.parallel_safety.exclusive;
      if (!eitherExclusive) continue;
      for (const globA of a.parallel_safety.file_ownership) {
        for (const globB of b.parallel_safety.file_ownership) {
          if (globsOverlap(globA, globB)) {
            findings.push({
              agentId: a.id,
              severity: 'error',
              code: 'file-ownership-overlap',
              message: `file_ownership ${JSON.stringify(globA)} overlaps ${b.id}'s exclusive ${JSON.stringify(globB)}.`,
            });
            findings.push({
              agentId: b.id,
              severity: 'error',
              code: 'file-ownership-overlap',
              message: `file_ownership ${JSON.stringify(globB)} overlaps ${a.id}'s exclusive ${JSON.stringify(globA)}.`,
            });
          }
        }
      }
    }
  }
  return findings;
}

/** `05` §5.9's own "declared frameworks exist"/"[skills] referenced exist" checks, against
 * `@forge/templates`' own real, shipped `FRAMEWORK_INDEX`/`SKILL_INDEX` — the same real registries
 * `writeRegenerableContent` itself already materializes into every real project's own `.forge/
 * frameworks/`/`.forge/skills/`. */
function referenceFindings(agent: AgentDefinition): readonly AgentValidationFinding[] {
  const findings: AgentValidationFinding[] = [];
  for (const framework of agent.frameworks ?? []) {
    if (!Object.hasOwn(FRAMEWORK_INDEX, framework)) {
      findings.push({
        agentId: agent.id,
        severity: 'error',
        code: 'unknown-framework',
        message: `frameworks names unknown framework ${JSON.stringify(framework)}.`,
      });
    }
  }
  for (const skill of agent.skills ?? []) {
    if (!Object.hasOwn(SKILL_INDEX, skill)) {
      findings.push({
        agentId: agent.id,
        severity: 'error',
        code: 'unknown-skill',
        message: `skills names unknown skill ${JSON.stringify(skill)}.`,
      });
    }
  }
  return findings;
}

/** `05` §5.9's own "tool grants don't exceed the module's ceiling" check — scoped to the real,
 * scalar `write`/`network`/`deploy` fields of the agent's own declared `ceiling.tools` (when present);
 * `exec` pattern subsumption (is every real `tools.exec` entry actually covered by a broader
 * `ceiling.tools.exec` pattern) needs real glob-subsumption logic beyond `globsOverlap`'s own
 * intersection test, a real, separate piece of work this check does not attempt — see
 * `SPEC-QUESTIONS.md`. `network`'s own real base/ceiling representational mismatch (`AgentToolGrant`'s
 * own doc comment: `false`/`'none'` mean the same thing across the two blocks) is normalized before
 * comparing. */
function ceilingFindings(agent: AgentDefinition): readonly AgentValidationFinding[] {
  const ceiling = agent.ceiling?.tools;
  if (ceiling === undefined) return [];
  const findings: AgentValidationFinding[] = [];

  if (ceiling.write === false && agent.tools.write) {
    findings.push({
      agentId: agent.id,
      severity: 'error',
      code: 'ceiling-exceeded',
      message: 'tools.write exceeds ceiling.tools.write.',
    });
  }
  if (ceiling.deploy === false && agent.tools.deploy) {
    findings.push({
      agentId: agent.id,
      severity: 'error',
      code: 'ceiling-exceeded',
      message: 'tools.deploy exceeds ceiling.tools.deploy.',
    });
  }
  if (ceiling.network !== undefined) {
    // A critic round caught the previous normalization handling only `false -> 'none'`, silently
    // skipping the comparison entirely for the real, schema-accepted `network: true` shape (`typeof
    // true !== 'string'`, so the whole check below was never reached) -- `true` means the identical
    // "unrestricted" intent `ceiling.tools.network`'s own `'full'` value names, so it normalizes the
    // same way, not past the check.
    const agentNetwork =
      agent.tools.network === false
        ? 'none'
        : agent.tools.network === true
          ? 'full'
          : agent.tools.network;
    const rank = { none: 0, allowlist: 1, full: 2 } as const;
    if (
      typeof agentNetwork === 'string' &&
      agentNetwork in rank &&
      ceiling.network in rank &&
      rank[agentNetwork] > rank[ceiling.network]
    ) {
      findings.push({
        agentId: agent.id,
        severity: 'error',
        code: 'ceiling-exceeded',
        message: `tools.network (${agentNetwork}) exceeds ceiling.tools.network (${ceiling.network}).`,
      });
    }
  }
  return findings;
}

async function loadRoster(ctx: AgentCommandContext): Promise<{
  readonly agents: readonly AgentDefinition[];
  readonly findings: readonly AgentValidationFinding[];
}> {
  const files = await listAgentFiles(ctx);
  const agents: AgentDefinition[] = [];
  const findings: AgentValidationFinding[] = [];
  for (const file of files) {
    const source = await readTextFile(ctx.paths.resolveWithin(file.relPath));
    const result = loadAgentDefinition(source, file.relPath);
    if (result.success) {
      agents.push(result.agent);
    } else {
      findings.push(...result.issues.map((issue) => issueToFinding(file.id, issue)));
    }
  }
  return { agents, findings };
}

/** `validate --all` — real schema validity, kb-write/file-ownership overlap, framework/skill
 * existence, and ceiling checks across the whole real, materialized roster. One agent's own real
 * schema failure does not stop the rest of the roster from being checked (`readAgentDefinition` never
 * throws), matching every other "many independent real checks" command in this file family. */
export async function agentValidateAll(
  ctx: AgentCommandContext,
): Promise<readonly AgentValidationFinding[]> {
  const { agents, findings } = await loadRoster(ctx);
  return [
    ...findings,
    ...overlapFindings(agents),
    ...agents.flatMap((agent) => referenceFindings(agent)),
    ...agents.flatMap((agent) => ceilingFindings(agent)),
  ];
}

/** `validate <id>` — the same real checks as `--all`, scoped to findings naming this one agent (the
 * overlap checks are inherently pairwise against the rest of the real roster, so still real and
 * complete, just filtered to this agent's own reported findings). */
export async function agentValidateOne(
  ctx: AgentCommandContext,
  id: string,
): Promise<readonly AgentValidationFinding[]> {
  const all = await agentValidateAll(ctx);
  return all.filter((finding) => finding.agentId === id);
}

export interface AgentCompileContext extends AgentCommandContext {
  readonly adapter: PlatformAdapter;
  readonly projectRoot: string;
}

/** `compile` — `05` §5.9's own "emits platform-native assets" — real `installAssets` (`@forge/
 * adapter-kit`), called once over the whole real, materialized roster, the identical shape `forge
 * init`'s own `writeInitTree` already calls it with (`init/write-tree.ts`), just triggered outside
 * `init` this time. Refuses with `ENV-004` when the injected adapter has no real `installAssets` of
 * its own — the same "not every adapter offers every optional capability" shape every other optional
 * `PlatformAdapter` method already gets treated with elsewhere in this codebase. */
export async function agentCompile(ctx: AgentCompileContext): Promise<readonly InstalledAsset[]> {
  if (ctx.adapter.installAssets === undefined) {
    throw new ForgeError('ENV-004', { tool: ctx.adapter.id });
  }
  const { agents } = await loadRoster(ctx);
  return ctx.adapter.installAssets({
    projectRoot: ctx.paths.resolveWithin('.'),
    agents: agents.map((agent) => ({ id: agent.id, displayName: agent.name })),
  });
}

const OVERRIDES_ROOT = '.forge/overrides/agents';

/** `override <id>` — writes a real, partial overlay document (`05` §5.10`'s own `$extends`-shaped
 * `.forge/overrides/agents/<id>.agent.yaml`) verbatim. This command does not itself validate the
 * overlay's own shape (`15` §15.2's own overlay-operator rules) — that is `forge compile`'s own real
 * job (`@forge/extensions/compile`), run separately once real `CompileSources` gathering exists (see
 * `compile.ts`'s own doc comment). */
export async function agentOverride(
  ctx: AgentCommandContext,
  id: string,
  overlayYaml: string,
): Promise<string> {
  const relPath = `${OVERRIDES_ROOT}/${id}.agent.yaml`;
  await writeFileAtomic(ctx.paths.resolveWithin(relPath), overlayYaml);
  return relPath;
}

/** `reset <id>` — deletes a real project override, if one exists; a real, honest no-op (not an error)
 * when there was never one to begin with. */
export async function agentReset(ctx: AgentCommandContext, id: string): Promise<boolean> {
  const relPath = `${OVERRIDES_ROOT}/${id}.agent.yaml`;
  const absolute = ctx.paths.resolveWithin(relPath);
  if (!(await pathExists(absolute))) return false;
  await rm(absolute);
  return true;
}

/** `diff <id>` — `05` §5.10's own "shows base vs resolved with per-field layer provenance." Needs a
 * real, already-compiled `CompileResult` (`forge compile`'s own output) to ask `overlayExplain` about
 * — the same "this command's real caller already has the expensive object" shape `overlay.ts`'s own
 * `overlayExplain` already takes as a parameter, reused directly here rather than a second wrapper. */
export { overlayExplain as agentDiff } from './overlay.ts';
