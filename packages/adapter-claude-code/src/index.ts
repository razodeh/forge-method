/**
 * `@forge/adapter-claude-code` — `07` §7.3's real `PlatformAdapter` implementation for Claude Code.
 *
 * This package's own `@anthropic-ai/claude-agent-sdk` dependency (P3, the SDK transport) declares a
 * `zod: ^4.0.0` peer dependency, while every other package in this monorepo is pinned to `zod@3.25.76`
 * — confirmed directly (the SDK's own real `package.json` lists it, and `sdk.d.ts` genuinely imports
 * from `zod/v4`/`zod/v3` subpaths). Rather than a blanket `strict-peer-dependencies=false` (which would
 * silently swallow *any* future peer-dep mismatch anywhere in the workspace), the root `package.json`
 * carries a single, narrowly-scoped `pnpm.peerDependencyRules.allowedVersions` entry for exactly this
 * one edge (`"@anthropic-ai/claude-agent-sdk>zod": "3"`) — safe because the installed `zod@3.25.76`
 * ships forward-compatible `./v3`/`./v4` subpath exports the SDK's own imports actually resolve
 * against, not a version this package merely hopes is close enough. See `SPEC-QUESTIONS.md` Q113.
 *
 * @see specs/07 §7.3
 * @see SPEC-QUESTIONS.md Q113
 * @see PLAN-M7.md
 */
export { claudeCodeAdapterConfigSchema, type ClaudeCodeAdapterConfig } from './config.ts';
export { MINIMUM_CLAUDE_CLI_VERSION, probeCliVersion, type CliVersionProbe } from './version.ts';
export { probeAuthAvailability, type AuthAvailability } from './auth.ts';
export { realClaudeCliRunner, type ClaudeCliRunner, type ClaudeCliResult } from './process.ts';
