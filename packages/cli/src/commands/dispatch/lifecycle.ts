/**
 * `commands/dispatch/lifecycle.ts` — the project's own real health/status commands:
 * `forge agent|workflow|template validate --all` (`specs/22` M6 C9, the dispatcher's own original
 * mandate), `forge status` (`03` §3.5), and `forge doctor [--fix] [--rebuild-index] [--rule <name>]`
 * (`03` §3.7). Grouped as one "lifecycle" area because each answers the same question — "is this
 * project in a healthy, known-good state right now" — distinct from `workspace.ts`'s own
 * "operate on this project's configuration/cost/audit/report/uninstall" commands (a DECISION: the
 * original `bin.ts` groups `audit`/`config`/`cost`/`report`/`uninstall`/`export` together under one
 * `PLAN-M12.md` P2 doc comment alongside `doctor`, but `doctor`'s own real role — the one command
 * every other lifecycle check and `forge upgrade`'s own degraded-adapter path defer to — reads more
 * naturally beside `status`/`validate --all` than beside `config`/`cost`).
 *
 * `runDoctorCommand`'s own `DoctorRuleContext.testCommands` narrowing (`legacyStringTestCommands`,
 * `specs/22` M17 P3) lives here, unchanged from the real current `bin.ts`.
 *
 * @see specs/22 M17 P2
 * @see specs/22 M17 P3
 */
import { EXIT_CODES, ForgeError } from '@forge/core/errors';
import type { ProjectPaths } from '@forge/core/fs';
import { legacyStringTestCommands } from '@forge/schemas/config';

import { agentValidateAll } from '../agent.ts';
import { readConfig } from '../config.ts';
import { runDoctor } from '../doctor/index.ts';
import { runDoctorRuleCommand } from '../doctor/rule-command.ts';
import { runStatus, runStatusJson } from '../run/status.ts';
import { gateValidateAll, workflowValidateAll } from '../workflow.ts';
import { templateValidateAll } from '../template.ts';
import {
  AGENTS_ROOT,
  buildAdapterForDiagnostics,
  CHECKS_ROOT,
  parseCommandFlags,
  realEnvSnapshot,
  realProcessVersion,
  WORKFLOWS_ROOT,
  type DispatchContext,
} from './shared.ts';

async function runAgentValidate(paths: ProjectPaths, json: boolean): Promise<number> {
  const findings = await agentValidateAll({ paths, agentsRoot: AGENTS_ROOT });
  if (json) {
    console.log(JSON.stringify({ v: 1, findings }));
  } else if (findings.length === 0) {
    console.log('forge agent validate --all: no real findings.');
  } else {
    for (const finding of findings) {
      console.error(`${finding.severity} ${finding.agentId} ${finding.code}: ${finding.message}`);
    }
  }
  return findings.some((finding) => finding.severity === 'error') ? 1 : 0;
}

async function runWorkflowValidate(paths: ProjectPaths, json: boolean): Promise<number> {
  const results = await workflowValidateAll({
    paths,
    workflowsRoot: WORKFLOWS_ROOT,
    agentsRoot: AGENTS_ROOT,
    checksRoot: CHECKS_ROOT,
  });
  // `specs/22` M13: a gate's advisory `brief:` is validated by this same command, in its own
  // `gates` result field (workflow ids and gate ids are different namespaces).
  const gateResults = await gateValidateAll({
    paths,
    checksRoot: CHECKS_ROOT,
    agentsRoot: AGENTS_ROOT,
  });
  const allIssues = [...results.values()].flat();
  const allGateIssues = [...gateResults.values()].flat();
  if (json) {
    console.log(
      JSON.stringify({
        v: 1,
        results: Object.fromEntries(results),
        gates: Object.fromEntries(gateResults),
      }),
    );
  } else if (allIssues.length === 0 && allGateIssues.length === 0) {
    console.log('forge workflow validate --all: no real issues.');
  } else {
    for (const [id, issues] of results) {
      for (const issue of issues) console.error(`${id}: ${issue.code} ${issue.message}`);
    }
    for (const [id, issues] of gateResults) {
      for (const issue of issues) console.error(`gate ${id}: ${issue.code} ${issue.message}`);
    }
  }
  return allIssues.length + allGateIssues.length > 0 ? 1 : 0;
}

async function runTemplateValidate(json: boolean): Promise<number> {
  const results = await templateValidateAll();
  const invalid = results.filter((result) => !result.valid);
  if (json) {
    console.log(JSON.stringify({ v: 1, results }));
  } else if (invalid.length === 0) {
    console.log('forge template validate --all: no real errors.');
  } else {
    for (const result of invalid) console.error(`${result.type}: ${result.errors.join('; ')}`);
  }
  return invalid.length > 0 ? 1 : 0;
}

async function runStatusCommand(
  paths: ProjectPaths,
  projectRoot: string,
  json: boolean,
): Promise<number> {
  if (json) {
    const report = await runStatusJson(paths, projectRoot, undefined);
    console.log(JSON.stringify(report));
  } else {
    const status = await runStatus(paths, projectRoot, undefined);
    console.log(JSON.stringify(status, null, 2));
  }
  return 0;
}

const DOCTOR_FLAGS = { '--fix': false, '--rebuild-index': false, '--rule': true } as const;

/** `forge doctor [--fix] [--rebuild-index] [--json]` (`03` §3.7). Exit `5`
 * (`EXIT_CODES.prerequisiteMissing`) iff any hard check still fails after the real checks (and, with
 * `--fix`, the real fix pass) run — `03` §3.7's own literal "exit code 5 if any hard prerequisite
 * fails, 0 with warnings otherwise" contract, read directly off `DoctorReport.ok`. */
async function runDoctorCommand(
  paths: ProjectPaths,
  projectRoot: string,
  args: readonly string[],
  json: boolean,
): Promise<number> {
  const { flags, values, positionals } = parseCommandFlags(args, DOCTOR_FLAGS);
  if (positionals.length > 0) {
    throw new ForgeError('USR-002', { flag: '[extra positional]', value: positionals[0] ?? '' });
  }
  const doctorRule = values.get('--rule');
  if (doctorRule !== undefined) {
    if (
      flags.has('--fix') ||
      flags.has('--rebuild-index') ||
      args.filter((a) => a === '--rule').length > 1
    ) {
      throw new ForgeError('USR-002', {
        flag: '--rule',
        value: `${doctorRule} (cannot be repeated, or combined with --fix or --rebuild-index)`,
      });
    }
    // Read inside the rule command, so an unreadable config is a failing verdict and not an escaping refusal.
    return runDoctorRuleCommand(
      async () => {
        const config = await readConfig(paths);
        return {
          paths,
          projectRoot,
          kbRoot: config.paths.kb,
          reportsRoot: config.paths.reports,
          env: realEnvSnapshot(),
          // `DoctorRuleContext.testCommands` is not yet taught the structured form (post-v1.0,
          // `specs/22` M17 P3) -- a no-op narrowing for every existing, string-only project.
          testCommands: legacyStringTestCommands(config.execution.testCommands),
        };
      },
      doctorRule,
      json,
      console,
    );
  }
  const config = await readConfig(paths);
  const env = realEnvSnapshot();
  const adapter = await buildAdapterForDiagnostics(config, env);
  const report = await runDoctor({
    paths,
    projectRoot,
    config,
    ...(adapter !== undefined ? { adapter } : {}),
    env,
    processVersion: realProcessVersion(),
    fix: flags.has('--fix'),
    rebuildIndex: flags.has('--rebuild-index'),
  });
  if (json) {
    console.log(JSON.stringify(report));
  } else {
    for (const check of report.checks) {
      console.log(`${check.ok ? 'ok' : check.severity} ${check.id}: ${check.message}`);
    }
    for (const fix of report.fixes ?? []) {
      console.log(`fix ${fix.applied ? 'applied' : 'not applied'} ${fix.id}: ${fix.message}`);
    }
  }
  return report.ok ? EXIT_CODES.success : EXIT_CODES.prerequisiteMissing;
}

/**
 * Dispatches `forge agent|workflow|template validate --all`, `forge status`, `forge doctor`.
 * `undefined` for every other command.
 *
 * @see specs/22 M17 P2
 */
export async function dispatchLifecycle(ctx: DispatchContext): Promise<number | undefined> {
  const [command, sub, ...rest] = ctx.positionals;
  const afterCommand = ctx.positionals.slice(1);
  const { paths, projectRoot, flags } = ctx;

  // A critic round caught the original version falling through to the generic "not wired" message
  // for e.g. `agent validate` with no real `--all` -- wrong: this command *is* wired, the real
  // problem is a missing required flag, and the generic message pointed a caller at dozens of
  // genuinely-unimplemented commands instead of naming the one real thing they actually got wrong.
  const isValidateAll = (name: string): boolean => command === name && sub === 'validate';
  const requireAllFlag = (): boolean => {
    if (rest.includes('--all')) return true;
    console.error(
      `forge: "${String(command)} ${String(sub)}" is real, but needs --all (only the real "--all" form is wired ` +
        'here yet; a real single-id form does not exist).',
    );
    return false;
  };

  if (isValidateAll('agent')) {
    return requireAllFlag() ? runAgentValidate(paths, flags.json) : 2;
  }
  if (isValidateAll('workflow')) {
    return requireAllFlag() ? runWorkflowValidate(paths, flags.json) : 2;
  }
  if (isValidateAll('template')) {
    return requireAllFlag() ? runTemplateValidate(flags.json) : 2;
  }
  if (command === 'status') {
    return runStatusCommand(paths, projectRoot, flags.json);
  }
  if (command === 'doctor') {
    return runDoctorCommand(paths, projectRoot, afterCommand, flags.json);
  }
  return undefined;
}
