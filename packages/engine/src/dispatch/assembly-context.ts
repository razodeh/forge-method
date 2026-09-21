/**
 * `createPromptAssemblyContext` — the real `PromptAssemblyContext` (`types.ts`) for a project, built from
 * its `.forge/config.yaml`: the one production constructor, so `forge run` cannot reach dispatch with any
 * of the pieces prompt assembly needs missing (`PLAN-M13.md` P5, D4).
 *
 * KB access reuses `forge kb`'s own way of opening the index (`parseKbTree` + `openKbIndex`, D6) rather
 * than a second one: a fresh project has no entries and no synced index, and both return empty results
 * rather than failing, so the pinned core and skills still pack. The tree is read from the *integration*
 * worktree (`ctx.integrationPath`), because that is where earlier steps' merged lanes land and what a new
 * lane branches from; the search index stays the project's own (`.forge/state/index.db`), read the way
 * `forge kb search` reads it -- whatever the last `forge kb sync` produced, ids the tree lacks skipped.
 *
 * @see specs/05 §5.4, §5.8
 * @see specs/15 §15.3.2
 * @see PLAN-M13.md P5
 * @see SPEC-QUESTIONS.md Q203
 */
import { ForgeError, ProjectPaths, isForgeError, type AbsolutePath } from '@forge/core';
import { listDirEntriesSorted } from '@forge/core/fs';
import type { Escalation } from '@forge/extensions/agents';
import type { StyleProfile } from '@forge/extensions/style';
import { resolveContentReference } from '@forge/agents/prompt';
import { readAgentDefinition, type AgentDefinition } from '@forge/agents/schema';
import { JsonBackend, openKbIndex, parseKbTree } from '@forge/kb';
import type { ForgeConfig } from '@forge/schemas/config';
import { z } from 'zod';

import type { KbAccess, PromptAssemblyContext } from './types.ts';

const escalationGrantSchema = z
  .object({
    write: z.boolean().optional(),
    exec: z.array(z.string().min(1)).optional(),
    network: z.enum(['none', 'allowlist', 'full']).optional(),
    deploy: z.boolean().optional(),
    allowlistHosts: z.array(z.string().min(1)).optional(),
  })
  .strict();

const escalationSchema = z
  .object({
    agent: z.string().min(1),
    grant: escalationGrantSchema,
    reason: z.string().min(1),
    approvedBy: z.string().min(1),
    approvedAt: z.string().min(1),
    expires: z.string().min(1),
  })
  .strict();

/**
 * `security.toolCeilingEscalations` is schema-typed `unknown[]` (`SPEC-QUESTIONS.md` Q196); this is the
 * validation `resolveStepToolGrant` requires of whoever sources that list. Any malformed entry throws
 * `CFG-054`: skipping it would ignore a grant a human believes is in force, and an unvalidated cast is the
 * fail-open that piece exists to prevent.
 *
 * @throws {ForgeError} `CFG-054`.
 */
export function parseEscalations(raw: readonly unknown[]): readonly Escalation[] {
  return raw.map((entry, index) => {
    const parsed = escalationSchema.safeParse(entry);
    if (!parsed.success) {
      throw new ForgeError('CFG-054', {
        index,
        detail: parsed.error.issues
          .map((issue) => `${issue.path.join('.') || '(entry)'}: ${issue.message}`)
          .join('; '),
      });
    }
    const { agent, grant, reason, approvedBy, approvedAt, expires } = parsed.data;
    return {
      agent,
      // `Escalation.grant`'s optional fields carry no `| undefined`; drop the ones zod left undefined.
      grant: {
        ...(grant.write === undefined ? {} : { write: grant.write }),
        ...(grant.exec === undefined ? {} : { exec: grant.exec }),
        ...(grant.network === undefined ? {} : { network: grant.network }),
        ...(grant.deploy === undefined ? {} : { deploy: grant.deploy }),
        ...(grant.allowlistHosts === undefined ? {} : { allowlistHosts: grant.allowlistHosts }),
      },
      reason,
      approvedBy,
      approvedAt,
      expires,
    };
  });
}

function isNoEntry(error: unknown): boolean {
  const inner = isForgeError(error) ? error.cause : error;
  return typeof inner === 'object' && inner !== null && 'code' in inner && inner.code === 'ENOENT';
}

function isMissingFile(error: unknown): boolean {
  const inner = isForgeError(error) ? error.cause : error;
  if (typeof inner !== 'object' || inner === null || !('code' in inner)) return false;
  return inner.code === 'ENOENT' || inner.code === 'ENOTDIR';
}

/** A file name safe to read as `<agentsRoot>/<id>.yaml`: one path segment, no separators or traversal. */
const AGENT_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/**
 * Reads one agent from the project's resolved roster, `<agentsRoot>/<agentId>.yaml` (`forge init` /
 * `forge compile` write the fully resolved definitions there: `extends` walked, overrides applied). The one
 * reader both dispatch (`loadAgent`) and the session roster (`listProjectAgents`) go through.
 *
 * @throws {ForgeError} `RUN-056` when the agent is absent, unparseable or declares a different id than
 * the file name; any other I/O failure propagates unchanged so it stays retryable.
 */
export async function readProjectAgent(
  paths: ProjectPaths,
  agentsRoot: string,
  agentId: string,
): Promise<AgentDefinition> {
  const relative = `${agentsRoot}/${agentId}.yaml`;
  if (!AGENT_ID.test(agentId)) throw new ForgeError('RUN-056', { agentId, path: relative });
  let result;
  try {
    result = await readAgentDefinition(paths, relative);
  } catch (cause) {
    // `readTextFile` wraps every file-system failure in `RUN-034`. Only "no such file" means the roster
    // lacks this agent; anything else (`EMFILE`, `EBUSY`) is an I/O hiccup and propagates unchanged so
    // it stays retryable.
    if (isMissingFile(cause))
      throw new ForgeError('RUN-056', { agentId, path: relative }, { cause });
    throw cause;
  }
  if (!result.success) {
    throw new ForgeError(
      'RUN-056',
      { agentId, path: relative },
      { cause: new Error(JSON.stringify(result.issues)) },
    );
  }
  // The ceiling and role classification are keyed by the id *inside* the file; a file that names a
  // different agent than the one dispatched must not lend that agent its grant.
  if (result.agent.id !== agentId) {
    throw new ForgeError(
      'RUN-056',
      { agentId, path: relative },
      { cause: new Error(`file declares id "${result.agent.id}"`) },
    );
  }
  return result.agent;
}

/**
 * Every agent in the project's resolved roster (`<agentsRoot>/*.yaml`), sorted by file name: the roster a
 * session step draws its participants and its DECIDE owner from (`16` §16.3 step 4, `05` §5.3
 * `decisions_owned`). It is the same directory dispatch reads, so a project that can dispatch an agent can
 * seat it in a session; the `<project>/modules/` source tree a real `forge init` project does not have is
 * never consulted (`PLAN-M13.md` P27, Q215).
 *
 * An absent directory is an empty roster (a project not yet initialised has no decision owner, which the
 * session's human-input fallback handles). A file that exists but does not load is NOT skipped: dropping a
 * decision owner silently would hand the decision to the next agent in line, so it fails `RUN-056` naming
 * the file; so does a `.yaml` file whose name is not an agent id. A roster path that is not a directory
 * fails with the file-system error (`RUN-034`). Only directories and non-`.yaml` entries are ignored (as `forge agent list` does). The whole directory is read for every session step on purpose: one
 * half-edited roster file fails the step loudly rather than being routed around.
 *
 * @throws {ForgeError} `RUN-056` for a roster file that fails to load, `RUN-034` for an unreadable roster directory.
 */
export async function listProjectAgents(
  paths: ProjectPaths,
  agentsRoot: string,
  load: (agentId: string) => Promise<AgentDefinition> = (agentId) =>
    readProjectAgent(paths, agentsRoot, agentId),
): Promise<readonly AgentDefinition[]> {
  let entries: Awaited<ReturnType<typeof listDirEntriesSorted>>;
  try {
    entries = await listDirEntriesSorted(paths.resolveWithin(agentsRoot));
  } catch (cause) {
    // Only "no such directory" is an empty roster; a file where the directory should be, or an unreadable
    // directory, is an environment fault the caller must see.
    if (isNoEntry(cause)) return [];
    throw cause;
  }
  const agents: AgentDefinition[] = [];
  for (const { name, isDirectory } of entries) {
    // The same entries `forge agent list` counts: files ending `.yaml`.
    if (isDirectory || !name.endsWith('.yaml')) continue;
    // A name that is not an agent id (`readProjectAgent` refuses it with `RUN-056`) is not skipped: a
    // dropped file could be a decision owner.
    agents.push(await load(name.slice(0, -'.yaml'.length)));
  }
  return agents;
}

export interface CreatePromptAssemblyInput {
  /** The project root's paths: where config, `.forge/agents|briefs|prompts` and run state live. */
  readonly paths: ProjectPaths;
  /** The integration worktree's root (`ExecuteStepContext.integrationPath`). */
  readonly integrationPath: string;
  /** Project-relative directory of materialized agent definitions (`.forge/agents`). */
  readonly agentsRoot: string;
  readonly config: ForgeConfig;
  /** Where `@forge/templates` is installed, for skill packages (`packForStep`). */
  readonly templatesPackageRoot: AbsolutePath;
  readonly styleProfile?: StyleProfile | undefined;
}

export function createPromptAssemblyContext(
  input: CreatePromptAssemblyInput,
): PromptAssemblyContext {
  const { paths, config } = input;
  const integrationPaths = new ProjectPaths(input.integrationPath);
  const agentCache = new Map<string, Promise<AgentDefinition>>();

  const loadAgent = (agentId: string): Promise<AgentDefinition> => {
    const cached = agentCache.get(agentId);
    if (cached !== undefined) return cached;
    const loading = readProjectAgent(paths, input.agentsRoot, agentId);
    agentCache.set(agentId, loading);
    // A failed load is not cached: the file may be created before the next attempt.
    loading.catch(() => agentCache.delete(agentId));
    return loading;
  };

  return {
    paths,
    loadAgent,
    listAgents: () => listProjectAgents(paths, input.agentsRoot, loadAgent),
    loadContent: (reference) => resolveContentReference(paths, reference),
    openKb: async (): Promise<KbAccess> => {
      const tree = await parseKbTree(integrationPaths, config.paths.kb);
      const backend = openKbIndex(paths);
      return {
        backend,
        tree,
        parseErrorCount: tree.errors.length,
        close: () => {
          // `JsonBackend.close()` rewrites the whole index file from what it loaded. Prompt assembly only
          // reads, and a concurrent `forge kb sync` may have replaced that file since: writing it back
          // would clobber the sync. SQLite backends hold a real handle and are closed.
          if (!(backend instanceof JsonBackend)) backend.close();
        },
      };
    },
    models: config.models,
    escalations: parseEscalations(config.security.toolCeilingEscalations),
    autonomy: config.execution.autonomy,
    kbPackBudgetTokens: config.kb.packBudgetTokens,
    skillsPackBudgetTokens: config.skills.packBudgetTokens,
    templatesPackageRoot: input.templatesPackageRoot,
    pinnedCore: { projectIdentity: config.project.name, level: config.project.level },
    styleProfile: input.styleProfile,
    testCommands: config.execution.testCommands,
  };
}
