/**
 * `compilePrompt` — `05` §5.3's own nine-block system prompt assembly.
 *
 * @see specs/05 §5.3
 * @see PLAN-M6.md A5
 */
import type { StyleProfile } from '@forge/extensions/style';

import type { StepContext } from '../context/pack-for-step.ts';
import type { AgentContextPack } from '../context/types.ts';
import type { AgentDefinition } from '../schema/types.ts';
import { OPERATING_CONTRACT } from './operating-contract.ts';
import type { CompiledPrompt, CompiledPromptBlock, PromptConstraints } from './types.ts';

/**
 * Two deliberate deviations from `PLAN-M6.md` A5's own literal Surface text
 * (`compilePrompt(node: StepNode, agent, pack: ContextPack, constraints, definitionOfDone)`), both
 * decided the same way A4's own deviations were, and recorded here rather than only implicitly, per
 * `SPEC-QUESTIONS.md` Q102:
 *
 * 1. `step: StepContext`, not the real `StepNode` — the identical "no boundary-graph edge from
 *    `agents` to `@forge/engine`" constraint A4's own `pack-for-step.ts` already hit and resolved this
 *    way; block [4]'s own `step.brief` is exactly the one field this piece reads from it.
 * 2. A sixth `options: CompilePromptOptions` parameter — block [9]'s own two real sources (a project
 *    `StyleProfile`, `15` §15.8, and one agent overlay's own free-text `$append_guidance`,
 *    `@forge/extensions/resolve`, M2) are structurally unrelated inputs neither `agent` nor `pack` nor
 *    any of the other four parameters carries a field for; threading them through a dedicated,
 *    optional options bag (both fields themselves optional, since neither a house style nor an
 *    append-guidance overlay is guaranteed to exist for a given project/agent) keeps the five
 *    plan-documented parameters exactly as named rather than overloading one of them with an
 *    unrelated second meaning.
 */

/**
 * Block [9]'s own two independent sources — `05` §5.3 names them together ("House style + appended
 * guidance overlay") but they are structurally unrelated inputs (a project-wide `StyleProfile`
 * document, `15` §15.8, vs. one agent overlay's own free-text `$append_guidance` string,
 * `@forge/extensions/resolve`, M2) — kept as two optional fields rather than forcing a caller to
 * pre-merge them into one opaque string this piece could not otherwise validate the shape of.
 */
export interface CompilePromptOptions {
  readonly styleProfile?: StyleProfile | undefined;
  readonly appendGuidance?: string | undefined;
}

function renderRoleBlock(agent: AgentDefinition): string {
  const lines: string[] = [
    `Mandate: ${agent.mandate}`,
    '',
    'Persona:',
    `- Voice: ${agent.persona.voice}`,
    `- Stance: ${agent.persona.stance}`,
    `- Disagreement style: ${agent.persona.disagreement_style}`,
    '',
    'Decisions owned:',
    ...agent.decisions_owned.map((decision) => `- ${decision}`),
    '',
    'Output contract:',
    ...agent.outputs.map(
      (output) =>
        `- ${output.type} (schema: ${output.schema}, path: ${output.path}${
          output.cardinality !== undefined ? `, cardinality: ${output.cardinality}` : ''
        })`,
    ),
  ];
  return lines.join('\n');
}

function renderContextPackBlock(pack: AgentContextPack): string {
  const lines: string[] = ['Pinned core:'];
  for (const [key, value] of Object.entries(pack.pinnedCore)) {
    if (value === undefined) continue;
    lines.push(`- ${key}: ${String(value)}`);
  }
  lines.push('', 'Declared inputs:');
  if (pack.declaredInputs.length === 0) lines.push('(none)');
  for (const entry of pack.declaredInputs) {
    lines.push(`### ${entry.id}`, entry.content);
  }
  lines.push('', 'Retrieved:');
  if (pack.retrieved.length === 0) lines.push('(none)');
  for (const entry of pack.retrieved) {
    lines.push(`### ${entry.id} (score: ${String(entry.score)})`, entry.content);
  }
  return lines.join('\n');
}

/**
 * `05` §5.3 point 5 names this block "exact artifact schema + file paths + front-matter template" --
 * but `AgentDefinition.outputs` (A1's own schema, matching `05` §5.3's own worked `architect` example
 * verbatim: every output there is exactly `type`/`schema`/`path`/optional `cardinality`) carries no
 * separate front-matter-template field at all, and the spec's own worked example never gives one
 * either. Rendered from the real data this type actually has rather than inventing a template field
 * neither the schema nor the spec's own canonical example ever defines -- see `SPEC-QUESTIONS.md` Q102.
 */
function renderOutputContractBlock(agent: AgentDefinition): string {
  return agent.outputs
    .map(
      (output) =>
        `- ${output.type}: schema \`${output.schema}\`, path \`${output.path}\`${
          output.cardinality !== undefined ? ` (cardinality: ${output.cardinality})` : ''
        }`,
    )
    .join('\n');
}

function renderConstraintsBlock(constraints: PromptConstraints): string {
  const lines: string[] = [
    'Tool grants:',
    `- read: ${String(constraints.tools.read)}`,
    `- write: ${String(constraints.tools.write)}`,
    `- exec: ${constraints.tools.exec === undefined ? '(none)' : constraints.tools.exec.join(', ')}`,
    `- network: ${String(constraints.tools.network)}`,
    `- git_commit: ${constraints.tools.git_commit}`,
    `- deploy: ${String(constraints.tools.deploy)}`,
    '',
    'Forbidden actions:',
    ...(constraints.forbiddenActions.length === 0
      ? ['(none)']
      : constraints.forbiddenActions.map((action) => `- ${action}`)),
    '',
    'Budget:',
    `- max_turns: ${String(constraints.budget.max_turns)}`,
    `- wall_clock_ms: ${String(constraints.budget.wall_clock_ms)}`,
    `- max_cost_usd: ${String(constraints.budget.max_cost_usd)}`,
    '',
    `Autonomy: ${constraints.autonomy}`,
  ];
  return lines.join('\n');
}

function renderDefinitionOfDoneBlock(definitionOfDone: readonly string[]): string {
  if (definitionOfDone.length === 0) return '(none)';
  return definitionOfDone.map((check) => `- ${check}`).join('\n');
}

function renderSkillsBlock(pack: AgentContextPack): string {
  if (pack.skills.length === 0) return '(none)';
  const lines: string[] = [];
  for (const skill of pack.skills) {
    lines.push(`### ${skill.id}`, skill.description, `When to use: ${skill.whenToUse}`);
    if (skill.bodyIncluded && skill.body !== undefined) {
      lines.push('', skill.body);
    } else if (skill.demoted) {
      lines.push('(body demoted — over budget; load on demand via FORGE_LOAD_SKILL:)');
    }
    lines.push('');
  }
  return lines.join('\n').trimEnd();
}

function renderHouseStyleBlock(options: CompilePromptOptions): string {
  const lines: string[] = [];
  if (options.styleProfile !== undefined) {
    const style = options.styleProfile;
    const docLengthEntries = Object.entries(style.doc_length);
    lines.push(
      'House style:',
      `- language: ${style.language}`,
      `- tone: ${style.tone}`,
      `- person: ${style.person}`,
      `- banned phrases: ${style.banned_phrases.length === 0 ? '(none)' : style.banned_phrases.join(', ')}`,
      `- commit style: ${style.commit_style}`,
      `- heading style: ${style.artifact_conventions.headings}`,
      `- date format: ${style.artifact_conventions.dates}`,
      `- code fences: ${style.artifact_conventions.code_fences}`,
      `- diagram notation: ${style.artifact_conventions.diagrams}`,
      `- doc length: ${
        docLengthEntries.length === 0
          ? '(none)'
          : docLengthEntries.map(([type, length]) => `${type}: ${length}`).join(', ')
      }`,
    );
  }
  if (options.appendGuidance !== undefined) {
    if (lines.length > 0) lines.push('');
    lines.push('Appended guidance:', options.appendGuidance);
  }
  if (lines.length === 0) return '(none)';
  return lines.join('\n');
}

/**
 * Assembles `05` §5.3's own nine blocks, in order. Blocks [1] (`OPERATING_CONTRACT`, a module-level
 * constant) and [6] (derived only from `constraints`, never from `agent`/`pack`/`options`) are
 * structurally unreachable from any of `agent.skills`/`pack.retrieved`/`pack.declaredInputs`/
 * `options.appendGuidance` — the same "prove it structurally, not just check the happy path" property
 * A5's own Checks text requires, verified concretely by `compile-prompt.test.ts`'s own adversarial
 * fixture.
 */
export function compilePrompt(
  step: StepContext,
  agent: AgentDefinition,
  pack: AgentContextPack,
  constraints: PromptConstraints,
  definitionOfDone: readonly string[],
  options: CompilePromptOptions = {},
): CompiledPrompt {
  const blocks: CompiledPromptBlock[] = [
    { index: 1, name: 'FORGE operating contract', content: OPERATING_CONTRACT },
    { index: 2, name: 'Role block', content: renderRoleBlock(agent) },
    { index: 3, name: 'Project context pack', content: renderContextPackBlock(pack) },
    { index: 4, name: 'Step brief', content: step.brief },
    { index: 5, name: 'Output contract', content: renderOutputContractBlock(agent) },
    { index: 6, name: 'Constraints', content: renderConstraintsBlock(constraints) },
    {
      index: 7,
      name: 'Definition of done',
      content: renderDefinitionOfDoneBlock(definitionOfDone),
    },
    { index: 8, name: 'Skills', content: renderSkillsBlock(pack) },
    { index: 9, name: 'House style + appended guidance', content: renderHouseStyleBlock(options) },
  ];

  const text = blocks
    .map((block) => `## [${String(block.index)}] ${block.name}\n\n${block.content}`)
    .join('\n\n');

  return { blocks, text };
}
