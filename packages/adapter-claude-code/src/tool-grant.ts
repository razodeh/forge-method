/**
 * `mapToolGrantToAllowedTools`/`mapPermissionModeForCli`/`mapPermissionModeForSdk` — `07` §7.2's own
 * "Adapters MUST fail closed" mandate, made concrete against Claude Code's real tool/permission
 * vocabularies (confirmed directly against the real, installed CLI's own `--help` text and the real,
 * published SDK's own `.d.ts`).
 *
 * `mapToolGrantToAllowedTools` is genuinely shared between the CLI transport (P2) and the SDK
 * transport (P3) — one implementation, not two that could silently diverge on the exact same
 * security-relevant mapping; both accept a plain `readonly string[]` of tool names (the CLI transport
 * joins it into one `--allowedTools` value itself, the SDK's own `Options.allowedTools` already wants
 * an array). Permission-mode mapping is **not** shared, despite looking like it should be: the two
 * real vocabularies genuinely differ for the same FORGE `'manual'` concept — the CLI's own
 * `--permission-mode` choices include a literal `manual` value (confirmed against `--help`), but the
 * SDK's own real `PermissionMode` type (confirmed against `sdk.d.ts`) has no `'manual'` member at
 * all — its own equivalent, interactive-approval-by-default value is spelled `'default'`. One shared
 * function would have to either invent a value neither platform's real API accepts, or silently
 * special-case by caller, defeating the whole point of a shared mapping; two small, transport-named
 * functions are more honest than one function pretending the two vocabularies are the same.
 *
 * @see specs/07 §7.2
 * @see specs/07 §7.3
 * @see SPEC-QUESTIONS.md Q114
 * @see SPEC-QUESTIONS.md Q117
 * @see PLAN-M7.md P2, P3, P5
 */
import type { PermissionMode } from '@anthropic-ai/claude-agent-sdk';
import type { SessionRequest } from '@forge/adapter-kit';

/**
 * A crafted `exec` pattern containing a literal `(`, `)`, or `,` is refused (never wrapped) rather
 * than escaped, since Claude Code's own `Bash(...)` syntax has no documented escape mechanism.
 *
 * P5's own dedicated hardening pass briefly relaxed the `(`/`)` half of this refusal, reasoning from
 * the official docs' own "Parentheses inside the specifier are literal, so a command or path that
 * contains them needs no escaping" -- true, but a claim about *balanced*, single-rule usage
 * (`Edit(./Finance (2024)/**)`is the docs' own worked example: one open, one close, nested and
 * matched). A fresh critic round caught the real, adversarial case that claim does not cover: the
 * docs' *other* worked example -- `--allowedTools` accepting `"Bash(git *) Edit"` as one value that
 * splits into *two* rules -- proves Claude Code's own parser is depth-aware, closing a rule the
 * instant its own paren depth returns to zero and resuming to look for a *second* rule afterward. An
 * *unbalanced* pattern exploits exactly that mechanism: `exec: ['pytest) WebFetch(domain:*']` wraps
 * to `Bash(pytest) WebFetch(domain:*)` -- which the identical depth-tracking closes as `Bash(pytest)`
 * at the first `)`, then re-opens and parses ` WebFetch(domain:*)` as a genuine second rule, granting
 * unrestricted fetch access a `network: 'none'` grant never authorized. This is precisely the same
 * "a crafted pattern's own text closes the real boundary and starts a different one" risk
 * `@forge/adapter-kit/grants`'s own `describeGrant` doc comment already names for a sibling
 * string-building function in this same package family -- found there once already, and reproduced
 * here by the same relaxation this file's own history briefly introduced. Restored to refusing all
 * three characters unconditionally: distinguishing "balanced" from "unbalanced" parens was considered
 * (reject only when a running open/close count ever goes negative or ends nonzero) and rejected as
 * unwarranted complexity in a security-relevant function when this simpler, already-proven-correct
 * check costs only some rare, real commands that happen to contain a literal paren or comma.
 * `SPEC-QUESTIONS.md` Q117 has the full record of both the relaxation and this reversal.
 *
 * An empty pattern is refused too: `''` can never correspond to a real shell command a caller
 * actually meant to grant, and wrapping it as `Bash()` is untested, unconfirmed behaviour this
 * milestone found no reason to rely on.
 */
function safeBashRule(pattern: string): string | undefined {
  if (pattern.length === 0) return undefined;
  if (pattern.includes(')') || pattern.includes('(') || pattern.includes(',')) return undefined;
  return `Bash(${pattern})`;
}

/**
 * `domain:` values are real DNS hostnames (optionally with a real, documented `*` wildcard form,
 * confirmed against the official docs) -- never legitimately containing `(`, `)`, `,`, or the empty
 * string, so refusing all four costs no real host while closing the identical rule-boundary-injection
 * risk `safeBashRule` (above) was found to have reintroduced: a crafted `allowlistHosts` entry like
 * `'evil.com) Bash(*'` would wrap to `WebFetch(domain:evil.com) Bash(*)` -- an unrestricted `Bash`
 * rule smuggled in the exact same way, if this function allowed it.
 *
 * A host that is exactly `'*'` is the degenerate case of the real, documented wildcard (matching
 * every domain, confirmed: `WebFetch(domain:*)` "matches every domain") and is passed through
 * unrefused, granting real, unrestricted fetch access -- the identical "an adapter author granting
 * the wildcard degenerate case is granting the unrestricted case, not some narrower one-character
 * match" reading `@forge/adapter-kit/grants`'s own `isExecAllowed` doc comment already establishes
 * for `exec: ['*']`. Intentional here for the same reason, not a bypass this function should close --
 * an `allowlistHosts` caller who writes `'*'` is choosing that explicitly. Called out because
 * `WebFetch(domain:*)` also differs from a bare `WebFetch` rule in one real way the official docs
 * confirm (only the `domain:` form additionally widens the sandbox's own allowed-domain list) -- a
 * consequence real enough to name, not to silently absorb into "matches everything, same as `full`."
 */
function safeWebFetchDomainRule(host: string): string | undefined {
  if (host.length === 0) return undefined;
  if (host.includes(')') || host.includes('(') || host.includes(',')) return undefined;
  return `WebFetch(domain:${host})`;
}

/**
 * Maps `07` §7.2's own four-field `ToolGrant` onto Claude Code's real tool-name vocabulary. Always
 * returns a real, explicit list — never `undefined` for "omit the flag entirely," since omitting
 * `--allowedTools` lets the platform's own default tool set apply, which is the opposite of fail-
 * closed for a grant that means to deny everything.
 *
 * `network: 'allowlist'` maps to one real `WebFetch(domain:host)` rule per `allowlistHosts` entry --
 * a real, confirmed Claude Code permission-rule syntax P5's own dedicated hardening pass found (not
 * merely assumed absent, the way P2's own original text left it): "WebFetch rules use a `domain:`
 * prefix and match against the hostname of the requested URL," confirmed against the official docs
 * (`code.claude.com/docs/en/permissions`), superseding `SPEC-QUESTIONS.md` Q114's own "no documented
 * per-host scoping syntax was found" note -- see `SPEC-QUESTIONS.md` Q117 for the full record,
 * including the one real fidelity gap this mapping still cannot close: `WebSearch` has no analogous
 * domain-scoped rule form documented anywhere, so `'allowlist'` never grants it at all (fail closed,
 * matching `'none'` for that one tool specifically), and a granted `exec` capability can still reach
 * any host via `curl`/`wget` regardless of this `network` grant -- Claude Code's own docs name this
 * exact caveat directly ("using WebFetch alone doesn't prevent network access. If Bash is allowed,
 * Claude can still use curl, wget, or other tools to reach any URL"), not something this mapping (or
 * any `--allowedTools`-only mechanism) can close without sandboxing, a wholly separate, opt-in
 * Claude Code feature this milestone does not build any support for.
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
  if (grant.network === 'full') {
    tools.push('WebFetch', 'WebSearch');
  } else if (grant.network === 'allowlist') {
    for (const host of grant.allowlistHosts ?? []) {
      const rule = safeWebFetchDomainRule(host);
      if (rule !== undefined) tools.push(rule);
    }
  }
  if (grant.extra !== undefined) tools.push(...grant.extra);
  return tools;
}

const CLI_PERMISSION_MODE_MAP: Readonly<Record<SessionRequest['permissionMode'], string>> = {
  'deny-unlisted': 'dontAsk',
  'accept-edits': 'acceptEdits',
  auto: 'auto',
  // `07` §7.3's own mapping table: "default; requires interactive approval -> engine surfaces
  // prompts." Claude Code's own real `--permission-mode` choices include a literal `manual` value
  // (confirmed against `--help`) that reads as exactly this default, interactive-approval behaviour —
  // passed through rather than omitting the flag, so this session's own mode is always explicit.
  manual: 'manual',
};

/** `07` §7.3's mapping table, CLI column. Real choices confirmed against `--help`: `acceptEdits`,
 * `auto`, `bypassPermissions`, `manual`, `dontAsk`, `plan`. */
export function mapPermissionModeForCli(mode: SessionRequest['permissionMode']): string {
  return CLI_PERMISSION_MODE_MAP[mode];
}

const SDK_PERMISSION_MODE_MAP: Readonly<Record<SessionRequest['permissionMode'], PermissionMode>> =
  {
    'deny-unlisted': 'dontAsk',
    'accept-edits': 'acceptEdits',
    auto: 'auto',
    // The one real value that differs from the CLI transport: the SDK's own real `PermissionMode` type
    // (confirmed against the published package's own `sdk.d.ts`: `'default' | 'acceptEdits' |
    // 'bypassPermissions' | 'plan' | 'dontAsk' | 'auto'`) has no `'manual'` member at all -- `'default'`
    // is its own real spelling for the identical "prompts for dangerous operations" behaviour the CLI
    // calls `manual`.
    manual: 'default',
  };

/** `07` §7.3's mapping table, SDK column. Real choices confirmed against the published
 * `@anthropic-ai/claude-agent-sdk`'s own `PermissionMode` type declaration. Returns the SDK's own real
 * literal union type directly (not a bare `string`, unlike the CLI transport's own equivalent, which
 * has no analogous exported type to narrow to) so `Options.permissionMode` accepts the result without
 * a cast at the call site. */
export function mapPermissionModeForSdk(mode: SessionRequest['permissionMode']): PermissionMode {
  return SDK_PERMISSION_MODE_MAP[mode];
}
