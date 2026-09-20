/**
 * Every `forge spec validate --rule <name>` a shipped gate names must be a rule the CLI accepts
 * (`PLAN-M13.md` P24, Q214).
 *
 * `10` §10.3 rule 1: a gate with a failing deterministic check can only be waived. A check that names a
 * command the CLI rejects therefore forces a waiver on every project, so the set of rule names is derived
 * here from the real gate YAML files, not from a hand-kept list, and each name is run through the real
 * CLI in a temp project.
 *
 * **Scope, exactly.** This covers the `spec validate` command family only. Deterministic checks in other
 * families (`doctor --rule`, `kb lint --rule`, `test ...`, `diagram ...`, `deploy ...`, `spec interfaces
 * --check-frozen`) are still rejected by the CLI, and `G-Design`, `G-Foundation`, `G-Deliver`, `G-Verify`
 * and `G-Integration` still hold such checks; `PLAN-M13.md` P25 and P26 own them. The test below fails on
 * any `spec validate` run string in a form it does not understand, so a gate cannot use a new spelling
 * (`--rule=x`, `--json --rule x`) and slip past the derivation.
 *
 * P11 counted ten `--rule` names on `spec validate` that the CLI rejected before P24: the six implemented
 * by P24 (`metrics-defined`, `user-identified`, `scope-contradicts-constraints`, `capability-acceptance`,
 * `nfr-numeric`, `blocking-open-questions`) and the four `G-Integration`/`G-Operate` ones `PLAN-M13.md` P26
 * owns. Those four are pinned below so this test states, rather than hides, what is still missing.
 *
 * @see specs/10 §10.3
 * @see PLAN-M13.md P24, P26
 */
import { execFile } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { afterEach, describe, expect, it } from 'vitest';
import * as YAML from 'yaml';

import { VALIDATE_RULE_IDS } from '../../../src/commands/spec/validate-rules.ts';

const run = promisify(execFile);
const LAUNCHER = fileURLToPath(new URL('../../../bin/forge.mjs', import.meta.url));
const CHECKS_DIR = fileURLToPath(
  new URL('../../../../templates/templates/checks/', import.meta.url),
);

/** Names a gate uses that the CLI still rejects, and which piece will implement each. When a piece
 * implements one, this test fails until the name is removed here: a pin that outlives its reason is as
 * misleading as a missing rule. */
const PINNED_UNIMPLEMENTED: Readonly<Record<string, string>> = {
  'version-skew': 'PLAN-M13.md P26 (G-Integration)',
  'migration-order-violations': 'PLAN-M13.md P26 (G-Integration)',
  'slo-observability-coverage': 'PLAN-M13.md P26 (G-Operate)',
  'runbook-coverage': 'PLAN-M13.md P26 (G-Operate)',
};

interface GateCheck {
  readonly gate: string;
  readonly id: string;
  readonly run: string;
}

async function deterministicChecks(): Promise<readonly GateCheck[]> {
  const files = (await readdir(CHECKS_DIR)).filter((name) => name.endsWith('.gate.yaml')).sort();
  const checks: GateCheck[] = [];
  for (const file of files) {
    const gate = YAML.parse(await readFile(path.join(CHECKS_DIR, file), 'utf8')) as {
      readonly id: string;
      readonly checks: { readonly deterministic?: readonly { id: string; run: string }[] };
    };
    for (const check of gate.checks.deterministic ?? []) {
      checks.push({ gate: gate.id, id: check.id, run: check.run });
    }
  }
  return checks;
}

const RULE_FORM = /^forge spec validate --rule (\S+) --json$/;
const BARE_FORM = 'forge spec validate --json';

async function gateRuleNames(): Promise<readonly string[]> {
  const names = new Set<string>();
  for (const check of await deterministicChecks()) {
    const match = RULE_FORM.exec(check.run);
    if (match?.[1] !== undefined) names.add(match[1]);
  }
  return [...names].sort();
}

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function forge(args: readonly string[], cwd: string) {
  try {
    const { stdout, stderr } = await run(process.execPath, [LAUNCHER, ...args], {
      cwd,
      timeout: 60_000,
    });
    return { status: 0, stdout, stderr };
  } catch (error) {
    const e = error as { code?: number; stdout?: string; stderr?: string };
    return { status: e.code ?? 1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
  }
}

/** Four subprocesses at a time: sixteen concurrent Node spawns made this test flaky under a loaded machine. */
async function inBatches<T, R>(items: readonly T[], work: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let at = 0; at < items.length; at += 4) {
    out.push(...(await Promise.all(items.slice(at, at + 4).map(work))));
  }
  return out;
}

describe('gate rule names', () => {
  it('finds the rule names the shipped gates use (the derivation is not vacuous)', async () => {
    const names = await gateRuleNames();
    for (const known of [
      'definition-of-ready',
      'metrics-defined',
      'nfr-numeric',
      'runbook-coverage',
    ]) {
      expect(names).toContain(known);
    }
    expect(names.length).toBeGreaterThanOrEqual(16);
  });

  it('every spec validate --rule name a gate uses is implemented, or pinned below with its owner', async () => {
    const unimplemented = (await gateRuleNames()).filter(
      (name) => !(VALIDATE_RULE_IDS as readonly string[]).includes(name),
    );
    expect(unimplemented.sort()).toEqual(Object.keys(PINNED_UNIMPLEMENTED).sort());
  });

  it('no pinned name is implemented already, and every pinned name is still used by a gate', async () => {
    const used = await gateRuleNames();
    for (const name of Object.keys(PINNED_UNIMPLEMENTED)) {
      expect(
        VALIDATE_RULE_IDS as readonly string[],
        `${name} is implemented: unpin it`,
      ).not.toContain(name);
      expect(used, `${name} is no longer used by any gate: drop the pin`).toContain(name);
    }
  });

  it('every `forge spec validate` run string in a gate is the bare form or the one --rule form understood here', async () => {
    const unrecognised = (await deterministicChecks())
      .filter((check) => check.run.startsWith('forge spec validate'))
      .filter((check) => check.run !== BARE_FORM && !RULE_FORM.test(check.run))
      .map((check) => `${check.gate} ${check.id}: ${check.run}`);
    expect(unrecognised).toEqual([]);
  });
});

describe('the real CLI accepts exactly the gate rule names it implements', () => {
  it('runs each gate command line against an empty project and gets a v1 envelope, or the pinned rejection', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'forge-gate-rules-'));
    dirs.push(dir);
    const names = await gateRuleNames();
    const results = await inBatches(names, (name) =>
      forge(['-C', dir, 'spec', 'validate', '--rule', name, '--json'], dir).then((outcome) => ({
        name,
        ...outcome,
      })),
    );
    for (const outcome of results) {
      if (outcome.name in PINNED_UNIMPLEMENTED) {
        expect(outcome.status, outcome.name).toBe(2);
        expect(outcome.stderr).toContain('needs a real --rule');
        continue;
      }
      expect([0, 1], `${outcome.name}: ${outcome.stderr}`).toContain(outcome.status);
      const envelope = JSON.parse(outcome.stdout) as {
        v: number;
        errors: number;
        violations: unknown[];
      };
      expect(envelope.v).toBe(1);
      expect(envelope.errors).toBe(envelope.violations.length);
      expect(outcome.status).toBe(envelope.errors > 0 ? 1 : 0);
    }
  }, 240_000);

  it('the six P24 rules fail an empty project or pass it as their gate condition says', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'forge-gate-rules-'));
    dirs.push(dir);
    const expected: Readonly<Record<string, number>> = {
      'metrics-defined': 1,
      'user-identified': 1,
      'scope-contradicts-constraints': 1,
      'capability-acceptance': 1,
      'nfr-numeric': 1,
      'blocking-open-questions': 0,
    };
    const outcomes = await inBatches(Object.keys(expected), (name) =>
      forge(['-C', dir, 'spec', 'validate', '--rule', name, '--json'], dir).then((outcome) => ({
        name,
        ...outcome,
      })),
    );
    for (const [name, status] of Object.entries(expected)) {
      const outcome = outcomes.find((candidate) => candidate.name === name);
      expect(outcome?.status, name).toBe(status);
    }
  }, 240_000);
});
