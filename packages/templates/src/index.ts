/**
 * `@forge/templates` — a static, hand-editable stub file for every `18` §18.7 registry artifact
 * type, per `PLAN-M1.md` P11.
 *
 * This package cannot import `@forge/schemas` (`02` §2.2: `templates: []`, zero `@forge/*`
 * dependencies), so `TemplateArtifactTypeId` is its own, independently declared 22-member union
 * rather than `@forge/schemas`'s `ArtifactTypeId` — the two are kept in sync by a test at the
 * repository root (`test/templates.test.ts`), the one place allowed to depend on both packages.
 * See `SPEC-QUESTIONS.md` Q28.
 *
 * @see specs/18 §18.7
 * @see PLAN-M1.md P11
 * @see SPEC-QUESTIONS.md Q28
 */

import { BUILD_BRIEFS } from './content/briefs-build.ts';
import { OPS_AND_GATE_BRIEFS } from './content/briefs-ops-gates.ts';
import { PLANNING_BRIEFS } from './content/briefs-planning.ts';
import { PROMPTS_A } from './content/prompts-a.ts';
import { PROMPTS_B } from './content/prompts-b.ts';

/** The 22 artifact type names `specs/18` §18.7 registers (21 original + `ReviewReport`, added
 * post-v1.0), transcribed independently — see above. */
export type TemplateArtifactTypeId =
  | 'Vision'
  | 'Capability'
  | 'NFR'
  | 'Epic'
  | 'Story'
  | 'Task'
  | 'ADR'
  | 'InterfaceContract'
  | 'DataModel'
  | 'Diagram'
  | 'Risk'
  | 'Assumption'
  | 'OpenQuestion'
  | 'Waiver'
  | 'SessionRecord'
  | 'RCA'
  | 'Defect'
  | 'Environment'
  | 'Runbook'
  | 'GateReport'
  | 'HandoffRecord'
  | 'ReviewReport';

/**
 * Resolves a type to its template file, as a path relative to this package's own root
 * (`packages/templates/`) — a caller resolves it against wherever `@forge/templates` is actually
 * installed, since this package does not know its own filesystem location at the point this module
 * evaluates.
 */
/** `10` §10.5's own 20-row "Built-in workflows" table, transcribed independently for the identical
 * "this package has no `@forge/engine` edge" reason `TemplateArtifactTypeId` above already documents —
 * `specs/22` M6's own Build line says "the ten lifecycle workflows," but `10` §10.5's own table names
 * twenty (`PLAN-M6.md` T1, `SPEC-QUESTIONS.md` Q88: shipping all twenty is the correct reading, "ten
 * lifecycle workflows" is `22`'s own loose paraphrase of the ten `10` §10.2 phases, not a literal
 * subset instruction). */
export type WorkflowId =
  | 'intake'
  | 'discover'
  | 'define-product'
  | 'shape-solution'
  | 'initialize-project'
  | 'plan-stages'
  | 'plan-stage'
  | 'build-stage'
  | 'implement-story'
  | 'quick-fix'
  | 'verify-stage'
  | 'debug'
  | 'harden'
  | 'refactor'
  | 'deliver-stage'
  | 'operate'
  | 'adopt'
  | 'migrate'
  | 'retro'
  | 'replan';

/** Resolves a workflow id to its `.workflow.yaml` file, as a path relative to this package's own root
 * — the identical "caller resolves against wherever `@forge/templates` is actually installed" contract
 * `TEMPLATE_INDEX` below already documents. */
export const WORKFLOW_INDEX: Readonly<Record<WorkflowId, string>> = {
  intake: 'templates/workflows/intake.workflow.yaml',
  discover: 'templates/workflows/discover.workflow.yaml',
  'define-product': 'templates/workflows/define-product.workflow.yaml',
  'shape-solution': 'templates/workflows/shape-solution.workflow.yaml',
  'initialize-project': 'templates/workflows/initialize-project.workflow.yaml',
  'plan-stages': 'templates/workflows/plan-stages.workflow.yaml',
  'plan-stage': 'templates/workflows/plan-stage.workflow.yaml',
  'build-stage': 'templates/workflows/build-stage.workflow.yaml',
  'implement-story': 'templates/workflows/implement-story.workflow.yaml',
  'quick-fix': 'templates/workflows/quick-fix.workflow.yaml',
  'verify-stage': 'templates/workflows/verify-stage.workflow.yaml',
  debug: 'templates/workflows/debug.workflow.yaml',
  harden: 'templates/workflows/harden.workflow.yaml',
  refactor: 'templates/workflows/refactor.workflow.yaml',
  'deliver-stage': 'templates/workflows/deliver-stage.workflow.yaml',
  operate: 'templates/workflows/operate.workflow.yaml',
  adopt: 'templates/workflows/adopt.workflow.yaml',
  migrate: 'templates/workflows/migrate.workflow.yaml',
  retro: 'templates/workflows/retro.workflow.yaml',
  replan: 'templates/workflows/replan.workflow.yaml',
};

/** `11` §11.1-§11.2's own fourteen initialization/architecture frameworks (`repo-strategy` from `11`
 * §11.0's own worked example, plus thirteen more: `PLAN-M6.md` T3), plus `12`-`14`'s own twenty-nine
 * data/technology/testing/debugging/delivery/operations frameworks (`PLAN-M6.md` T4) — forty-three in
 * total, transcribed independently for the identical "this package has no `@forge/methods` edge"
 * reason `WorkflowId`/`WORKFLOW_INDEX` above already document (`02` §2.2's own boundary graph:
 * `templates: []`, zero `@forge/*` dependencies). */
export type FrameworkId =
  // T3 — 11 §11.1-§11.2 (F-INIT-1..7, F-ARCH-1..7)
  | 'repo-strategy'
  | 'directory-layout'
  | 'build-toolchain'
  | 'vcs-conventions'
  | 'dev-environment'
  | 'coding-standards'
  | 'scaffold-generation'
  | 'architecture-style'
  | 'decomposition-boundaries'
  | 'communication-integration-patterns'
  | 'pattern-selection'
  | 'nfr-strategy'
  | 'threat-modelling'
  | 'buy-build-borrow'
  // T4 — 12 §12.1 (F-DATA-1..8)
  | 'conceptual-logical-modelling'
  | 'access-pattern-analysis'
  | 'storage-selection'
  | 'consistency-transaction-design'
  | 'caching-strategy'
  | 'schema-evolution-migrations'
  | 'data-lifecycle-privacy-retention'
  | 'analytical-pipeline-design'
  // T4 — 12 §12.3 (F-TECH-1)
  | 'stack-selection'
  // T4 — 13 §13.1 (F-TEST-1..7)
  | 'test-pyramid-shape'
  | 'test-oracle-design'
  | 'test-data-strategy'
  | 'test-environment-dependency-strategy'
  | 'coverage-adequacy'
  | 'flake-control'
  | 'agent-executable-tests'
  // T4 — 13 §13.2 (F-DEBUG-1..3)
  | 'rca-loop'
  | 'rca-loop-bounds-escalation'
  | 'debugging-observability-precondition'
  // T4 — 13 §13.3 (F-REVIEW-1..2)
  | 'review-perspectives'
  | 'review-boundaries'
  // T4 — 14 (F-DELIVER-1..5, F-OPS-1..3)
  | 'environment-strategy'
  | 'build-artifact-strategy'
  | 'cicd-pipeline-design'
  | 'deployment-strategy'
  | 'observability-design'
  | 'release-management'
  | 'operational-readiness'
  | 'cost-model';

/** Resolves a framework id to its `.framework.yaml` file, as a path relative to this package's own
 * root — the identical "caller resolves against wherever `@forge/templates` is actually installed"
 * contract `WORKFLOW_INDEX`/`GATE_INDEX`/`TEMPLATE_INDEX` already document. */
export const FRAMEWORK_INDEX: Readonly<Record<FrameworkId, string>> = {
  'repo-strategy': 'templates/frameworks/repo-strategy.framework.yaml',
  'directory-layout': 'templates/frameworks/directory-layout.framework.yaml',
  'build-toolchain': 'templates/frameworks/build-toolchain.framework.yaml',
  'vcs-conventions': 'templates/frameworks/vcs-conventions.framework.yaml',
  'dev-environment': 'templates/frameworks/dev-environment.framework.yaml',
  'coding-standards': 'templates/frameworks/coding-standards.framework.yaml',
  'scaffold-generation': 'templates/frameworks/scaffold-generation.framework.yaml',
  'architecture-style': 'templates/frameworks/architecture-style.framework.yaml',
  'decomposition-boundaries': 'templates/frameworks/decomposition-boundaries.framework.yaml',
  'communication-integration-patterns':
    'templates/frameworks/communication-integration-patterns.framework.yaml',
  'pattern-selection': 'templates/frameworks/pattern-selection.framework.yaml',
  'nfr-strategy': 'templates/frameworks/nfr-strategy.framework.yaml',
  'threat-modelling': 'templates/frameworks/threat-modelling.framework.yaml',
  'buy-build-borrow': 'templates/frameworks/buy-build-borrow.framework.yaml',
  'conceptual-logical-modelling':
    'templates/frameworks/conceptual-logical-modelling.framework.yaml',
  'access-pattern-analysis': 'templates/frameworks/access-pattern-analysis.framework.yaml',
  'storage-selection': 'templates/frameworks/storage-selection.framework.yaml',
  'consistency-transaction-design':
    'templates/frameworks/consistency-transaction-design.framework.yaml',
  'caching-strategy': 'templates/frameworks/caching-strategy.framework.yaml',
  'schema-evolution-migrations': 'templates/frameworks/schema-evolution-migrations.framework.yaml',
  'data-lifecycle-privacy-retention':
    'templates/frameworks/data-lifecycle-privacy-retention.framework.yaml',
  'analytical-pipeline-design': 'templates/frameworks/analytical-pipeline-design.framework.yaml',
  'stack-selection': 'templates/frameworks/stack-selection.framework.yaml',
  'test-pyramid-shape': 'templates/frameworks/test-pyramid-shape.framework.yaml',
  'test-oracle-design': 'templates/frameworks/test-oracle-design.framework.yaml',
  'test-data-strategy': 'templates/frameworks/test-data-strategy.framework.yaml',
  'test-environment-dependency-strategy':
    'templates/frameworks/test-environment-dependency-strategy.framework.yaml',
  'coverage-adequacy': 'templates/frameworks/coverage-adequacy.framework.yaml',
  'flake-control': 'templates/frameworks/flake-control.framework.yaml',
  'agent-executable-tests': 'templates/frameworks/agent-executable-tests.framework.yaml',
  'rca-loop': 'templates/frameworks/rca-loop.framework.yaml',
  'rca-loop-bounds-escalation': 'templates/frameworks/rca-loop-bounds-escalation.framework.yaml',
  'debugging-observability-precondition':
    'templates/frameworks/debugging-observability-precondition.framework.yaml',
  'review-perspectives': 'templates/frameworks/review-perspectives.framework.yaml',
  'review-boundaries': 'templates/frameworks/review-boundaries.framework.yaml',
  'environment-strategy': 'templates/frameworks/environment-strategy.framework.yaml',
  'build-artifact-strategy': 'templates/frameworks/build-artifact-strategy.framework.yaml',
  'cicd-pipeline-design': 'templates/frameworks/cicd-pipeline-design.framework.yaml',
  'deployment-strategy': 'templates/frameworks/deployment-strategy.framework.yaml',
  'observability-design': 'templates/frameworks/observability-design.framework.yaml',
  'release-management': 'templates/frameworks/release-management.framework.yaml',
  'operational-readiness': 'templates/frameworks/operational-readiness.framework.yaml',
  'cost-model': 'templates/frameworks/cost-model.framework.yaml',
};

/** `10` §10.3's own ten-row gate catalogue, transcribed independently for the identical "this package
 * has no `@forge/engine` edge" reason `WorkflowId`/`WORKFLOW_INDEX` above already document. */
export type GateId =
  | 'G-Problem'
  | 'G-Product'
  | 'G-Design'
  | 'G-Foundation'
  | 'G-Ready'
  | 'G-Verify'
  | 'G-Stable'
  | 'G-Integration'
  | 'G-Deliver'
  | 'G-Operate';

/** Resolves a gate id to its `.gate.yaml` file, as a path relative to this package's own root — the
 * identical "caller resolves against wherever `@forge/templates` is actually installed" contract
 * `WORKFLOW_INDEX`/`TEMPLATE_INDEX` already document. */
export const GATE_INDEX: Readonly<Record<GateId, string>> = {
  'G-Problem': 'templates/checks/G-Problem.gate.yaml',
  'G-Product': 'templates/checks/G-Product.gate.yaml',
  'G-Design': 'templates/checks/G-Design.gate.yaml',
  'G-Foundation': 'templates/checks/G-Foundation.gate.yaml',
  'G-Ready': 'templates/checks/G-Ready.gate.yaml',
  'G-Verify': 'templates/checks/G-Verify.gate.yaml',
  'G-Stable': 'templates/checks/G-Stable.gate.yaml',
  'G-Integration': 'templates/checks/G-Integration.gate.yaml',
  'G-Deliver': 'templates/checks/G-Deliver.gate.yaml',
  'G-Operate': 'templates/checks/G-Operate.gate.yaml',
};

export const TEMPLATE_INDEX: Readonly<Record<TemplateArtifactTypeId, string>> = {
  Vision: 'templates/artifacts/Vision.md',
  Capability: 'templates/artifacts/Capability.md',
  NFR: 'templates/artifacts/NFR.md',
  Epic: 'templates/artifacts/Epic.md',
  Story: 'templates/artifacts/Story.md',
  Task: 'templates/artifacts/Task.md',
  ADR: 'templates/artifacts/ADR.md',
  InterfaceContract: 'templates/artifacts/InterfaceContract.md',
  DataModel: 'templates/artifacts/DataModel.md',
  Diagram: 'templates/artifacts/Diagram.md',
  Risk: 'templates/artifacts/Risk.md',
  Assumption: 'templates/artifacts/Assumption.md',
  OpenQuestion: 'templates/artifacts/OpenQuestion.md',
  Waiver: 'templates/artifacts/Waiver.md',
  SessionRecord: 'templates/artifacts/SessionRecord.md',
  RCA: 'templates/artifacts/RCA.md',
  Defect: 'templates/artifacts/Defect.md',
  Environment: 'templates/artifacts/Environment.md',
  Runbook: 'templates/artifacts/Runbook.md',
  GateReport: 'templates/artifacts/GateReport.md',
  HandoffRecord: 'templates/artifacts/HandoffRecord.md',
  ReviewReport: 'templates/artifacts/ReviewReport.md',
};

/** `15` §15.4.4's own six-group built-in skill library table, one real skill per named example
 * (thirty-two total: 6 method + 6 discipline + 6 diagramming + 6 stack + 5 tooling + 3 writing;
 * `PLAN-M6.md` T5). Transcribed independently for the identical "this package has no `@forge/*` edge"
 * reason every other index in this module already documents — `02` §2.2's own boundary graph runs
 * `extensions -> templates`, not the other way around, so `@forge/extensions/skills`' own
 * `SkillFrontMatter.id` type is not reachable from here either. */
export type SkillId =
  // Method skills
  | 'writing-an-adr'
  | 'writing-testable-acceptance-criteria'
  | 'splitting-an-oversized-story'
  | 'running-an-rca'
  | 'writing-a-runbook'
  | 'expand-contract-migration'
  // Discipline skills
  | 'tdd-loop-discipline'
  | 'test-oracle-design'
  | 'contract-testing'
  | 'property-based-testing'
  | 'performance-benchmarking'
  | 'threat-modelling-stride'
  // Diagramming skills
  | 'mermaid-authoring'
  | 'c4-diagramming'
  | 'sequence-diagramming'
  | 'er-diagramming'
  | 'state-diagramming'
  | 'diagram-review'
  // Stack skills
  | 'nodejs-typescript-conventions'
  | 'python-conventions'
  | 'jvm-conventions'
  | 'go-conventions'
  | 'rust-conventions'
  | 'dotnet-conventions'
  // Tooling skills
  | 'git-hygiene-for-lanes'
  | 'conventional-commits'
  | 'debugging-with-traces'
  | 'reading-a-flamegraph'
  | 'interpreting-a-coverage-report'
  // Writing skills
  | 'house-documentation-style'
  | 'changelog-writing'
  | 'api-reference-writing';

/** Resolves a skill id to its package *directory* (not a single file — `15` §15.4.2's own package
 * layout is `SKILL.md` plus optional `references/`/`examples/`/`scripts/`/`assets/` subdirectories),
 * as a path relative to this package's own root — the identical "caller resolves against wherever
 * `@forge/templates` is actually installed" contract every other index in this module documents. */
export const SKILL_INDEX: Readonly<Record<SkillId, string>> = {
  'writing-an-adr': 'templates/skills/writing-an-adr',
  'writing-testable-acceptance-criteria': 'templates/skills/writing-testable-acceptance-criteria',
  'splitting-an-oversized-story': 'templates/skills/splitting-an-oversized-story',
  'running-an-rca': 'templates/skills/running-an-rca',
  'writing-a-runbook': 'templates/skills/writing-a-runbook',
  'expand-contract-migration': 'templates/skills/expand-contract-migration',
  'tdd-loop-discipline': 'templates/skills/tdd-loop-discipline',
  'test-oracle-design': 'templates/skills/test-oracle-design',
  'contract-testing': 'templates/skills/contract-testing',
  'property-based-testing': 'templates/skills/property-based-testing',
  'performance-benchmarking': 'templates/skills/performance-benchmarking',
  'threat-modelling-stride': 'templates/skills/threat-modelling-stride',
  'mermaid-authoring': 'templates/skills/mermaid-authoring',
  'c4-diagramming': 'templates/skills/c4-diagramming',
  'sequence-diagramming': 'templates/skills/sequence-diagramming',
  'er-diagramming': 'templates/skills/er-diagramming',
  'state-diagramming': 'templates/skills/state-diagramming',
  'diagram-review': 'templates/skills/diagram-review',
  'nodejs-typescript-conventions': 'templates/skills/nodejs-typescript-conventions',
  'python-conventions': 'templates/skills/python-conventions',
  'jvm-conventions': 'templates/skills/jvm-conventions',
  'go-conventions': 'templates/skills/go-conventions',
  'rust-conventions': 'templates/skills/rust-conventions',
  'dotnet-conventions': 'templates/skills/dotnet-conventions',
  'git-hygiene-for-lanes': 'templates/skills/git-hygiene-for-lanes',
  'conventional-commits': 'templates/skills/conventional-commits',
  'debugging-with-traces': 'templates/skills/debugging-with-traces',
  'reading-a-flamegraph': 'templates/skills/reading-a-flamegraph',
  'interpreting-a-coverage-report': 'templates/skills/interpreting-a-coverage-report',
  'house-documentation-style': 'templates/skills/house-documentation-style',
  'changelog-writing': 'templates/skills/changelog-writing',
  'api-reference-writing': 'templates/skills/api-reference-writing',
};

/**
 * Resolves a workflow/gate step's `brief:` reference (e.g. `briefs/write-vision.md`, keyed here by
 * its basename minus extension, e.g. `write-vision`) to its real `.md` file, as a path relative to
 * this package's own root — the identical "caller resolves against wherever `@forge/templates` is
 * actually installed" contract every other index in this module documents.
 *
 * Deliberately typed `Readonly<Record<string, string>>`, not a closed literal-union id type like
 * {@link WorkflowId}/{@link GateId}/{@link FrameworkId}/{@link SkillId}/{@link TemplateArtifactTypeId}
 * above: every one of those five transcribes a spec-fixed, already-complete table (`10` §10.5/§10.3,
 * `11`-`14`, `15` §15.4.4, `18` §18.7) that is not expected to grow ad hoc. No such fixed catalogue
 * exists for briefs — `PLAN-M13.md` P1's own investigation found 62 distinct `briefs/*.md`
 * references empirically (58 in this package's own workflows/gates; four more appear only in
 * `modules/fm-service`/`modules/fm-mobile` workflows, which no index here materializes yet — see
 * `SPEC-QUESTIONS.md` Q197), not from a spec table enumerating them by name. `PLAN-M13.md` P2 (content authoring, not yet built — see
 * `SPEC-QUESTIONS.md` Q197) adds real entries here as each brief is written; a closed union would
 * force every content-authoring change to also touch this file's own type declaration for no real
 * benefit, since nothing here depends on the id set being closed the way the other five genuinely do.
 *
 * Empty today: no `packages/templates/templates/briefs/*.md` file exists in this codebase yet (P1's
 * own real, disclosed, temporary state — every `brief:` reference in every real, shipped workflow/gate
 * currently resolves to nothing at all, correctly reported by `forge workflow validate --all` as a
 * real `unknown-brief` finding until P2 lands). See `SPEC-QUESTIONS.md` Q197.
 *
 * @see specs/22 M13
 * @see PLAN-M13.md P1
 */
export const BRIEF_INDEX: Readonly<Record<string, string>> = {
  ...PLANNING_BRIEFS,
  ...BUILD_BRIEFS,
  ...OPS_AND_GATE_BRIEFS,
};

/**
 * Resolves an agent's `prompt.system`/`prompt.briefs.*` reference (e.g.
 * `prompts/domain-modeler.system.md`, keyed here by its basename minus extension, e.g.
 * `domain-modeler.system`) to its real `.md` file, as a path relative to this package's own root —
 * the identical "caller resolves against wherever `@forge/templates` is actually installed" contract
 * every other index in this module documents.
 *
 * Open `Readonly<Record<string, string>>`, empty today, for the identical reason {@link BRIEF_INDEX}
 * above is: `PLAN-M13.md` P1's own investigation found "62 distinct `prompts/*.md`" references across
 * the 34 shipped agents, empirically, not from a spec-fixed catalogue table. `PLAN-M13.md` P3 (agent
 * prompt content authoring, not yet built — see `SPEC-QUESTIONS.md` Q197) adds real entries here as
 * each prompt is written.
 *
 * @see specs/22 M13
 * @see PLAN-M13.md P1
 */
export const PROMPT_INDEX: Readonly<Record<string, string>> = {
  ...PROMPTS_A,
  ...PROMPTS_B,
};
