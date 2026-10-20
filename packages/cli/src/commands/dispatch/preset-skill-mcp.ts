/**
 * `commands/dispatch/preset-skill-mcp.ts` — `forge preset <sub>`/`forge skill <sub>`/`forge mcp
 * <sub>` (`03` §3.2.8). Three small, related commands sharing one file — `bin.test.ts`'s own real
 * test grouping (`describe('forge preset / forge skill / forge mcp ...')`) already treats these as
 * one family, and none of the three shares a real helper with any other dispatch area.
 *
 * @see specs/22 M17 P2
 */
import { EXIT_CODES, ForgeError } from '@forge/core/errors';
import type { ProjectPaths } from '@forge/core/fs';

import { mcpList, mcpValidate, type McpCommandContext } from '../mcp.ts';
import {
  presetApply,
  presetEject,
  presetList,
  presetShow,
  type PresetCommandContext,
} from '../preset.ts';
import { skillList, skillValidate, type SkillCommandContext } from '../skill.ts';
import { assertNoArgs, parseCommandFlags, type DispatchContext } from './shared.ts';

const PRESET_SUBCOMMANDS = ['list', 'show', 'apply'] as const;
const PRESET_APPLY_FLAGS = { '--eject': false } as const;

async function runPresetCommand(
  paths: ProjectPaths,
  sub: string | undefined,
  rest: readonly string[],
  json: boolean,
): Promise<number> {
  if (sub === 'list') {
    assertNoArgs(rest);
    const presets = presetList();
    console.log(
      json
        ? JSON.stringify({ v: 1, presets })
        : presets.map((preset) => `${preset.id} (${preset.posture})`).join('\n'),
    );
    return EXIT_CODES.success;
  }
  if (sub === 'show') {
    const { positionals } = parseCommandFlags(rest, {});
    const [id] = positionals;
    if (id === undefined || positionals.length > 1) {
      console.error('forge: "preset show" needs a real <id>.');
      return EXIT_CODES.usage;
    }
    const preset = presetShow(id);
    console.log(json ? JSON.stringify({ v: 1, preset }) : JSON.stringify(preset, null, 2));
    return EXIT_CODES.success;
  }
  if (sub === 'apply') {
    const { flags, positionals } = parseCommandFlags(rest, PRESET_APPLY_FLAGS);
    const [id] = positionals;
    if (id === undefined || positionals.length > 1) {
      console.error('forge: "preset apply" needs a real <id>.');
      return EXIT_CODES.usage;
    }
    if (flags.has('--eject')) {
      const overlays = presetEject(id);
      console.log(
        json
          ? JSON.stringify({ v: 1, overlays })
          : overlays.map((overlay) => overlay.path).join('\n'),
      );
      return EXIT_CODES.success;
    }
    const ctx: PresetCommandContext = { paths };
    const applied = await presetApply(ctx, id);
    console.log(
      json
        ? JSON.stringify({ v: 1, applied })
        : `forge preset apply ${id}: wrote ${String(applied.files.length)} file(s).`,
    );
    return EXIT_CODES.success;
  }

  // `diff` is `03` §3.2.8's own named subcommand with no real mechanism anywhere in this codebase
  // (`preset.ts`'s own surface has no `presetDiff` at all) — a real, disclosed gap, not fabricated here.
  console.error(
    `forge: "preset ${sub ?? ''}" needs a real subcommand this dispatcher wires yet ` +
      `(${PRESET_SUBCOMMANDS.join('|')}) — "diff" has no real mechanism yet (see SPEC-QUESTIONS.md).`,
  );
  return EXIT_CODES.usage;
}

const SKILL_SUBCOMMANDS = ['list', 'validate'] as const;

async function runSkillCommand(
  paths: ProjectPaths,
  sub: string | undefined,
  rest: readonly string[],
  json: boolean,
): Promise<number> {
  const ctx: SkillCommandContext = { paths };

  if (sub === 'list') {
    assertNoArgs(rest);
    const ids = await skillList(ctx);
    console.log(json ? JSON.stringify({ v: 1, ids }) : ids.join('\n'));
    return EXIT_CODES.success;
  }
  if (sub === 'validate') {
    const { positionals } = parseCommandFlags(rest, {});
    const [id] = positionals;
    if (id === undefined || positionals.length > 1) {
      console.error('forge: "skill validate" needs a real <id>.');
      return EXIT_CODES.usage;
    }
    const outcome = await skillValidate(ctx, id);
    console.log(json ? JSON.stringify({ v: 1, outcome }) : JSON.stringify(outcome, null, 2));
    return outcome.valid ? EXIT_CODES.success : EXIT_CODES.failure;
  }

  // `new`/`attach`/`detach`/`test`/`import` are `03` §3.2.8's own named subcommands with no real
  // mechanism anywhere in `@forge/extensions/skills` — a real, disclosed gap, not fabricated here.
  console.error(
    `forge: "skill ${sub ?? ''}" needs a real subcommand this dispatcher wires yet (${SKILL_SUBCOMMANDS.join('|')}).`,
  );
  return EXIT_CODES.usage;
}

const MCP_SUBCOMMANDS = ['validate', 'list'] as const;
const MCP_VALIDATE_FLAGS = { '--environment': true } as const;

async function runMcpCommand(
  paths: ProjectPaths,
  sub: string | undefined,
  rest: readonly string[],
  json: boolean,
): Promise<number> {
  if (sub === 'validate') {
    const { values, positionals } = parseCommandFlags(rest, MCP_VALIDATE_FLAGS);
    if (positionals.length > 0) {
      throw new ForgeError('USR-002', { flag: '[extra positional]', value: positionals[0] ?? '' });
    }
    const environment = values.get('--environment');
    if (environment === undefined) {
      console.error('forge: "mcp validate" needs a real --environment <env>.');
      return EXIT_CODES.usage;
    }
    const ctx: McpCommandContext = { paths };
    const outcome = await mcpValidate(ctx, environment);
    console.log(json ? JSON.stringify({ v: 1, outcome }) : JSON.stringify(outcome, null, 2));
    return outcome.valid ? EXIT_CODES.success : EXIT_CODES.failure;
  }
  if (sub === 'list') {
    assertNoArgs(rest);
    return mcpList();
  }

  // `add`/`test`/`grant`/`revoke`/`trace` are `03` §3.2.8's own named subcommands with no real
  // mechanism anywhere in `@forge/extensions/mcp` — a real, disclosed gap, not fabricated here.
  console.error(
    `forge: "mcp ${sub ?? ''}" needs a real subcommand this dispatcher wires yet (${MCP_SUBCOMMANDS.join('|')}).`,
  );
  return EXIT_CODES.usage;
}

/**
 * Dispatches `forge preset`/`forge skill`/`forge mcp`. `undefined` for every other command.
 *
 * @see specs/22 M17 P2
 */
export async function dispatchPresetSkillMcp(ctx: DispatchContext): Promise<number | undefined> {
  const [command, sub, ...rest] = ctx.positionals;
  const { paths, flags } = ctx;

  if (command === 'preset') {
    return runPresetCommand(paths, sub, rest, flags.json);
  }
  if (command === 'skill') {
    return runSkillCommand(paths, sub, rest, flags.json);
  }
  if (command === 'mcp') {
    return runMcpCommand(paths, sub, rest, flags.json);
  }
  return undefined;
}
