# forge-method

## 0.1.0

### Minor Changes

- d58894d: First real release of the `forge` CLI.

  `forge` runs your idea through an explicit software engineering lifecycle — discovery, design,
  planning, implementation, verification, delivery — orchestrating a team of specialized AI agents
  (architect, PM, engineers, SDET, reviewer, and more) against a coding-agent platform (Claude Code
  today; any CLI coding tool via a declarative adapter), instead of one generalist agent improvising
  from a prompt.

  What's in this release:

  - `forge init` scaffolds a project at a scale-adaptive level (`L0` patch through `L4` platform),
    materializing the agents, workflows, gates, and prompts your project's level actually needs.
  - `forge doctor` verifies your environment (Node, git, platform adapter, config) with actionable
    remedies, not just pass/fail.
  - Spec authoring (`forge spec new/list/validate`) against a normative artifact schema, with real
    document and dependency-graph validation.
  - Workflow execution (`forge run <workflow> [--dry-run]`) driving real, resumable, budgeted agent
    sessions through a compiled step DAG, with `forge status`, `forge lanes`, `forge cost`,
    `forge audit`, and `forge merge` to watch, inspect, and steer a run while it's active.
  - A durable Knowledge Body (`docs/forge/kb/`) every agent reads before acting and writes back to
    after deciding, so decisions made early in a project are still respected much later.
  - Ten built-in quality gates (`G-Problem` through `G-Operate`) that check real, machine-verifiable
    conditions before letting work through a stage.
  - A Windows-compatibility fix to the published CLI's own entry point (a dynamic-import path bug
    that would otherwise have broken `forge` immediately on Windows).

  Known gap, disclosed rather than hidden: cross-platform CI (Linux/macOS/Windows) is still being
  hardened post-release — see `CONTRIBUTING.md` for the current, honest state of that work.
