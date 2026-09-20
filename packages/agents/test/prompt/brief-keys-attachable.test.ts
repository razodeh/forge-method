/**
 * Every `prompt.briefs.<key>` of every shipped agent must be attachable (`PLAN-M13.md` P3c,
 * `SPEC-QUESTIONS.md` Q198/Q199/Q203/Q205).
 *
 * `assembleAgentSession` (`packages/engine/src/dispatch/assemble.ts`) looks an agent's
 * `prompt.briefs.<key>` up by exactly one of two keys: the basename (minus `.md`) of the step's own
 * `brief: briefs/<name>.md`, or, for an interaction-mode participant session, the mode name
 * (`swarm-review`, `panel`, `debate`, `pair`). A key that equals neither for any step *that agent
 * executes* is dead: its authored file is registered, hashed, validated and shipped, and never reaches a
 * prompt. Twenty-two of the first thirty-three shipped keys were dead because they were copied from
 * `05` §5.3's illustrative names; this test is what stops that recurring as the content grows.
 *
 * Everything is derived from the real shipped YAML -- agent definitions (every module), workflow steps
 * (built-in and module workflows, nested `fanout.step`/`do` steps included) and gate advisory checks --
 * so adding an agent, a key or a step needs no edit here. Two deliberate limits, both on the strict
 * side: a mode-name key is credited only to an agent that a shipped workflow step runs under that mode
 * (interaction sessions dispatch participants under `panel`/`debate` too, but no shipped agent key
 * relies on that, so it is not modelled: extend `attachableKeysOf` with the session roster the day one
 * does); and a key is credited by any module's workflow, because a module's steps may run another
 * module's agent (the mobile store-release workflow runs core's `release`), so a key may be live only
 * when that module is installed. Lives in `@forge/agents` (next to the
 * `prompts-*-content` tests) because it needs both this package's loader and `@forge/templates`, and
 * `templates` may import no `@forge/*` package (`02` §2.2); `@forge/engine` is not importable from here,
 * so the engine's mode-name list is read as text (drift guard at the bottom).
 *
 * @see specs/15 §15.3
 * @see specs/05 §5.3
 * @see PLAN-M13.md P3c
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { describe, expect, it } from 'vitest';

import { GATE_INDEX, WORKFLOW_INDEX } from '@forge/templates';

import { loadAgentDefinition } from '../../src/schema/load.ts';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const templatesPackageRoot = path.join(repoRoot, 'packages', 'templates');
const modulesDir = path.join(repoRoot, 'modules');

/** The interaction-mode names a participant session attaches its `prompt.briefs.<mode>` under. A
 * `dispatch-agent-step.ts` drift guard below keeps this list equal to the modes the engine passes. */
const PARTICIPANT_MODE_KEYS: ReadonlySet<string> = new Set([
  'swarm-review',
  'panel',
  'debate',
  'pair',
]);

interface ShippedAgent {
  readonly module: string;
  readonly id: string;
  readonly briefKeys: readonly string[];
  /** Whether the agent can own a story: it has a `Code` output. A workflow step written
   * `agent: '{{ownerRole}}'` / `'{{item.owner_role}}'` (`implement-story`, `build-stage`) resolves at
   * run time to whichever such agent the story names (`Story.owner_role`, `write-stories`). */
  readonly ownsCode: boolean;
  /** Modules later in the registry's precedence order (alphabetical: a later module directory wins for a
   * shared id, see `prompts-a-content.test.ts`) that ship an agent with the same id. Their copy replaces
   * this one wherever they are installed, so a step that only exists in such a module never runs this
   * definition. */
  readonly shadowedBy: readonly string[];
}

/** One place an agent is put to work: a workflow step or a gate advisory check. */
interface Execution {
  /** The `agent:` field verbatim (may be a `{{...}}` expression). */
  readonly agent: string;
  /** Basename of `brief: briefs/<name>.md`, when the step has one. */
  readonly briefKey: string | undefined;
  /** The step's interaction `mode`, when it has one. */
  readonly mode: string | undefined;
  readonly source: string;
  /** The module whose `workflows/` directory holds the step; `undefined` for a built-in workflow or a
   * built-in gate (always installed). */
  readonly module?: string | undefined;
}

function readText(file: string): string {
  return readFileSync(file, 'utf8');
}

function listFiles(dir: string, suffix: string): string[] {
  try {
    return readdirSync(dir)
      .filter((name) => name.endsWith(suffix))
      .sort();
  } catch {
    return [];
  }
}

function loadShippedAgents(): ShippedAgent[] {
  const agents: ShippedAgent[] = [];
  const modules = readdirSync(modulesDir).sort();
  const idsByModule = new Map<string, ReadonlySet<string>>();
  for (const moduleName of modules) {
    const agentsDir = path.join(modulesDir, moduleName, 'agents');
    idsByModule.set(
      moduleName,
      new Set(
        listFiles(agentsDir, '.agent.yaml').map((name) => name.replace(/\.agent\.yaml$/, '')),
      ),
    );
  }
  for (const moduleName of modules) {
    const agentsDir = path.join(modulesDir, moduleName, 'agents');
    for (const name of listFiles(agentsDir, '.agent.yaml')) {
      const result = loadAgentDefinition(readText(path.join(agentsDir, name)), name);
      if (!result.success) {
        throw new Error(`${moduleName}/${name} failed to load: ${JSON.stringify(result.issues)}`);
      }
      agents.push({
        module: moduleName,
        id: result.agent.id,
        briefKeys: Object.keys(result.agent.prompt.briefs ?? {}),
        ownsCode: result.agent.outputs.some((output) => output.type === 'Code'),
        shadowedBy: modules
          .slice(modules.indexOf(moduleName) + 1)
          .filter((later) => idsByModule.get(later)?.has(result.agent.id) === true),
      });
    }
  }
  return agents;
}

const BRIEF_REFERENCE = /^briefs\/([^/\\]+)\.md$/;

/** Every mapping with an `agent` string, at any depth: a step, a `fanout.step`, a `do:` body, a gate's
 * advisory check. Deliberately structure-agnostic so a new nesting construct cannot hide a step. */
function collectExecutions(
  node: unknown,
  source: string,
  moduleName: string | undefined,
  into: Execution[],
): void {
  if (Array.isArray(node)) {
    for (const item of node) collectExecutions(item, source, moduleName, into);
    return;
  }
  if (typeof node !== 'object' || node === null) return;
  const record = node as Record<string, unknown>;
  const agent = record['agent'];
  if (typeof agent === 'string') {
    const brief = record['brief'];
    const mode = record['mode'];
    into.push({
      agent,
      briefKey: typeof brief === 'string' ? BRIEF_REFERENCE.exec(brief)?.[1] : undefined,
      mode: typeof mode === 'string' ? mode : undefined,
      source,
      module: moduleName,
    });
  }
  for (const value of Object.values(record)) collectExecutions(value, source, moduleName, into);
}

function loadShippedExecutions(): Execution[] {
  const executions: Execution[] = [];
  const documents: { source: string; file: string; module: string | undefined }[] = [
    ...Object.entries(WORKFLOW_INDEX).map(([id, rel]) => ({
      source: `workflow ${id}`,
      file: path.join(templatesPackageRoot, rel),
      module: undefined,
    })),
    ...Object.entries(GATE_INDEX).map(([id, rel]) => ({
      source: `gate ${id}`,
      file: path.join(templatesPackageRoot, rel),
      module: undefined,
    })),
  ];
  for (const moduleName of readdirSync(modulesDir).sort()) {
    const dir = path.join(modulesDir, moduleName, 'workflows');
    for (const name of listFiles(dir, '.workflow.yaml')) {
      documents.push({
        source: `workflow ${moduleName}/${name}`,
        file: path.join(dir, name),
        module: moduleName,
      });
    }
  }
  for (const { source, file, module } of documents) {
    collectExecutions(parseYaml(readText(file)), source, module, executions);
  }
  return executions;
}

const isTemplated = (agent: string): boolean => /\{\{.*\}\}/.test(agent);

/** The keys `agent` can ever be looked up by (each with every place that would select it), mirroring
 * `assembleAgentSession`'s two sources. */
function attachableKeysOf(
  agent: ShippedAgent,
  executions: readonly Execution[],
): ReadonlyMap<string, readonly string[]> {
  const keys = new Map<string, string[]>();
  const add = (key: string, source: string): void => {
    keys.set(key, [...(keys.get(key) ?? []), source]);
  };
  for (const execution of executions) {
    const runsIt = isTemplated(execution.agent) ? agent.ownsCode : execution.agent === agent.id;
    if (!runsIt) continue;
    // A step in a module that ships its own copy of this agent runs that copy, never this one.
    if (execution.module !== undefined && agent.shadowedBy.includes(execution.module)) continue;
    const modeKey =
      execution.mode !== undefined && PARTICIPANT_MODE_KEYS.has(execution.mode)
        ? execution.mode
        : undefined;
    // `dispatchAgentStep` passes the mode name as the key for a `panel`/`debate`/`swarm-review` step's
    // participant sessions, so the step's own brief basename is not looked up there; `pair` and the
    // solo-like modes still look it up.
    const suppressed = modeKey !== undefined && modeKey !== 'pair';
    if (execution.briefKey !== undefined && !suppressed) add(execution.briefKey, execution.source);
    if (modeKey !== undefined) add(modeKey, execution.source);
  }
  return keys;
}

/** `module/agent.key` for every shipped key whose only attachment point is a gate advisory check. */
function findGateOnlyBriefKeys(
  agents: readonly ShippedAgent[],
  executions: readonly Execution[],
): string[] {
  const gateOnly: string[] = [];
  for (const agent of agents) {
    const attachable = attachableKeysOf(agent, executions);
    for (const key of agent.briefKeys) {
      const sources = attachable.get(key);
      if (sources?.every((source) => source.startsWith('gate ')) === true) {
        gateOnly.push(`${agent.module}/${agent.id}.${key}`);
      }
    }
  }
  return gateOnly;
}

/** `module/agent.key` for every `prompt.briefs` key that no execution of that agent can ever select. */
function findDeadBriefKeys(
  agents: readonly ShippedAgent[],
  executions: readonly Execution[],
): string[] {
  const dead: string[] = [];
  for (const agent of agents) {
    const attachable = attachableKeysOf(agent, executions);
    for (const key of agent.briefKeys) {
      if (!attachable.has(key)) dead.push(`${agent.module}/${agent.id}.${key}`);
    }
  }
  return dead;
}

describe('agent prompt.briefs keys are attachable', () => {
  const agents = loadShippedAgents();
  const executions = loadShippedExecutions();

  it('derives a non-trivial picture of the shipped content (the check cannot pass vacuously)', () => {
    expect(agents.length).toBeGreaterThanOrEqual(30);
    expect(agents.flatMap((agent) => agent.briefKeys).length).toBeGreaterThan(20);
    expect(
      executions.filter((execution) => execution.briefKey !== undefined).length,
    ).toBeGreaterThan(50);
    expect(executions.some((execution) => isTemplated(execution.agent))).toBe(true);
    expect(executions.some((execution) => execution.mode === 'swarm-review')).toBe(true);
  });

  it('every shipped agent key equals the brief basename of a step that agent executes, or a mode it runs under', () => {
    expect(
      findDeadBriefKeys(agents, executions),
      'each entry is <module>/<agent>.<key>: no shipped workflow step or gate check that this agent ' +
        'executes has brief briefs/<key>.md (or mode <key>), so `assembleAgentSession` can never ' +
        'attach it. Re-key it to a real brief the agent runs, or delete the key, its prompt file and ' +
        'its PROMPTS_A/PROMPTS_B entry.',
    ).toEqual([]);
  });

  describe('the detector itself (a key that looks live but is not must be reported)', () => {
    const reviewer: ShippedAgent = {
      module: 'm',
      id: 'reviewer',
      briefKeys: ['swarm-review', 'write-docs', 'implement-story'],
      ownsCode: false,
      shadowedBy: [],
    };
    const synthetic: Execution[] = [
      { agent: 'reviewer', briefKey: undefined, mode: 'swarm-review', source: 's1' },
      { agent: 'writer', briefKey: 'write-docs', mode: undefined, source: 's2' },
      { agent: '{{ownerRole}}', briefKey: 'implement-story', mode: undefined, source: 's3' },
    ];

    it('does not credit a brief that only another agent runs, or a templated step for a non-code agent', () => {
      expect(findDeadBriefKeys([reviewer], synthetic)).toEqual([
        'm/reviewer.write-docs',
        'm/reviewer.implement-story',
      ]);
    });

    it('credits a templated step only to agents that own code', () => {
      const engineer: ShippedAgent = {
        module: 'm',
        id: 'engineer',
        briefKeys: ['implement-story', 'write-docs'],
        ownsCode: true,
        shadowedBy: [],
      };
      expect(findDeadBriefKeys([engineer], synthetic)).toEqual(['m/engineer.write-docs']);
    });

    it('does not credit a step that only exists in a module that ships its own copy of the agent', () => {
      const core: ShippedAgent = {
        module: 'core',
        id: 'writer',
        briefKeys: ['draft', 'review'],
        ownsCode: false,
        shadowedBy: ['later'],
      };
      expect(
        findDeadBriefKeys(
          [core],
          [
            { agent: 'writer', briefKey: 'draft', mode: undefined, source: 's', module: 'later' },
            { agent: 'writer', briefKey: 'review', mode: undefined, source: 's', module: 'other' },
          ],
        ),
      ).toEqual(['core/writer.draft']);
    });

    it('does not credit the brief basename of a panel, debate or swarm-review step, but does for pair', () => {
      const agent: ShippedAgent = {
        module: 'm',
        id: 'a',
        briefKeys: ['k-panel', 'k-pair', 'panel'],
        ownsCode: false,
        shadowedBy: [],
      };
      expect(
        findDeadBriefKeys(
          [agent],
          [
            { agent: 'a', briefKey: 'k-panel', mode: 'panel', source: 's1' },
            { agent: 'a', briefKey: 'k-pair', mode: 'pair', source: 's2' },
          ],
        ),
      ).toEqual(['m/a.k-panel']);
    });

    it('does not credit an unknown mode name', () => {
      const odd: ShippedAgent = {
        module: 'm',
        id: 'odd',
        briefKeys: ['huddle'],
        ownsCode: false,
        shadowedBy: [],
      };
      expect(
        findDeadBriefKeys(
          [odd],
          [{ agent: 'odd', briefKey: undefined, mode: 'huddle', source: 's' }],
        ),
      ).toEqual(['m/odd.huddle']);
    });
  });

  it('names every key that is attachable only through a gate advisory check, which the engine does not dispatch yet', () => {
    // `packages/engine/src/gates/evaluate.ts` says "advisory checks are never actually run here": no code
    // path turns a gate's `advisory: [{agent, brief}]` entry into an agent session today. A key credited
    // only by such a check is attachable in principle (the day the check is dispatched through
    // `assembleAgentSession` with `node.brief` set, `briefs/<name>.md` selects it) but not in fact. The
    // list is pinned so a new gate-only key is a visible, reviewed decision and not a silent pass.
    expect(findGateOnlyBriefKeys(agents, executions)).toEqual([
      'fm-core/critic.critique-architecture',
    ]);
  });

  it('mirrors the lookup rule assemble.ts implements (a change there must be reviewed here)', () => {
    const source = readText(
      path.join(repoRoot, 'packages', 'engine', 'src', 'dispatch', 'assemble.ts'),
    );
    // The basename rule: `briefs/<name>.md` -> `<name>`, looked up with `Object.hasOwn` in the agent's
    // `prompt.briefs`; `input.briefKey` (a participant mode name) takes precedence.
    expect(source).toContain('const BRIEF_BASENAME = /^briefs\\/([^/\\\\]+)\\.md$/;');
    expect(source).toContain('briefKey ??= briefKeyOf(node.brief);');
    expect(source).toContain('Object.hasOwn(agentBriefs, briefKey)');
  });

  it('PARTICIPANT_MODE_KEYS equals the mode names dispatch-agent-step.ts passes as briefKey', () => {
    const source = readText(
      path.join(repoRoot, 'packages', 'engine', 'src', 'interaction', 'dispatch-agent-step.ts'),
    );
    const passed = new Set([...source.matchAll(/briefKey: ['"]([a-z-]+)['"]/g)].map((m) => m[1]));
    expect([...passed].sort()).toEqual([...PARTICIPANT_MODE_KEYS].sort());
  });
});
