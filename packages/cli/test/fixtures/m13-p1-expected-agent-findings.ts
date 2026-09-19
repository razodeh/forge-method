/**
 * The real, complete, itemized `unknown-prompt` findings `forge agent validate --all` reports against
 * the real, complete, currently-shipped `modules/` roster right now — `PLAN-M13.md` P1's own real,
 * disclosed, intentionally temporary regression (see `SPEC-QUESTIONS.md` Q197). Captured directly from
 * a real run of `agentValidateAll` against a real `forge init` (not hand-typed from a spec or guessed):
 * every one of the 34 real, shipped agents' own `prompt.system`/`prompt.briefs.*` reference currently
 * resolves to nothing, since `PROMPT_INDEX` (`packages/templates/src/index.ts`) is still empty —
 * `PLAN-M13.md` P3 (agent prompt content authoring, not yet built) closes this.
 *
 * Shared by `packages/cli/test/e2e/init.test.ts` (E1 init, real workflow issues alongside these) and
 * `packages/cli/test/commands/agent.test.ts` (`agentValidateAll` alone) — both assert the identical
 * real fact against the identical real roster, so one shared constant is what keeps them from silently
 * drifting apart the way two independently-hand-typed copies of the same 62-entry list could.
 *
 * @see specs/05 §5.9
 * @see PLAN-M13.md P1
 */
import type { AgentValidationFinding } from '../../src/commands/agent.ts';

export const EXPECTED_M13_P1_AGENT_FINDINGS: readonly AgentValidationFinding[] = [
  { agentId: 'analyst', severity: 'error', code: 'unknown-prompt', message: 'prompt.system references unknown prompt "prompts/analyst.system.md".' },
  { agentId: 'analyst', severity: 'error', code: 'unknown-prompt', message: 'prompt.briefs.discovery references unknown prompt "prompts/analyst.discovery.md".' },
  { agentId: 'architect', severity: 'error', code: 'unknown-prompt', message: 'prompt.system references unknown prompt "prompts/architect.system.md".' },
  { agentId: 'architect', severity: 'error', code: 'unknown-prompt', message: 'prompt.briefs.design-system references unknown prompt "prompts/architect.design-system.md".' },
  { agentId: 'architect', severity: 'error', code: 'unknown-prompt', message: 'prompt.briefs.review-change references unknown prompt "prompts/architect.review-change.md".' },
  { agentId: 'backend', severity: 'error', code: 'unknown-prompt', message: 'prompt.system references unknown prompt "prompts/backend.system.md".' },
  { agentId: 'backend', severity: 'error', code: 'unknown-prompt', message: 'prompt.briefs.implement-story references unknown prompt "prompts/backend.implement-story.md".' },
  { agentId: 'base-engineer', severity: 'error', code: 'unknown-prompt', message: 'prompt.system references unknown prompt "prompts/base-engineer.system.md".' },
  { agentId: 'base-engineer', severity: 'error', code: 'unknown-prompt', message: 'prompt.briefs.implement-story references unknown prompt "prompts/base-engineer.implement-story.md".' },
  { agentId: 'compliance', severity: 'error', code: 'unknown-prompt', message: 'prompt.system references unknown prompt "prompts/compliance.system.md".' },
  { agentId: 'compliance', severity: 'error', code: 'unknown-prompt', message: 'prompt.briefs.map-compliance references unknown prompt "prompts/compliance.map-compliance.md".' },
  { agentId: 'critic', severity: 'error', code: 'unknown-prompt', message: 'prompt.system references unknown prompt "prompts/critic.system.md".' },
  { agentId: 'critic', severity: 'error', code: 'unknown-prompt', message: 'prompt.briefs.critique-architecture references unknown prompt "prompts/critic.critique-architecture.md".' },
  { agentId: 'data-architect', severity: 'error', code: 'unknown-prompt', message: 'prompt.system references unknown prompt "prompts/data-architect.system.md".' },
  { agentId: 'data-architect', severity: 'error', code: 'unknown-prompt', message: 'prompt.briefs.design-data-model references unknown prompt "prompts/data-architect.design-data-model.md".' },
  { agentId: 'data-engineer', severity: 'error', code: 'unknown-prompt', message: 'prompt.system references unknown prompt "prompts/data-engineer.system.md".' },
  { agentId: 'data-engineer', severity: 'error', code: 'unknown-prompt', message: 'prompt.briefs.implement-pipeline references unknown prompt "prompts/data-engineer.implement-pipeline.md".' },
  { agentId: 'data-engineer', severity: 'error', code: 'unknown-prompt', message: 'prompt.briefs.model-warehouse references unknown prompt "prompts/data-engineer.model-warehouse.md".' },
  { agentId: 'diagnostician', severity: 'error', code: 'unknown-prompt', message: 'prompt.system references unknown prompt "prompts/diagnostician.system.md".' },
  { agentId: 'diagnostician', severity: 'error', code: 'unknown-prompt', message: 'prompt.briefs.run-rca-framework references unknown prompt "prompts/diagnostician.run-rca-framework.md".' },
  { agentId: 'domain-modeler', severity: 'error', code: 'unknown-prompt', message: 'prompt.system references unknown prompt "prompts/domain-modeler.system.md".' },
  { agentId: 'domain-modeler', severity: 'error', code: 'unknown-prompt', message: 'prompt.briefs.model-domain references unknown prompt "prompts/domain-modeler.model-domain.md".' },
  { agentId: 'em', severity: 'error', code: 'unknown-prompt', message: 'prompt.system references unknown prompt "prompts/em.system.md".' },
  { agentId: 'em', severity: 'error', code: 'unknown-prompt', message: 'prompt.briefs.run-retro references unknown prompt "prompts/em.run-retro.md".' },
  { agentId: 'facilitator', severity: 'error', code: 'unknown-prompt', message: 'prompt.system references unknown prompt "prompts/facilitator.system.md".' },
  { agentId: 'facilitator', severity: 'error', code: 'unknown-prompt', message: 'prompt.briefs.run-session references unknown prompt "prompts/facilitator.run-session.md".' },
  { agentId: 'finops', severity: 'error', code: 'unknown-prompt', message: 'prompt.system references unknown prompt "prompts/finops.system.md".' },
  { agentId: 'finops', severity: 'error', code: 'unknown-prompt', message: 'prompt.briefs.model-cost references unknown prompt "prompts/finops.model-cost.md".' },
  { agentId: 'frontend', severity: 'error', code: 'unknown-prompt', message: 'prompt.system references unknown prompt "prompts/frontend.system.md".' },
  { agentId: 'frontend', severity: 'error', code: 'unknown-prompt', message: 'prompt.briefs.implement-story references unknown prompt "prompts/frontend.implement-story.md".' },
  { agentId: 'frontend', severity: 'error', code: 'unknown-prompt', message: 'prompt.briefs.component-spec references unknown prompt "prompts/frontend.component-spec.md".' },
  { agentId: 'integration-architect', severity: 'error', code: 'unknown-prompt', message: 'prompt.system references unknown prompt "prompts/integration-architect.system.md".' },
  { agentId: 'integration-architect', severity: 'error', code: 'unknown-prompt', message: 'prompt.briefs.design-integration references unknown prompt "prompts/integration-architect.design-integration.md".' },
  { agentId: 'ml-engineer', severity: 'error', code: 'unknown-prompt', message: 'prompt.system references unknown prompt "prompts/ml-engineer.system.md".' },
  { agentId: 'ml-engineer', severity: 'error', code: 'unknown-prompt', message: 'prompt.briefs.integrate-model references unknown prompt "prompts/ml-engineer.integrate-model.md".' },
  { agentId: 'mobile', severity: 'error', code: 'unknown-prompt', message: 'prompt.system references unknown prompt "prompts/mobile.system.md".' },
  { agentId: 'mobile', severity: 'error', code: 'unknown-prompt', message: 'prompt.briefs.implement-story references unknown prompt "prompts/mobile.implement-story.md".' },
  { agentId: 'mobile', severity: 'error', code: 'unknown-prompt', message: 'prompt.briefs.prepare-release-build references unknown prompt "prompts/mobile.prepare-release-build.md".' },
  { agentId: 'orchestrator', severity: 'error', code: 'unknown-prompt', message: 'prompt.system references unknown prompt "prompts/orchestrator.system.md".' },
  { agentId: 'orchestrator', severity: 'error', code: 'unknown-prompt', message: 'prompt.briefs.schedule-run references unknown prompt "prompts/orchestrator.schedule-run.md".' },
  { agentId: 'platform', severity: 'error', code: 'unknown-prompt', message: 'prompt.system references unknown prompt "prompts/platform.system.md".' },
  { agentId: 'platform', severity: 'error', code: 'unknown-prompt', message: 'prompt.briefs.initialize-project references unknown prompt "prompts/platform.initialize-project.md".' },
  { agentId: 'pm', severity: 'error', code: 'unknown-prompt', message: 'prompt.system references unknown prompt "prompts/pm.system.md".' },
  { agentId: 'pm', severity: 'error', code: 'unknown-prompt', message: 'prompt.briefs.define-product references unknown prompt "prompts/pm.define-product.md".' },
  { agentId: 'po', severity: 'error', code: 'unknown-prompt', message: 'prompt.system references unknown prompt "prompts/po.system.md".' },
  { agentId: 'po', severity: 'error', code: 'unknown-prompt', message: 'prompt.briefs.write-stories references unknown prompt "prompts/po.write-stories.md".' },
  { agentId: 'release', severity: 'error', code: 'unknown-prompt', message: 'prompt.system references unknown prompt "prompts/release.system.md".' },
  { agentId: 'release', severity: 'error', code: 'unknown-prompt', message: 'prompt.briefs.write-release-notes references unknown prompt "prompts/release.write-release-notes.md".' },
  { agentId: 'reviewer', severity: 'error', code: 'unknown-prompt', message: 'prompt.system references unknown prompt "prompts/reviewer.system.md".' },
  { agentId: 'reviewer', severity: 'error', code: 'unknown-prompt', message: 'prompt.briefs.swarm-review references unknown prompt "prompts/reviewer.swarm-review.md".' },
  { agentId: 'sdet', severity: 'error', code: 'unknown-prompt', message: 'prompt.system references unknown prompt "prompts/sdet.system.md".' },
  { agentId: 'sdet', severity: 'error', code: 'unknown-prompt', message: 'prompt.briefs.write-failing-tests references unknown prompt "prompts/sdet.write-failing-tests.md".' },
  { agentId: 'security', severity: 'error', code: 'unknown-prompt', message: 'prompt.system references unknown prompt "prompts/security.system.md".' },
  { agentId: 'security', severity: 'error', code: 'unknown-prompt', message: 'prompt.briefs.threat-model references unknown prompt "prompts/security.threat-model.md".' },
  { agentId: 'sre', severity: 'error', code: 'unknown-prompt', message: 'prompt.system references unknown prompt "prompts/sre.system.md".' },
  { agentId: 'sre', severity: 'error', code: 'unknown-prompt', message: 'prompt.briefs.design-delivery references unknown prompt "prompts/sre.design-delivery.md".' },
  { agentId: 'techwriter', severity: 'error', code: 'unknown-prompt', message: 'prompt.system references unknown prompt "prompts/techwriter.system.md".' },
  { agentId: 'techwriter', severity: 'error', code: 'unknown-prompt', message: 'prompt.briefs.write-docs references unknown prompt "prompts/techwriter.write-docs.md".' },
  { agentId: 'test-architect', severity: 'error', code: 'unknown-prompt', message: 'prompt.system references unknown prompt "prompts/test-architect.system.md".' },
  { agentId: 'test-architect', severity: 'error', code: 'unknown-prompt', message: 'prompt.briefs.plan-testing references unknown prompt "prompts/test-architect.plan-testing.md".' },
  { agentId: 'ux', severity: 'error', code: 'unknown-prompt', message: 'prompt.system references unknown prompt "prompts/ux.system.md".' },
  { agentId: 'ux', severity: 'error', code: 'unknown-prompt', message: 'prompt.briefs.design-flows references unknown prompt "prompts/ux.design-flows.md".' },
];
