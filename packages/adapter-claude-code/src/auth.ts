/**
 * `probeAuthAvailability` — two independent, real credential facts this environment may have, not a
 * mutually-exclusive mode. Confirmed directly against the real, installed `claude` CLI's own
 * `--help` text (`--bare`'s own description: "Anthropic auth is strictly `ANTHROPIC_API_KEY` or
 * `apiKeyHelper`... OAuth and keychain are never read") and `claude auth status --json`'s own real
 * output shape, rather than assumed from `07` §7.3's prose alone.
 *
 * @see specs/07 §7.3
 * @see SPEC-QUESTIONS.md Q113
 * @see PLAN-M7.md P1
 */
import { realClaudeCliRunner, type ClaudeCliRunner } from './process.ts';

/**
 * `ANTHROPIC_API_KEY` is the one credential the real, installed CLI's own `--help` text names
 * explicitly and unambiguously ("Anthropic auth is strictly `ANTHROPIC_API_KEY` or `apiKeyHelper`").
 * The same text also says bare mode's 3P providers "(Bedrock/Vertex/Foundry) use their own
 * credentials" but names no specific env var for any of the three, and this milestone has no
 * confirmed, grounded source for their exact names (checking would mean guessing at AWS/GCP/Azure
 * credential conventions Claude Code itself may or may not follow) — recorded honestly as a real gap
 * in `SPEC-QUESTIONS.md` Q113 rather than shipping unconfirmed env var names that could produce a
 * false `apiKey: true` for a provider that was never actually configured correctly. A caller with a
 * real Bedrock/Vertex/Foundry setup should pass a config override once this gap is closed.
 */
const API_KEY_ENV_VARS = ['ANTHROPIC_API_KEY'] as const;

export interface AuthAvailability {
  readonly apiKey: boolean;
  readonly subscription: boolean;
}

function hasApiKeyCredential(env: Readonly<Record<string, string>>): boolean {
  return API_KEY_ENV_VARS.some((name) => {
    const value = env[name];
    return value !== undefined && value.length > 0;
  });
}

/**
 * Runs `claude auth status --json` and reads only the real, real-time boolean `loggedIn` field. Never
 * reads or returns `email`/`orgId`/`orgName`/any other field the real command's own output carries —
 * those identify a real person's account and have no reason to be captured anywhere this build
 * writes to disk or logs. Never throws: a missing binary, a non-zero exit, or unparseable JSON all
 * resolve to `false` (a real absence of ambient login, not a crash).
 */
async function probeSubscriptionLogin(
  env: Readonly<Record<string, string>>,
  runner: ClaudeCliRunner,
): Promise<boolean> {
  const result = await runner(['auth', 'status', '--json'], env);
  if (result.exitCode !== 0) return false;
  try {
    const parsed: unknown = JSON.parse(result.stdout);
    return (
      typeof parsed === 'object' &&
      parsed !== null &&
      'loggedIn' in parsed &&
      parsed.loggedIn === true
    );
  } catch {
    return false;
  }
}

/**
 * Both facts are checked independently and unconditionally — this probe makes no live API call and
 * costs nothing (`claude auth status` reads local session state; it does not call the model), so
 * unlike every conformance/live-smoke test this milestone gates behind `FORGE_LIVE`, this one runs in
 * every ordinary test run.
 */
export async function probeAuthAvailability(
  env: Readonly<Record<string, string>>,
  runner: ClaudeCliRunner = realClaudeCliRunner,
): Promise<AuthAvailability> {
  const apiKey = hasApiKeyCredential(env);
  const subscription = await probeSubscriptionLogin(env, runner);
  return { apiKey, subscription };
}
