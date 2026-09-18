# Claude Code build prompt — FORGE (gauntlet loop)

Paste everything below the line into Claude Code at the repo root, with the spec pack at `./specs/`.

---

You are building **FORGE** from the specification pack in `./specs/`. Read `specs/README.md` first,
then `specs/22-build-plan-and-milestones.md` for order. The specs are normative: where a spec gives
an interface, schema, or file format, implement it as written.

You will not write this codebase in one pass. You will run a **gauntlet loop**: set a bar, cut the
work into small judgeable pieces, build each piece, attack it with a separate critic, judge it blind
against the bar, and loop until it wins. Nothing merges until it wins.

## Step 0 — Set the bar (do this once, before any code)

Write `QUALITY-BAR.md` at the repo root containing:

1. **Three named exemplars** — real, installable TypeScript CLI/monorepo projects whose code you
   consider the standard for this category. Pick ones you can actually inspect. For each, name the
   two specific properties you are trying to match (e.g. error messages that state the remedy,
   zero-`any` public surfaces, tests that read as executable specifications).
2. **A rubric of 8–12 binary criteria**, each phrased so a hostile reader can answer yes/no without
   knowing who wrote the code. No criterion may be satisfiable by opinion alone. Include at minimum:
   - Every exported symbol has a precise type; no `any`, no unexplained `as`, no `@ts-expect-error`
     without a linked issue.
   - Every error is a typed `ForgeError` with `code`, `severity`, and an actionable `remedy`.
   - Every module boundary in `specs/02` §2.2 is respected; no upward imports.
   - Tests assert behaviour against the spec, not the implementation; deleting the implementation
     and rewriting it differently keeps the tests valid.
   - Failure paths are tested, not just happy paths: aborts, timeouts, crashes, malformed input.
   - No `TODO`, `FIXME`, stub return, or mocked business logic outside test files.
   - Public API has doc comments explaining *why*, not restating the signature.
   - The piece is resumable/idempotent where the spec requires it, with a test proving it.
3. **The floor** — the deterministic checks that must pass before anything is even judged:
   `pnpm typecheck && pnpm lint && pnpm test && pnpm boundaries` plus coverage ≥ 85% lines / 80%
   branches on changed packages.

Show me `QUALITY-BAR.md` and stop. Do not start building until I approve it.

## Step 1 — Cut the work

Take the next milestone from `specs/22`. Split it into **pieces of at most ~400 lines of production
code each**, where a piece is independently judgeable: it has its own public surface, its own tests,
and a one-sentence statement of what it must do. Write the list to `PLAN-<milestone>.md` with, per
piece: the spec sections it implements, its public surface, its acceptance checks, and its
dependencies on other pieces. Order them so dependencies come first.

If a piece cannot be judged without another piece existing, it is too small — merge it. If it needs
more than ~400 lines, split it.

## Step 2 — The gauntlet, per piece

For each piece, in order:

**Round N, phase BUILD.** Implement the piece to the spec. Write the tests first, from the spec text,
before the implementation. Run the floor checks. Do not proceed while any floor check fails.

**Phase CRITIC.** Launch a *separate subagent* with this instruction, and give it only the diff, the
relevant spec sections, and `QUALITY-BAR.md` — **not** your reasoning, not your commit message, not
your explanation of why a shortcut was acceptable:

> You are a hostile staff engineer reviewing this change for a codebase you will have to maintain
> for five years. Assume it is worse than it looks. Find every place where it violates the rubric,
> diverges from the spec, hides a failure mode, or will break under concurrency, crash, malformed
> input, or a hostile user. For each finding give: severity (blocking/major/minor), the exact
> location, the concrete failure it causes, and the test that would catch it. Do not praise
> anything. If you find fewer than three blocking or major issues, say explicitly why the code is
> genuinely clean rather than padding the list.

**Phase JUDGE.** Score the piece against every rubric criterion in `QUALITY-BAR.md` as yes/no with
the evidence line. Judge the *artifact*, not the effort: you may not credit intent, difficulty, or
"this is fine for now". Any `no` = the piece loses.

**Phase LOOP.** If it lost: fix the specific findings, then run BUILD → CRITIC → JUDGE again with a
*fresh* critic subagent. Repeat until every criterion is `yes` and the critic's blocking and major
lists are empty.

**Escalation.** If a piece fails three full rounds, stop looping. Write `BLOCKED-<piece>.md` stating
what the bar demands, what you produced, why the gap persists, and the two options you see — then
ask me. Do not lower the bar, do not weaken a test, do not relax a threshold, and do not mark it
done. Silently reducing scope to pass is the one failure mode I will not forgive.

## Step 3 — Commit and report

When a piece wins: one conventional commit, message naming the spec sections implemented. Then
append to `GAUNTLET-LOG.md`: piece name, rounds taken, the blocking findings from each round, and
what the critic caught that you missed. This log is how I learn whether the bar is calibrated — do
not sanitise it.

At the end of each milestone, run the milestone's exit tests from `specs/22` and report pass/fail
per criterion, with the command output.

## Standing rules

- **Specs win.** If your instinct disagrees with a spec, implement the spec and record the
  disagreement in `SPEC-QUESTIONS.md`. Do not quietly improve on it.
- **Ambiguity is a question, not a guess.** If a spec is silent on something that matters, add it to
  `SPEC-QUESTIONS.md` with your recommended answer and proceed with that answer, clearly marked.
- **Never edit a test to make it pass.** If a test is wrong, say so explicitly, explain why, and get
  agreement before touching it.
- **The critic is never the builder.** Always a fresh subagent, always without your rationale.
- **No scaffolding for its own sake.** Do not build packages the current milestone doesn't need.
- Work through milestones in order. After each, stop and show me the report before continuing.

Start with Step 0.
