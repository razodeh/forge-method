/**
 * `commands/dispatch/kb.ts` — `forge kb <sub>` (`03` §3.2.2, `17` §17.4/§17.6, `specs/22` M15 P10).
 *
 * @see specs/22 M17 P2
 */
import { EXIT_CODES, ForgeError } from '@forge/core/errors';
import type { ProjectPaths } from '@forge/core/fs';
import type { ArtifactSource } from '@forge/schemas';
import { artifactSourceSchema } from '@forge/schemas';

import { readConfig } from '../config.ts';
import {
  kbDiff,
  kbDisclose,
  kbDiscloseResolve,
  kbDisclosures,
  kbGraph,
  kbLint,
  kbList,
  kbOpen,
  kbSearch,
  kbShow,
  kbSync,
  kbVerify,
  type KbCommandContext,
} from '../kb.ts';
import { runKbLintRuleCommand } from '../kb-rule-command.ts';
import { describeRefusal } from '../output-port.ts';
import {
  assertNoArgs,
  isBlank,
  KB_ROOT,
  parseCommandFlags,
  realEnvSnapshot,
  sanitizeDeep,
  SPECS_ROOT,
  type DispatchContext,
} from './shared.ts';

const KB_SUBCOMMANDS = [
  'list',
  'show',
  'search',
  'lint',
  'diff',
  'sync',
  'open',
  'graph',
  'verify',
  'disclosures',
  'disclose',
] as const;

async function buildKbContext(paths: ProjectPaths): Promise<KbCommandContext> {
  const config = await readConfig(paths);
  return {
    paths,
    kbRoot: KB_ROOT,
    specsRoot: SPECS_ROOT,
    level: config.project.level,
    env: realEnvSnapshot(),
    reportsRoot: config.paths.reports,
  };
}

const KB_GRAPH_FLAGS = { '--hops': true } as const;
const KB_LINT_FLAGS = { '--rule': true } as const;
const KB_DISCLOSE_FLAGS = {
  '--kind': true,
  '--summary': true,
  '--owner': true,
  '--source': true,
} as const;
const KB_DISCLOSE_RESOLVE_FLAGS = { '--reason': true, '--by': true } as const;

/** `--source <kind>:<ref>` (`forge kb disclose`'s own one-source-per-call simplification). Validated
 * against the real `artifactSourceSchema` rather than a hand-rolled kind check, so the two can never
 * silently drift. */
function parseDiscloseSource(raw: string): ArtifactSource {
  const sep = raw.indexOf(':');
  if (sep === -1) throw new ForgeError('USR-002', { flag: '--source', value: raw });
  const candidate = { kind: raw.slice(0, sep), ref: raw.slice(sep + 1) };
  const parsed = artifactSourceSchema.safeParse(candidate);
  if (!parsed.success) throw new ForgeError('USR-002', { flag: '--source', value: raw });
  return parsed.data;
}

async function runKbCommand(
  paths: ProjectPaths,
  sub: string | undefined,
  rest: readonly string[],
  json: boolean,
): Promise<number> {
  if (sub === 'lint') {
    const { values: lintValues, positionals: lintPositionals } = parseCommandFlags(
      rest,
      KB_LINT_FLAGS,
    );
    assertNoArgs(lintPositionals);
    if (rest.filter((token) => token === '--rule').length > 1) {
      throw new ForgeError('USR-002', { flag: '--rule', value: 'given more than once' });
    }
    const lintRule = lintValues.get('--rule');
    // Context is built inside the rule command: a project whose config cannot be read is a failing
    // verdict there, not a refusal that escapes with no `errors` field for the gate to read.
    if (lintRule !== undefined) {
      return runKbLintRuleCommand(() => buildKbContext(paths), lintRule, json, console);
    }
    let findings: Awaited<ReturnType<typeof kbLint>>;
    try {
      findings = sanitizeDeep(await kbLint(await buildKbContext(paths)));
    } catch (error) {
      // `G-Design`'s `kb:lint` reads `errors`; a refusal printed by the top-level handler has none.
      // Under `--json` an unreadable project is one failing finding instead.
      if (!json) throw error;
      const refusal = describeRefusal(error);
      console.log(
        JSON.stringify({
          v: 1,
          errors: 1,
          findings: [
            {
              ruleId: 'kb:refused',
              severity: 'error',
              message: `The check could not run: ${refusal.message}`,
              remedy: refusal.remedy,
            },
          ],
        }),
      );
      return EXIT_CODES.failure;
    }
    const errors = findings.filter((f) => f.severity === 'error').length;
    console.log(
      json
        ? JSON.stringify({ v: 1, errors, findings })
        : findings
            .map(
              (f) =>
                `${f.severity} ${f.ruleId}${f.entryId === undefined ? '' : ` ${f.entryId}`}: ${f.message}`,
            )
            .join('\n') || 'forge kb lint: no real findings.',
    );
    return errors > 0 ? EXIT_CODES.failure : EXIT_CODES.success;
  }
  const ctx = await buildKbContext(paths);

  if (sub === 'list') {
    assertNoArgs(rest);
    const entries = sanitizeDeep(await kbList(ctx));
    console.log(
      json
        ? JSON.stringify({ v: 1, entries })
        : entries.map((entry) => `${entry.kind} ${entry.id} ${entry.title}`).join('\n'),
    );
    return EXIT_CODES.success;
  }
  if (sub === 'show') {
    const { positionals } = parseCommandFlags(rest, {});
    const [id] = positionals;
    if (id === undefined || positionals.length > 1) {
      console.error('forge: "kb show" needs a real <id>.');
      return EXIT_CODES.usage;
    }
    const entry = sanitizeDeep(await kbShow(ctx, id));
    console.log(
      json
        ? JSON.stringify({ v: 1, entry })
        : `${entry.kind} ${entry.id} ${entry.title} (${entry.path})`,
    );
    return EXIT_CODES.success;
  }
  if (sub === 'search') {
    const { positionals } = parseCommandFlags(rest, {});
    const query = positionals.join(' ');
    if (query === '') {
      console.error('forge: "kb search" needs a real <query>.');
      return EXIT_CODES.usage;
    }
    const hits = sanitizeDeep(await kbSearch(ctx, query));
    console.log(
      json
        ? JSON.stringify({ v: 1, hits })
        : hits.map((hit) => `${hit.id} (${hit.score.toFixed(2)}) ${hit.title}`).join('\n') ||
            'forge kb search: no real hits.',
    );
    return EXIT_CODES.success;
  }
  if (sub === 'diff') {
    assertNoArgs(rest);
    return kbDiff();
  }
  if (sub === 'sync') {
    assertNoArgs(rest);
    const result = await kbSync(ctx);
    console.log(
      json
        ? JSON.stringify({ v: 1, ...result })
        : `forge kb sync: indexed ${String(result.entryCount)} entries.`,
    );
    return EXIT_CODES.success;
  }
  if (sub === 'open') {
    const { positionals } = parseCommandFlags(rest, {});
    const [id] = positionals;
    if (id === undefined || positionals.length > 1) {
      console.error('forge: "kb open" needs a real <id>.');
      return EXIT_CODES.usage;
    }
    const result = await kbOpen(ctx, id);
    console.log(json ? JSON.stringify({ v: 1, ...result }) : result.path);
    return EXIT_CODES.success;
  }
  if (sub === 'graph') {
    const { values, positionals } = parseCommandFlags(rest, KB_GRAPH_FLAGS);
    if (positionals.length > 1) {
      throw new ForgeError('USR-002', { flag: '[extra positional]', value: positionals[1] ?? '' });
    }
    const hopsRaw = values.get('--hops');
    let hops = 1;
    if (hopsRaw !== undefined) {
      if (!/^\d+$/.test(hopsRaw))
        throw new ForgeError('USR-002', { flag: '--hops', value: hopsRaw });
      hops = Number(hopsRaw);
    }
    const edges = await kbGraph(ctx, positionals[0], hops);
    console.log(
      json
        ? JSON.stringify({ v: 1, edges })
        : edges.map((edge) => `${edge.from} -> ${edge.to}`).join('\n') ||
            'forge kb graph: no real edges.',
    );
    return EXIT_CODES.success;
  }
  if (sub === 'verify') {
    assertNoArgs(rest);
    const findings = sanitizeDeep(await kbVerify(ctx));
    const failing = findings.filter(
      (f) =>
        f.outcome === 'fail' ||
        f.outcome === 'timeout' ||
        f.outcome === 'error' ||
        f.outcome === 'refused',
    );
    console.log(
      json
        ? JSON.stringify({ v: 1, findings })
        : findings.map((f) => `${f.outcome} ${f.id}: ${f.detail}`).join('\n') ||
            'forge kb verify: no real, verifiable entries.',
    );
    return failing.length > 0 ? EXIT_CODES.failure : EXIT_CODES.success;
  }
  if (sub === 'disclosures') {
    assertNoArgs(rest);
    const ledger = sanitizeDeep(await kbDisclosures(ctx));
    const openCount = ledger.entries.filter((entry) => entry.open).length;
    const corruptNote =
      (ledger.disclosureCorruptCount > 0
        ? ` (${String(ledger.disclosureCorruptCount)} entr${ledger.disclosureCorruptCount === 1 ? 'y' : 'ies'} in kb/disclosures.md could not be read -- see \`forge kb lint\`.)`
        : '') +
      (ledger.exemptionCorruptCount > 0
        ? ` (${String(ledger.exemptionCorruptCount)} entr${ledger.exemptionCorruptCount === 1 ? 'y' : 'ies'} in reports/exemptions.md could not be read.)`
        : '');
    console.log(
      json
        ? JSON.stringify({
            v: 1,
            open: openCount,
            disclosuresCorrupt: ledger.disclosureCorruptCount,
            exemptionsCorrupt: ledger.exemptionCorruptCount,
            entries: ledger.entries,
          })
        : (ledger.entries
            .map(
              (entry) =>
                `${entry.open ? 'open' : 'resolved'} ${entry.synthesized ? '(synthesized) ' : ''}${entry.kind} ${entry.id} (${entry.owner}): ${entry.summary}`,
            )
            .join('\n') || 'forge kb disclosures: none recorded.') + corruptNote,
    );
    return EXIT_CODES.success;
  }
  if (sub === 'disclose') {
    if (rest[0] === 'resolve') {
      const { values, positionals } = parseCommandFlags(rest.slice(1), KB_DISCLOSE_RESOLVE_FLAGS);
      const [id] = positionals;
      const reason = values.get('--reason');
      const by = values.get('--by');
      if (id === undefined || positionals.length > 1) {
        console.error('forge: "kb disclose resolve" needs a real <id>.');
        return EXIT_CODES.usage;
      }
      if (reason === undefined || by === undefined) {
        console.error('forge: "kb disclose resolve" needs --reason <text> --by <identifier>.');
        return EXIT_CODES.usage;
      }
      if (isBlank(reason)) {
        console.error('forge: "kb disclose resolve" needs a real, non-blank --reason.');
        return EXIT_CODES.usage;
      }
      if (isBlank(by)) {
        console.error('forge: "kb disclose resolve" needs a real, non-blank --by.');
        return EXIT_CODES.usage;
      }
      await kbDiscloseResolve(ctx, { id, reason, by });
      console.log(
        json
          ? JSON.stringify({ v: 1, resolved: true, id })
          : `forge kb disclose resolve: ${id} resolved.`,
      );
      return EXIT_CODES.success;
    }
    const { values, positionals } = parseCommandFlags(rest, KB_DISCLOSE_FLAGS);
    assertNoArgs(positionals);
    const kind = values.get('--kind');
    const summary = values.get('--summary');
    const owner = values.get('--owner');
    const sourceRaw = values.get('--source');
    if (kind !== 'trade-off' && kind !== 'known-gap') {
      console.error('forge: "kb disclose" needs --kind <trade-off|known-gap>.');
      return EXIT_CODES.usage;
    }
    if (summary === undefined || isBlank(summary)) {
      console.error('forge: "kb disclose" needs a real, non-blank --summary <text>.');
      return EXIT_CODES.usage;
    }
    if (owner === undefined || isBlank(owner)) {
      console.error('forge: "kb disclose" needs a real, non-blank --owner <identifier>.');
      return EXIT_CODES.usage;
    }
    if (sourceRaw === undefined) {
      console.error(
        'forge: "kb disclose" needs a real --source <kind>:<ref> (decision/human/code/external).',
      );
      return EXIT_CODES.usage;
    }
    const source = parseDiscloseSource(sourceRaw);
    const id = await kbDisclose(ctx, { kind, summary, owner, sources: [source] });
    console.log(
      json ? JSON.stringify({ v: 1, recorded: true, id }) : `forge kb disclose: recorded ${id}.`,
    );
    return EXIT_CODES.success;
  }

  console.error(`forge: "kb ${sub ?? ''}" needs a real subcommand (${KB_SUBCOMMANDS.join('|')}).`);
  return EXIT_CODES.usage;
}

/**
 * Dispatches `forge kb <sub>`. `undefined` for every other command.
 *
 * @see specs/22 M17 P2
 */
export async function dispatchKb(ctx: DispatchContext): Promise<number | undefined> {
  const [command, sub, ...rest] = ctx.positionals;
  const { paths, flags } = ctx;
  if (command !== 'kb') return undefined;
  return runKbCommand(paths, sub, rest, flags.json);
}
