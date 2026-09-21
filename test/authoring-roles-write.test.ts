/**
 * Authoring roles can write, judging roles cannot (`PLAN-M13.md` P15; `SPEC-QUESTIONS.md` Q220; owner decision
 * 2026-09-20, `P11-TRIAGE.md` §4 question 1 and section 6).
 *
 * The decision: an authoring role (the ones whose shipped workflow steps declare document `outputs`) holds
 * `tools.write: true`, CONFINED by the engine to a claim of its step's declared outputs (`PLAN-M13.md` P14,
 * strict at every autonomy level); `reviewer` and `critic` never write, and their reports are written by the
 * engine (P17). This file is the permanent separation-of-duties guard around that decision. It reads the
 * agent definitions, the module ceilings and a real `forge init` project, not a list of expectations typed
 * next to the YAML, and it does four jobs:
 *
 *  1. every authoring role holds the grant, in EVERY source of truth (`modules/fm-core/agents`, the
 *     `fm-service` copy of `integration-architect` that shadows the core one, and the resolved
 *     `.forge/agents/*.yaml` a real `forge init` writes);
 *  2. `reviewer` and `critic` do not, anywhere, and no ceiling anywhere widened for them; the exact set of
 *     agents that still cannot write is pinned, so a new read-only agent (or one flipped by accident) is a
 *     deliberate edit;
 *  3. the separation-of-duties invariants that are actually true of the roster (see the header of
 *     `SELF_EVIDENCING_BEFORE_P15` for why the stronger one is not);
 *  4. the grant path (`resolveStepToolGrant`, `RUN-077`) accepts the real shipped grants and still refuses
 *     anything above the ceiling, for the changed agents and for a hand-made regression of the exact
 *     pre-fix state (grant `write: true` over a ceiling `write: false`).
 *
 * The runtime half (a granted role's stray writes are reverted and traced) is proven end to end in
 * `test/authoring-roles-run.test.ts`.
 *
 * @see specs/05 §5.2, §5.3, §5.9
 * @see specs/15 §15.3
 * @see specs/20 §20.1
 * @see PLAN-M13.md P15
 */
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as YAML from 'yaml';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ForgeError } from '@forge/core';
import { isEscalationRefused } from '@forge/extensions/agents';
import { parseWorkflow, type WorkflowStep } from '@forge/engine/workflow';
import { WORKFLOW_INDEX } from '@forge/templates';
import { FakePlatformAdapter } from '@forge/testkit';

import { runInit } from '../packages/cli/src/init/run-init.ts';
import { loadAgentDefinition } from '../packages/agents/src/schema/load.ts';
import type { AgentDefinition } from '../packages/agents/src/schema/types.ts';
import { resolveExtends } from '../packages/agents/src/registry/index.ts';
import { AgentRegistry } from '../packages/agents/src/registry/registry.ts';
import { resolveStepToolGrant, roleTagsForAgent } from '../packages/agents/src/resolve/index.ts';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const modulesDir = path.join(repoRoot, 'modules');

/**
 * The roles whose shipped steps declare document outputs and which the owner approved to write (Q1). Each
 * name is a role, not a step: a role is listed only because a step of a shipped workflow gives it an output.
 * `release` is here for `fm-mobile/store-release:prepare-store-submission`.
 */
const AUTHORING_ROLES = [
  'analyst',
  'pm',
  'po',
  'ux',
  'architect',
  'data-architect',
  'integration-architect',
  'security',
  'test-architect',
  'em',
  'release',
] as const;

/** The judging roles: they review or criticise other agents' work and must never hold a write grant. */
const JUDGING_ROLES = ['reviewer', 'critic'] as const;

/**
 * Every agent id, per module, that still cannot write, and why. Pinned exactly: adding an agent here, or
 * flipping one to `write: true`, is a deliberate edit of this table. None of them is the agent of a shipped
 * step that declares outputs (`output-contract-known-gaps.test.ts` recomputes that), and `reviewer` writes no
 * report itself: the engine does (`PLAN-M13.md` P17).
 */
const READ_ONLY_AGENTS: Readonly<Record<string, string>> = {
  'fm-core/compliance': 'optional role, no shipped step runs it',
  'fm-core/critic': 'judges other agents work (advisory critique); never writes',
  'fm-core/domain-modeler': 'specialised role, no shipped step runs it',
  'fm-core/facilitator': 'runs sessions, writes no file of its own',
  'fm-core/finops': 'optional role, no shipped step runs it',
  'fm-core/orchestrator': 'schedules, writes no file of its own',
  'fm-core/reviewer': 'judges other agents work; the engine writes its ReviewReport',
  'fm-service/domain-modeler': 'specialised role, no shipped step runs it',
};

/**
 * The roles that hold BOTH `write: true` and a `gates.may_approve` entry for a gate their own outputs are
 * evidence for (`gates.produces_evidence_for`). The stronger invariant, "no writing role approves the gate
 * that judges its own outputs", is false of the shipped roster and was false before P15: `platform` and
 * `sre` have shipped as writers that may approve their own G-Foundation, G-Deliver and G-Operate evidence
 * since M6, and `pm` and `po` (`05` §5.2: "`pm`/`po` cannot approve engineering gates" implies they can
 * approve product ones) became such pairs when P15 gave them the write grant the owner approved. The
 * narrower invariants this file DOES pin: (1) the pairs are exactly the baseline plus the two P15 created, so a new one is a
 * deliberate edit; (2) no judging role (`reviewer`, `critic`, `diagnostician`, `test-architect`) may approve
 * any gate; (3) `architect` and every other role outside the list approves nothing. `may_approve` is read by
 * no run-time code (a gate is approved by a person: `forge gate approve`), so these pairs are a declared
 * authority, not an enforced one; whether pm/po should keep it is an owner question (Q220).
 */
const SELF_EVIDENCING_BEFORE_P15: readonly string[] = [
  'platform:G-Foundation',
  'sre:G-Deliver',
  'sre:G-Operate',
];

/** The pairs P15 CREATED by giving `pm` and `po` the owner-approved write grant: an open owner question (Q220),
 * listed apart so the regression is named as one and not blessed as part of the baseline. */
const SELF_EVIDENCING_CREATED_BY_P15: readonly string[] = ['pm:G-Product', 'po:G-Ready'];

/** `05` §5.2's four separation-of-duties roles (`REVIEW_OR_CRITIC_ROLES`, `resolve/tool-grant.ts`). */
const PROTECTED_ROLES = ['reviewer', 'critic', 'diagnostician', 'test-architect'] as const;

/**
 * The protected roles that write, by decision. `diagnostician` shipped `write: true` (it writes the failing
 * reproduction test and the RCA); `test-architect` receives it in P15 because the owner approved question 1
 * with it named (`P11-TRIAGE.md` §4: "includes test-architect, a protected role"), for a test plan and an NFR
 * verification record it authors, not the work under review. `isEscalationRefused` still refuses an overlay
 * escalation to `write: true` for all four, so a project cannot widen further (proved below).
 */
const PROTECTED_ROLES_THAT_WRITE: readonly string[] = ['diagnostician', 'test-architect'];

interface LoadedAgent {
  readonly module: string;
  readonly file: string;
  readonly agent: AgentDefinition;
}

interface ModuleCeilings {
  readonly module: string;
  readonly ceilings: Readonly<
    Record<
      string,
      {
        readonly write: boolean;
        readonly deploy: boolean;
        readonly network: string;
        readonly exec?: readonly string[];
      }
    >
  >;
}

function loadModuleAgents(): readonly LoadedAgent[] {
  const found: LoadedAgent[] = [];
  for (const moduleName of readdirSync(modulesDir).sort()) {
    const agentsDir = path.join(modulesDir, moduleName, 'agents');
    let files: string[];
    try {
      files = readdirSync(agentsDir)
        .filter((file) => file.endsWith('.agent.yaml'))
        .sort();
    } catch {
      continue;
    }
    for (const file of files) {
      const result = loadAgentDefinition(readFileSync(path.join(agentsDir, file), 'utf8'), file);
      if (!result.success)
        throw new Error(`${moduleName}/${file}: ${JSON.stringify(result.issues)}`);
      found.push({ module: moduleName, file, agent: result.agent });
    }
  }
  return found;
}

function loadModuleCeilings(): readonly ModuleCeilings[] {
  return readdirSync(modulesDir)
    .sort()
    .map((moduleName) => {
      const parsed = YAML.parse(
        readFileSync(path.join(modulesDir, moduleName, 'module.yaml'), 'utf8'),
      ) as { ceilings?: ModuleCeilings['ceilings'] };
      return { module: moduleName, ceilings: parsed.ceilings ?? {} };
    });
}

const loaded = loadModuleAgents();
const moduleCeilings = loadModuleCeilings();
const byKey = (moduleName: string, id: string): LoadedAgent => {
  const found = loaded.find((entry) => entry.module === moduleName && entry.agent.id === id);
  if (found === undefined) throw new Error(`no agent ${moduleName}/${id}`);
  return found;
};
const ceilingsOf = (moduleName: string) =>
  moduleCeilings.find((entry) => entry.module === moduleName)?.ceilings ?? {};

/** The agent as dispatch sees it: `extends` resolved against every agent of the module tree (the module copy
 * of a role shadows the core one, as `loadAgentRegistry` decides). */
function resolvedFor(moduleName: string, id: string): AgentDefinition {
  const registry = new AgentRegistry(
    loaded.filter((entry) => entry.module === 'fm-core').map((entry) => entry.agent),
  );
  const own = byKey(moduleName, id).agent;
  if (moduleName === 'fm-core') return resolveExtends(id, registry);
  return resolveExtends(id, new AgentRegistry([...registry.all().filter((a) => a.id !== id), own]));
}

/** Asserts the call throws the typed `RUN-077` (a grant above its ceiling), not merely any message with "ceiling". */
function expectCeilingRefusal(call: () => unknown, label: string): void {
  let thrown: unknown;
  try {
    call();
  } catch (error) {
    thrown = error;
  }
  expect(thrown, `${label}: nothing was refused`).toBeInstanceOf(ForgeError);
  expect((thrown as ForgeError).code, label).toBe('RUN-077');
}

let initDir = '';
let initAgents: ReadonlyMap<string, AgentDefinition> = new Map();

beforeAll(async () => {
  initDir = await mkdtemp(path.join(tmpdir(), 'forge-p15-init-'));
  const adapter = new FakePlatformAdapter();
  const result = await runInit(
    initDir,
    { name: 'P15 Roles', yes: true, level: 'L0' },
    { candidateAdapters: [adapter], env: {}, modulesDir },
  );
  expect(result.kind).toBe('initialized');
  const map = new Map<string, AgentDefinition>();
  const agentsDir = path.join(initDir, '.forge', 'agents');
  for (const file of (await readdir(agentsDir)).filter((name) => name.endsWith('.yaml'))) {
    const parsed = loadAgentDefinition(await readFile(path.join(agentsDir, file), 'utf8'), file);
    if (!parsed.success) throw new Error(`${file}: ${JSON.stringify(parsed.issues)}`);
    map.set(parsed.agent.id, parsed.agent);
  }
  initAgents = map;
}, 300_000);

afterAll(async () => {
  if (initDir !== '') await rm(initDir, { recursive: true, force: true });
});

describe('P15: every authoring role holds tools.write in every source of truth', () => {
  it.each(AUTHORING_ROLES)('%s: the fm-core definition grants write', (id) => {
    expect(byKey('fm-core', id).agent.tools.write, `${id} is write:false`).toBe(true);
  });

  it('integration-architect: BOTH copies grant write (the fm-service copy shadows the core one where installed)', () => {
    expect(byKey('fm-core', 'integration-architect').agent.tools.write).toBe(true);
    expect(byKey('fm-service', 'integration-architect').agent.tools.write).toBe(true);
  });

  it.each(AUTHORING_ROLES)('%s: the module ceiling permits write', (id) => {
    expect(ceilingsOf('fm-core')[id]?.write, `fm-core ceilings.${id}`).toBe(true);
  });

  it('integration-architect: both modules ceilings permit write', () => {
    expect(ceilingsOf('fm-core')['integration-architect']?.write).toBe(true);
    expect(ceilingsOf('fm-service')['integration-architect']?.write).toBe(true);
  });

  it('an agent that declares its own ceiling.tools.write permits it (architect: the ceiling item of the triage)', () => {
    for (const entry of loaded) {
      if (entry.agent.tools.write && entry.agent.ceiling !== undefined) {
        expect(entry.agent.ceiling.tools.write, `${entry.module}/${entry.agent.id}`).toBe(true);
      }
    }
    expect(byKey('fm-core', 'architect').agent.ceiling?.tools.write).toBe(true);
  });

  it.each(AUTHORING_ROLES)('%s: the resolved agent of a real forge init grants write', (id) => {
    const resolved = initAgents.get(id);
    expect(resolved, `${id} is not in .forge/agents`).toBeDefined();
    expect(resolved?.tools.write).toBe(true);
    if (resolved?.ceiling !== undefined) expect(resolved.ceiling.tools.write).toBe(true);
  });

  it('nothing else about the changed grants moved: exec, network, deploy and git_commit are what they were', () => {
    // The triage table names no edit beyond `write` (and the architect ceiling). Pinned per role so a
    // widening slipped in beside the flip fails here.
    const expectedExec: Readonly<Record<string, readonly string[]>> = {
      analyst: ['ls*', 'rg*', 'cat*'],
      pm: ['ls*', 'rg*', 'cat*'],
      po: ['ls*', 'rg*', 'cat*'],
      ux: ['ls*', 'rg*', 'cat*'],
      architect: ['git log*', 'git diff*', 'ls*', 'rg*', 'cat*', 'tree*'],
      'data-architect': ['git log*', 'ls*', 'rg*', 'cat*'],
      'integration-architect': ['ls*', 'rg*', 'cat*'],
      security: ['git log*', 'ls*', 'rg*', 'cat*'],
      'test-architect': ['ls*', 'rg*', 'cat*'],
      em: ['git log*', 'ls*', 'rg*', 'cat*'],
      release: ['git log*', 'ls*', 'rg*', 'cat*'],
    };
    for (const id of AUTHORING_ROLES) {
      for (const entry of loaded.filter((candidate) => candidate.agent.id === id)) {
        const { tools } = entry.agent;
        expect([...(tools.exec ?? [])], `${entry.module}/${id} exec`).toEqual(expectedExec[id]);
        expect(tools.network, `${entry.module}/${id} network`).toBe(false);
        expect(tools.deploy, `${entry.module}/${id} deploy`).toBe(false);
        expect(tools.git_commit, `${entry.module}/${id} git_commit`).toBe(
          id === 'analyst' || id === 'em' ? 'none' : 'docs-only',
        );
      }
    }
  });
});

describe('P15: judging roles never write, and nothing widened for them', () => {
  it.each(JUDGING_ROLES)(
    '%s is write:false in the definition, the module ceiling, its own ceiling and a real init',
    (id) => {
      for (const entry of loaded.filter((candidate) => candidate.agent.id === id)) {
        expect(entry.agent.tools.write, `${entry.module}/${id} tools`).toBe(false);
        expect(entry.agent.ceiling?.tools.write ?? false, `${entry.module}/${id} own ceiling`).toBe(
          false,
        );
        expect(ceilingsOf(entry.module)[id]?.write ?? false, `${entry.module} ceilings.${id}`).toBe(
          false,
        );
      }
      expect(initAgents.get(id)?.tools.write).toBe(false);
      expect(initAgents.get(id)?.ceiling?.tools.write ?? false).toBe(false);
    },
  );

  it('the reviewer and critic ceilings are exactly the grants the agents hold (no headroom was added)', () => {
    for (const id of JUDGING_ROLES) {
      const { tools } = byKey('fm-core', id).agent;
      expect(ceilingsOf('fm-core')[id]).toEqual({
        write: false,
        exec: [...(tools.exec ?? [])],
        network: 'none',
        deploy: false,
      });
    }
  });

  it('the exact set of agents that still cannot write is pinned', () => {
    const readOnly = loaded
      .filter((entry) => !entry.agent.tools.write)
      .map((entry) => `${entry.module}/${entry.agent.id}`)
      .sort();
    expect(readOnly).toEqual(Object.keys(READ_ONLY_AGENTS).sort());
  });

  it('the protected roles (05 §5.2) write only by named decision', () => {
    for (const id of PROTECTED_ROLES) {
      const writes = byKey('fm-core', id).agent.tools.write;
      expect(writes, id).toBe(PROTECTED_ROLES_THAT_WRITE.includes(id));
    }
  });

  it('an escalation to write:true is still refused for every protected role, whether or not it writes today (15 §15.3.2)', () => {
    for (const id of PROTECTED_ROLES) {
      const escalation = {
        agent: id,
        grant: { write: true },
        reason: 'test',
        approvedBy: 'someone',
        approvedAt: '2026-01-01T00:00:00Z',
        expires: '2027-01-01T00:00:00Z',
      };
      expect(roleTagsForAgent(id).isReviewOrCritic, `${id} tag`).toBe(true);
      expect(isEscalationRefused(escalation, roleTagsForAgent(id)), id).toBe(true);
    }
    // A role outside the four is not refused by the tag (the ceiling is what limits it).
    expect(
      isEscalationRefused(
        {
          agent: 'pm',
          grant: { write: true },
          reason: '',
          approvedBy: '',
          approvedAt: '',
          expires: '',
        },
        roleTagsForAgent('pm'),
      ),
    ).toBe(false);
  });
});

describe('P15: separation-of-duties invariants that are true of the roster', () => {
  const everyAgent = loaded.map((entry) => entry.agent);

  it('no judging role may approve any gate', () => {
    for (const id of PROTECTED_ROLES) {
      expect(byKey('fm-core', id).agent.gates.may_approve, id).toEqual([]);
    }
  });

  it('architect and integration-architect approve nothing, in either copy', () => {
    for (const entry of loaded.filter((e) =>
      ['architect', 'integration-architect'].includes(e.agent.id),
    )) {
      expect(entry.agent.gates.may_approve, `${entry.module}/${entry.agent.id}`).toEqual([]);
    }
  });

  it('the (writer, may_approve, produces_evidence_for) pairs are exactly the M6 baseline plus the two P15 created', () => {
    const pairs = everyAgent
      .filter((agent) => agent.tools.write)
      .flatMap((agent) =>
        agent.gates.may_approve
          .filter((gate) => agent.gates.produces_evidence_for.includes(gate))
          .map((gate) => `${agent.id}:${gate}`),
      );
    expect([...new Set(pairs)].sort()).toEqual(
      [...SELF_EVIDENCING_BEFORE_P15, ...SELF_EVIDENCING_CREATED_BY_P15].sort(),
    );
    // The baseline pairs were already true at HEAD~ of P15: they are pinned as pairs of roles that wrote before.
    for (const pair of SELF_EVIDENCING_BEFORE_P15) {
      const id = pair.split(':')[0] ?? '';
      expect(AUTHORING_ROLES.includes(id as (typeof AUTHORING_ROLES)[number]), pair).toBe(false);
    }
    for (const pair of SELF_EVIDENCING_CREATED_BY_P15) {
      const id = pair.split(':')[0] ?? '';
      expect(AUTHORING_ROLES.includes(id as (typeof AUTHORING_ROLES)[number]), pair).toBe(true);
    }
  });

  it('exactly pm, po, platform and sre may approve any gate, and none of them is a judging or protected role', () => {
    const approvers = everyAgent.filter((agent) => agent.gates.may_approve.length > 0);
    expect(new Set(approvers.map((agent) => agent.id))).toEqual(
      new Set(['pm', 'po', 'platform', 'sre']),
    );
    for (const agent of approvers) {
      expect(JUDGING_ROLES.includes(agent.id as (typeof JUDGING_ROLES)[number])).toBe(false);
      expect(PROTECTED_ROLES.includes(agent.id as (typeof PROTECTED_ROLES)[number])).toBe(false);
    }
  });
});

type AgentStep = Extract<WorkflowStep, { kind: 'agent' }>;

describe('P15: an authoring role never runs a shipped step that declares no outputs', () => {
  // The claim is forced `strict` only for an `agent` step that declares `outputs` (`PLAN-M13.md` P14); a step
  // that declares none takes the autonomy default (`warn` at `guided`, which reverts nothing). A role that now
  // holds `write` on such a step would write unconfined, so every shipped step of these roles must declare
  // outputs. A user-authored workflow can still name one of these roles without outputs (disclosed in Q220).
  function agentSteps(steps: readonly WorkflowStep[], out: AgentStep[] = []): AgentStep[] {
    for (const step of steps) {
      if (step.kind === 'fanout') agentSteps([step.step], out);
      else if (step.kind === 'parallel' || step.kind === 'sequence') agentSteps(step.steps, out);
      else if (step.kind === 'agent') out.push(step);
    }
    return out;
  }

  function shippedAgentSteps(): readonly { key: string; step: AgentStep }[] {
    const sources: { origin: string; text: string }[] = Object.entries(WORKFLOW_INDEX).map(
      ([id, relative]) => ({
        origin: id,
        text: readFileSync(path.join(repoRoot, 'packages', 'templates', relative), 'utf8'),
      }),
    );
    for (const moduleName of readdirSync(modulesDir)) {
      const dir = path.join(modulesDir, moduleName, 'workflows');
      let files: string[];
      try {
        files = readdirSync(dir).filter((file) => file.endsWith('.workflow.yaml'));
      } catch {
        continue;
      }
      for (const file of files) {
        sources.push({
          origin: `${moduleName}/${file}`,
          text: readFileSync(path.join(dir, file), 'utf8'),
        });
      }
    }
    const found: { key: string; step: AgentStep }[] = [];
    for (const { origin, text } of sources) {
      const parsed = parseWorkflow(text);
      if (!parsed.success) throw new Error(`${origin} does not parse`);
      const { workflow } = parsed;
      const hooks = [
        ...(workflow.onComplete ?? []),
        ...(workflow.onFailure?.escalations ?? []).map((escalation) => escalation.do),
      ];
      for (const step of [...agentSteps(workflow.steps), ...agentSteps(hooks)]) {
        found.push({ key: `${origin}:${step.id ?? step.agent}`, step });
      }
    }
    return found;
  }

  it('every shipped agent step of an authoring role declares outputs, so its claim is forced strict', () => {
    const steps = shippedAgentSteps();
    const ofAuthoringRoles = steps.filter(({ step }) =>
      (AUTHORING_ROLES as readonly string[]).includes(step.agent),
    );
    // A floor against an empty enumeration (a vacuous pass): the P15 steps alone are more than twenty.
    expect(ofAuthoringRoles.length).toBeGreaterThan(25);
    const unconfined = ofAuthoringRoles
      .filter(({ step }) => (step.outputs ?? []).length === 0)
      .map(({ key, step }) => `${key} (${step.agent})`);
    expect(unconfined).toEqual([]);
  });
});

describe('P15: the briefs that make the new HandoffRecord outputs satisfiable (P7 reads a `subtype:` delivered line)', () => {
  const brief = (name: string): string =>
    readFileSync(path.join(repoRoot, 'packages/templates/templates/briefs', name), 'utf8').replace(
      /\s+/g,
      ' ',
    );
  it.each([
    ['review-stage-plan.md', 'stage-plan-review'],
    ['prepare-store-submission.md', 'store-submission-record'],
  ])('%s tells the agent the first delivered string is `subtype: %s`', (name, subtype) => {
    const text = brief(name);
    expect(text).toContain(`the first string in \`delivered\` is \`subtype: ${subtype}\``);
    expect(text).toContain('handoffs.md');
    expect(text).toMatch(/leave every other entry/i);
  });
});

describe('P15: the owner_role text that keeps a writing role off implementation steps', () => {
  it('the write-stories brief tells po the owner is an implementation role, never an authoring or judging one', () => {
    const text = readFileSync(
      path.join(repoRoot, 'packages/templates/templates/briefs/write-stories.md'),
      'utf8',
    ).replace(/\s+/g, ' ');
    expect(text).toMatch(/`owner_role`: an implementation role/);
    expect(text).toMatch(/Never a role that writes documents or judges work/);
  });
});

describe('P15: the module ceilings and the grant path', () => {
  it('every agent of every module holds a grant inside its module ceiling (write, deploy, network, exec)', () => {
    for (const entry of loaded) {
      const ceiling = ceilingsOf(entry.module)[entry.agent.id];
      expect(ceiling, `${entry.module} declares no ceiling for ${entry.agent.id}`).toBeDefined();
      if (ceiling === undefined) continue;
      const { tools } = entry.agent;
      const label = `${entry.module}/${entry.agent.id}`;
      if (tools.write) expect(ceiling.write, `${label} write`).toBe(true);
      if (tools.deploy) expect(ceiling.deploy, `${label} deploy`).toBe(true);
      const network =
        tools.network === false ? 'none' : tools.network === true ? 'allowlist' : tools.network;
      if (network !== 'none') expect(ceiling.network, `${label} network`).not.toBe('none');
      for (const pattern of tools.exec ?? []) {
        const covered = (ceiling.exec ?? []).some((covering) =>
          covering.endsWith('*') ? pattern.startsWith(covering.slice(0, -1)) : pattern === covering,
        );
        expect(covered, `${label} exec ${pattern} is outside the ceiling`).toBe(true);
      }
    }
  });

  // The module convention (each `module.yaml` header: "the ceiling equals what the shipped agent already holds"),
  // pinned for `write` so that no ceiling silently grants a judging role headroom to widen into.
  it('the module ceiling never carries headroom: write equals the agent grant, for every agent', () => {
    for (const entry of loaded) {
      expect(
        ceilingsOf(entry.module)[entry.agent.id]?.write,
        `${entry.module}/${entry.agent.id}`,
      ).toBe(entry.agent.tools.write);
    }
  });

  it.each(AUTHORING_ROLES)(
    '%s: resolveStepToolGrant resolves the shipped grant (against its own ceiling where it declares one: only architect does) and carries write',
    (id) => {
      const grant = resolveStepToolGrant({
        agent: resolvedFor('fm-core', id),
        escalations: [],
        now: Date.now(),
      });
      expect(grant.grant.write).toBe(true);
      expect(grant.usedEscalation).toBe(false);
    },
  );

  it('the fm-service integration-architect (the shadowing copy) resolves to write:true too', () => {
    const grant = resolveStepToolGrant({
      agent: resolvedFor('fm-service', 'integration-architect'),
      escalations: [],
      now: Date.now(),
    });
    expect(grant.grant.write).toBe(true);
  });

  it('every authoring role is still refused anything above its ceiling: network, deploy and exec', () => {
    for (const id of AUTHORING_ROLES) {
      const agent = resolvedFor('fm-core', id);
      // Roles that declare no ceiling of their own are checked against their own grant (fail closed), so an
      // explicit ceiling equal to the shipped grant makes the widening attempt meaningful for all of them.
      const capped: AgentDefinition = {
        ...agent,
        ceiling: {
          tools: {
            write: agent.tools.write,
            ...(agent.tools.exec !== undefined ? { exec: agent.tools.exec } : {}),
            network: 'none',
            deploy: false,
          },
        },
      };
      for (const overlayTools of [
        { network: 'full' as const },
        { deploy: true },
        { exec: ['rm *'] },
      ]) {
        expectCeilingRefusal(
          () =>
            resolveStepToolGrant({ agent: capped, overlayTools, escalations: [], now: Date.now() }),
          `${id} ${JSON.stringify(overlayTools)}`,
        );
      }
    }
  });

  it('a grant of write:true over a ceiling of write:false is refused: the exact state the architect had before P15', () => {
    const architect = resolvedFor('fm-core', 'architect');
    const before: AgentDefinition = {
      ...architect,
      ceiling: {
        tools: {
          ...(architect.ceiling?.tools ?? {}),
          write: false,
          network: 'none',
          deploy: false,
        },
      },
    };
    expectCeilingRefusal(
      () => resolveStepToolGrant({ agent: before, escalations: [], now: Date.now() }),
      'architect with write over a write:false ceiling',
    );
  });

  it('a reviewer or critic overlay asking for write is refused: by its own ceiling (write:false), not by the role tag, which only governs escalations', () => {
    for (const id of JUDGING_ROLES) {
      expectCeilingRefusal(
        () =>
          resolveStepToolGrant({
            agent: resolvedFor('fm-core', id),
            overlayTools: { write: true },
            escalations: [],
            now: Date.now(),
          }),
        id,
      );
    }
  });
});
