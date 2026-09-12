/**
 * `CONFIG_KEY_DOCS` — one documentation line per leaf key in `configSchema`, per `PLAN-M1.md` P8's
 * mandate ("a documented default for every key... This is what makes `forge config explain`
 * possible in M2").
 *
 * @see specs/18 §18.3
 * @see PLAN-M1.md P8
 */

/** Every leaf dot-path `configSchema` declares — see `walk.ts`'s doc comment for what counts as one. */
export type ConfigKeyPath =
  | 'version'
  | 'project.name'
  | 'project.slug'
  | 'project.description'
  | 'project.level'
  | 'project.mode'
  | 'project.repoUrl'
  | 'project.adopted'
  | 'paths.kb'
  | 'paths.specs'
  | 'paths.plans'
  | 'paths.sessions'
  | 'paths.reports'
  | 'paths.code'
  | 'platform.primary'
  | 'platform.fallback'
  | 'platform.perAgent'
  | 'platform.routing.onRateLimit'
  | 'platform.routing.onOutage'
  | 'platform.adapterConfig'
  | 'models.tiers.frugal'
  | 'models.tiers.balanced'
  | 'models.tiers.max'
  | 'models.overrides'
  | 'execution.concurrency'
  | 'execution.autonomy'
  | 'execution.autonomyByGate'
  | 'execution.retainLaneWorktrees'
  | 'execution.integrationBranch'
  | 'execution.conflictPolicy'
  | 'execution.sharedMutablePaths'
  | 'execution.testCommands'
  | 'budget.perRunUsd'
  | 'budget.perStepUsdDefault'
  | 'budget.dailyUsd'
  | 'budget.onBreach'
  | 'roster.preset'
  | 'roster.enable'
  | 'roster.disable'
  | 'roster.alias'
  | 'roster.add'
  | 'roster.split'
  | 'kb.packBudgetTokens'
  | 'kb.retrieval.embeddings'
  | 'kb.retrieval.graphHops'
  | 'kb.staleness.architecture'
  | 'kb.staleness.data'
  | 'kb.staleness.delivery'
  | 'kb.staleness.product'
  | 'kb.staleness.ops'
  | 'skills.packBudgetTokens'
  | 'skills.hardBodyCapTokens'
  | 'mcp.servers'
  | 'mcp.grants'
  | 'mcp.defaults.grantMode'
  | 'mcp.defaults.injectionPosture'
  | 'mcp.adoptHostServers'
  | 'diagrams.defaultNotation'
  | 'diagrams.allowedNotations'
  | 'diagrams.render'
  | 'diagrams.remoteRenderer'
  | 'diagrams.complexity.maxNodes'
  | 'diagrams.complexity.maxEdges'
  | 'diagrams.complexity.hardMaxNodes'
  | 'diagrams.driftPolicy'
  | 'diagrams.requireCaptions'
  | 'quality.coverage.lines'
  | 'quality.coverage.branches'
  | 'quality.coverage.ratchet'
  | 'quality.flake.maxRatePct'
  | 'quality.flake.window'
  | 'quality.flake.quarantineCap'
  | 'quality.pyramid.maxE2ESharePct'
  | 'quality.dodProfileDefault'
  | 'security.secretSource'
  | 'security.secretCommand'
  | 'security.toolCeilingEscalations'
  | 'security.destructiveOps'
  | 'security.redactPatterns'
  | 'vcs.allowCommits'
  | 'vcs.commitConvention'
  | 'vcs.signCommits'
  | 'vcs.trailers'
  | 'telemetry.network'
  | 'telemetry.otlpEndpoint'
  | 'output.color'
  | 'output.ascii'
  | 'output.style';

export const CONFIG_KEY_DOCS: Readonly<Record<ConfigKeyPath, string>> = {
  version: 'Config schema version; drives migrations when the shape of this file changes.',
  'project.name': "The project's display name.",
  'project.slug': 'A short, stable, filesystem- and URL-safe identifier for the project.',
  'project.description': 'One-line description of what the project is.',
  'project.level': 'The rigor level (L0..L4) that scales gate strictness and required artifacts.',
  'project.mode': 'guided (a human is in the loop) or express (fewer stops, more autonomy).',
  'project.repoUrl': "The project's source repository URL, or empty if none is configured yet.",
  'project.adopted':
    'Whether this project went through `forge adopt` (`17` §17.4) — set once, automatically, when a ' +
    'full adoption run completes. Narrows some defaults (e.g. out-of-claim file writes default to ' +
    'strict even at guided autonomy) to account for unknown coupling in a brownfield codebase.',
  'paths.kb': 'Repo-relative path to the knowledge body.',
  'paths.specs': 'Repo-relative path to spec artifacts.',
  'paths.plans': 'Repo-relative path to delivery plans.',
  'paths.sessions': 'Repo-relative path to session records.',
  'paths.reports': 'Repo-relative path to generated reports (gates, coverage, drift, cost).',
  'paths.code': 'Repo-relative path to the root of the actual source tree.',
  'platform.primary':
    'The opaque id of the primary configured platform adapter, or empty if unset.',
  'platform.fallback': 'The opaque id of the fallback platform adapter, or null if there is none.',
  'platform.perAgent': 'Per-agent platform overrides: agent id -> platform id.',
  'platform.routing.onRateLimit': 'What to do when the primary platform is rate-limited.',
  'platform.routing.onOutage': 'What to do when the primary platform is unreachable.',
  'platform.adapterConfig':
    'Per-platform adapter configuration, keyed by platform id. Each adapter package owns and ' +
    "validates its own entry's shape; this schema only requires it be present as an object.",
  'models.tiers.frugal': 'Model to use at the frugal budget tier, per platform id.',
  'models.tiers.balanced': 'Model to use at the balanced budget tier, per platform id.',
  'models.tiers.max': 'Model to use at the max budget tier, per platform id.',
  'models.overrides': 'Per-agent-role tier overrides: role id -> tier name.',
  'execution.concurrency': '"auto", or a fixed maximum number of concurrent lanes.',
  'execution.autonomy': 'Default autonomy level: how much a run proceeds without human approval.',
  'execution.autonomyByGate': 'Per-gate autonomy overrides: gate id -> autonomy level.',
  'execution.retainLaneWorktrees': 'When to keep a lane worktree after it finishes.',
  'execution.integrationBranch':
    'Branch name template lanes integrate into (may reference {stage}).',
  'execution.conflictPolicy': 'Who resolves a merge conflict between lanes.',
  'execution.sharedMutablePaths':
    'Paths multiple lanes may touch, and how conflicts on them resolve.',
  'execution.testCommands':
    'The real shell command for each test layer (unit/integration/contract/e2e/nfr/lint/typecheck) — a layer with no command reports as unable to verify, never as passing.',
  'budget.perRunUsd': 'Maximum spend, in USD, for one run.',
  'budget.perStepUsdDefault': 'Default maximum spend, in USD, for one step.',
  'budget.dailyUsd': 'Maximum spend, in USD, per day across all runs.',
  'budget.onBreach': 'What happens when a budget limit is exceeded.',
  'roster.preset': 'Named starting roster of agent roles to enable.',
  'roster.enable': 'Role ids to enable in addition to the preset.',
  'roster.disable': 'Role ids to disable from the preset.',
  'roster.alias': 'Role id renames: original role id -> alias.',
  'roster.add': 'New role definitions to add beyond the preset.',
  'roster.split': 'Role ids to split into multiple roles: original role id -> new role ids.',
  'kb.packBudgetTokens': 'Maximum tokens of KB content packed into an agent context.',
  'kb.retrieval.embeddings':
    'Whether embedding-based retrieval is enabled (default is lexical only).',
  'kb.retrieval.graphHops': 'How many graph hops retrieval follows from a seed entry.',
  'kb.staleness.architecture': 'Days before an architecture KB entry is flagged stale.',
  'kb.staleness.data': 'Days before a data KB entry is flagged stale.',
  'kb.staleness.delivery': 'Days before a delivery KB entry is flagged stale.',
  'kb.staleness.product': 'Days before a product KB entry is flagged stale.',
  'kb.staleness.ops': 'Days before an ops KB entry is flagged stale.',
  'skills.packBudgetTokens': 'Maximum tokens of skill content packed into an agent context.',
  'skills.hardBodyCapTokens': 'Hard ceiling on tokens for one skill body, regardless of budget.',
  'mcp.servers': 'Configured MCP servers.',
  'mcp.grants': 'Per-server or per-tool grants for MCP access.',
  'mcp.defaults.grantMode': 'Default grant mode applied to a newly-registered MCP server.',
  'mcp.defaults.injectionPosture': 'Default trust posture applied to MCP-supplied content.',
  'mcp.adoptHostServers': "Whether to adopt the host environment's already-configured MCP servers.",
  'diagrams.defaultNotation': 'Default diagram notation when a type does not force one.',
  'diagrams.allowedNotations': 'Notations this project permits generating or accepting.',
  'diagrams.render': 'When diagrams are rendered to an image for review.',
  'diagrams.remoteRenderer': 'URL of a remote rendering service, or null to render locally only.',
  'diagrams.complexity.maxNodes': 'Soft cap on nodes in one diagram before a warning.',
  'diagrams.complexity.maxEdges': 'Soft cap on edges in one diagram before a warning.',
  'diagrams.complexity.hardMaxNodes': 'Hard cap on nodes in one diagram; above this it is refused.',
  'diagrams.driftPolicy': 'What happens when a generated diagram no longer matches its source.',
  'diagrams.requireCaptions': 'Whether every diagram must carry a caption and alt text.',
  'quality.coverage.lines': 'Minimum required line coverage percentage.',
  'quality.coverage.branches': 'Minimum required branch coverage percentage.',
  'quality.coverage.ratchet':
    'Whether coverage is required to never decrease from its recorded high.',
  'quality.flake.maxRatePct': 'Maximum tolerated flaky-test rate, as a percentage.',
  'quality.flake.window': 'Number of recent runs the flake rate is computed over.',
  'quality.flake.quarantineCap': 'Maximum number of tests that may be quarantined at once.',
  'quality.pyramid.maxE2ESharePct': 'Maximum share of the test suite that may be end-to-end tests.',
  'quality.dodProfileDefault':
    'Default Definition-of-Done profile applied when a story names none.',
  'security.secretSource': 'Where secrets are read from.',
  'security.secretCommand': 'Command to run to fetch a secret, when secretSource is "command".',
  'security.toolCeilingEscalations': 'Configured exceptions raising a tool-use ceiling.',
  'security.destructiveOps': 'How a potentially destructive operation is handled.',
  'security.redactPatterns':
    'Regular expressions matching content to redact from logs and reports.',
  'vcs.allowCommits': 'Whether FORGE is allowed to create commits.',
  'vcs.commitConvention': 'Commit message convention FORGE-authored commits follow.',
  'vcs.signCommits': 'Whether FORGE-authored commits are signed.',
  'vcs.trailers': 'Whether FORGE-authored commits carry trailers (e.g. linking a story id).',
  'telemetry.network': 'Whether telemetry is allowed to leave the machine over the network.',
  'telemetry.otlpEndpoint': 'OTLP endpoint telemetry is exported to, or null to export nowhere.',
  'output.color': 'Terminal color mode.',
  'output.ascii': 'Whether output is restricted to plain ASCII (no box-drawing or Unicode glyphs).',
  'output.style': 'Named output theme.',
};
