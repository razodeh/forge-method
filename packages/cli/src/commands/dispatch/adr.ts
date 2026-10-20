/**
 * `commands/dispatch/adr.ts` — `forge adr <sub>` (`03` §3.2.2, `PLAN-M12.md` P4).
 *
 * @see specs/22 M17 P2
 */
import { EXIT_CODES } from '@forge/core/errors';
import type { ProjectPaths } from '@forge/core/fs';

import {
  adrAccept,
  adrList,
  adrNew,
  adrReject,
  adrShow,
  adrSupersede,
  type AdrCommandContext,
} from '../adr.ts';
import {
  assertNoArgs,
  gateCommandMarker,
  KB_ROOT,
  parseCommandFlags,
  realEnvSnapshot,
  sanitizeDeep,
  type DispatchContext,
} from './shared.ts';

const ADR_SUBCOMMANDS = ['new', 'list', 'show', 'supersede', 'accept', 'reject'] as const;

/** The real FORGE session marker (`@forge/core/session-marker`, `PLAN-M14.md` P4/P31), read once
 * via `gateCommandMarker` -- itself a plain env-to-object reader with no gate-specific semantics, so
 * reused directly rather than duplicated. Absent `FORGE_RUN_ID`: `undefined`, a real human's own
 * shell never carries this marker, and `adrAccept`/`adrReject`/`adrSupersede` (`refuseUnderMarker`)
 * behave exactly as they did before this piece. */
function buildAdrContext(paths: ProjectPaths): AdrCommandContext {
  const marker = gateCommandMarker(realEnvSnapshot());
  return { paths, kbRoot: KB_ROOT, ...(marker === undefined ? {} : { marker }) };
}

async function runAdrCommand(
  paths: ProjectPaths,
  sub: string | undefined,
  rest: readonly string[],
  json: boolean,
): Promise<number> {
  const ctx = buildAdrContext(paths);

  if (sub === 'new') {
    const { positionals } = parseCommandFlags(rest, {});
    const [title] = positionals;
    if (title === undefined || positionals.length > 1) {
      console.error('forge: "adr new" needs a real <title>.');
      return EXIT_CODES.usage;
    }
    const doc = await adrNew(ctx, title);
    console.log(
      json
        ? JSON.stringify({ v: 1, path: doc.path, id: doc.get(['id']) })
        : `forge adr new: wrote ${doc.path}.`,
    );
    return EXIT_CODES.success;
  }
  if (sub === 'list') {
    assertNoArgs(rest);
    const entries = sanitizeDeep(await adrList(ctx));
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
      console.error('forge: "adr show" needs a real <id>.');
      return EXIT_CODES.usage;
    }
    const doc = await adrShow(ctx, id);
    const frontMatter = sanitizeDeep(doc.frontMatter);
    console.log(
      json
        ? JSON.stringify({ v: 1, path: doc.path, frontMatter })
        : `${doc.path}\n${JSON.stringify(frontMatter, null, 2)}`,
    );
    return EXIT_CODES.success;
  }
  if (sub === 'supersede') {
    const { positionals } = parseCommandFlags(rest, {});
    const [id, newTitle] = positionals;
    if (id === undefined || newTitle === undefined || positionals.length > 2) {
      console.error('forge: "adr supersede" needs a real <id> <newTitle>.');
      return EXIT_CODES.usage;
    }
    const result = await adrSupersede(ctx, id, newTitle);
    console.log(
      json
        ? JSON.stringify({
            v: 1,
            superseded: result.superseded.path,
            replacement: result.replacement.path,
          })
        : `forge adr supersede ${id}: ${result.superseded.path} -> ${result.replacement.path}.`,
    );
    return EXIT_CODES.success;
  }
  if (sub === 'accept' || sub === 'reject') {
    const { positionals } = parseCommandFlags(rest, {});
    const [id] = positionals;
    if (id === undefined || positionals.length > 1) {
      console.error(`forge: "adr ${sub}" needs a real <id>.`);
      return EXIT_CODES.usage;
    }
    const doc = sub === 'accept' ? await adrAccept(ctx, id) : await adrReject(ctx, id);
    console.log(
      json
        ? JSON.stringify({ v: 1, path: doc.path, status: doc.get(['status']) })
        : `forge adr ${sub} ${id}: recorded.`,
    );
    return EXIT_CODES.success;
  }

  console.error(
    `forge: "adr ${sub ?? ''}" needs a real subcommand (${ADR_SUBCOMMANDS.join('|')}).`,
  );
  return EXIT_CODES.usage;
}

/**
 * Dispatches `forge adr <sub>`. `undefined` for every other command.
 *
 * @see specs/22 M17 P2
 */
export async function dispatchAdr(ctx: DispatchContext): Promise<number | undefined> {
  const [command, sub, ...rest] = ctx.positionals;
  const { paths, flags } = ctx;
  if (command !== 'adr') return undefined;
  return runAdrCommand(paths, sub, rest, flags.json);
}
