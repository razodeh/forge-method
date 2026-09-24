/**
 * `@forge/templates`'s 10 built-in gates (`10` §10.3), per `PLAN-M6.md` T2's own Checks section.
 *
 * Lives at the repository root, not inside `packages/templates/test/` or `packages/engine/test/`, for
 * the identical cross-package-check reason `test/workflows.test.ts` and `test/templates.test.ts`
 * already document: this is the one check that needs both `@forge/engine/gates` (the already-built
 * generic evaluator, M5 P14) and `@forge/templates` (`GATE_INDEX`), and `02` §2.2 gives `@forge/templates`
 * zero `@forge/*` dependencies while `@forge/engine` has no edge to `@forge/templates` either.
 *
 * `@forge/engine/gates` has no YAML loader of its own (`GateDefinition`'s own doc comment: it models
 * only the fields `evaluateGate`/`applyWaiver`/`buildGateReport` actually read, not a full parser for
 * the richer worked-example YAML) -- this file parses each `.gate.yaml` with the raw `yaml` package
 * (the same "no dedicated loader exists yet, parse directly" approach `test/templates.test.ts` already
 * established for artifact stubs) and narrows the parsed object down to a `GateDefinition` itself.
 *
 * @see specs/10 §10.3
 * @see PLAN-M6.md T2
 * @see SPEC-QUESTIONS.md Q91
 */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { describe, expect, it } from 'vitest';

import { evaluateGate, validateCheckDocument } from '@forge/engine/gates';
import type { CheckRunner, GateDefinition } from '@forge/engine/gates';
import { GATE_INDEX, type GateId } from '@forge/templates';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const templatesPackageRoot = path.join(repoRoot, 'packages', 'templates');

interface RawGateFile {
  readonly id: string;
  readonly name: string;
  readonly phase: string;
  readonly autonomyOverride: string | null;
  readonly checks: {
    readonly deterministic: readonly {
      readonly id: string;
      readonly run: string;
      readonly parser?: string;
      readonly failOn: string;
    }[];
    readonly advisory: readonly {
      readonly id: string;
      readonly agent: string;
      readonly brief: string;
    }[];
  };
  readonly openQuestionsPolicy: 'block' | 'warn';
  readonly approval: {
    readonly required: boolean;
    readonly roles: readonly string[];
    readonly quorum: number;
  };
  readonly evidence: readonly { readonly artifact: string }[];
  readonly onReject: { readonly action: string; readonly target: string };
}

function readGateFile(id: GateId): RawGateFile {
  return parseYaml(
    readFileSync(path.join(templatesPackageRoot, GATE_INDEX[id]), 'utf8'),
  ) as RawGateFile;
}

/** Projects a `RawGateFile` down to exactly the fields `evaluateGate` reads -- `GateDefinition`'s own
 * doc comment names this projection as the expected caller responsibility. */
function toGateDefinition(raw: RawGateFile): GateDefinition {
  return { id: raw.id, checks: raw.checks, openQuestionsPolicy: raw.openQuestionsPolicy };
}

const ALL_GATE_IDS = Object.keys(GATE_INDEX) as GateId[];

describe('the 10 built-in gates (10 §10.3) all parse and are structurally well-formed', () => {
  it.each(ALL_GATE_IDS)(
    '%s parses as YAML with a matching id and at least one deterministic check',
    (id) => {
      const raw = readGateFile(id);
      expect(raw.id).toBe(id);
      expect(raw.checks.deterministic.length).toBeGreaterThan(0);
    },
  );

  it("GATE_INDEX names exactly the 10 ids 10 §10.3's own catalogue table lists, no more and no fewer", () => {
    expect(ALL_GATE_IDS.sort()).toEqual(
      [
        'G-Problem',
        'G-Product',
        'G-Design',
        'G-Foundation',
        'G-Ready',
        'G-Verify',
        'G-Stable',
        'G-Integration',
        'G-Deliver',
        'G-Operate',
      ].sort(),
    );
  });

  it('every deterministic check names a real "forge <sub>" command -- the expected CLI surface for @forge/cli (this milestone) to satisfy', () => {
    for (const id of ALL_GATE_IDS) {
      const raw = readGateFile(id);
      for (const check of raw.checks.deterministic) {
        expect(check.run).toMatch(/^forge \S+/);
        expect(check.run).toContain('--json');
      }
    }
  });

  it("G-Design matches 10 §10.3's own literal worked example exactly", () => {
    const worked = `
id: G-Design
name: Design gate
phase: P3
autonomyOverride: null          # or 'alwaysHuman'
checks:
  deterministic:
    - id: spec:validate
      run: "forge spec validate --json"
      parser: forge-json
      failOn: "errors > 0"
    - id: kb:lint
      run: "forge kb lint --json"
      failOn: "errors > 0"
    - id: adr:coverage
      run: "forge kb lint --rule adr-coverage --json"
      failOn: "errors > 0"
    - id: interfaces:frozen
      run: "forge spec interfaces --check-frozen --json"
      failOn: "undefined_refs > 0"
    - id: nfr:numeric
      run: "forge spec validate --rule nfr-numeric --json"
      failOn: "errors > 0"
    - id: diagram:validate
      run: "forge diagram validate --gate G-Design --json"
      failOn: "errors > 0"     # syntax, required coverage, ADR diagram coverage, node refs, captions
    - id: diagram:drift
      run: "forge diagram generate --all --check --json"
      failOn: "drifted > 0"
  advisory:
    - id: architect-review
      agent: critic
      brief: briefs/critique-architecture.md
      # advisory results NEVER fail the gate; they populate open questions
openQuestionsPolicy: block      # block | warn -- blocking OQs must be resolved
approval:
  required: true                # at 'guided' and 'supervised'
  roles: [ human ]               # who may approve
  quorum: 1
evidence:
  - artifact: ArchitectureSpec
  - artifact: ADR(*)
  - artifact: DataModel
  - artifact: ThreatModel
onReject:
  action: replan
  target: P3
`;
    expect(readGateFile('G-Design')).toEqual(parseYaml(worked));
  });

  it("G-Deliver defaults to alwaysHuman -- 10 §10.3's own gate rule 5", () => {
    expect(readGateFile('G-Deliver').autonomyOverride).toBe('alwaysHuman');
  });

  it('no other gate hardcodes alwaysHuman -- rule 5 names G-Deliver specifically, not a blanket default', () => {
    for (const id of ALL_GATE_IDS) {
      if (id === 'G-Deliver') continue;
      expect(readGateFile(id).autonomyOverride).toBeNull();
    }
  });
});

/** A well-formed output for every field any shipped `failOn` reads, at its passing value. `evaluateGate` fails
 * closed (M13 P35): an empty `{}` is no longer a stand-in for "passed", because a check that cannot show the field
 * it reads has not passed. */
const PASSING_OUTPUT = JSON.stringify({
  v: 1,
  errors: 0,
  failed: 0,
  flaky: 0,
  quarantined: 0,
  drifted: 0,
  undefined_refs: 0,
  regressions: 0,
  coverage: 100,
});
/** The same fields, every one at a value that trips its `failOn`. */
const FAILING_OUTPUT = JSON.stringify({
  v: 1,
  errors: 1,
  failed: 1,
  flaky: 1,
  quarantined: 99,
  drifted: 1,
  undefined_refs: 1,
  regressions: 1,
  coverage: 0,
});

describe('every gate round-trips through the real evaluateGate (M5 P14)', () => {
  it.each(ALL_GATE_IDS)(
    '%s: evaluateGate reports passed=true when every check is scripted to pass',
    async (id) => {
      const definition = toGateDefinition(readGateFile(id));
      const runner: CheckRunner = () => Promise.resolve({ stdout: PASSING_OUTPUT, exitCode: 0 });
      const result = await evaluateGate(definition, '/fixture', runner);
      expect(result.passed).toBe(true);
      expect(result.checks).toHaveLength(definition.checks.deterministic.length);
    },
  );

  it.each(ALL_GATE_IDS)(
    '%s: evaluateGate reports passed=false when the first check is scripted to fail',
    async (id) => {
      const definition = toGateDefinition(readGateFile(id));
      const firstCheckId = definition.checks.deterministic[0]?.id;
      const runner: CheckRunner = (check) =>
        Promise.resolve(
          check.id === firstCheckId
            ? { stdout: FAILING_OUTPUT, exitCode: 1 }
            : { stdout: PASSING_OUTPUT, exitCode: 0 },
        );
      const result = await evaluateGate(definition, '/fixture', runner);
      expect(result.passed).toBe(false);
      expect(result.checks.find((c) => c.checkId === firstCheckId)?.passed).toBe(false);
      // ...because its failOn fired on well-formed data, not because the output was refused or incomplete.
      expect(result.checks.find((c) => c.checkId === firstCheckId)?.reason).toBeUndefined();
    },
  );
});

/**
 * The seven shipped `modules/*\/checks/*.check.yaml` files (`PLAN-M14.md` P22): each must carry a real
 * `appliesTo.gates` (naming a real, shipped gate id -- one of `ALL_GATE_IDS` above) and a `severity`, so
 * `loadGateRegistry` (`PLAN-M14.md` P20, `@forge/cli/commands/run/gates.ts`) can actually attach it to a
 * real gate rather than refusing the whole registry (`GATE-506`) the moment a project installs the
 * module (the disclosed gap `PLAN-M14.md` P20's own Discloses note names, closed here).
 */
describe('the seven shipped module check files (PLAN-M14.md P22)', () => {
  const modulesRoot = path.join(repoRoot, 'modules');

  interface ShippedCheckFile {
    readonly module: string;
    readonly relPath: string;
    readonly raw: unknown;
  }

  function shippedCheckFiles(): readonly ShippedCheckFile[] {
    const files: ShippedCheckFile[] = [];
    for (const module of readdirSync(modulesRoot).sort()) {
      const checksDir = path.join(modulesRoot, module, 'checks');
      let names: readonly string[];
      try {
        names = readdirSync(checksDir).filter((name) => name.endsWith('.check.yaml')).sort();
      } catch {
        continue;
      }
      for (const name of names) {
        const relPath = path.join('modules', module, 'checks', name);
        files.push({
          module,
          relPath,
          raw: parseYaml(readFileSync(path.join(checksDir, name), 'utf8')),
        });
      }
    }
    return files;
  }

  it('there are exactly seven, none of them lost or double-counted by this scan', () => {
    expect(shippedCheckFiles()).toHaveLength(7);
  });

  it.each(shippedCheckFiles().map((file): [string, ShippedCheckFile] => [file.relPath, file]))(
    '%s parses strictly (validateCheckDocument) with a real appliesTo.gates and a severity',
    (_label, file) => {
      const result = validateCheckDocument(file.raw);
      expect(result.problems, file.relPath).toEqual([]);
      const document = result.document;
      if (document === undefined) throw new Error(`${file.relPath} did not parse`);
      expect(document.appliesTo.gates.length, file.relPath).toBeGreaterThan(0);
      for (const gateId of document.appliesTo.gates) {
        expect(ALL_GATE_IDS, `${file.relPath} names a real shipped gate`).toContain(gateId);
      }
      expect(['error', 'warn'], file.relPath).toContain(document.severity);
    },
  );

  it('the seven ids/gates/severities match this piece\'s own content proposal exactly', () => {
    const byId = new Map(
      shippedCheckFiles().map((file) => {
        const { document } = validateCheckDocument(file.raw);
        if (document === undefined) throw new Error(`${file.relPath} did not parse`);
        return [document.id, { gates: [...document.appliesTo.gates].sort(), severity: document.severity }];
      }),
    );
    expect(Object.fromEntries(byId)).toEqual({
      'contract:verify': { gates: ['G-Integration'], severity: 'error' },
      'api:breaking-change': { gates: ['G-Integration'], severity: 'error' },
      'a11y:audit': { gates: ['G-Verify'], severity: 'error' },
      'bundle:size': { gates: ['G-Verify'], severity: 'error' },
      'lineage:coverage': { gates: ['G-Verify'], severity: 'error' },
      'data-quality:tests': { gates: ['G-Verify'], severity: 'error' },
      'device-matrix:coverage': { gates: ['G-Verify'], severity: 'error' },
    });
  });
});
