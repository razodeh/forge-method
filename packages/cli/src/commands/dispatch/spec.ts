/**
 * `commands/dispatch/spec.ts` — `forge spec <sub>` (`03` §3.2.2), both the narrow, gate-shelled
 * `spec validate --rule <name>` form (`PLAN-M8.md` P2) and the full `spec` surface (`PLAN-M12.md` P4).
 *
 * `buildSpecContext` is exported: `migrate.ts`'s own `runMigrateRunCommand` reuses it verbatim (the
 * real current `bin.ts` already shares this one context builder between `spec`/`migrate` — this
 * extraction keeps that sharing explicit via a cross-file import rather than duplicating the
 * three-field literal).
 *
 * @see specs/22 M17 P2
 */
import { EXIT_CODES } from '@forge/core/errors';
import type { ProjectPaths } from '@forge/core/fs';
import { ARTIFACT_TYPES } from '@forge/schemas';
import type { ArtifactTypeId } from '@forge/schemas';

import { runGateCheck, MAX_LISTED_VIOLATIONS } from '../gate-check-output.ts';
import { printable } from '../output-port.ts';
import {
  specList,
  specMatrix,
  specNew,
  specOrphans,
  specShow,
  SPEC_ARTIFACT_TYPES,
  specTrace,
  specValidate,
  type SpecCommandContext,
} from '../spec.ts';
import { specInterfacesCheck } from '../spec/interfaces.ts';
import {
  specValidateRule,
  VALIDATE_RULE_IDS,
  type ValidateRuleId,
} from '../spec/validate-rules.ts';
import { readConfig } from '../config.ts';
import {
  AGENTS_ROOT,
  assertNoArgs,
  findRuleFlag,
  KB_ROOT,
  parseCommandFlags,
  sanitizeDeep,
  SPECS_ROOT,
  type DispatchContext,
} from './shared.ts';

function isValidateRuleId(value: string | undefined): value is ValidateRuleId {
  return value !== undefined && (VALIDATE_RULE_IDS as readonly string[]).includes(value);
}

/** `story:dor`/`story:file-claim-overlap`/etc. (`G-Ready.gate.yaml`/`G-Stable.gate.yaml`) each shell
 * `forge spec validate --rule <name> --json` and read a top-level numeric `errors` field back
 * (`failOn: 'errors > 0'`) — `specValidateRule`'s own return value carries the full `violations` list
 * instead, so this is the one place that numeric field is actually produced. */
async function runSpecValidateRule(
  paths: ProjectPaths,
  rule: ValidateRuleId,
  json: boolean,
): Promise<number> {
  const ctx = { paths, specsRoot: SPECS_ROOT, kbRoot: KB_ROOT, agentsRoot: AGENTS_ROOT };
  const result = await specValidateRule(ctx, rule);
  if (json) {
    console.log(
      JSON.stringify({
        v: 1,
        errors: result.violations.length,
        violations: result.violations.slice(0, MAX_LISTED_VIOLATIONS),
        ...(result.violations.length > MAX_LISTED_VIOLATIONS ? { truncated: true } : {}),
      }),
    );
  } else if (result.violations.length === 0) {
    console.log(`forge spec validate --rule ${rule}: no real violations.`);
  } else {
    for (const violation of result.violations.slice(0, MAX_LISTED_VIOLATIONS)) {
      console.error(
        printable(
          `${violation.subject}: ${violation.message}${violation.remedy === undefined ? '' : ` ${violation.remedy}`}`,
        ),
      );
    }
    if (result.violations.length > MAX_LISTED_VIOLATIONS) {
      console.error(
        `${String(result.violations.length)} violations in all; only the first ${String(MAX_LISTED_VIOLATIONS)} are listed.`,
      );
    }
  }
  return result.violations.length > 0 ? 1 : 0;
}

const SPEC_SUBCOMMANDS = [
  'list',
  'show',
  'validate',
  'trace',
  'matrix',
  'orphans',
  'new',
  'interfaces',
] as const;

/** Exported for `migrate.ts`'s own `runMigrateRunCommand`. */
export function buildSpecContext(paths: ProjectPaths): SpecCommandContext {
  return { paths, specsRoot: SPECS_ROOT, kbRoot: KB_ROOT, agentsRoot: AGENTS_ROOT };
}

/** `spec validate` with no real `--rule` — `03` §3.2.2's own bare form, distinct from `spec validate
 * --rule <name>` above: the full `18` §18.6 two-phase document check plus `09` §9.4's graph-level
 * required-edge/cycle checks. */
async function runSpecValidateCommand(
  paths: ProjectPaths,
  rest: readonly string[],
  json: boolean,
): Promise<number> {
  assertNoArgs(rest);
  const ctx = buildSpecContext(paths);
  const result = await specValidate(ctx);
  const hasProblems =
    result.documents.some((doc) => !doc.valid) ||
    result.missingRequiredEdges.length > 0 ||
    result.cycles.length > 0;
  if (json) {
    const errors =
      result.documents.reduce(
        (sum, doc) => sum + (doc.valid ? 0 : Math.max(1, doc.errors.length)),
        0,
      ) +
      result.missingRequiredEdges.length +
      result.cycles.length;
    console.log(JSON.stringify({ v: 1, ...result, errors }));
  } else if (!hasProblems) {
    console.log('forge spec validate: no real problems.');
  } else {
    for (const doc of result.documents) {
      if (!doc.valid) for (const error of doc.errors) console.error(`${doc.path}: ${error}`);
    }
    for (const violation of result.missingRequiredEdges) console.error(violation.message);
    for (const cycle of result.cycles) console.error(`cycle: ${cycle.path.join(' -> ')}`);
  }
  return hasProblems ? EXIT_CODES.failure : EXIT_CODES.success;
}

async function runSpecCommand(
  paths: ProjectPaths,
  sub: string | undefined,
  rest: readonly string[],
  json: boolean,
): Promise<number> {
  const ctx = buildSpecContext(paths);

  if (sub === 'list') {
    assertNoArgs(rest);
    const specs = sanitizeDeep(await specList(ctx));
    console.log(
      json
        ? JSON.stringify({ v: 1, specs })
        : specs.map((spec) => `${spec.id} ${spec.type} ${spec.title}`).join('\n'),
    );
    return EXIT_CODES.success;
  }
  if (sub === 'show') {
    const { positionals } = parseCommandFlags(rest, {});
    const [id] = positionals;
    if (id === undefined || positionals.length > 1) {
      console.error('forge: "spec show" needs a real <id>.');
      return EXIT_CODES.usage;
    }
    const doc = await specShow(ctx, id);
    const frontMatter = sanitizeDeep(doc.frontMatter);
    console.log(
      json
        ? JSON.stringify({ v: 1, path: doc.path, frontMatter })
        : `${doc.path}\n${JSON.stringify(frontMatter, null, 2)}`,
    );
    return EXIT_CODES.success;
  }
  if (sub === 'trace') {
    const { positionals } = parseCommandFlags(rest, {});
    const [id] = positionals;
    if (id === undefined || positionals.length > 1) {
      console.error('forge: "spec trace" needs a real <id>.');
      return EXIT_CODES.usage;
    }
    const result = await specTrace(ctx, id);
    console.log(
      json
        ? JSON.stringify({ v: 1, ...result })
        : `parents: ${result.parents.map((p) => p.id).join(', ') || '(none)'}\n` +
            `children: ${result.children.map((c) => c.id).join(', ') || '(none)'}`,
    );
    return EXIT_CODES.success;
  }
  if (sub === 'matrix') {
    assertNoArgs(rest);
    const matrix = await specMatrix(ctx);
    console.log(json ? JSON.stringify({ v: 1, ...matrix }) : JSON.stringify(matrix, null, 2));
    return EXIT_CODES.success;
  }
  if (sub === 'interfaces') {
    // `G-Design`'s `interfaces:frozen` check (`06` §6.6 rule 5, `PLAN-M13.md` P26): the one form there is.
    const { flags, positionals } = parseCommandFlags(rest, { '--check-frozen': false });
    if (!flags.has('--check-frozen') || positionals.length > 0) {
      console.error(
        'forge: "spec interfaces" needs a real --check-frozen (and takes no other argument).',
      );
      return EXIT_CODES.usage;
    }
    return runGateCheck(
      {
        command: 'forge spec interfaces --check-frozen',
        refusalFields: { undefined_refs: 1 },
        json,
        out: console,
      },
      async () => {
        const config = await readConfig(paths);
        return specInterfacesCheck({
          ...ctx,
          specsRoot: config.paths.specs,
          kbRoot: config.paths.kb,
        });
      },
    );
  }
  if (sub === 'orphans') {
    assertNoArgs(rest);
    const orphans = await specOrphans(ctx);
    console.log(
      json
        ? JSON.stringify({ v: 1, orphans })
        : orphans.map((orphan) => `${orphan.kind} ${orphan.id}: ${orphan.reason}`).join('\n') ||
            'forge spec orphans: no real orphans.',
    );
    return orphans.length > 0 ? EXIT_CODES.failure : EXIT_CODES.success;
  }
  if (sub === 'new') {
    const { positionals } = parseCommandFlags(rest, {});
    const [type, title] = positionals;
    if (type === undefined || title === undefined || positionals.length > 2) {
      console.error(
        'forge: "spec new" needs a real <type> <title> (a multi-word title must be one quoted argument).',
      );
      return EXIT_CODES.usage;
    }
    if (!ARTIFACT_TYPES.some((candidate) => candidate.id === type)) {
      console.error(
        `forge: "spec new" needs a real <type> (one of: ${[...SPEC_ARTIFACT_TYPES].join(', ')}).`,
      );
      return EXIT_CODES.usage;
    }
    const doc = await specNew(ctx, type as ArtifactTypeId, title);
    console.log(
      json
        ? JSON.stringify({ v: 1, path: doc.path, id: doc.get(['id']) })
        : `forge spec new ${type}: wrote ${doc.path}.`,
    );
    return EXIT_CODES.success;
  }

  console.error(
    `forge: "spec ${sub ?? ''}" needs a real subcommand (${SPEC_SUBCOMMANDS.join('|')}).`,
  );
  return EXIT_CODES.usage;
}

/**
 * Dispatches `forge spec <sub>`. `undefined` for every other command.
 *
 * @see specs/22 M17 P2
 */
export async function dispatchSpec(ctx: DispatchContext): Promise<number | undefined> {
  const [command, sub, ...rest] = ctx.positionals;
  const { paths, flags } = ctx;
  if (command !== 'spec') return undefined;

  if (sub === 'validate') {
    const ruleFlag = findRuleFlag(rest);
    // `PLAN-M12.md` P4: the bare, no-`--rule` form (`03` §3.2.2's own real `spec validate` row) is
    // wired here too — `ruleFlag === undefined` means no `--rule` was given at all, distinct from `''`
    // (a real, trailing valueless `--rule`) or any other misspelled value.
    if (ruleFlag === undefined) {
      return runSpecValidateCommand(paths, rest, flags.json);
    }
    if (!isValidateRuleId(ruleFlag)) {
      console.error(
        `forge: "spec validate" needs a real --rule <name> (one of: ${VALIDATE_RULE_IDS.join(', ')}); ` +
          `got ${JSON.stringify(ruleFlag)}.`,
      );
      return 2;
    }
    return runSpecValidateRule(paths, ruleFlag, flags.json);
  }
  return runSpecCommand(paths, sub, rest, flags.json);
}
