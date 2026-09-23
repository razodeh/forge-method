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
  /**
   * The agent's own loaded `prompt.system` text (`PLAN-M13.md` P5, `SPEC-QUESTIONS.md` D1): role-level
   * working instructions the structured fields (`mandate`/`persona`/`decisions_owned`/`outputs`) do not
   * carry. Appended to block [2] under its own heading -- block [2] is one of `05` §5.3's two
   * customization surfaces, so this widens no invariant: blocks [1] and [6] remain derived from nothing
   * this option (or any other) can reach.
   */
  readonly roleInstructions?: string | undefined;
  /**
   * The agent's own `prompt.briefs.<key>` text for the workflow brief this step runs (`15` §15.3's
   * "replace a specific brief" example), appended to block [4] under its own heading. The caller decides
   * which key applies (this function has no notion of a workflow's brief basename); it only renders.
   */
  readonly roleSpecificGuidance?: string | undefined;
  /**
   * The session is read-only (an interaction-mode participant, a brownfield analysis turn): it writes no
   * files, so block [5] must not tell it to produce the agent's artifact files -- the constraints block
   * [6] says `write: false`, and two blocks of one prompt must not contradict each other.
   */
  readonly readOnly?: boolean | undefined;
}

/** Horizontal whitespace (any Unicode space, never a line break) or an invisible format character
 * (`\p{Cf}`: zero-width, bidi controls, soft hyphen, BOM, tag characters) or default-ignorable code point
 * (Hangul fillers, invisible operators, variation selectors). */
const HSPACE = '(?:[^\\S\\r\\n\\u2028\\u2029]|[\\p{Cf}\\p{Default_Ignorable_Code_Point}])';
/** Anything that can precede a heading marker on its own line without stopping a renderer reading it as
 * a heading: blockquote markers and list-item markers (`- `, `* `, `+ `, `1. `). */
const LINE_PREFIX = `(?:${HSPACE}|>|[-*+]|\\p{Nd}+[.)])*`;
const HASH = `[#\\uff03](?:${HSPACE})*`;
/**
 * A line that reads as one of this compiler's own `## [n] Name` block headings, however it is dressed:
 * any heading depth, any leading whitespace (NBSP and other Unicode spaces included), zero-width or
 * BOM characters, blockquote markers, spaces inside the brackets, full-width `［６］` brackets and digits.
 * Content that reaches blocks [2]-[5] and [7]-[9] (a brief, a KB entry, a skill body, role instructions,
 * appended guidance) is authored by parties who do not control blocks [1] and [6]; a line like
 * `## [6] Constraints` inside it would otherwise render a second, forged block-[6] heading in the very
 * text the model reads, even though the real block's own content is untouched. Any block number is
 * matched: the numbering scheme is an implementation detail no content should be able to imitate.
 * (An *unnumbered* `## Constraints` is not matched -- it cannot be confused with the numbered heading,
 * and real briefs legitimately contain such headings.)
 */
const FORGED_BLOCK_HEADING = new RegExp(
  `^(${LINE_PREFIX})((?:${HASH}){1,6}[\\[\\uff3b\\u3010\\u3014]${HSPACE}*\\p{Nd}+${HSPACE}*[\\]\\uff3d\\u3011\\u3015])`,
  'gmu',
);

/**
 * Defangs block-heading lookalikes in caller/author-supplied content by prefixing a backslash, so the
 * only lines the joined text ever starts with `## [n]` are the nine this module itself emits. Applied to
 * every block whose content is not derived purely from a constant or from `PromptConstraints`. Vertical
 * tab, form feed and NEL are line breaks to some renderers but not to JavaScript's `^`; they are
 * normalised to `\n` first so a heading cannot hide behind one.
 */
export function neutralizeBlockHeadings(content: string): string {
  return content
    .replace(/[\v\f\u0085]/g, '\n')
    .replace(
      FORGED_BLOCK_HEADING,
      (_match, lead: string, heading: string) => `${lead}\\${heading}`,
    );
}

/** One rendered line per value: a pattern or action string from an agent file or an escalation must not
 * be able to start a new line (and so a forged heading) inside block [6]. */
function oneLine(value: string): string {
  return value.replace(/[\r\n\u2028\u2029\v\f\u0085]+/g, ' ');
}

function renderRoleBlock(agent: AgentDefinition, roleInstructions: string | undefined): string {
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
  if (roleInstructions !== undefined && roleInstructions.trim() !== '') {
    lines.push('', 'Role instructions:', roleInstructions);
  }
  return lines.join('\n');
}

function renderStepBriefBlock(brief: string, roleSpecificGuidance: string | undefined): string {
  if (roleSpecificGuidance === undefined || roleSpecificGuidance.trim() === '') return brief;
  return `${brief}\n\nRole-specific guidance for this step:\n${roleSpecificGuidance}`;
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

/** Block [5] for a session that writes nothing: its whole output is its final message. */
const READ_ONLY_OUTPUT_CONTRACT =
  'This session is read-only: do not create or modify files. Your output is your final message (or the structured output the task asks for), and no artifact file is expected from you.';

/**
 * `05` §5.3 point 5 names this block "exact artifact schema + file paths + front-matter template" --
 * but `AgentDefinition.outputs` (A1's own schema, matching `05` §5.3's own worked `architect` example
 * verbatim: every output there is exactly `type`/`schema`/`path`/optional `cardinality`) carries no
 * separate front-matter-template field at all, and the spec's own worked example never gives one
 * either. Rendered from the real data this type actually has rather than inventing a template field
 * neither the schema nor the spec's own canonical example ever defines -- see `SPEC-QUESTIONS.md` Q102.
 * `step.produces` renders exactly what its caller supplied -- `@forge/engine/dispatch`'s
 * `assembleAgentSession` hands the RESOLVED claim (`resolveProduces`, `PLAN-M14.md` P6), so this block
 * names the path a session is actually held to under a relocated docs layout too, not only the shipped
 * default; this module itself has no docs roots to resolve one from, and does not need any.
 */
function renderOutputContractBlock(agent: AgentDefinition, step: StepContext): string {
  // What the block says must match what the engine enforces for THIS step (`PLAN-M13.md` P18, `SPEC-QUESTIONS.md`
  // Q224): a step that declares `outputs` is checked against exactly those and confined to them plus its `produces`;
  // a step that declares none is confined to its `produces` alone. The role's other outputs (what it writes in its other
  // steps) are not listed: they would tell the session to write files this step's claim reverts. Every value here can
  // come from a user-authored workflow, so each goes through `oneLine`.
  const own = new Map(agent.outputs.map((output) => [output.type, output] as const));
  // `step.produces` (`PLAN-M14.md` P6) can arrive matcher-escaped: `resolveProduces` backslash-prefixes a
  // leading `!`/`#` so `enforceClaim`'s real minimatch call (and the skill filter's own reversed
  // comparison, `pack-for-step.ts`) reads a configured docs root literally, never as negation or a
  // comment. Classification (`startsWith('!')`, produces-DSL exclusion syntax) MUST run on that exact
  // escaped form first -- a configured root of `!weird` resolves to `\!weird/...`, which does not itself
  // start with `!` and so is correctly read as an allowed path, not an exclusion -- and only the text
  // actually shown to the agent is unescaped, after classification, never before it (a fresh critic
  // round: unescaping first showed the agent a path containing a literal backslash that does not exist
  // on disk, and briefly also misclassified an allowed `!`-rooted path as a refusal). Blanket, not
  // scoped to only the root's own escaping: a second, independent critic round found this can also strip
  // a workflow author's OWN backslash escape written elsewhere in the same produces entry (minimatch's
  // own escape syntax, e.g. `notes\*.md` meaning the literal filename `notes*.md`), showing it as if it
  // were a live wildcard while the real claim still matches only the literal name. No shipped brief does
  // this (confirmed: `test/write-implies-claim.test.ts`'s identity check covers every real produces
  // entry), enforcement and skill matching are both unaffected (only this display text is wrong), and a
  // precise fix needs `resolveProduces` to return which prefix of the string is its own escaping rather
  // than a flat string a display step can no longer tell apart from the author's -- left open rather than
  // guessed at here.
  const unescapeMatcher = (value: string): string => value.replace(/\\(.)/g, '$1');
  const paths = (
    globs: readonly string[],
  ): { readonly allowed: readonly string[]; readonly refused: readonly string[] } => ({
    allowed: globs
      .filter((glob) => !glob.startsWith('!'))
      .map((glob) => oneLine(unescapeMatcher(glob))),
    refused: globs
      .filter((glob) => glob.startsWith('!'))
      .map((glob) => oneLine(unescapeMatcher(glob.slice(1)))),
  });
  const quoted = (list: readonly string[]): string => list.map((path) => `\`${path}\``).join(', ');
  const claim = paths(step.produces);
  // `PLAN-M14.md` P8: a supervisor already reserved this output's own id (or, `cardinality: 'many'`, a
  // contiguous block) before this prompt was assembled -- the agent is told to use it, not invent one,
  // so a declared KB output's real id is decided once, centrally, collision-free (`08` §8.6, `18`
  // §18.8), never guessed by a session that cannot see what a concurrent step just claimed. Absent
  // (`undefined`/empty) for every non-KB output: this line then renders as nothing.
  const reservedIdsLine = (ids: readonly string[] | undefined): string => {
    if (ids === undefined || ids.length === 0) return '';
    if (ids.length === 1) {
      return ` -- reserved id \`${oneLine(ids[0] ?? '')}\`: use exactly this id, do not choose another`;
    }
    const first = oneLine(ids[0] ?? '');
    const last = oneLine(ids[ids.length - 1] ?? '');
    return ` -- reserved id range \`${first}\`..\`${last}\` (${String(ids.length)} ids): use them in order starting from \`${first}\`, one per new entry, never skipping or reusing one`;
  };
  const claimLines: string[] = [];
  if (claim.allowed.length > 0) {
    claimLines.push(`- Files: only the paths in this step's claim: ${quoted(claim.allowed)}`);
    if (claim.refused.length > 0) {
      claimLines.push(`- Never write (outside this step's claim): ${quoted(claim.refused)}`);
    }
  }

  const declared = step.outputs ?? [];
  if (declared.length === 0) {
    return claimLines.length > 0
      ? claimLines.join('\n')
      : '- This step declares no outputs and names no paths to write: make only the changes the task asks for, and write no artifact files.';
  }
  const lines = declared.map((wanted) => {
    const type = oneLine(wanted.type);
    const role = own.get(wanted.type);
    const path = wanted.path === undefined ? role?.path : oneLine(wanted.path);
    const schema = role === undefined ? '' : `schema \`${oneLine(role.schema)}\``;
    const where = path === undefined ? '' : `path \`${path}\``;
    const cardinality =
      wanted.cardinality === undefined ? '' : ` (cardinality: ${oneLine(wanted.cardinality)})`;
    const subtype = wanted.subtype === undefined ? '' : ` (subtype: ${oneLine(wanted.subtype)})`;
    // A `Diagram` is not produced until its `<path>.yaml` sidecar is (`08` §8.11; the output check demands it).
    const sidecar =
      wanted.type === 'Diagram' && path !== undefined ? ` (and its sidecar \`${path}.yaml\`)` : '';
    const head = [schema, where].filter((part) => part !== '').join(', ');
    const reserved = reservedIdsLine(wanted.reservedIds);
    return head === ''
      ? `- ${type}: declared by this step${subtype}${reserved}`
      : `- ${type}: ${head}${cardinality}${subtype}${sidecar}${reserved}`;
  });
  // The step's own claim beyond its declared outputs (its `produces`) is enforced too, so it is stated too.
  return [...lines, ...claimLines].join('\n');
}

/** The test commands a step may run (`PromptConstraints.testCommands`), one per line, each in backticks: the exact string
 * that runs, nothing appended. Empty when the step runs no tests. */
function renderTestCommandLines(testCommands: PromptConstraints['testCommands']): string[] {
  if (testCommands === undefined) return [];
  const lines: string[] = [];
  if (testCommands.granted.length > 0) {
    lines.push(
      '- test commands you may run (each is exact: run it as written, with nothing added or changed; a variant of one is refused):',
      ...testCommands.granted.map(
        (entry) => `  - ${oneLine(entry.layer)}: \`${oneLine(entry.command)}\``,
      ),
    );
  }
  if (testCommands.unavailable.length > 0) {
    lines.push(
      `- test layers this step needs with no runnable command (unset, or not one plain command): ${testCommands.unavailable.map(oneLine).join(', ')}; you cannot run them, so say they were not run`,
    );
  }
  return lines;
}

function renderConstraintsBlock(constraints: PromptConstraints): string {
  const lines: string[] = [
    'Tool grants:',
    `- read: ${String(constraints.tools.read)}`,
    `- write: ${String(constraints.tools.write)}`,
    `- exec: ${constraints.tools.exec === undefined ? '(none)' : constraints.tools.exec.map(oneLine).join(', ')}`,
    ...renderTestCommandLines(constraints.testCommands),
    `- network: ${String(constraints.tools.network)}`,
    `- git_commit: ${constraints.tools.git_commit}`,
    `- deploy: ${String(constraints.tools.deploy)}`,
    '',
    'Forbidden actions:',
    ...(constraints.forbiddenActions.length === 0
      ? ['(none)']
      : constraints.forbiddenActions.map((action) => `- ${oneLine(action)}`)),
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
    {
      index: 2,
      name: 'Role block',
      content: neutralizeBlockHeadings(renderRoleBlock(agent, options.roleInstructions)),
    },
    {
      index: 3,
      name: 'Project context pack',
      content: neutralizeBlockHeadings(renderContextPackBlock(pack)),
    },
    {
      index: 4,
      name: 'Step brief',
      content: neutralizeBlockHeadings(
        renderStepBriefBlock(step.brief, options.roleSpecificGuidance),
      ),
    },
    {
      index: 5,
      name: 'Output contract',
      content:
        options.readOnly === true
          ? READ_ONLY_OUTPUT_CONTRACT
          : neutralizeBlockHeadings(renderOutputContractBlock(agent, step)),
    },
    { index: 6, name: 'Constraints', content: renderConstraintsBlock(constraints) },
    {
      index: 7,
      name: 'Definition of done',
      content: neutralizeBlockHeadings(renderDefinitionOfDoneBlock(definitionOfDone)),
    },
    { index: 8, name: 'Skills', content: neutralizeBlockHeadings(renderSkillsBlock(pack)) },
    {
      index: 9,
      name: 'House style + appended guidance',
      content: neutralizeBlockHeadings(renderHouseStyleBlock(options)),
    },
  ];

  const text = blocks
    .map((block) => `## [${String(block.index)}] ${block.name}\n\n${block.content}`)
    .join('\n\n');

  return { blocks, text };
}
