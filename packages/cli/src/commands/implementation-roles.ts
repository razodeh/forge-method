/**
 * Who may own a Story (`PLAN-M13.md` P36, `09` §9.3, `10` §10.6): the implementation roles of the project's own agent
 * roster.
 *
 * `implement-story`'s `plan`, `green`, `refactor` and `document` steps run as `{{ownerRole}}`, the Story's `owner_role`,
 * with that agent's own write grant. Before this, `owner_role` was any non-empty string, so a story owned by `security`,
 * `pm` or `release` ran an authoring role over the story's source. A role is an implementation role when the agent
 * declares a source-code output (`isImplementationAgent`, the derivation `05` §5.2's separation rule and the agent-output
 * registry test already share): the set is read from `.forge/agents`, never listed here, so a project's own implementer
 * counts and a project without one refuses every owner.
 *
 * @see specs/09 §9.3
 * @see specs/10 §10.6
 */
import { isForgeError } from '@forge/core/errors';
import { listDirEntriesSorted, type ProjectPaths } from '@forge/core/fs';
import { isImplementationAgent, readAgentDefinition } from '@forge/agents/schema';

function isNoEntry(error: unknown): boolean {
  const inner = isForgeError(error) ? error.cause : error;
  return typeof inner === 'object' && inner !== null && 'code' in inner && inner.code === 'ENOENT';
}

/**
 * The implementation roles of the project's roster: the file names (`<id>.yaml`, the id `implement-story` resolves an owner
 * by) of the agents that declare a source-code output. `undefined` only when there is no roster at all (no
 * `.forge/agents`, or no agent file in it): nothing can be judged, and any run fails on its missing agents anyway.
 *
 * A file that cannot be read or parsed is not an implementation role, and is not a reason to stop judging: one corrupt
 * unrelated agent must not switch the check off for every Story. A roster directory that cannot be listed for any reason but
 * "absent" (permissions, a file where the directory should be) throws rather than reads as "no roster".
 */
export async function readImplementationRoles(
  paths: ProjectPaths,
  agentsRoot: string,
): Promise<readonly string[] | undefined> {
  let entries: Awaited<ReturnType<typeof listDirEntriesSorted>>;
  try {
    entries = await listDirEntriesSorted(paths.resolveWithin(agentsRoot));
  } catch (cause) {
    if (isNoEntry(cause)) return undefined;
    throw cause;
  }
  const files = entries.filter((entry) => !entry.isDirectory && entry.name.endsWith('.yaml'));
  if (files.length === 0) return undefined;
  const roles: string[] = [];
  for (const file of files) {
    try {
      const result = await readAgentDefinition(paths, `${agentsRoot}/${file.name}`);
      if (result.success && isImplementationAgent(result.agent)) {
        roles.push(file.name.slice(0, -'.yaml'.length));
      }
    } catch {
      // Unreadable: not an implementation role (see above).
    }
  }
  return roles.sort();
}

/** Why `ownerRole` may not own a Story, or `undefined` when it may (or `roles` is unknown). The message names the roles
 * that are allowed, so the fix is in the text. */
export function ownerRoleProblem(
  ownerRole: string,
  roles: readonly string[] | undefined,
): string | undefined {
  if (roles === undefined) return undefined;
  const owner = ownerRole.trim();
  if (roles.includes(owner)) return undefined;
  const allowed = roles.length === 0 ? 'none (no agent declares a Code output)' : roles.join(', ');
  return (
    `owner_role ${JSON.stringify(ownerRole)} is not an implementation role: the story's implement-story steps run as its ` +
    `owner with write access to its source, so the owner must be an agent that produces code. Allowed roles here: ${allowed}. ` +
    'Set owner_role to one of them in the Story document.'
  );
}
