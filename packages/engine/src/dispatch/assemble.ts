/**
 * Prompt assembly for a dispatched agent — `PLAN-M13.md` P5, the fix the whole milestone exists for.
 *
 * Before this, a real agent step was sent `node.brief` (a raw `briefs/<name>.md` path) as its entire
 * prompt with an empty system prompt, every tool grant identical and the model "whichever the adapter
 * listed first". Everything needed to do it properly already existed and was tested with no caller
 * outside its own package (`@forge/agents/prompt`, `/context`, `/resolve`); this module is the one place
 * that calls them, so both dispatch paths (`runAgentStep`'s `SessionRequest`, and interaction-mode
 * participant sessions) share one implementation instead of two that could drift.
 *
 * What one assembly does, in order, and what each failure means (every one throws a `ForgeError`; callers
 * fold it into a typed `StepOutcome` failure via `tryAssemble` and dispatch nothing):
 * 1. Load the agent (`RUN-056` when absent -- never a generic stand-in).
 * 2. Refuse an adapter that cannot carry a system prompt (`RUN-080`): `07` §7.2's fail-closed rule.
 * 3. Resolve the brief *text* (`CFG-053`/`RUN-079` for a reference that is not, or does not name, a real
 *    brief -- never the path itself) and the agent's role instructions (D1) and role-specific guidance
 *    (D2).
 * 4. Resolve the grant (`RUN-077` above the ceiling) and model (`RUN-078` unmapped tier).
 * 5. Pack KB context, compile the nine blocks, write `prompt.md` + `context.json` (`05` §5.3 calls the
 *    record mandatory; a failed write is a failed step, never a run with no audit trail).
 *
 * Determinism (`21` §21.1, crash-resume): nothing here reads a clock, a random source, or filesystem
 * enumeration order that is not sorted, and no run-specific id enters the prompt text, so an identical
 * step compiles a byte-identical prompt after a crash and a resume.
 *
 * @see specs/05 §5.3, §5.4, §5.8
 * @see specs/07 §7.2
 * @see PLAN-M13.md P5
 * @see SPEC-QUESTIONS.md Q203
 */
import path from 'node:path';

import { ForgeError, isForgeError, writeFileAtomic } from '@forge/core';
import type { SessionRequest, ToolGrant } from '@forge/adapter-kit';
import { packForStep, type AgentContextPack, type StepContext } from '@forge/agents/context';
import { compilePrompt, writePromptRecord, type CompiledPrompt } from '@forge/agents/prompt';
import type { PromptConstraints } from '@forge/agents/prompt';
import { resolveStepModel, resolveStepToolGrant } from '@forge/agents/resolve';
import type { AgentDefinition } from '@forge/agents/schema';
import { slugifyStepId } from '@forge/vcs';

import type { StepNode } from '../plan/index.ts';
import type { ExecuteStepContext, KbAccess, StepFailureInfo } from './types.ts';

/** Everything a caller may vary per assembly; everything else comes from `ctx.assembly`. */
export interface AssembleInput {
  readonly node: StepNode;
  readonly ctx: ExecuteStepContext;
  /** A participant session (interaction modes) supplies the agent it already holds; a workflow step
   * leaves this out and the agent is loaded from `node.agent`. */
  readonly agent?: AgentDefinition | undefined;
  /** Already-resolved prose that plays block [4]: a participant turn's task text, or a session phase's
   * question. Left out for a workflow agent step, whose `node.brief` is a `briefs/<name>.md` reference
   * that is loaded here. */
  readonly taskText?: string | undefined;
  /** Distinguishes one participant session of a step from another (`panel:security`, ...): part of the
   * session's own step id and prompt-record location. Absent for the step's own session. */
  readonly role?: string | undefined;
  /** The key an agent's `prompt.briefs.<key>` is looked up by, when the task text is prose rather than a
   * `briefs/<name>.md` reference: an interaction-mode participant passes its mode name (`swarm-review`),
   * so `prompt.briefs.swarm-review` attaches to each perspective's session. */
  readonly briefKey?: string | undefined;
  /** Participant sessions read the primary author's lane and never write (`dispatch-agent-step.ts`). */
  readonly readOnly?: boolean | undefined;
}

export interface AssembledSession {
  readonly agent: AgentDefinition;
  readonly stepKey: string;
  readonly systemPrompt: SessionRequest['systemPrompt'];
  /** The short, fixed kickoff line -- everything substantive is in the system prompt. */
  readonly prompt: string;
  readonly model: string;
  readonly thinking: NonNullable<SessionRequest['thinking']>;
  readonly tools: ToolGrant;
  readonly compiled: CompiledPrompt;
  /** Writes the audit record (`prompt.md` + `context.json`, `05` §5.3) -- called by the dispatcher
   * immediately before it hands the session to the adapter, not at compile time, so a record only ever
   * exists for a session that was actually about to start (a step that fails between assembly and
   * dispatch, e.g. lane creation, leaves none). `context.json` is written first: `prompt.md`, the
   * mandatory half, is the last thing to land, so a crash between the two never leaves `prompt.md`
   * without its manifest. */
  readonly persist: () => Promise<void>;
  /** What the pack could not deliver, for the step's `SessionStarted` event: declared inputs that were not
   * packed (`05` §5.4 point 2) and KB files that failed to parse. */
  readonly diagnostics: {
    readonly unresolvedDeclaredInputs: readonly string[];
    readonly kbParseErrors: number;
  };
  /** `20` §20.5 point 3: `node.taint` passed through, never something assembly invents. `packForStep`
   * packs KB entries, skills and pinned core -- nothing sourced from an MCP server or a fetched page --
   * but KB entry *text* is not fenced (earlier agents, or `forge adopt`, may have written it): only
   * heading defanging stands between it and the system prompt. No consumer reads this field yet beyond
   * `context.json`'s `externalContent`; enforcement of the tainted-step restrictions is `taint-guard.ts`'s. */
  readonly taint: 'external' | undefined;
}

/** Directory name for a step's audit record. The compiled step id (`06` §6.2: `workflow:step[:item]`)
 * contains `:` (an NTFS alternate-data-stream separator on Windows) and, for a fanout item, arbitrary
 * text from run inputs; `slugifyStepId` is the same filesystem- and Windows-safe, collision-resistant
 * rendering lane branches already use. */
export function promptRecordDirName(stepKey: string): string {
  return slugifyStepId(stepKey);
}

/** The fixed kickoff `SessionRequest.prompt` for a fresh session. Deterministic and free of anything
 * but the step key. */
export function kickoffPrompt(stepKey: string): string {
  return (
    `Carry out step ${JSON.stringify(stepKey)} exactly as described in the "Step brief" block of your system prompt. ` +
    'Follow its operating contract and constraints.'
  );
}

/** The prompt for a resumed session (`resumeSession`): the original system prompt is already in force. */
export function resumePrompt(stepKey: string): string {
  return `Continue step ${JSON.stringify(stepKey)} from where the previous session stopped. Your system prompt is unchanged.`;
}

const BRIEF_BASENAME = /^briefs\/([^/\\]+)\.md$/;

/** `15` §15.3's `prompt.briefs.<key>`: the key is the workflow brief's basename without `.md`. */
function briefKeyOf(reference: string): string | undefined {
  return BRIEF_BASENAME.exec(reference)?.[1];
}

function hasId(value: unknown): value is { readonly id: string } {
  return (
    typeof value === 'object' && value !== null && 'id' in value && typeof value.id === 'string'
  );
}

/** Every KB entry id the tree holds (`buildContextPack` throws `KB-013` for a declared id it lacks, so
 * declared inputs are matched against this first). */
function kbEntryIds(kb: KbAccess): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const entry of kb.tree.entries) {
    if (
      (entry.kind === 'kb-entry' ||
        entry.kind === 'adr' ||
        entry.kind === 'diagram' ||
        entry.kind === 'runbook') &&
      hasId(entry.value)
    ) {
      ids.add(entry.value.id);
    }
  }
  return ids;
}

const GLOB_CHARS = /[*?[\]{}]/;

/** A workflow `inputs:` reference (`10` §10.1's mini-DSL: `kb:<id>`, `artifact:<Type>(<id>)`,
 * `diff:lane`) as the one KB id it names exactly, or `undefined` when it is a glob, a whole type, or not a
 * KB-resolvable kind at all. Expanding those needs the input-DSL resolver no piece has built
 * (`SPEC-QUESTIONS.md` Q203); they are listed, not dropped. */
function exactKbIdOf(reference: string): string | undefined {
  const kb = /^kb:(.+)$/.exec(reference);
  if (kb?.[1] !== undefined && !GLOB_CHARS.test(kb[1])) return kb[1];
  const artifact = /^artifact:[^(]+\((.+)\)$/.exec(reference);
  if (artifact?.[1] !== undefined && !GLOB_CHARS.test(artifact[1])) return artifact[1];
  return undefined;
}

interface DeclaredInputs {
  readonly resolvedIds: readonly string[];
  readonly unresolved: readonly string[];
  readonly section: string;
}

function resolveDeclaredInputs(node: StepNode, kb: KbAccess): DeclaredInputs {
  const known = kbEntryIds(kb);
  const resolvedIds: string[] = [];
  const unresolved: string[] = [];
  const lines: string[] = [];
  for (const reference of node.inputs) {
    const id = exactKbIdOf(reference);
    if (id !== undefined && known.has(id)) {
      resolvedIds.push(id);
      lines.push(`- ${reference} (full text in the project context pack as ${id})`);
    } else {
      unresolved.push(reference);
      lines.push(`- ${reference} (declared for this step but NOT included in the context pack)`);
    }
  }
  return {
    resolvedIds,
    unresolved,
    section: lines.length === 0 ? '' : `Declared inputs for this step:\n${lines.join('\n')}`,
  };
}

const RUN_INPUT_VALUE_CAP = 2000;
const RUN_INPUT_MAX_KEYS = 50;
const RUN_INPUT_NAME_CAP = 80;

/** Deterministic JSON for a run-input value: object keys sorted at every depth, and every value JSON
 * cannot carry (a function, a symbol, a `bigint`, a cycle, a throwing getter) rendered as a fixed marker
 * instead of throwing -- a run input must never turn a deterministic prompt into a failed step. */
function stableJson(value: unknown): string {
  const active = new WeakSet<object>();
  const render = (inner: unknown): string => {
    switch (typeof inner) {
      case 'string':
      case 'number':
      case 'boolean':
        return JSON.stringify(inner);
      case 'bigint':
        return JSON.stringify(inner.toString());
      case 'undefined':
      case 'function':
      case 'symbol':
        return '"[unserializable]"';
      case 'object':
        break;
    }
    if (inner === null) return 'null';
    if (active.has(inner)) return '"[circular]"';
    active.add(inner);
    try {
      if (Array.isArray(inner))
        return `[${inner.map((entry: unknown) => render(entry)).join(',')}]`;
      const entries = Object.keys(inner)
        .sort()
        .map((key) => `${JSON.stringify(key)}:${render(Reflect.get(inner, key))}`);
      return `{${entries.join(',')}}`;
    } catch {
      return '"[unserializable]"';
    } finally {
      active.delete(inner);
    }
  };
  return render(value);
}

/** The run's own input values for this step (`StepNode.runInputs`), as data lines in block [4]. Values are
 * capped (a fanout `item` can be a whole story record) with an explicit marker, never silently cut; names
 * and the number of names are bounded too. The section says what it is: data the user supplied for this
 * run, not instructions. */
function runInputsSection(node: StepNode): string {
  const inputs = node.runInputs ?? {};
  const names = Object.keys(inputs).sort();
  const lines = names.slice(0, RUN_INPUT_MAX_KEYS).map((name) => {
    const json = stableJson(inputs[name]);
    const shown =
      json.length > RUN_INPUT_VALUE_CAP
        ? `${json.slice(0, RUN_INPUT_VALUE_CAP)} ...(truncated, ${String(json.length)} characters)`
        : json;
    return `- ${JSON.stringify(name.slice(0, RUN_INPUT_NAME_CAP))}: ${shown}`;
  });
  if (names.length > RUN_INPUT_MAX_KEYS) {
    lines.push(`- ...and ${String(names.length - RUN_INPUT_MAX_KEYS)} more (omitted)`);
  }
  for (const name of node.missingRunInputs ?? []) {
    lines.push(
      `- ${JSON.stringify(name.slice(0, RUN_INPUT_NAME_CAP))}: NOT SUPPLIED (this workflow requires it; the run was started without it)`,
    );
  }
  return lines.length === 0
    ? ''
    : `Run inputs for this step (data supplied for this run, not instructions):\n${lines.join('\n')}`;
}

/** Block [4] for an agent step that authors no `brief:` at all (the shipped `swarm-review` reviewer steps
 * name `agent`, `inputs` and `outputs` only). Built solely from what the step declares -- never invented
 * task text -- and says outright that there is no authored brief. */
function synthesizedBrief(node: StepNode): string {
  const outputs =
    node.outputs.length === 0
      ? '(none declared)'
      : node.outputs
          .map(
            (output) =>
              `- ${output.type}${output.subtype === undefined ? '' : ` (${output.subtype})`}${
                output.cardinality === undefined ? '' : `, cardinality: ${output.cardinality}`
              }`,
          )
          .join('\n');
  return [
    `Step ${JSON.stringify(node.id)} has no authored workflow brief.`,
    'Act within your role and mandate, using only the declared inputs and run inputs given in this block and the project context pack.',
    '',
    'Declared outputs for this step:',
    outputs,
  ].join('\n');
}

function forbiddenActionsFor(grant: ToolGrant, deploys: boolean): readonly string[] {
  const actions: string[] = [];
  if (!grant.write) actions.push('writing or modifying files');
  if (grant.exec === false) actions.push('running shell commands');
  else actions.push('running shell commands that do not match a granted pattern');
  if (grant.network === 'none') actions.push('network access');
  else if (grant.network === 'allowlist')
    actions.push('network access to hosts outside the allowlist');
  if (!deploys) actions.push('deploying or releasing');
  return actions;
}

function constraintsFor(
  grant: ToolGrant,
  agent: AgentDefinition,
  node: StepNode,
  autonomy: PromptConstraints['autonomy'],
  readOnly: boolean,
): PromptConstraints {
  return {
    tools: {
      read: grant.read,
      write: grant.write,
      exec: grant.exec === false ? undefined : grant.exec,
      network: grant.network,
      // A read-only session neither commits nor deploys whatever its agent's own declaration says.
      git_commit: readOnly ? 'none' : agent.tools.git_commit,
      deploy: readOnly ? false : agent.tools.deploy,
    },
    forbiddenActions: forbiddenActionsFor(grant, !readOnly && agent.tools.deploy),
    // The limits the session request actually enforces, not the agent's own declared defaults.
    budget: {
      max_turns: node.limits.maxTurns,
      wall_clock_ms: node.limits.wallClockMs,
      max_cost_usd: node.limits.maxCostUsd,
    },
    autonomy: node.autonomy ?? autonomy,
  };
}

const NO_CHECKS_DECLARED =
  'none declared: this step names no gate evidence and no gate depends on it directly';

/** Block [7] (`05` §5.3: "the checks that will be run against this step's output"), from the gates the
 * plan attached (`StepNode.gateEvidence`). An explicit "none declared" when there are none; a gate id the
 * registry does not hold is named as such rather than skipped. */
function definitionOfDone(node: StepNode, ctx: ExecuteStepContext): readonly string[] {
  const gateIds = node.gateEvidence ?? [];
  if (gateIds.length === 0) return [NO_CHECKS_DECLARED];
  const lines: string[] = [];
  for (const gateId of gateIds) {
    const gate = ctx.gateRegistry.get(gateId);
    if (gate === undefined) {
      lines.push(`Gate ${gateId}: definition not found in this project's gate registry`);
      continue;
    }
    for (const check of gate.checks.deterministic) {
      lines.push(`Gate ${gateId}, check ${check.id}: \`${check.run}\` (fails on: ${check.failOn})`);
    }
    for (const check of gate.checks.advisory) {
      lines.push(`Gate ${gateId}, advisory review ${check.id} by ${check.agent}`);
    }
  }
  return lines.length === 0 ? [NO_CHECKS_DECLARED] : lines;
}

/**
 * Compiles and records the prompt for one agent session. See the module doc for the ordered steps and
 * failure meanings.
 *
 * @throws {ForgeError} any of `RUN-056`, `RUN-077`, `RUN-078`, `RUN-079`, `RUN-080`, `CFG-053`, or a KB/IO
 * error; the caller (`tryAssemble`) turns it into a step failure.
 */
export async function assembleAgentSession(input: AssembleInput): Promise<AssembledSession> {
  try {
    const assembled = await compileSession(input);
    return { ...assembled, persist: () => markRefusals(assembled.persist) };
  } catch (cause) {
    throw markRefusal(cause);
  }
}

/** Errors thrown by assembly (never by the adapter or the lane), so a caller far from the call site --
 * `executeStep`, folding a `session` step's participant failure into a typed outcome -- can tell "this
 * step was refused before anything was dispatched" from any other throw without a second error type that
 * would strip the `ForgeError` the CLI prints. A `WeakSet`, not a field: the error object is untouched. */
const ASSEMBLY_REFUSALS = new WeakSet<object>();

export function markRefusal(cause: unknown): unknown {
  if (typeof cause === 'object' && cause !== null) ASSEMBLY_REFUSALS.add(cause);
  return cause;
}

async function markRefusals(action: () => Promise<void>): Promise<void> {
  try {
    await action();
  } catch (cause) {
    throw markRefusal(cause);
  }
}

/** Whether `cause` was thrown by prompt assembly (see `ASSEMBLY_REFUSALS`). */
export function isAssemblyRefusal(cause: unknown): boolean {
  return typeof cause === 'object' && cause !== null && ASSEMBLY_REFUSALS.has(cause);
}

/** A refusal as the typed step failure every caller folds it into. `code` is the `ForgeError` code when
 * there is one; `classifyFailure` decides from it whether the refusal is permanent (a config-shaped
 * code) or a retryable hiccup (a wrapped or raw file-system error). */
export function refusalFailure(cause: unknown): StepFailureInfo {
  const message = cause instanceof Error ? cause.message : String(cause);
  return { source: 'prompt', code: errorCodeOf(cause), message, cause };
}

async function compileSession(input: AssembleInput): Promise<AssembledSession> {
  const { node, ctx, role } = input;
  const deps = ctx.assembly;
  const stepKey = role === undefined ? node.id : `${node.id}:${role}`;

  if (input.taskText?.trim() === '') {
    // A blank question/task would compile an empty block [4]: the same silently-weaker prompt this
    // module exists to prevent.
    throw new ForgeError('RUN-081', { stepId: node.id });
  }
  if (input.agent === undefined && node.agent === undefined) {
    throw new ForgeError('RUN-039', {
      stepId: node.id,
      kind: 'agent (missing its own agent field)',
    });
  }
  const agent = input.agent ?? (await deps.loadAgent(String(node.agent)));

  const capabilities = await ctx.adapter.capabilities();
  if (capabilities.systemPromptControl === 'none') {
    throw new ForgeError('RUN-080', { adapterId: ctx.adapter.id, stepId: stepKey });
  }
  // `append` keeps Claude Code's built-in tool-use guidance ahead of FORGE's blocks; `replace` would drop
  // it and the nine blocks say nothing about how to use the tools. An adapter that reports only
  // `replace` gets `replace` -- the request never asks for a mode the adapter did not report.
  const mode = capabilities.systemPromptControl === 'replace' ? 'replace' : 'append';

  // Block [4] source, and the key an agent-specific brief is looked up by.
  let briefText: string;
  let briefKey: string | undefined = input.briefKey;
  if (input.taskText !== undefined) {
    briefText = input.taskText;
  } else if (node.brief !== undefined) {
    briefText = await deps.loadContent(node.brief);
    briefKey ??= briefKeyOf(node.brief);
  } else {
    briefText = synthesizedBrief(node);
  }

  const roleInstructions = await deps.loadContent(agent.prompt.system);
  const agentBriefs = agent.prompt.briefs;
  const roleSpecificRef =
    briefKey !== undefined && agentBriefs !== undefined && Object.hasOwn(agentBriefs, briefKey)
      ? agentBriefs[briefKey]
      : undefined;
  const roleSpecificGuidance =
    roleSpecificRef === undefined ? undefined : await deps.loadContent(roleSpecificRef);

  const resolved = resolveStepToolGrant({
    agent,
    escalations: deps.escalations,
    // Read only when an escalation exists to be expired: the injected clock is shared, and consuming a
    // tick per assembly would shift every timestamp a step reports for no reason.
    now: deps.escalations.length === 0 ? 0 : ctx.now(),
  });
  const readOnly = input.readOnly === true;
  // A read-only session (interaction participants, adopt analysis) runs in the real tree, not a lane, and
  // may be handed hostile input: it keeps the agent's `read` and nothing else -- no write, no exec (a
  // permitted `git`/`rg` still has flags that write or execute), no network.
  const tools: ToolGrant = readOnly
    ? { read: resolved.grant.read, write: false, exec: false, network: 'none' }
    : resolved.grant;
  const model = resolveStepModel(agent, deps.models, ctx.adapter.id);

  const kb = await deps.openKb();
  let pack: AgentContextPack;
  let declared: DeclaredInputs;
  try {
    declared = resolveDeclaredInputs(node, kb);
    const step: StepContext = {
      brief: briefText,
      declaredInputIds: declared.resolvedIds,
      produces: node.produces,
      consumes: node.consumes,
    };
    pack = await packForStep(step, agent, kb.backend, kb.tree, {
      budgetTokens: deps.kbPackBudgetTokens,
      skillsPackBudgetTokens: deps.skillsPackBudgetTokens,
      templatesPackageRoot: deps.templatesPackageRoot,
      pinnedCoreOverrides: deps.pinnedCore,
    });
  } finally {
    kb.close();
  }

  const stepBrief = [briefText, runInputsSection(node), declared.section]
    .filter((part) => part !== '')
    .join('\n\n');
  const compiled = compilePrompt(
    {
      brief: stepBrief,
      declaredInputIds: declared.resolvedIds,
      produces: node.produces,
      consumes: node.consumes,
    },
    agent,
    pack,
    constraintsFor(tools, agent, node, deps.autonomy, readOnly),
    definitionOfDone(node, ctx),
    {
      styleProfile: deps.styleProfile,
      roleInstructions,
      roleSpecificGuidance,
      readOnly,
    },
  );

  const dirName = promptRecordDirName(stepKey);
  const persist = async (): Promise<void> => {
    // `18` §18.2: "context pack manifest (ids + token counts, not content)", plus what `05` §5.4's last
    // line asks the step record to reproduce: which skills were included or demoted, and which declared
    // inputs could not be resolved into the pack.
    await writeFileAtomic(
      deps.paths.resolveState(path.posix.join('runs', ctx.runId, 'steps', dirName, 'context.json')),
      `${JSON.stringify(
        {
          stepId: stepKey,
          agentId: agent.id,
          model,
          manifest: pack.manifest,
          skills: pack.skills.map((skill) => ({
            id: skill.id,
            bodyIncluded: skill.bodyIncluded,
            demoted: skill.demoted,
          })),
          unresolvedDeclaredInputs: declared.unresolved,
          kbParseErrors: kb.parseErrorCount,
          externalContent: node.taint === 'external',
        },
        null,
        2,
      )}\n`,
    );
    await writePromptRecord(ctx.runId, dirName, compiled, deps.paths);
  };

  return {
    agent,
    stepKey,
    systemPrompt: { mode, text: compiled.text },
    prompt: kickoffPrompt(stepKey),
    model,
    thinking: agent.model.thinking,
    tools,
    compiled,
    persist,
    diagnostics: {
      unresolvedDeclaredInputs: declared.unresolved,
      kbParseErrors: kb.parseErrorCount,
    },
    taint: node.taint,
  };
}

function errorCodeOf(value: unknown): string | undefined {
  // Only a `ForgeError`'s code is a FORGE code; a raw Node error's `code` (`EMFILE`, `SQLITE_BUSY`) is not
  // one and must not be mistaken for a config-shaped refusal.
  return isForgeError(value) ? value.code : undefined;
}

/** `assembleAgentSession` with any failure returned as a typed step failure (`source: 'prompt'`) instead
 * of thrown, matching every other runtime failure in `steps.ts` ("describe a failure as data"). The
 * caller returns it without dispatching anything. */
export async function tryAssemble(
  input: AssembleInput,
): Promise<
  | { readonly ok: true; readonly value: AssembledSession }
  | { readonly ok: false; readonly failure: StepFailureInfo }
> {
  try {
    return { ok: true, value: await assembleAgentSession(input) };
  } catch (cause) {
    return { ok: false, failure: refusalFailure(cause) };
  }
}

/** The model a session of `node` is recorded against (`UsageRecorded`), for a *resumed* adapter session:
 * its system prompt is already in force, so nothing is recompiled and the original `prompt.md` (which is
 * what that session actually received) is left untouched -- rewriting it from inputs that may have drifted
 * since the crash would make the audit record claim a prompt the session never saw. */
export async function tryResolveSessionModel(
  node: StepNode,
  ctx: ExecuteStepContext,
): Promise<
  | { readonly ok: true; readonly model: string }
  | { readonly ok: false; readonly failure: StepFailureInfo }
> {
  try {
    if (node.agent === undefined) {
      throw new ForgeError('RUN-039', {
        stepId: node.id,
        kind: 'agent (missing its own agent field)',
      });
    }
    const agent = await ctx.assembly.loadAgent(String(node.agent));
    return { ok: true, model: resolveStepModel(agent, ctx.assembly.models, ctx.adapter.id) };
  } catch (cause) {
    return { ok: false, failure: refusalFailure(cause) };
  }
}
