/**
 * `mapToolGrantToAllowedTools`/`mapPermissionMode` — `07` §7.2's own "Adapters MUST fail closed"
 * mandate, made concrete against Claude Code's real `--allowedTools`/`--permission-mode` syntax
 * (confirmed directly against the real, installed CLI's own `--help` text: `--allowedTools, --allowed-tools
 * <tools...>` — "Comma or space-separated list of tool names to allow (e.g. \"Bash(git *) Edit\")";
 * `--permission-mode <mode>` — choices `acceptEdits`, `auto`, `bypassPermissions`, `manual`, `dontAsk`,
 * `plan`). Shared between the CLI transport (P2) and the SDK transport (P3) deliberately — one
 * implementation, not two that could silently diverge on the exact same security-relevant mapping.
 *
 * @see specs/07 §7.2
 * @see specs/07 §7.3
 * @see SPEC-QUESTIONS.md Q114
 * @see PLAN-M7.md P2, P3, P5
 */
import type { SessionRequest } from '@forge/adapter-kit';

/**
 * A crafted `exec` pattern containing a literal `)` could otherwise close the `Bash(...)` permission
 * rule early and inject trailing text Claude Code's own parser would read as a *second*, attacker-
 * controlled rule — the identical "a pattern's own text closes the real boundary and starts a
 * different one" risk `@forge/adapter-kit/grants`' own `describeGrant` doc comment already names for
 * a different string-building function in this same package family (P5's own hardening mandate).
 * Refuses (returns `undefined`, meaning "grant nothing for this pattern") rather than attempting to
 * escape it, since Claude Code's own `Bash(...)` syntax has no documented escape mechanism to rely on.
 */
function safeBashRule(pattern: string): string | undefined {
  if (pattern.includes(')') || pattern.includes('(')) return undefined;
  return `Bash(${pattern})`;
}

/**
 * Maps `07` §7.2's own four-field `ToolGrant` onto Claude Code's real tool-name vocabulary. Always
 * returns a real, explicit list — never `undefined` for "omit the flag entirely," since omitting
 * `--allowedTools` lets the platform's own default tool set apply, which is the opposite of fail-
 * closed for a grant that means to deny everything.
 *
 * `network` has no direct Claude Code tool-permission equivalent for `'allowlist'` specifically — no
 * documented per-host scoping syntax was found inside `--allowedTools` on the real, installed CLI.
 * Resolved fail-closed rather than guessed: `'allowlist'` is treated identically to `'none'` (both
 * exclude `WebFetch`/`WebSearch` entirely) until a real, confirmed host-scoping mechanism is found —
 * recorded as a real fidelity gap in `SPEC-QUESTIONS.md` Q114, P5's own hardening piece to close for
 * real once (if ever) Claude Code documents one.
 */
export function mapToolGrantToAllowedTools(grant: SessionRequest['tools']): readonly string[] {
  const tools: string[] = [];
  if (grant.read) tools.push('Read');
  if (grant.write) tools.push('Edit', 'Write');
  if (grant.exec !== false) {
    for (const pattern of grant.exec) {
      const rule = safeBashRule(pattern);
      if (rule !== undefined) tools.push(rule);
    }
  }
  if (grant.network === 'full') tools.push('WebFetch', 'WebSearch');
  if (grant.extra !== undefined) tools.push(...grant.extra);
  return tools;
}

const PERMISSION_MODE_MAP: Readonly<Record<SessionRequest['permissionMode'], string>> = {
  'deny-unlisted': 'dontAsk',
  'accept-edits': 'acceptEdits',
  auto: 'auto',
  // `07` §7.3's own mapping table: "default; requires interactive approval -> engine surfaces
  // prompts." Claude Code's own real `--permission-mode` choices include a literal `manual` value
  // (confirmed against `--help`) that reads as exactly this default, interactive-approval behaviour —
  // passed through rather than omitting the flag, so this session's own mode is always explicit.
  manual: 'manual',
};

export function mapPermissionMode(mode: SessionRequest['permissionMode']): string {
  return PERMISSION_MODE_MAP[mode];
}
