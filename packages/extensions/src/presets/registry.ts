/**
 * `PRESET_REGISTRY` — `15` §15.9's five named presets, as real, schema-valid overlay content (never
 * placeholders), mirroring `@forge/templates`' stub-per-type precedent (`PLAN-M1.md` P11).
 *
 * Every preset's `posture` field carries `15` §15.9's own table text verbatim, including the facts
 * this piece's `files` cannot mechanically apply (a project scale level, an autonomy posture, a
 * technology-maturity policy, a waiver-expiry number) — `SPEC-QUESTIONS.md` Q38 records why: none of
 * those has a schema this milestone's own `@forge/extensions` owns. `files` only ever expresses the
 * subset of each posture that a real, already-committed P1–P7 schema can validate.
 *
 * @see specs/15 §15.9
 * @see PLAN-M2.md P7
 * @see SPEC-QUESTIONS.md Q38
 */
import type { PresetDefinition } from './types.ts';

export const PRESET_REGISTRY: readonly PresetDefinition[] = [
  {
    id: 'solo-fast',
    posture:
      'L1–L2 default, autonomy autonomous for non-destructive steps, lean artifact set, reviewer ' +
      'enabled but single-perspective, cost-tuned models.',
    files: [
      {
        path: '.forge/overrides/agents/reviewer.agent.yaml',
        kind: 'agentOverlay',
        data: {
          model: { tier: 'frugal' },
          persona: { voice: 'Terse, single-perspective correctness review — no swarm.' },
        },
      },
    ],
  },
  {
    id: 'startup-lean',
    posture: 'Balanced; full inner loop; light documentation; staged NFRs. (default)',
    files: [
      {
        path: '.forge/overrides/style/startup-lean.style.yaml',
        kind: 'styleProfile',
        data: {
          id: 'startup-lean-style',
          language: 'en',
          tone: 'concise, pragmatic, no ceremony',
          person: 'third',
          banned_phrases: [],
          artifact_conventions: {
            headings: 'sentence-case',
            dates: 'ISO-8601',
            code_fences: 'always-annotated',
            diagrams: 'mermaid',
          },
          commit_style: 'conventional',
          doc_length: { adr: '≤ 1 page', story: '≤ 1 page' },
        },
      },
    ],
  },
  {
    id: 'enterprise-rigor',
    posture:
      'All gates alwaysHuman at design and delivery, full ADR discipline, compliance role on, ' +
      'expanded review perspectives, waivers require expiry ≤ 30 days.',
    files: [
      {
        path: '.forge/overrides/agents/compliance.agent.yaml',
        kind: 'agentOverlay',
        data: {
          mandate:
            'Own the compliance matrix and control mapping for every gate that requires one.',
          limits: { max_cost_usd: 5.0 },
        },
      },
      {
        path: '.forge/overrides/workflows/build-stage.workflow.yaml',
        kind: 'workflowOverlay',
        data: {
          steps: {
            $replaceWhere: [
              { id: 'review', step: { perspectives: { $append: ['compliance', 'security'] } } },
            ],
          },
        },
      },
    ],
  },
  {
    id: 'regulated',
    posture:
      'enterprise-rigor + compliance matrix required at G-Design, data-map mandatory, deletion ' +
      'tests mandatory, no emerging-maturity technology, no write-capable MCP.',
    files: [
      {
        path: '.forge/overrides/mcp/regulated.mcp.yaml',
        kind: 'mcpConfig',
        data: {
          servers: [],
          grants: {},
          defaults: { grantMode: 'explicit', injectionPosture: 'untrusted-content' },
        },
      },
      {
        path: '.forge/overrides/checks/regulated-compliance-matrix.check.yaml',
        kind: 'gateCheck',
        data: {
          id: 'regulated:compliance-matrix',
          run: 'acme-compliance-matrix-check --json',
          parser: 'json',
          failOn: 'missing > 0',
          remedy: 'Complete the compliance matrix and control mapping before G-Design.',
          appliesTo: { gates: ['G-Design'] },
          severity: 'error',
        },
      },
    ],
    // "No emerging-maturity technology" has no mechanical home: `12` §12.2's own `maturity: emerging
    // | growing | mature | legacy | declining` field lives on a technology-catalog entry, a document
    // kind no P1-P7 schema in this milestone owns — carried in `posture` prose only (SPEC-QUESTIONS.md
    // Q38's own principle: a fact with no real schema gets no fabricated one). An earlier version of
    // this preset expressed it as `frameworks/repo-strategy.framework.yaml`'s `options: { $remove:
    // ['emerging'] }` — `repo-strategy`'s real options are `monorepo-single-package`/
    // `monorepo-workspaces`/`polyrepo`/`meta-repo` (`11` §11's own table); `'emerging'` was never one
    // of them, so that file patched the wrong framework with a fabricated id and was removed.
  },
  {
    id: 'agency-delivery',
    posture: 'Client-facing artifact templates, weekly stage cadence, export-oriented reporting.',
    files: [
      {
        path: '.forge/overrides/templates/ADR.md',
        kind: 'templateOverlay',
        data: {
          id: 'ADR-0001',
          type: 'ADR',
          schemaVersion: 1,
          title: '<the decision, phrased as a title a client can read without internal jargon>',
          status: 'proposed',
          created: '2026-01-15',
          updated: '2026-01-15',
          revision: 1,
          author: 'architect',
          changelog: [],
          category: 'architecture',
          deciders: [],
          date: '2026-01-15',
          reversibility: 'medium',
          blast_radius: [],
          revisit_trigger: '<the condition that should trigger revisiting this decision>',
          supersedes: [],
          superseded_by: null,
          related: [],
          diagrams: [],
          framework: '<the decision framework used, if any>',
        },
      },
    ],
  },
];
