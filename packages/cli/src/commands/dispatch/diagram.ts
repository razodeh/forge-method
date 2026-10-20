/**
 * `commands/dispatch/diagram.ts` — `forge diagram <sub>` (`03` §3.2.2, `PLAN-M13.md` P26).
 *
 * @see specs/22 M17 P2
 */
import { EXIT_CODES, ForgeError } from '@forge/core/errors';
import type { ProjectPaths } from '@forge/core/fs';

import { readConfig } from '../config.ts';
import {
  diagramDiff,
  diagramGenerate,
  diagramLegend,
  diagramList,
  diagramRender,
  diagramShow,
  diagramSync,
  diagramValidate,
  type DiagramCommandContext,
} from '../diagram.ts';
import {
  DIAGRAM_GATES,
  diagramDriftCheck,
  diagramValidateGate,
  type DiagramGate,
  type DiagramGateContext,
} from '../diagram-gate.ts';
import { runGateCheck } from '../gate-check-output.ts';
import {
  assertNoArgs,
  KB_ROOT,
  parseCommandFlags,
  sanitizeDeep,
  stripControlChars,
  type DispatchContext,
} from './shared.ts';

const DIAGRAM_SUBCOMMANDS = [
  'list',
  'show',
  'validate',
  'render',
  'sync',
  'generate',
  'diff',
  'legend',
] as const;

function buildDiagramContext(paths: ProjectPaths): DiagramCommandContext {
  return { paths, kbRoot: KB_ROOT };
}

const DIAGRAM_RENDER_FLAGS = { '--open': false } as const;
const DIAGRAM_INPUT_FLAGS = { '--input': true } as const;
const DIAGRAM_VALIDATE_FLAGS = { '--gate': true } as const;
const DIAGRAM_GENERATE_FLAGS = { '--input': true, '--all': false, '--check': false } as const;

/** What the two gate-shaped diagram checks (`PLAN-M13.md` P26) read from the configuration. Built
 * inside `runGateCheck`'s thunk, so a project whose config cannot be read is a failing verdict, not
 * a refusal. */
async function buildDiagramGateContext(paths: ProjectPaths): Promise<DiagramGateContext> {
  const config = await readConfig(paths);
  return {
    paths,
    kbRoot: config.paths.kb,
    specsRoot: config.paths.specs,
    level: config.project.level,
    diagrams: {
      complexity: config.diagrams.complexity,
      requireCaptions: config.diagrams.requireCaptions,
      driftPolicy: config.diagrams.driftPolicy,
    },
  };
}

/** Parses a caller-supplied JSON value out of one flag's own raw string — the identical "this
 * package cannot gather it itself... passed straight through from the caller" seam `diagram.generate`/
 * `diff`/`sync`'s own `generatorInput` parameter establishes, since no real "locate my own real
 * project content at runtime" resolver exists anywhere in this codebase yet. A malformed JSON string
 * is a real, reported `USR-002`, never a raw `JSON.parse` `SyntaxError` reaching the caller. */
function parseJsonFlag(flag: string, raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new ForgeError('USR-002', { flag, value: raw });
  }
}

async function runDiagramCommand(
  paths: ProjectPaths,
  sub: string | undefined,
  rest: readonly string[],
  json: boolean,
): Promise<number> {
  const ctx = buildDiagramContext(paths);

  if (sub === 'list') {
    assertNoArgs(rest);
    const entries = sanitizeDeep(await diagramList(ctx));
    console.log(
      json
        ? JSON.stringify({ v: 1, entries })
        : entries.map((entry) => `${entry.id} ${entry.title}`).join('\n'),
    );
    return EXIT_CODES.success;
  }
  if (sub === 'show') {
    const { positionals } = parseCommandFlags(rest, {});
    const [id] = positionals;
    if (id === undefined || positionals.length > 1) {
      console.error('forge: "diagram show" needs a real <id>.');
      return EXIT_CODES.usage;
    }
    const diagram = sanitizeDeep(await diagramShow(ctx, id));
    console.log(json ? JSON.stringify({ v: 1, diagram }) : diagram.source);
    return EXIT_CODES.success;
  }
  if (sub === 'validate') {
    const { values, positionals } = parseCommandFlags(rest, DIAGRAM_VALIDATE_FLAGS);
    const gate = values.get('--gate');
    if (gate !== undefined) {
      // `G-Design`/`G-Deliver`'s `diagram:validate` check (`08` §8.11.7, `PLAN-M13.md` P26).
      if (positionals.length > 0 || !(DIAGRAM_GATES as readonly string[]).includes(gate)) {
        console.error(
          `forge: "diagram validate --gate" needs a real gate (one of ${DIAGRAM_GATES.join('|')}) and takes no <id>; got ${JSON.stringify(gate)}.`,
        );
        return EXIT_CODES.usage;
      }
      return runGateCheck(
        {
          command: `forge diagram validate --gate ${gate}`,
          refusalFields: {},
          json,
          out: console,
        },
        async () => diagramValidateGate(await buildDiagramGateContext(paths), gate as DiagramGate),
      );
    }
    const [id] = positionals;
    if (id === undefined || positionals.length > 1) {
      console.error('forge: "diagram validate" needs a real <id>.');
      return EXIT_CODES.usage;
    }
    const findings = sanitizeDeep(await diagramValidate(ctx, id));
    console.log(
      json
        ? JSON.stringify({ v: 1, findings })
        : findings.map((f) => `${f.severity} ${f.message}`).join('\n') ||
            'forge diagram validate: no real findings.',
    );
    return findings.some((f) => f.severity === 'error') ? EXIT_CODES.failure : EXIT_CODES.success;
  }
  if (sub === 'render') {
    const { flags, positionals } = parseCommandFlags(rest, DIAGRAM_RENDER_FLAGS);
    const [id] = positionals;
    if (id === undefined || positionals.length > 1) {
      console.error('forge: "diagram render" needs a real <id>.');
      return EXIT_CODES.usage;
    }
    if (flags.has('--open')) {
      throw new ForgeError('USR-003', {
        feature: 'forge diagram render --open (no real browser-launch mechanism exists yet)',
      });
    }
    const html = stripControlChars(await diagramRender(ctx, id));
    console.log(json ? JSON.stringify({ v: 1, id, html }) : html);
    return EXIT_CODES.success;
  }
  if (sub === 'generate') {
    const { flags, values, positionals } = parseCommandFlags(rest, DIAGRAM_GENERATE_FLAGS);
    if (flags.has('--all') || flags.has('--check')) {
      // `G-Design`/`G-Deliver`'s `diagram:drift` check (`08` §8.11.6, `PLAN-M13.md` P26): read-only.
      if (
        !flags.has('--all') ||
        !flags.has('--check') ||
        positionals.length > 0 ||
        values.has('--input')
      ) {
        console.error(
          'forge: "diagram generate --all" is the drift check and needs a real --check (it takes no <generator> and no --input).',
        );
        return EXIT_CODES.usage;
      }
      return runGateCheck(
        {
          command: 'forge diagram generate --all --check',
          refusalFields: { drifted: 1 },
          json,
          out: console,
        },
        async () => diagramDriftCheck(await buildDiagramGateContext(paths)),
      );
    }
    const [generatorName] = positionals;
    if (generatorName === undefined || positionals.length > 1) {
      console.error('forge: "diagram generate" needs a real <generator>.');
      return EXIT_CODES.usage;
    }
    const inputRaw = values.get('--input');
    const input = inputRaw === undefined ? undefined : parseJsonFlag('--input', inputRaw);
    const generated = sanitizeDeep(diagramGenerate(generatorName, input));
    console.log(json ? JSON.stringify({ v: 1, generated }) : generated.source);
    return EXIT_CODES.success;
  }
  if (sub === 'diff') {
    const { values, positionals } = parseCommandFlags(rest, DIAGRAM_INPUT_FLAGS);
    const [id] = positionals;
    if (id === undefined || positionals.length > 1) {
      console.error('forge: "diagram diff" needs a real <id>.');
      return EXIT_CODES.usage;
    }
    const inputRaw = values.get('--input');
    if (inputRaw === undefined) {
      console.error(
        'forge: "diagram diff" needs a real --input <json> (this generator\'s own real input).',
      );
      return EXIT_CODES.usage;
    }
    const result = sanitizeDeep(await diagramDiff(ctx, id, parseJsonFlag('--input', inputRaw)));
    console.log(json ? JSON.stringify({ v: 1, result }) : JSON.stringify(result, null, 2));
    return result.hasDrift ? EXIT_CODES.failure : EXIT_CODES.success;
  }
  if (sub === 'sync') {
    const { values, positionals } = parseCommandFlags(rest, DIAGRAM_INPUT_FLAGS);
    if (positionals.length > 0) {
      throw new ForgeError('USR-002', { flag: '[extra positional]', value: positionals[0] ?? '' });
    }
    const inputRaw = values.get('--input');
    if (inputRaw === undefined) {
      console.error(
        'forge: "diagram sync" needs a real --input <json>, a JSON object mapping diagram id to that ' +
          "diagram's own real generator input.",
      );
      return EXIT_CODES.usage;
    }
    const parsedInput = parseJsonFlag('--input', inputRaw);
    if (typeof parsedInput !== 'object' || parsedInput === null || Array.isArray(parsedInput)) {
      throw new ForgeError('USR-002', { flag: '--input', value: inputRaw });
    }
    const generatorInputs = new Map(
      Object.entries(parsedInput as Readonly<Record<string, unknown>>),
    );
    const results = sanitizeDeep(await diagramSync(ctx, generatorInputs));
    console.log(
      json
        ? JSON.stringify({ v: 1, results })
        : results
            .map((result) =>
              result.kind === 'ok'
                ? `${result.id}: ${result.result.hasDrift ? 'drifted' : 'in sync'}`
                : `${result.id}: error ${result.message}`,
            )
            .join('\n') || 'forge diagram sync: no real diagrams with a generator to check.',
    );
    return results.some((result) => result.kind === 'error' || result.result.hasDrift)
      ? EXIT_CODES.failure
      : EXIT_CODES.success;
  }
  if (sub === 'legend') {
    assertNoArgs(rest);
    return diagramLegend();
  }

  console.error(
    `forge: "diagram ${sub ?? ''}" needs a real subcommand (${DIAGRAM_SUBCOMMANDS.join('|')}).`,
  );
  return EXIT_CODES.usage;
}

/**
 * Dispatches `forge diagram <sub>`. `undefined` for every other command.
 *
 * @see specs/22 M17 P2
 */
export async function dispatchDiagram(ctx: DispatchContext): Promise<number | undefined> {
  const [command, sub, ...rest] = ctx.positionals;
  const { paths, flags } = ctx;
  if (command !== 'diagram') return undefined;
  return runDiagramCommand(paths, sub, rest, flags.json);
}
