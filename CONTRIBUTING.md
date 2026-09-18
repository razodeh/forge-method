# Contributing to FORGE

FORGE is built against a normative specification pack ([`specs/`](specs/)), using a documented,
adversarial build discipline ([`process/BUILD-PROMPT.md`](process/BUILD-PROMPT.md)) rather than ad
hoc changes. That discipline applies to this repository's own history and is the model for how a
contribution should be made, reviewed, and recorded — you don't have to replicate it in full for a
small fix, but the spirit (spec-grounded, tested, honestly disclosed when something is a real
trade-off) is what every PR is judged against.

## Before you start

1. **Read the relevant spec section(s) first.** If your change touches behavior, find the
   `specs/NN-*.md` file that governs it. [`specs/README.md`](specs/README.md) is the index;
   [`specs/22-build-plan-and-milestones.md`](specs/22-build-plan-and-milestones.md) has the
   milestone-by-milestone build order. **The specs are normative** — where a spec gives an
   interface, schema, or file format, implement it as written.
2. **If your instinct disagrees with the spec, don't silently diverge.** Either implement the spec
   as written, or open an issue/discussion explaining the disagreement before writing code. This
   project's own convention when a real, deliberate divergence is warranted (not a bug — a genuine
   design decision) is to record it in [`process/SPEC-QUESTIONS.md`](process/SPEC-QUESTIONS.md) and,
   if it changes normative text, in the spec file itself, never as an undocumented drift between
   what the spec says and what the code does.
3. **Check [`process/GAUNTLET-LOG.md`](process/GAUNTLET-LOG.md) and
   [`process/SPEC-QUESTIONS.md`](process/SPEC-QUESTIONS.md) first** if you're unsure whether
   something is a known limitation, an already-made decision, or a genuine bug. Both are large,
   searchable, append-only records of exactly this kind of question, going back to the first
   milestone.

## Setting up

```bash
git clone https://github.com/razodeh/forge-method.git
cd forge-method
pnpm install
```

Requires Node ≥ 20.19 and pnpm (see `packageManager` in [`package.json`](package.json) for the exact
version this repo is tested against). The CLI runs directly from source, no build step required for
local development:

```bash
pnpm forge status               # or: node --experimental-strip-types packages/cli/bin/forge.mjs status
```

## The floor — every change must pass this before review

```bash
pnpm typecheck   # tsc --noEmit across every package
pnpm lint        # eslint --max-warnings 0, plus prettier --check
pnpm run boundaries   # enforces the package dependency graph in specs/02 §2.2 — no upward imports
pnpm test        # the full suite, plus coverage ratchets (≥85% lines / 80% branches on changed packages)
```

Run the narrower `node scripts/run-tests.mjs run <path>` while iterating; run the full `pnpm test`
before opening a PR. A few tests are known, accepted, load-sensitive flakes under heavy concurrent
load (real `SIGKILL`-mid-run crash-resume tests, mainly) — if something fails only under full-suite
load and passes cleanly in isolation, it's very likely one of these, not a regression; say so in
your PR rather than chasing it.

## Code conventions this codebase actually enforces

These aren't style preferences — they're checked by the floor above, or by dedicated tests:

- **No `any`, no unexplained `as`, no `@ts-expect-error` without a comment explaining why.** Every
  exported symbol has a precise type.
- **Every error is a typed `ForgeError`** (`@forge/core/errors`) with a `code`, `severity`, and an
  actionable `remedy` — never a bare `throw new Error(...)` in production code, and never an error
  message that states a problem without saying what to do about it.
- **Package boundaries are real and enforced** (`tools/eslint-plugin-forge-boundaries`, checked by
  `pnpm run boundaries`). `specs/02` §2.2 defines who may import whom; `cli` may import everything,
  everything else is a one-directional graph with no cycles. Adding a new cross-package dependency
  edge is a real, deliberate decision — see any of the `Q104`-precedent entries in
  `SPEC-QUESTIONS.md` for how past ones were justified and recorded.
- **Determinism is a feature, not an accident.** Injected clocks, seeded RNG, `TZ=UTC` in tests, no
  reliance on filesystem enumeration order. If your code needs "now," it takes a `Clock` parameter;
  it doesn't call `Date.now()` directly (a lint rule enforces this — see `R10` references throughout
  the codebase and `BLOCKED-P1b.md` for a real, resolved escalation about exactly this class of
  gap).
- **Tests assert behavior against the spec, not the implementation.** A test should still make sense
  if the implementation were deleted and rewritten differently. Failure paths (aborts, timeouts,
  malformed input, crashes) are tested, not just the happy path.
- **No `TODO`, `FIXME`, stub return, or mocked business logic outside test files.** A genuine,
  disclosed gap is recorded in `SPEC-QUESTIONS.md` and surfaced honestly (a real, named error with a
  remedy — see `USR-003`'s many uses across `packages/cli/src/commands/` for the pattern), not a
  silent stub.

[`process/QUALITY-BAR.md`](process/QUALITY-BAR.md) has the full rubric this project holds every
piece to.

## Making a change

1. **Tests first**, written from the spec text, before the implementation — the same order
   `BUILD-PROMPT.md`'s own gauntlet loop uses.
2. Implement against the floor above.
3. **Get a second, genuinely independent review before merging anything non-trivial** — ideally from
   someone who hasn't seen your reasoning, only the diff and the relevant spec section. This
   project's own build process calls this the CRITIC phase: a fresh reviewer with no stake in the
   implementation finds real problems a self-review reliably misses. If you're using an AI coding
   agent to help review, give it the diff and the spec section, not your own explanation of why it's
   correct.
4. If review finds something real, fix it and go again — don't merge on "mostly done."
5. Open a PR. Reference the spec section(s) your change implements or the `SPEC-QUESTIONS.md` entry
   recording the design decision, if either applies.

## Reporting bugs / requesting features

Open a GitHub issue. For a bug, include the exact command, the exact output, and — if you can — the
spec section that says what should have happened instead. For anything security-relevant, see
[`SECURITY.md`](SECURITY.md) instead of opening a public issue.

## Code of Conduct

This project follows the [Contributor Covenant](CODE_OF_CONDUCT.md). Participation implies agreement
to it.
