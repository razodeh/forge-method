# M13 agent notes — standing process rules for every piece

Read this file in full before starting any M13 piece. Every rule below exists because ignoring it
caused real stalls or damage earlier in this milestone. The piece's own brief (from the
orchestrator) says what to build; this file says how to work.

## The loop (from `process/BUILD-PROMPT.md`, read that too)

BUILD tests-first from the spec text, then dispatch a **fresh, context-free critic subagent**
(general-purpose, no access to your rationale) to review your diff, JUDGE its findings (fix real
ones; disclose-and-defer only genuinely out-of-scope ones), LOOP with re-verification until a round
finds nothing new or you reach **3 rounds** (if genuinely stuck, write `BLOCKED-<PIECE>-M13.md` at
the repo root and stop; do not guess past it), then the two-commit pattern, then LOG. Do not grade
your own work. Point critics at what can go wrong in _this_ piece: vacuous passes, fail-open paths,
contradictions with the specs, stale generated copies, tests adjusted to pass rather than to be
right.

## Commands and cost

1. You **cannot receive background-task notifications**. Never use `run_in_background` or `Monitor`.
   Run every test/typecheck/boundaries/lint command as a synchronous Bash call with an explicit
   large `timeout` (250000-500000 ms). Tests run via `node scripts/run-tests.mjs run <paths>` (never
   bare vitest).
2. **Do not run the full unscoped suite** (owner-approved cost cut; the API budget has been hit
   repeatedly). Run scoped, but broad enough for what you touch: everything under any package
   directory you change, the tests that mention what you changed (grep), and the root `test/` files
   that enumerate workflows, agents or gates (`agent-prompts-all-workflows`,
   `output-contract-known-gaps`, `workflows`, `build-stage-compiles`, `workspace-floor`,
   `fm-*-workflow`, `live-smoke`, `determinism`), plus `pnpm typecheck`, `pnpm run boundaries`,
   `pnpm lint`. The orchestrator runs the one full-suite check at the end. State the scoping in your
   Q entry and log entry.
3. Known load-sensitive flakes (pass in isolation; do not chase):
   `engine/test/e2e/crash-resume.test.ts`, `scripts/verify-success-criteria.test.ts` (SC3),
   `kb/test/adopt/survey.test.ts`, `cli/test/commands/run/resume.test.ts`,
   `engine/test/interaction/session.test.ts`, `tui/test/*`, `run-upgrade.test.ts` idempotency,
   `upgrade/backup.test.ts`. `pnpm lint` exits 1 on 4 pre-existing prettier warnings
   (`cli/src/commands/overlay.ts`, `cli/test/commands/overlay.test.ts`,
   `cli/test/commands/doctor/{corrupt-state,rebuild-index}.test.ts`); anything else is yours.
4. **No live model session, no API key.** Every test uses the fake/testkit adapter, which enforces a
   strict nine-block prompt (do not opt out). The owner's key lives in the gitignored `.env`; never
   read, print or copy it. Live runs are the orchestrator's job.

## Shared working tree (several agents work concurrently)

5. Before every commit: `git status --short`; `git add` **exact files** only (never `-A` / `.`);
   never commit, stash, revert or reformat another agent's files; isolate your hunks of shared files
   (`process/*.md`, `packages/core/src/errors/codes.ts`, `packages/cli/src/bin.ts`, engine
   `dispatch/steps.ts`, test helpers) with a hand-built patch (`git diff -- f > x.patch`, edit,
   `git apply --cached`). Never `git checkout`, `git restore` or `git stash` a file another agent
   has dirty.
6. Always re-read a file immediately before editing it; use small targeted Edits, never whole-file
   rewrites of shared files. Only `npx prettier --write` files you own; never blanket-run prettier.
7. **Never write a helper script that opens a file for writing before reading it** (an agent once
   emptied 19 files that way). Read, transform, write; check `git diff --stat` afterwards. Use
   quoted heredoc delimiters (`<<'EOF'`) so the shell does not execute backticks.
8. If a concurrent agent's in-flight change breaks something you run, prove your own files pass (a
   clean `git worktree` of HEAD plus your hunks works) and say so in your report; do not fix theirs.
9. **Never run `forge init` with the repo as cwd.** Use temp dirs (`mktemp -d` or the scratchpad)
   and set cwd or pass `-C <tmpdir>` (which works since P12). If stray `.forge/`, `FORGE.md`,
   `docs/forge/` appear in the repo root, delete them before committing.
10. The tool layer may rewrite `\uXXXX` escapes inside commands into literal characters. If a regex
    or string in a file gains raw control or format characters, convert them back to escapes.

## Records

11. Every real decision goes in `process/SPEC-QUESTIONS.md` as a new `## Q<n> — M13 P<x>: ...` entry
    (append; never rewrite history). Next free number:
    `grep -n "^## Q2" process/SPEC-QUESTIONS.md | tail -4`; re-check immediately before your docs
    commit (other agents add entries; use the next free number that is not reserved for someone else
    in your brief).
12. Two commits: the work (`feat|fix|test|docs(scope): ... (M13 P<x>, <spec refs>, 22 M13)`), then
    `docs: record M13 P<x> in the gauntlet log (Q<n>)` adding `## M13 P<x> — <title>` to
    `process/GAUNTLET-LOG.md` (heading exactly that shape) and the Q entry. Both end with:

    ```
    Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
    Claude-Session: https://claude.ai/code/session_01BTkpkz1xaBgdu2RU1aiLpU
    ```

13. If you change a normative spec (`specs/*.md`), quote the changed text in the Q entry and keep
    the edit to what the piece's brief authorises. `05` §5.5's operating-contract text is compared
    word for word by a test and is given to every agent: do not reword it.

14. **Verify the COMMIT, not the working tree.** Several pieces committed only their own hunks of
    shared files (`bin.ts`, `steps.ts`, `assemble.ts`, ...). Their working tree, which also held
    other agents' uncommitted edits, still typechecked and passed, while the commit itself did not:
    P25's commit left `packages/cli/src/bin.ts` with 18 syntax errors that nothing caught until HEAD
    was checked out clean. Before you report, and again after any commit that isolated hunks:
    `git worktree add <scratch>/wt-<piece> HEAD` (scratch dir, never inside the repo),
    `pnpm install --offline --frozen-lockfile` there (about 5 seconds), then run `pnpm typecheck`
    and your piece's key tests IN THAT WORKTREE. If it fails, fix the commit (rebuild the hunks; add
    a follow-up commit if needed). Remove the worktree afterwards
    (`git worktree remove --force <path>`). Prefer building hand-isolated hunks by editing the clean
    worktree file and committing there, rather than `git apply --unidiff-zero` against a dirty tree.

## Failure handling

14. If macOS returns `Operation not permitted` on the project directory, stop and report exactly
    what was and was not saved. If you hit a spend-limit error the orchestrator resumes you: on
    resume, re-check `git status` and your uncommitted files first (a cutoff can leave an edit
    half-applied), run `pnpm typecheck`, and re-dispatch any critic that died with the cutoff.

## Your report

Report back once both commits exist: hashes; what you built and the root cause where you fixed a
bug; each critic round's findings and how you resolved them; the mutation/revert evidence where the
brief asks for it; scoped verification results; decisions; and anything you found but did not fix
(the orchestrator turns those into pieces).
