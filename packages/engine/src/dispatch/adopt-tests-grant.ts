/**
 * The adopt-tests agent session's own exec grant (`specs/22` M17 P7, `13` F-TEST-11's own "Runs the
 * tests in its lane (exec grant limited to the commands it proposes)").
 *
 * **Why this cannot be `deriveTestExec`/`grantWithTestExec` (`test-command-grant.ts`) again.** That
 * mechanism derives an exact, additive exec pattern from `execution.testCommands.<layer>` — the
 * project's own, already-committed, live config. The whole point of `adopt-tests` is that no such
 * entry exists yet: the agent is INVESTIGATING what it should be, and the plan text's own "the
 * commands it proposes" cannot literally mean "grant it whatever free-text string it writes after the
 * fact" — nothing could compute a grant from a value that does not exist until the very session the
 * grant must already be attached to has started (`20` §20.1's own permission model: the step grant is
 * fixed before a session starts, never renegotiated mid-session from the model's own output, which
 * would make the allowlist meaningless — the model could "propose" anything and be granted it).
 *
 * **DECISION (specs/22 M17 P7): a bounded, static, reviewable allowlist of CONVENTIONAL test-runner
 * invocations, not a dynamic grant.** The agent does not get an unbounded exec grant; it gets exactly
 * the invocation shapes a real test-adoption investigation plausibly needs — the same ecosystems
 * `detect.ts` already recognises deterministically (vitest/jest/mocha/node's built-in runner, pytest,
 * `go test`, phpunit), the generic script runners most projects' own `package.json`/`Makefile`
 * delegate to (`npm test`, `pnpm test`, `make test`, ...), the "no built-in parser" ecosystems `detect.ts`
 * hands off by name (cargo, dotnet, Ruby's two mainstream runners), and the read-only investigation
 * commands every other role already gets (`ls*`/`rg*`/`cat*`/`find*`/`git log*`/`git diff*`). The agent
 * "proposes" in the sense that it CHOOSES and parameterises among these fixed, anchored verbs — never
 * in the sense of being granted an arbitrary string. Every pattern is either an exact command or has
 * exactly one trailing `*` (`20` §20.1's own "patterns are anchored" rule; `matchesExecPattern`,
 * `@forge/adapter-kit/grants`, treats a trailing `*` as a prefix match and nothing else as a wildcard
 * at all), so nothing here can chain, redirect, or expand past the one program it names — the hard
 * denylist (`isHardDenylisted`) and the rest of `isExecAllowed`'s own fail-closed checks still apply on
 * top of this list exactly as they do for every other agent's own declared patterns.
 *
 * **Deliberately not threaded through `assembleAgentSession`/`grantWithTestExec`'s own call site** —
 * unlike that mechanism (used by every `kind: agent` step in the compiled workflow DAG), this one has
 * exactly one caller (`@forge/cli`'s `commands/loop/test/adopt-agent.ts`, the hand-built, ad hoc
 * `forge test adopt --agent` dispatch — the same "`forge debug`/`review`/`panel` call a real mechanism
 * directly rather than through the compiled DAG" precedent `ad-hoc-step.ts` already establishes). Union
 * it onto `AssembledSession.tools` yourself after calling `assembleAgentSession`, the identical shape
 * `grantWithTestExec` already has (own patterns first, then the added ones, no duplicates, `exec: false`
 * stays `false`).
 *
 * **Courtesy scoping, not the only gate — lane isolation is (revised again, a THIRD critic round).**
 * This list governs the live session's own in-turn tool calls (what the fake adapter's
 * `execAttempts`, and a real adapter's own tool-use channel, check against). A SECOND critic round
 * proved that no version of this list, however carefully pruned, can be the thing standing between a
 * live, in-turn command and the real project: widening it for real framework coverage (below) let
 * `make -f /tmp/evil.mk pwn`, `./gradlew --init-script=/tmp/evil.gradle tasks`,
 * `./mvnw -f /tmp/evil-pom.xml package`, and the `rake` equivalent all through — the identical
 * "pattern cannot express this verb, without this dangerous flag" problem dropping `find*` (below) was
 * supposed to have already closed, just through different verbs. There is no narrower pattern that
 * keeps `make <target>` while refusing `make -f <anything>`: a trailing `*` is a plain prefix match,
 * nothing else. The real fix is not a third revision of this list — it is that `adopt-agent.ts`'s own
 * session now runs the WHOLE investigation/exec phase inside a fresh, disposable lane worktree (its
 * own top doc comment, "Each round runs in its own, fresh, disposable lane worktree"), the identical
 * guarantee every other agent role in this codebase already gets: the adapter-kit conformance suite
 * (C2/C4) requires a real `PlatformAdapter` to confine a session's own live exec to `cwd`, so whatever
 * a live command does — however dangerous its shape — only ever touches that lane's own disposable
 * checkout. This list's real job, now, is what finding #7 originally wanted of it: reasonable,
 * reviewable scoping for what a genuine investigation plausibly needs, not a security boundary no
 * fixed pattern list could ever actually be. The SEPARATE, FINAL `command.run`/`.translate` the
 * session reports in its structured JSON response is still independently re-vetted against this exact
 * list (`adopt-agent.ts`'s own `vetProposedTestCommand`, before `runTranslatorProof` ever executes
 * either) — that check is sound against this exact exploit class (confirmed directly, both critic
 * rounds agree) because it is FORGE's own later, separate execution of a model's STRUCTURED OUTPUT,
 * never a live tool call the lane's own `cwd` already confines — a different gap than the live-exec
 * one above, closed a different way, and the reason this list still exists and still matters even
 * though it is no longer the live-exec boundary.
 *
 * **Why `find*` is still dropped outright, not merely narrowed.** A first critic round proved live
 * that `find*` lets `-exec`/`-delete` through with no shell metacharacter at all
 * (`isExecAllowed(grant, 'find / -maxdepth 2 -exec rm -rf {} +')` returns `true`). Lane isolation
 * (above) would absorb a LIVE use of it the identical way it now absorbs `make -f`/`gradlew
 * --init-script`, but there was never a genuine investigation need for `find` specifically (`ls*`/
 * `rg*`/`cat*`/`tree*`/`git log*`/`git diff*`/`git show*` already cover it) — dropping a pattern with
 * no real use and an easy destructive reading remains the right default even once lane isolation
 * backs everything else, the same "least privilege where there is no cost to it" reasoning that keeps
 * this an allowlist of CONVENTIONAL invocations rather than "whatever is now safe to grant."
 *
 * **Widened for real investigation coverage (second critic round).** The original ~25 fixed patterns
 * were both too dangerous (`find*`, above) AND too narrow: a real Django project's own conventional
 * `python manage.py test` could never be investigated OR proposed at all, regardless of how well the
 * agent read the project, because no pattern here covered it — a genuine, project-shaped command, not
 * a hostile one, refused by construction. Three kinds of addition close that: (1) more NAMED framework
 * entrypoints (Django, Laravel) exactly the way `pytest`/`phpunit` already are; (2) `make <anything>`/
 * `rake <anything>` widened from `make test*`/`rake test*` to every target/task — a Makefile/Rakefile
 * recipe is the PROJECT's own, already-committed, human-authored text, so the only thing the agent
 * chooses is which already-defined name to run, the identical "it is what the project configured, not
 * what the model invented" trust `test-command-grant.ts`'s own derived patterns already rely on — a
 * trust that turned out not to extend to an attacker-supplied `-f <path>` naming a DIFFERENT recipe
 * entirely, which is exactly what the third critic round above found and lane isolation, not a
 * narrower pattern, actually closes; (3) `.forge/test-translators/<ext>` invocations (one per
 * interpreter) for `command.translate` itself — safe because that directory is where
 * `copyTranslatorIntoProject` (`adopt-agent.ts`) only ever copies ONE validated file FROM, by name,
 * once a round's proof has passed; nothing a live command plants under it inside a round's own
 * disposable lane ever reaches the real project on that basis alone. A genuinely unconventional
 * in-house runner this list still does not name is the one real, disclosed residual gap: the brief's
 * own point 3 already tells the agent to say so in its `reason` rather than silently substitute
 * something else, the identical hand-off `detect.ts` gives a human for the same shape of gap.
 */
import type { ToolGrant } from '@forge/adapter-kit';

export const ADOPT_TESTS_EXEC_PATTERNS: readonly string[] = [
  // Read-only investigation (`05` §5.3's own baseline shape for every role) — `find*` deliberately
  // dropped, not merely narrowed; see this file's own doc comment.
  'ls*',
  'rg*',
  'cat*',
  'tree*',
  'git log*',
  'git diff*',
  'git show*',
  // JavaScript/TypeScript (`detect.ts`'s own `vitestCommand`/`jestCommand`/`mochaCommand`/
  // `nodeTestCommand`, plus the generic script-runner invocations most manifests delegate through).
  'npx vitest*',
  'npx jest*',
  'npx mocha*',
  'node --test*',
  'npm test*',
  'npm run test*',
  'pnpm test*',
  'pnpm run test*',
  'yarn test*',
  'yarn run test*',
  // Python (`detect.ts`'s own `pytestCommand`, plus Django's own conventional entrypoint).
  'pytest*',
  'python -m pytest*',
  'python3 -m pytest*',
  'python manage.py test*',
  'python3 manage.py test*',
  './manage.py test*',
  // Go (`detect.ts`'s own `goTestCommand`).
  'go test*',
  // PHP (`detect.ts`'s own `phpunitCommand`, plus Laravel's own conventional entrypoint).
  'phpunit*',
  './vendor/bin/phpunit*',
  'php artisan test*',
  './artisan test*',
  // Generic, project-defined recipes (Makefile-only and polyglot-monorepo hand-offs, `detect.ts`'s own
  // `'makefile-only'`/`'workspace-no-root-command'` ecosystems) — every TARGET, not only `test`: the
  // recipe body is the project's own committed text, never the agent's (this file's own doc comment).
  'make *',
  'rake *',
  // Recognised-by-name, no-built-in-parser hand-offs (`detect.ts`'s own doc comment names exactly
  // these three): the agent may still run one to see real output before deciding a translator is
  // needed. Java/Kotlin's own conventional build-wrapper invocation (`specs/15` §15.11's own worked
  // example already grants this exact pattern, `"./gradlew *"`, to a comparable module role).
  'cargo test*',
  'dotnet test*',
  'bundle exec rspec*',
  'rspec*',
  './gradlew *',
  './mvnw *',
  // The agent's own translator, once written — one pattern per interpreter it may reasonably be
  // written in (this file's own brief: "Node by default, or the project's own language"). Safe only
  // because `.forge/test-translators/` is the agent's own sole write claim; see this file's own doc
  // comment.
  'node .forge/test-translators/*',
  'python .forge/test-translators/*',
  'python3 .forge/test-translators/*',
  'ruby .forge/test-translators/*',
  'php .forge/test-translators/*',
];

/**
 * `grant` with `ADOPT_TESTS_EXEC_PATTERNS` added to its exec patterns — the identical shape
 * `grantWithTestExec` already gives `execution.testCommands`-derived patterns: the agent's own
 * declared patterns are kept, in order, with the allowlist appended and no pattern repeated; an agent
 * whose resolved grant allows no commands at all (`exec: false`) is never handed one.
 */
export function grantWithAdoptTestsExec(grant: ToolGrant): ToolGrant {
  if (grant.exec === false) return grant;
  const own = grant.exec;
  return {
    ...grant,
    exec: [...own, ...ADOPT_TESTS_EXEC_PATTERNS.filter((pattern) => !own.includes(pattern))],
  };
}
