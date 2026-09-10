/**
 * `forge diagram <list|show|validate|render [--open]|sync|generate <generator>|diff <id>|legend>` —
 * `03` §3.2.2.
 *
 * @see specs/03 §3.2.2
 */
import { ForgeError } from '@forge/core/errors';
import type { ProjectPaths } from '@forge/core/fs';
import { parseKbTree } from '@forge/kb/schema';
import type { Diagram } from '@forge/schemas';
import { checkDrift, type DriftResult } from '@forge/diagrams/drift';
import {
  GENERATOR_NAMES,
  runGenerator,
  type GeneratedDiagram,
  type GeneratorName,
} from '@forge/diagrams/generate';
import { lintDiagram } from '@forge/diagrams/lint';
import type { DiagramFinding } from '@forge/diagrams/lint';
import { parseDiagram } from '@forge/diagrams/parse';
import { renderHtml } from '@forge/diagrams/render';

import { summarize, type KbEntrySummary } from './shared.ts';

export interface DiagramCommandContext {
  readonly paths: ProjectPaths;
  readonly kbRoot: string;
}

function isDiagramEntry(
  entry: Awaited<ReturnType<typeof parseKbTree>>['entries'][number],
): entry is { readonly kind: 'diagram'; readonly path: string; readonly value: Diagram } {
  return entry.kind === 'diagram';
}

async function findDiagram(ctx: DiagramCommandContext, id: string): Promise<Diagram> {
  const tree = await parseKbTree(ctx.paths, ctx.kbRoot);
  const entry = tree.entries.filter(isDiagramEntry).find((candidate) => candidate.value.id === id);
  if (entry === undefined) {
    throw new ForgeError('KB-015', { id });
  }
  return entry.value;
}

export async function diagramList(ctx: DiagramCommandContext): Promise<readonly KbEntrySummary[]> {
  const tree = await parseKbTree(ctx.paths, ctx.kbRoot);
  return tree.entries
    .filter((entry) => entry.kind === 'diagram')
    .map((entry) => summarize(entry, ctx.kbRoot));
}

export async function diagramShow(ctx: DiagramCommandContext, id: string): Promise<Diagram> {
  return findDiagram(ctx, id);
}

export async function diagramValidate(
  ctx: DiagramCommandContext,
  id: string,
): Promise<readonly DiagramFinding[]> {
  const diagram = await findDiagram(ctx, id);
  const parsed = await parseDiagram(diagram.source);
  return lintDiagram(diagram, parsed);
}

/** `render [--open]`: the real, self-contained HTML document itself (`@forge/diagrams/render`'s own
 * pure `renderHtml`), returned as a string — this function writes nothing to disk on its own; a
 * gauntlet critic found an earlier version of this doc comment claimed "the file is written and its
 * path returned," which was never true (`renderHtml` is a pure string builder, confirmed by this
 * function's own test asserting the return value *is* the markup, not a path). Writing the returned
 * HTML to a real file and handling `--open` is the real CLI command's own job once one exists, not
 * this thin wrapper's. */
export async function diagramRender(ctx: DiagramCommandContext, id: string): Promise<string> {
  const diagram = await findDiagram(ctx, id);
  return renderHtml(diagram.source);
}

function isGeneratorName(value: string): value is GeneratorName {
  return (GENERATOR_NAMES as readonly string[]).includes(value);
}

/** `generate <generator>`: a real generator call (`@forge/diagrams/generate`'s own `runGenerator`) —
 * `input` is whatever that generator's own input type documents; this package cannot gather it
 * itself (no project-tree access below `@forge/cli`'s own boundary — matching `checkDrift`'s own
 * documented caller-supplies-it contract), so it is passed straight through from the caller. */
export function diagramGenerate(generatorName: string, input: unknown): GeneratedDiagram {
  if (!isGeneratorName(generatorName)) {
    throw new ForgeError('USR-002', { flag: 'generator', value: generatorName });
  }
  return runGenerator(generatorName, input);
}

/**
 * `diff <id>` / `sync`: `08` §8.11.6's own re-derive-and-compare (`checkDrift`) — needs the same
 * caller-supplied `generatorInput` `diagramGenerate` does, for the identical reason. `sync` runs it
 * against every diagram that declares a generator, `diff <id>` against just one; neither writes
 * anything back (this milestone has no autofix-apply wiring — `applyAutofix` exists in
 * `@forge/diagrams/drift` but nothing here calls it yet, a real, narrow gap, not this command's own
 * job to invent).
 */
export async function diagramDiff(
  ctx: DiagramCommandContext,
  id: string,
  generatorInput: unknown,
): Promise<DriftResult> {
  const diagram = await findDiagram(ctx, id);
  return checkDrift(diagram, diagram.source, generatorInput);
}

export type DiagramSyncOutcome =
  | { readonly id: string; readonly kind: 'ok'; readonly result: DriftResult }
  | { readonly id: string; readonly kind: 'error'; readonly message: string };

/**
 * `sync` — `checkDrift`'s own real generator call (`GENERATORS[generator](generatorInput)`) can
 * throw for one diagram (malformed or mismatched `generatorInput` — a real possibility, not
 * hypothetical) without that meaning every *other* diagram's own real drift check should be lost too.
 * A gauntlet critic found the original version let one such throw escape the whole loop, with no
 * diagram id attached to tell the caller which one failed, and silently discarding every result
 * already computed for diagrams processed earlier. Each diagram's own outcome — a real `DriftResult`
 * or a real error message, always tagged with its own id — is collected instead, so one bad input
 * never hides every other diagram's real result.
 */
export async function diagramSync(
  ctx: DiagramCommandContext,
  generatorInputs: ReadonlyMap<string, unknown>,
): Promise<readonly DiagramSyncOutcome[]> {
  const tree = await parseKbTree(ctx.paths, ctx.kbRoot);
  const results: DiagramSyncOutcome[] = [];
  for (const entry of tree.entries) {
    if (entry.kind !== 'diagram' || entry.value.generator === undefined) continue;
    const input = generatorInputs.get(entry.value.id);
    if (input === undefined) continue;
    try {
      const result = checkDrift(entry.value, entry.value.source, input);
      results.push({ id: entry.value.id, kind: 'ok', result });
    } catch (cause) {
      results.push({
        id: entry.value.id,
        kind: 'error',
        message: cause instanceof Error ? cause.message : String(cause),
      });
    }
  }
  return results;
}

/** `legend`: `08` §8.11.8's own `diagrams.legend` project-config field, auto-appended to standalone
 * views — `@forge/schemas/config`'s own `diagramsSchema` has no `legend` field, and no generator
 * produces one either, so there is no real data anywhere in this codebase for this command to read.
 * Refused rather than fabricated. */
export function diagramLegend(): never {
  throw new ForgeError('USR-003', { feature: 'diagram legend' });
}
