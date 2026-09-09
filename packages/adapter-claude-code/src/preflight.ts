/**
 * `runPreflight` — `07` §7.2's own `preflight(ctx): Promise<PreflightResult>`, made real for Claude
 * Code: runs P1's `probeCliVersion`/`probeAuthAvailability` and turns their results into real, typed
 * `PreflightIssue`s naming the exact remedy (`07` §7.3: "surface this in `forge doctor` with an exact
 * remedy").
 *
 * @see specs/07 §7.2
 * @see specs/07 §7.3
 * @see PLAN-M7.md P4
 */
import type { PreflightContext, PreflightIssue, PreflightResult } from '@forge/adapter-kit';

import type { ClaudeCodeAdapterConfig } from './config.ts';
import { MINIMUM_CLAUDE_CLI_VERSION, probeCliVersion } from './version.ts';
import { probeAuthAvailability } from './auth.ts';

export async function runPreflight(
  ctx: PreflightContext,
  config: ClaudeCodeAdapterConfig,
): Promise<PreflightResult> {
  const issues: PreflightIssue[] = [];

  const versionProbe = await probeCliVersion(ctx.env);
  if (!versionProbe.ok) {
    issues.push(
      versionProbe.version === undefined
        ? {
            code: 'ADP-CLAUDE-CODE-NOT-FOUND',
            message: 'The claude CLI is not reachable on PATH.',
            remedy:
              'Install Claude Code (https://claude.com/claude-code) and ensure claude is on PATH.',
          }
        : {
            code: 'ADP-CLAUDE-CODE-OUTDATED',
            message: `The installed claude CLI is version ${versionProbe.version}, below the required ${MINIMUM_CLAUDE_CLI_VERSION}.`,
            remedy: `Run \`claude update\` (or reinstall) to upgrade to at least ${MINIMUM_CLAUDE_CLI_VERSION}.`,
          },
    );
  }

  const authAvailability = await probeAuthAvailability(ctx.env);
  // `07` §7.3: bare mode's own auth is "strictly ANTHROPIC_API_KEY or apiKeyHelper... OAuth and
  // keychain are never read" -- non-bare mode's own broader requirement is *either* real credential,
  // confirmed directly against the real CLI's own `--help` text (P1, `SPEC-QUESTIONS.md` Q113).
  const hasRequiredCredential = config.bare
    ? authAvailability.apiKey
    : authAvailability.apiKey || authAvailability.subscription;
  if (!hasRequiredCredential) {
    issues.push(
      config.bare
        ? {
            code: 'ADP-CLAUDE-CODE-NO-API-KEY',
            message:
              'bare mode requires ANTHROPIC_API_KEY (or a Bedrock/Vertex/Foundry credential); none was found.',
            remedy:
              'Set ANTHROPIC_API_KEY, or set platform.adapterConfig["claude-code"].bare to false to use an ambient subscription login instead.',
          }
        : {
            code: 'ADP-CLAUDE-CODE-NO-CREDENTIAL',
            message: 'Neither ANTHROPIC_API_KEY nor a real claude auth status login were found.',
            remedy: 'Run `claude auth login` to sign in, or set ANTHROPIC_API_KEY.',
          },
    );
  }

  return {
    ok: issues.length === 0,
    ...(versionProbe.version === undefined ? {} : { version: versionProbe.version }),
    issues,
  };
}
