# Getting started with FORGE

This is a real, step-by-step walkthrough. Every command below was run against the actual, current
`forge` CLI while writing this document — none of it is aspirational. Two genuine defects this guide
originally disclosed (a `workflow validate --all` finding and a `spec new` type-coverage gap) have
since been fixed; where a natural next step would still need a command that isn't wired into the CLI
yet, this guide says so explicitly rather than silently showing you a clean run that doesn't match
reality.

## 0. What you need

- **Node.js ≥ 20.19** and **pnpm** (this repository's own floor — `package.json`'s `engines` field).
- **git ≥ 2.30** (worktree support — FORGE uses git worktrees for parallel lanes).
- **A platform adapter.** Today that means the [Claude Code CLI](https://claude.com/claude-code)
  installed and on `PATH`. `forge init` runs Claude Code in **bare mode** by default (`07` §7.3),
  which intentionally ignores your personal `CLAUDE.md`/hooks/OAuth login for reproducibility —
  which means it needs `ANTHROPIC_API_KEY` (or a Bedrock/Vertex/Foundry credential) set in your
  environment, not just an interactive `claude auth login`. `forge doctor` (step 3 below) tells you
  exactly what's missing if anything is.

**A note on Windows, honestly.** `git`/`node`/`pnpm` install/build/typecheck/lint, and a project's
own lane/integration worktrees (`worktreesRootFor`, section 14 below) already resolve a real Windows
cache path (`%LOCALAPPDATA%`, falling back to `~/AppData/Local`) — this is real, not aspirational.
What is NOT yet true: FORGE's own CI runs a Windows leg in the matrix, but has not been confirmed
green there end to end (`pnpm test`'s own 45-minute ceiling has repeatedly been hit before a
conclusive pass or fail on `ubuntu-latest`/`windows-latest`, independent of any Windows-specific
defect); the shared observation step both `forge parity capture` and `forge parity check` go through
(`observeParityDeclaration`, `packages/cli/src/commands/parity/observe.ts`) refuses outright on
`win32` today (`ENV-007`) rather than running with a weaker guarantee, since its own single-quote
shell-escaping defence is not safe to trust on Windows' argument-quoting rules; and a timed-out or
aborted command on `win32` kills only the single top-level process, never its descendants
(`packages/engine/src/dispatch/shell.ts`), since `taskkill`-based process-tree teardown is not wired
yet. None of this is quietly assumed fixed — it is a tracked, not-yet-landed gap
(`process/plans/PLAN-M17.md` P16, deliberately deferred this milestone pending real GitHub Windows
CI and push authorization), not a silent one.

FORGE has not yet had its first real npm publish (the changesets release pipeline — `specs/22` M12 —
is built and ready, but running it is a real, separate action nobody has taken yet), so every
command below is run from a checkout of this repository, either via the `pnpm forge` script alias or
directly:

```bash
pnpm install
node --experimental-strip-types packages/cli/bin/forge.mjs <command>
# equivalently, from the repo root only: pnpm forge <command>
```

The rest of this guide writes just `forge <command>` — substitute whichever of the two forms you're
using.

## 1. Check your environment first

Before touching a real project, ask FORGE whether your machine is ready. Run this from _inside_ an
already-initialized project (step 2 creates one) — `forge doctor` is safe to re-run any time:

```bash
forge doctor
```

Typical output (abridged):

```
ok node-version: Node v22.14.0 satisfies the 20.10.0 floor.
ok package-manager-pnpm: pnpm 9.15.5 found on PATH.
ok git-version: git version 2.39.5 satisfies the 2.30 worktree-support floor.
ok platform-adapter: Platform adapter preflight passed (version 2.1.270).
ok config-validity: .forge/config.yaml is real and schema-valid.
...
```

If `platform-adapter` fails, the message names the exact remedy (install Claude Code, or set
`ANTHROPIC_API_KEY`). Fix that before continuing — every later step that touches a real agent
session needs it. `forge doctor` also accepts `--fix` (apply safe automatic fixes) and
`--rebuild-index` (rebuild the KB search index), and `--json` for machine-readable output.

## 2. Initialize a project

`forge init` needs `--name` and `--yes` (non-interactive; there is no interactive prompt flow wired
into this CLI yet, so `--yes` is effectively required):

```bash
mkdir my-project && cd my-project
ANTHROPIC_API_KEY=<your key> forge init --name "My Project" --level L0 --yes
```

`--level` picks how much process the project gets (`L0` patch … `L4` platform — see
[`docs/method-guide.md`](method-guide.md#scale-adaptive-levels)); omit it and FORGE proposes one
from the idea text you'd give it in guided mode. A successful run prints:

```
forge init: wrote 166 files to /path/to/my-project (level L0, platform claude-code).
```

This writes `.forge/` (resolved agents, workflows, gates, config, manifest), `docs/forge/kb/` (an
empty Knowledge Body, ready to grow), and `docs/forge/specs/` (empty until you add specs).
Re-running `forge init` on the same directory is safe — it detects the existing project and
regenerates the resolved set instead of failing.

Other useful `init` flags: `--modules web,service` (comma-separated module ids),
`--preset startup-lean`, `--platform claude-code` (explicit adapter selection instead of
auto-detected). `git init` runs by default whenever the directory isn't already a git repo —
`--git-init` is currently a no-op (there's no flag yet to opt _out_), confirmed directly against the
real `runInit`/`ensureGit` source rather than assumed from the flag's own name.

## 3. Look around

With nothing authored yet, most listings are legitimately empty — that's expected for a brand-new
project, not a bug:

```bash
forge kb list      # (empty — no KB entries yet)
forge spec list    # (empty — no specs yet)
forge gate list    # G-Deliver, G-Design, G-Foundation, G-Integration, G-Operate, G-Problem,
                    # G-Product, G-Ready, G-Stable, G-Verify — the ten gates fm-core ships
forge skill list    # the built-in skill library materialized into your project
```

Both validators come back clean on a fresh project. They do real work: FORGE checks that every
workflow step's `brief:`, every gate's `brief:` and every agent's `prompt.system`/`prompt.briefs.*`
resolves to a real, non-empty file under `.forge/briefs/` / `.forge/prompts/`, and `forge init`
materializes the shipped briefs and prompts there.

```bash
forge agent validate --all      # forge agent validate --all: no real findings.
forge workflow validate --all   # forge workflow validate --all: no real issues.
```

A missing or empty brief or prompt file shows up here as `unknown-prompt` / `unknown-brief`, so
these two commands are what to run after you edit or add an agent, workflow or gate.

## 4. Author your first spec artifact

```bash
forge spec new Vision "My Project Vision"
```

prints `forge spec new Vision: wrote docs/forge/specs/vision.md.` `spec new` recognises eight type
names (`Vision`, `Capability`, `NFR`, `Epic`, `Story`, `Task`, `InterfaceContract`, `DataModel` —
case-sensitive), and all eight now work through this CLI (`Story`/`InterfaceContract`/`DataModel`
derive their own path-template `slug`/`name` placeholder from `<title>` automatically; a fix, not a
new feature — an earlier revision of this guide disclosed those three as broken). Then:

```bash
forge spec list       # VIS-001 Vision My Project Vision
forge spec validate    # "forge spec validate: no real problems."
```

`forge spec validate` runs the full two-phase document + graph check (required edges, cycles).
There's also a narrower, gate-shelled form, `forge spec validate --rule <name>`, used internally by
the gate YAML files rather than by a human at the terminal.

## 5. See what a workflow would do, without running it

FORGE ships real workflows (`.forge/workflows/*.workflow.yaml`) that drive agent sessions through a
DAG of steps. `--dry-run` compiles the DAG and reports the plan without starting any agent session
or spending anything:

```bash
forge run discover --dry-run
# forge run discover --dry-run: compiled 5 steps.
```

A workflow that needs a value to run says so, and takes it as a flag. `--stage <id>` also supplies
`stageId`, `--story <id>` also supplies `storyId`, and `--input <name>=<value>` (repeat it for more
than one) supplies anything else the workflow declares under `inputs:`:

```bash
forge run build-stage --stage mvp --dry-run       # the stage's stories, in dependency order
forge run plan-stage --stage mvp --dry-run
forge run implement-story --story STORY-001 --dry-run   # owner role and file claim come from the Story
forge run quick-fix --input defectId=DEF-001 --dry-run
forge run debug --input defectId=DEF-001 --dry-run
forge run refactor --input goal="Split the billing module" --dry-run
```

Left out, the run is refused before anything starts, naming the input and how to supply it
(`Workflow quick-fix needs run input(s) that were not supplied: defectId.` and the remedy
`Pass each with --input <name>=<value>`). A value must be a plain token (letters, digits and
`. _ - / : @ + ,`, not starting with `-`) when the workflow puts it in a shell command, as it does
for a stage id, a story id or a build target; `--input ownerRole=` may not contradict the Story's
own `owner_role`, and a story owned by `sdet` or `reviewer` is refused (the tests or the review and
the implementation would share one role). `build-stage` reads the stage's Epics and Stories from
`docs/forge/specs` (the same reader `forge plan run-plan <stage>` uses), so the stage must exist:
run `plan-stage` first, or `--stage` is refused with `RUN-082`. It also refuses a stage with a
blocked story, or with no story left to build (`RUN-090`), and orders the stories exactly as
`forge plan run-plan` shows; `implement-story` (and `forge implement`) refuse a blocked or already
delivered story. Workflows with no declared inputs (`discover`, `define-product`,
`initialize-project`, `intake`, `shape-solution`, `verify-stage`, `deliver-stage`, `plan-stages`,
`harden`, `operate`, `retro`, `adopt`) dry-run standalone. Under `--json` a refusal raised as a
coded error (a dirty tree, a missing input, an unknown stage; from `run`, `implement`, `plan` and
the rest) also prints one line, `{"v":1,"ok":false,"error":{"code","message","remedy","exitCode"}}`,
on stdout; stderr and the exit code are the same as without it. A command that prints its own usage
message (for example `forge story verify` with an unknown story) does not.

Dropping `--dry-run` starts a **real** run: it invokes your configured platform adapter, spawns real
agent sessions, and (with a real `ANTHROPIC_API_KEY`) spends real money. This guide stops short of
walking through a live run for that reason — once you're ready, `forge run <workflow>` is the
command, and `forge status`, `forge lanes`, `forge logs`, `forge gate`, and `forge merge` are how
you watch, inspect and progress it while it's active (see their own `--help`-free but
self-describing error messages, or `03-cli-and-installer.md` §3.2.4 for the full flag reference).
Once it finishes, `forge land` is how its work actually reaches your trunk branch — section 10
below. Note that `forge status` itself only succeeds once a run has actually started — on a fresh
project with no run yet, it exits non-zero with
`No FORGE run is currently active in this project. Run \`forge run <workflow>\` to start one.`,
which is the correct, by-design behaviour, not an error in this guide.

## 6. Other everyday commands

```bash
forge cost                 # per-run/per-agent/per-model spend and budget status
forge audit                # gate decisions, tool-ceiling escalations, policy violations
forge report               # the evidence scorecard -- see section 8 below. Not `forge test report`,
                           # a different, still-unwired command (section 7).
forge config get project.name
forge config set execution.concurrency 4
forge export markdown-bundle   # bundle the KB + specs as one Markdown document
forge export html              # ditto, as one HTML document
forge adr new "Use Postgres"   # docs/forge/kb/decisions/ADR-0001-use-postgres.md
```

On a fresh project, `forge report` prints real, explicit zeroes — nothing has run yet:

```
forge report: binding 0/0 (0%)
  critic loop: 0 round(s) consumed, 0 stop-and-disclose
  gates: 0/0 clean first pass, 0 rejection(s) total
  exemptions: 0 opened, 0 expired
  cost: $0.00 across 0 stor(y/ies)
  kb reads: 0/0 artifacts preceded by a real KB read (0%)
```

## 7. What's not wired into the CLI yet

FORGE's real library code (tested independently, extensively) is ahead of what the `forge` CLI argv
dispatcher currently exposes. As of this milestone, genuinely **not** reachable from the command
line (each is a disclosed, deliberate scope boundary, not an oversight — read directly against the
real `packages/cli/src/commands/dispatch/*.ts` area files below; since `specs/22` M17 P2 split the
former 6,041-line `bin.ts` monolith into those files, `bin.ts` itself is a ~60-line entry point with
no command list of its own left to point at, even though the CLI's own generic "not wired into this
real, deliberately minimal dispatcher yet" fallback message still says to look there — a real,
disclosed inconsistency in the tool's own text, not a reason to doubt this list):

- `module list`/`module info`, `overlay list/remove/update/explain/diff/doctor/eject` (only
  `overlay add` is wired)
- `config list`/`config explain`
- `agent`/`workflow` beyond `validate --all` (no `list`/`show`/`new`/`compile`/`graph`)
- `mcp add/test/grant/revoke/trace` (only `mcp list`/`mcp validate` — and today even `mcp list`
  reports itself as not yet supported)
- `kb diff`, `diagram legend`/`render --open`, `customize` (entirely), `preset diff`,
  `skill new/attach/detach/test/import`
- `forge help <topic>` (bare `forge help` works — it recommends your next command)
- `forge plan data`/`forge plan testing` (no such workflow exists yet)
- `forge test plan/generate/report`
- `forge logs --follow`/`--lane`, `forge cost --run`/`--since`

If a command above is what you were reaching for, it exists as tested library code but has no CLI
wiring — check `GAUNTLET-LOG.md` and `SPEC-QUESTIONS.md` for its current status rather than assuming
it's simply missing.

## 8. Catch a non-binding test

Everything above is deterministic bookkeeping; this section is the one real behavioral guarantee
FORGE adds on top of it — a test that doesn't actually test anything gets caught, not silently
trusted. It needs a story with real implementation and test files, so (continuing in this same
project) write one by hand rather than through a live agent session — `forge test binding` doesn't
need one; it's a plain, deterministic check against committed files:

```bash
forge spec new Story "Add two numbers"
# forge spec new Story: wrote docs/forge/specs/stories/STORY-001-add-two-numbers.md.
```

Fill in the generated stub's placeholder fields (`epic`, `capability`, `owner_role`,
`files_expected`, `dod_profile`) — a real project gets these from an already-planned stage; here,
write `owner_role: backend`, `files_expected: [src/add.js, src/add.test.js]`,
`dod_profile: default`. `forge test binding` itself (what this walkthrough runs below) doesn't read
`dod_profile` at all — it's `forge story verify`'s own `verify` phase that does, so a real project
also needs a Definition-of-Done profile naming `test:binding` for that command, not this one
(`docs/forge/kb/engineering/dod-profiles.yaml`):

```yaml
profiles:
  default:
    ready: []
    verify:
      - { check: test:binding }
    done: []
```

`test:binding`'s own result parser expects vitest's `--reporter=json` on stdout — vitest 5's own
default JSON reporter writes to a file instead, which breaks the parse
(`vitest produced unparseable output`). Install vitest 4 (`pnpm add -D vitest@^4`), and point
`execution.testCommands.unit` at an **absolute** path, since the check runs inside an isolated
scratch worktree with no installed `node_modules` of its own (`npx` is refused outright — it fetches
a package by name, which the check's own no-network-no-install guard exists specifically to
prevent):

```bash
forge config set execution.testCommands.unit "$(pwd)/node_modules/.bin/vitest run"
```

`forge test binding` refuses outright on a dirty working tree (`VCS-010` — its scratch worktree is
built from `HEAD`, so an uncommitted edit would silently verdict on stale code). Everything above
this point — `forge init`'s own scaffold, the new story file, `dod-profiles.yaml`, the
`execution.testCommands.unit` edit to `.forge/config.yaml`, `pnpm add`'s `package.json`/lockfile —
is still uncommitted. Commit it now, as its own commit, separate from the implementation you're
about to write below (two commits, not one — `forge test binding` reverts the single commit
immediately before the one it checks, so keeping the scaffold and the implementation apart is what
makes that revert land exactly on `src/`, not on everything else too). `pnpm add` doesn't gitignore
`node_modules/` for you, so exclude it explicitly first — committing it would otherwise silently
work, just with several thousand needless files in the repo's history:

```bash
echo 'node_modules/' >> .gitignore
git add -A && git commit -m "scaffold: init, story, DoD profile, test runner config"
```

Now write the implementation and a test that _looks_ like it covers it but doesn't call it at all:

```
// src/add.js
export function add(a, b) {
  return a + b;
}
```

```
// src/add.test.js
import { describe, it, expect } from 'vitest';

describe('add', () => {
  it('returns a number', () => {
    expect(typeof 2).toBe('number');
  });
});
```

Commit both together, then run the check:

```bash
git add src/ && git commit -m "implement add() with a test"
forge test binding --story STORY-001
```

```
forge test binding --story STORY-001: bound=0 nonBinding=1 restoreVerified=true evidence=MUT-001.
non-binding: add returns a number
```

Exit code 1. The test passed before the revert, and kept passing after — it never calls `add` at
all, so it can't tell a correct implementation from a missing one. `evidence=MUT-001` names a real
`MutationEvidence` artifact the check just wrote (`docs/forge/reports/mutation/`, not yet committed
— that happens below): the test by name, the real commit range reverted, `restoreVerified: true`
(the worktree came back clean). This is also what `test:binding` reports to `G-Verify`, and what
`forge story verify` reports natively.

**One real caveat to know before fixing this**: `baseRevision` (what the implementation is reverted
back to) is a disclosed, fixed `HEAD~1` — not "whatever commit introduced this story's files." If
anything else gets committed between implementing a story and checking it, `HEAD~1` no longer
reverts the implementation at all, and the check becomes a no-op that always reports non-binding
regardless of how good the test actually is (this guide hit exactly that confusion while writing
this section — committing the evidence file as its own commit before fixing the test moved `HEAD~1`
onto a commit that already had the real implementation, making the very next check's own "revert"
silently do nothing — and is disclosing it rather than hiding it). The practical fix: fix the test
and stage the evidence file together, then amend them both into the SAME commit that introduced
`src/` — never a separate commit on top of it — so that commit stays immediately `HEAD~1` away from
the next check:

```
// src/add.test.js
import { describe, it, expect } from 'vitest';
import { add } from './add.js';

describe('add', () => {
  it('returns the sum of its two arguments', () => {
    expect(add(2, 3)).toBe(5);
  });
});
```

```bash
git add src/add.test.js docs/forge/reports/mutation/ && git commit --amend --no-edit
forge test binding --story STORY-001
```

```
forge test binding --story STORY-001: bound=1 nonBinding=0 restoreVerified=true evidence=MUT-002.
```

Exit code 0. Reverting `add.js` now genuinely removes the function the fixed test imports and calls,
so the test fails under the revert exactly as it should, and passes again once the worktree is
restored. `evidence=MUT-002`, not `MUT-001` again: amending a commit replaces its content, not its
own evidence file's own already-assigned id — ids are sequential per project, never reused, even for
a commit that got amended.

**The other path**, had the test genuinely been unable to bind (a thin wrapper around a third-party
SDK, say, not this one — fixing a test that's merely weak, like above, is always the right call):
declare an exemption instead of leaving it to fail the gate forever. Tried against the ORIGINAL,
still-non-binding test (`forge test exempt` refuses outright to exempt a test that already binds —
"you may not pre-emptively exempt a test that already binds" — so this only works before the fix
above, not after):

```bash
forge test exempt STORY-001 "add returns a number" --reason "placeholder assertion, no real coverage yet" --owner backend --expires 2026-12-31
```

```
forge test exempt STORY-001 add returns a number: recorded EXEMPT-001 (expires 2026-12-31).
```

An exemption needs a reason, an owner and a real expiry — a stale one (expired, or naming a test
that no longer exists) fails `test:binding` loudly, naming itself, rather than silently expiring
into a quiet pass. Re-running `forge test binding --story STORY-001` now exits 0
(`bound=0 nonBinding=0` — the one non-binding test is covered, not hidden), and the exemption shows
up automatically, with no separate step to remember it:

```bash
forge kb disclosures
```

```
open (synthesized) exemption EXEMPT-001 (backend): STORY-001: add returns a number: placeholder assertion, no real coverage yet
```

Either path — fix it (this guide's own project, above) or exempt it, honestly — is meant to show up
in the project's own scorecard. Run it now and it doesn't, and that's itself worth disclosing
honestly rather than quietly editing around:

```bash
forge report
```

```
forge report: binding 0/0 (0%)
  critic loop: 0 round(s) consumed, 0 stop-and-disclose
  gates: 0/0 clean first pass, 0 rejection(s) total
  exemptions: 0 opened, 0 expired
  cost: $0.00 across 0 stor(y/ies)
  kb reads: 0/0 artifacts preceded by a real KB read (0%)
```

Still all zeroes, confirmed by actually re-running it, not assumed. `forge report`'s own binding and
exemption counts both come from real telemetry (`specs/22` M15 P11) emitted only when a real
`FORGE_RUN_ID` is set in the environment — a real `forge run`, or a gate check running as a workflow
step. A bare `forge test binding`/`forge test exempt` invoked by hand at a shell, exactly as this
guide just did, sets none, so neither command leaves anything for `forge report` to project. The
disclosures listing above still shows the exemption, because it reads `reports/exemptions.md`
directly — a durable, committed file, not an event log entry — so it has no such gap. This is a
real, disclosed scope boundary of `forge report`, not a bug in this guide's own steps: see
`docs/method-guide.md`'s own Measurement section, and `SPEC-QUESTIONS.md` Q291 for the full
reasoning.

## 9. Check a refactor against a reference

Everything above is checked by running a story's own tests, with or without a revert — there's no
reference to compare against. A `refactor` is different: the code _before_ the change always exists,
so this guide's own CLI now ships a **parity oracle** that checks a refactor's candidate against a
reviewed, immutable capture of that reference's own observed behaviour, and `refactor` now refuses
to run at all without one. This section runs the real `forge parity capture`/`check`,
`forge test binding --hunks` and `forge evidence prune` commands against `fixtures/parity-refactor/`
— the small, deliberately trivial fixture this repository's own test suite already uses for exactly
this — not a live `forge refactor` run: that needs a real agent session and real spend, which this
guide doesn't do (see [`docs/method-guide.md`](method-guide.md) for the concepts this section only
runs).

This needs its own project, kept apart from the one sections 2–8 built (it needs an unrelated
`sum.mjs`, and mixing it into `STORY-001`'s own history would only confuse both) — initialize one
exactly as section 2 did, in a new directory:

```bash
FORGE_REPO="$(pwd)"
mkdir /tmp/forge-parity-demo && cd /tmp/forge-parity-demo
forge init --name "Parity Demo" --level L0 --yes
git add -A && git commit -q -m "scaffold: forge init"
```

`$FORGE_REPO` is this checkout's own root — every `fixtures/parity-refactor/` path below is relative
to it, not to the new project directory you just `cd`'d into.

Copy in the fixture's reference implementation and commit it on its own; this commit is what the
declaration below names as the reviewed reference:

```bash
cp "$FORGE_REPO/fixtures/parity-refactor/reference/sum.mjs" ./sum.mjs
git add -A && git commit -q -m "reference implementation of sum.mjs"
REF_SHA=$(git rev-parse HEAD)
```

`fixtures/parity-refactor/reference/sum.mjs`'s own content, read directly rather than retyped:

```
// The reference implementation `specs/22` M16's own exit test (`03` §3.5, `13` F-TEST-9) compares a
// refactor against: sums its two command-line arguments and prints the result. Deliberately simple
// and deterministic (no clock, no randomness, no filesystem) so a byte-for-byte parity comparison is
// the whole point, not an accident of the fixture.
const [a, b] = process.argv.slice(2).map(Number);
process.stdout.write(String(a + b));
```

The fixture's own declaration names this exact commit as its reference, as a template with a
placeholder where the real commit sha goes, since the declaration can't name a commit that didn't
exist until the step above:

```
name: behavior
reference:
  ref: __REFERENCE_SHA__
review:
  by: fixture-author
  basis: read reference/sum.mjs by hand; it is three lines
  at: 2026-01-01
expires: 2999-01-01
surfaces:
  process:
    run: "node sum.mjs"
    stability:
      runs: 2
    cases:
      - args: ["2", "3"]
      - args: ["10", "-4"]
```

A real declaration's own `review.basis` would name something substantive — the actual diff a human
read, not a one-line gesture; this fixture's own basis is deliberately trivial, because the fixture
itself is six lines — four of comment, two of code, shown above. (Its path, `reference/sum.mjs`, is
also this fixture's own location inside this repository, not `./sum.mjs` where it actually sits once
copied into the project you just created — `basis` is free text the tooling never parses, so that
mismatch is cosmetic, not a sign you missed a step.) Fill in the one real commit sha the same way
this repository's own tests do, substituting it for the placeholder, and commit the result:

```bash
mkdir -p .forge/parity
sed "s/__REFERENCE_SHA__/$REF_SHA/" "$FORGE_REPO/fixtures/parity-refactor/declaration/behavior.parity.yaml" > .forge/parity/behavior.parity.yaml
git add -A && git commit -q -m "declare parity for sum.mjs"
```

Now capture the reference's own observed behaviour — the one human act that actually writes the
oracle:

```bash
forge parity capture
```

```
forge parity capture: captured 1, unchanged 0 (behavior -> d1c9ffbd3f94a72eecc7826c5a22c6d381175f3d6fa8e8ebb140bf6348e9e36a.json).
```

(the capture's own file name — the sha256 of its own canonical bytes — is as specific to this run as
the commit sha above; yours will legitimately differ.) Commit it: a capture is an oracle a later
`refactor` has to trust, and trusting an uncommitted file is not trusting anything.

```bash
git add -A && git commit -q -m "capture reference behaviour"
```

Now try a behaviour-preserving refactor: the implementation changes, the observable output does not.

```bash
cp "$FORGE_REPO/fixtures/parity-refactor/preserving/sum.mjs" ./sum.mjs
forge parity check --trusted @trunk --no-record
```

```
forge parity check: 2 passing, 0 failing (behavior: match).
```

Exit code 0. `--trusted @trunk --no-record` isn't an arbitrary choice of flags here — it is the same
trust anchor and recording behaviour that `G-Parity`'s own check runs inside a real `refactor`, just
without that check's own `--json` (shown further below instead, once this walkthrough needs a
machine-readable field rather than a human-readable line): the trust anchor is always trunk, and a
gate check never records evidence of its own, because it runs inside the integration worktree, where
a file the check wrote would leave that worktree dirty for the next run.

`@trunk` is a symbol, not a literal ref: `forge parity check` resolves it itself, to
`refs/heads/<vcs.trunk>` — `vcs.trunk` (default `"main"`, which is what it is in the project this
walkthrough built in section 2) is a real `.forge/config.yaml` key, proposed by `forge init` from
the real git branch it finds checked out right after it runs — a fresh project's own just-created
branch, or whatever an already-existing repository was already on — falling back to the literal
default only when there is no real git repository to ask at all (`--no-git`). So a project whose
trunk is called `master` (or anything else) never needs `G-Parity.gate.yaml` edited or templated to
match — the shipped gate file itself says `--trusted @trunk` verbatim. An explicit ref still works
exactly as before (`--trusted refs/heads/main`, or any other full sha/`refs/`-qualified name `13`
F-TEST-9 accepts) when you want to pin the comparison to something other than the project's own
trunk.

Now try a behaviour-changing refactor: a deliberate off-by-one
(`function sum(x, y) { return x + y + 1; }`).

```bash
cp "$FORGE_REPO/fixtures/parity-refactor/changing/sum.mjs" ./sum.mjs
forge parity check --trusted @trunk --no-record --json
```

```
{"v":1,"ok":true,"verdict":"mismatch","failing":2,"passing":0,"evidenceId":null,"declarations":[{"name":"behavior","verdict":"mismatch","reason":"surface \"process\" case 0 differs on its \"stdout\" stream","passing":0,"failing":2}]}
```

Exit code 1. Read `reason` closely: it says _where_ the two disagree — the surface (`"process"`),
the case (`0`, the first of the two declared) and the stream (`"stdout"`) — and nothing else. It
never says the reference printed `5` and the candidate printed `6`; F-TEST-9 is explicit that an
envelope never carries the differing text itself, only where the difference is, so a
`ParityEvidence` record can be shared and reviewed without leaking whatever the comparison actually
found.

Put the preserving refactor back — it's the one actually going into this project's history — and
check it again without `--no-record` this time, the way a human checking by hand (rather than a
gate, mid-run) normally would:

```bash
cp "$FORGE_REPO/fixtures/parity-refactor/preserving/sum.mjs" ./sum.mjs
forge parity check --trusted @trunk --json
```

```
{"v":1,"ok":true,"verdict":"match","failing":0,"passing":2,"evidenceId":"PAR-001","declarations":[{"name":"behavior","verdict":"match","passing":2,"failing":0}]}
```

`evidenceId` names a real, just-written `ParityEvidence` record. Look at it — the shas and digests
_inside_ the record are your own and will differ; the record's own id really is `PAR-001` here too
(always, for the first record in a fresh project), and the shape around it won't differ either:

```bash
cat docs/forge/reports/parity/PAR-001-behavior.md
```

```
---
id: PAR-001
type: ParityEvidence
schemaVersion: 1
title: forge parity check -- project
status: recorded
created: 2026-10-09
updated: 2026-10-09
revision: 1
author: engine
changelog: []
trusted: db9414d8d0515d5fc75ab7a8e8f4dc580de0520d
headSha: db9414d8d0515d5fc75ab7a8e8f4dc580de0520d
dirty: true
deltaDigest: 381e765f28a4fe317c20d06ca1556d5f47d004936714381ae62159888e15598d
toolVersions:
  node: v22.14.0
verdict: match
declarations:
  - name: behavior
    digest: e56543d4c13540078da406bf8051760834cceb0765c7f76e6976b0e4d09a4ac4
    reference:
      ref: d5b92b81372331b02a229bf7e296b9a645355adc
      sha: d5b92b81372331b02a229bf7e296b9a645355adc
    platform: darwin-arm64
    captureDigest: d1c9ffbd3f94a72eecc7826c5a22c6d381175f3d6fa8e8ebb140bf6348e9e36a
    verdict: match
    cases:
      - surface: process
        caseIndex: 0
        verdict: match
        contentHash: 642ed483706c549e49d466ce64f6b6238a54cb2ee1b9c0ae4731665a18b929ab
      - surface: process
        caseIndex: 1
        verdict: match
        contentHash: d2de089df2234317cbe04a0355dee26281ea74a8db689775719e0cff71eadf6c
    exemptCount: 0
---

<No further content: every real finding lives in the front matter above, not the body.>
```

Every hash in that file is a hash _of_ content — never the content itself, proof rather than just a
claim of F-TEST-9's "never the observed content" rule. Commit it:

```bash
git add -A && git commit -q -m "record a parity check (PAR-001)"
```

`forge parity check` tells you a refactor's observable output didn't move. It says nothing about
whether your own tests would have caught it if it had — that's `forge test binding`'s job (section 8
above), and this CLI's own hunk mode is a finer-grained form of exactly that: reverting one hunk of
a change at a time, rather than the whole thing at once. It needs a story and a real test, so add
both — a story whose `files_expected` splits `sum.mjs` from its own test, and a test that actually
calls the refactored code through its command-line contract, the only one `sum.mjs` has:

```bash
cat > package.json <<'EOF'
{
  "name": "parity-demo",
  "private": true,
  "type": "module"
}
EOF
forge spec new Story "Refactor sum.mjs"
```

```
forge spec new Story: wrote docs/forge/specs/stories/STORY-001-refactor-sum-mjs.md.
```

Fill in the same placeholder fields section 8 did (`owner_role: backend`, `dod_profile: default`),
with `files_expected: [sum.mjs, sum.test.mjs]` this time:

```
// sum.test.mjs
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

describe('sum.mjs', () => {
  it('sums its two command-line arguments', () => {
    const output = execFileSync('node', ['sum.mjs', '2', '3'], { encoding: 'utf8' });
    expect(output).toBe('5');
  });
});
```

Point `execution.testCommands.unit` at a real vitest 4 — this project can reuse the one
`pnpm install` already put in this repository's own `node_modules`, so there's nothing new to
install this time:

```bash
forge config set execution.testCommands.unit "$FORGE_REPO/node_modules/.bin/vitest run --root ."
echo 'node_modules/' >> .gitignore
git add -A && git commit -q -m "add a story and a real test for sum.mjs"
```

Now hunk-mutate the refactor itself, against the commit that introduced the reference
implementation:

```bash
forge test binding --story STORY-001 --hunks --base "$REF_SHA"
```

```
forge test binding --story STORY-001: bound=0 nonBinding=1 restoreVerified=true evidence=MUT-001.
non-binding: sum.mjs sums its two command-line arguments
hunk uncovered: baa2bdc602d66102d957428fc5325071928d713eff01ccc870f00ed2a340f52d sum.mjs
```

(unlike the commit shas above, this hunk id is the same for every reader: it is derived purely from
the diff's own content and position, never from a commit sha or a timestamp.)

Exit code 1 — and worth sitting with, because this is not a weak test. It really does exec `sum.mjs`
and check its real output; it's the identical check `forge parity check` already made above. That's
exactly why reverting the refactor doesn't fail it: `preserving/sum.mjs` is called that because, for
every input, it returns what `reference/sum.mjs` already returned — so a test of nothing but the
observable output can never tell the two apart, by the fixture's own construction. The one hunk (the
diff has no unchanged line to split it on, so the whole file is one hunk here) reads `uncovered` for
the identical reason the change-level check reads `nonBinding=1`. This is the real, concrete
difference between the two oracles this milestone ships: parity rewards exactly this refactor,
because nothing observable moved; binding has nothing to say about it either way, because nothing in
this test distinguishes "the new code ran" from "the old code would have produced the same thing." A
refactor that broke something internal — not just its final printed digit — is what a hunk-level
check is for; this fixture's own refactor, by design, isn't that.

Commit the evidence this just wrote, then look at retention:

```bash
git add -A && git commit -q -m "record MUT-001 (hunk-mode binding check)"
forge evidence prune
```

```
forge evidence prune: kept 2, would remove 0.
```

A dry run by default: the one `MutationEvidence` record (`MUT-001`) and the one `ParityEvidence`
record (`PAR-001`) committed above are both still under the default `--keep 5`, so nothing is
removed. `--apply` is what would actually prune, and it refuses outright inside a real FORGE run,
for the identical reason `forge parity capture` does above.

This whole section ran against a small, deliberately trivial fixture — six lines of reference code
and two tiny variants of it — never a real production refactor. A real one is `specs/22` M16 P17's
own job, authorized separately, if and when the project's owner actually spends real money on one.

## 10. Landing a finished run on trunk

A real `forge run`/`forge refactor` (never run in this walkthrough — see section 9's own note on
why) integrates its lanes onto an **integration branch** (`forge/integration/{stage}` by default,
`18` §18.3's `execution.integrationBranch`), never onto your trunk branch directly. Before this
milestone, nothing told you how — or whether — that work was supposed to reach trunk at all: the
integration branch just sat there, and a person who committed it onto trunk by hand then blocked the
_next_ run (its lanes branch from the integration branch's own tip, which a manual trunk commit
never updates).

Two ways to land a run, and a project picks one by its own `execution.integrationBranch` config:

- **Configure `execution.integrationBranch` to BE your trunk branch itself** — set it to the exact
  same value as `vcs.trunk` (`forge config set execution.integrationBranch main`, for a project
  whose trunk is `main`). Every lane merge then lands directly on trunk as the run proceeds; there
  is nothing further to do, and `forge land` (below) is a confirmed no-op for a project configured
  this way. This is also why `G-Parity`'s own trust anchor (`@trunk`, section 9 above) is meaningful
  for such a project at all: F-TEST-9 says a project configured this way "gets no protection" from a
  rewritten oracle — the integration branch and trunk are the same ref, so there is no separate copy
  an in-flight run's own lane could tamper with.
- **Keep the default, separate integration branch**, and land a finished run explicitly:

  ```bash
  forge land --run <runId>
  ```

  This fast-forwards (or recognises there is nothing to do) your trunk branch to the run's own
  integration branch tip, **in your own working tree** — it needs your working tree to already have
  trunk checked out, with no uncommitted changes, exactly as a person doing this merge by hand
  would. `--run` defaults to the project's own last run when omitted.

  `--run` names which BRANCH to land, not which COMMITS: the default integration branch is shared
  and accumulates across every run that targets the same stage, so if a second run already landed
  more lanes onto that same branch after the one you named, `forge land --run <earlier-run>` lands
  that later work too — there is no partial-landing mechanism, and no reliable way to carve "only
  this run's own commits" out of one branch's shared history. When this is actually detectable (the
  named run's own recorded event log shows less than what is currently on the branch), the command
  says so rather than landing it silently: a non-fatal `warning` in the `--json` envelope, or an
  extra printed line without it. It names what moved past the run's own last recorded merge, never a
  specific cause — the identical shape also shows up if this exact run's own failure handling later
  reverted that same lane, which is not "another run" at all, so the wording never guesses which one
  it is. Landing still proceeds either way — the warning is honesty, not a refusal.

  Three outcomes, each printed plainly (and under `--json` as
  `{v:1, mergesDirectly, trunkTip, landed, warning?}`):

  - Nothing to land (already landed, or trunk already has it some other way): `landed: false`,
    exit 0.
  - A real fast-forward: `landed: true`, trunk now points at the integration branch's own tip,
    exit 0.
  - **Diverged** — trunk picked up a commit of its own (a manual commit, or another run's own
    landing) since this run started, so it cannot be fast-forwarded without an unattended merge
    FORGE never creates on its own: refused (`RUN-156`), naming both tips and exactly how to recover
    — merge trunk's own current tip into the integration branch, resolve anything that conflicts,
    commit the result, then run `forge land --run <runId>` again. This is the actionable version of
    the problem this section opened with: a manual trunk commit no longer silently blocks the next
    run with no way forward, it names one.

  Not on trunk, or a dirty working tree, when you run it? Refused typed too (`RUN-155`, or the
  project's own familiar `VCS-DIRTY-TREE`) — `forge land` never switches branches or discards
  uncommitted work on your behalf.

## 11. Configuring your trunk branch

Section 9 above already showed `@trunk` resolving through a real `.forge/config.yaml` key; this
section is the dedicated, standalone version, run against the project section 2 built (trunk `main`,
since that is what this machine's `git init` defaults to):

```bash
forge config get vcs.trunk
```

```
vcs.trunk: "main"
```

`forge init` never hardcodes this: it reads back git's own real choice right after running
`git init` (or, for an already-existing repository, whatever branch was already checked out), so a
project whose trunk is genuinely `master` — or anything else — gets that value, not a literal
default silently substituted for it. The literal default, `"main"`, is reached only when there is no
real git repository to ask at all (`--no-git`).

A project with an already-established trunk by some other name changes it the same way as any other
config value:

```bash
forge config set vcs.trunk master
forge config get vcs.trunk
```

```
forge config set vcs.trunk: "master".
vcs.trunk: "master"
```

This one key is what every `@trunk` symbol in this CLI resolves against —
`forge parity check --trusted @trunk` (section 9), and the `vcs.trunk` fast-forward target
`forge land` moves (section 10) — so changing it mid-project is a real, load-bearing change, not a
cosmetic one: do it before a run is in flight, not during one. (This project's own `vcs.trunk` is
reverted back to `main` for the rest of this guide — `git checkout -- .forge/config.yaml` undoes the
`set` above cleanly, since it was never committed.)

Before `specs/22` M17 P9, none of this was configurable at all: `@trunk` (and `G-Parity.gate.yaml`'s
own `--trusted` flag) resolved to the literal string `"main"`, unconditionally, deep in this CLI's
dispatcher — a project whose real trunk was `master` could never pass a real `refactor`'s `G-Parity`
gate, for a reason that had nothing to do with parity itself. That defect is fixed, not merely
mitigated — confirmed directly above, by actually changing the value and reading it back.

## 12. Bringing an existing project's tests into FORGE

Everything through section 8 assumed `execution.testCommands.unit` names a runner FORGE already
understands (Vitest, by `detectEcosystem`). A project FORGE did not build may use anything. This
section runs `forge test adopt` for real against two small, fresh projects — one whose test runner
is confidently detected, one whose runner is genuinely unfamiliar — and then writes, by hand, the
one artifact that brings an unfamiliar runner's raw output into FORGE's own canonical shape: a
**translator**.

### The detected case

```bash
mkdir /tmp/forge-adopt-detected && cd /tmp/forge-adopt-detected
ANTHROPIC_API_KEY=<your key> forge init --name "Adopt Detected" --level L0 --yes
cat > package.json <<'EOF'
{
  "name": "adopt-detected-demo",
  "private": true,
  "devDependencies": { "vitest": "^4.0.0" }
}
EOF
git add -A && git commit -q -m "scaffold: forge init + a vitest devDependency"
forge test adopt --json
```

```
{"v":1,"outcome":"staged","layer":"unit","candidate":{"dir":".","layer":"unit","ecosystem":"javascript","runner":"vitest","confident":true,"command":{"run":"npx vitest run --reporter=json","output":{"source":"stdout"},"format":"vitest-json","scope":"npx vitest run --reporter=json {files}","filter":"npx vitest run --reporter=json -t {name:regex}"},"reason":"package.json declares \"vitest\" as a dependency."}}
```

A real `.forge/test-adopt/unit.proposal.yaml` now exists, `source: detected`, carrying exactly this
command — written there, never into the live `execution.testCommands.unit`, which is still unset:
detection only ever proposes (F-TEST-1's explicit-config-wins rule holds here too). (`run` goes
through `npx` unconditionally for every detected JS runner this detector knows — `detect.ts`'s own
fixed proposal for vitest/jest/mocha, not something this guide's own scratch project's bare
`devDependencies` entry, with no real `node_modules` installed, caused.)

### The handoff case: an in-house runner

```bash
mkdir /tmp/forge-adopt-handoff && cd /tmp/forge-adopt-handoff
ANTHROPIC_API_KEY=<your key> forge init --name "Adopt Handoff" --level L0 --yes
mkdir tests
cat > tests/run.mjs <<'EOF'
#!/usr/bin/env node
// A tiny, bespoke in-house test "runner" -- not vitest, not pytest, not anything forge test adopt's
// deterministic detector recognises. One line of output per test: "PASS <name>" or
// "FAIL <name>: <reason>".
const TESTS = {
  'add works': () => {
    const sum = 2 + 2;
    if (sum !== 4) throw new Error(`expected 4, got ${sum}`);
  },
  'subtract works': () => {
    const diff = 5 - 2;
    if (diff !== 3) throw new Error(`expected 3, got ${diff}`);
  },
};
let failed = 0;
for (const [name, fn] of Object.entries(TESTS)) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    failed += 1;
    console.log(`FAIL ${name}: ${error.message}`);
  }
}
process.exit(failed > 0 ? 1 : 0);
EOF
node tests/run.mjs
```

```
PASS add works
PASS subtract works
```

Real tests, that really pass — `forge test adopt` still cannot recognise the runner, because nothing
names it in a shape detection reads:

```bash
cat > package.json <<'EOF'
{ "name": "adopt-handoff-demo", "private": true, "type": "module", "scripts": { "test": "node tests/run.mjs" } }
EOF
git add -A && git commit -q -m "scaffold: forge init + an in-house test runner"
forge test adopt --json
```

```
{"v":1,"outcome":"handoff","candidate":{"dir":".","layer":"unit","ecosystem":"javascript","confident":false,"reason":"package.json exists but names no recognised test runner (checked: vitest, jest, mocha, Node's built-in --test) in its dependencies or \"scripts.test\" (\"node tests/run.mjs\")."}}
```

Exit code 1, and nothing staged — a real, honest hand-off, not a guess forced into the nearest
built-in shape. `13` F-TEST-11's own next step from here is `forge test adopt --agent`: an AI-driven
workflow that investigates the project, runs its tests for real (including with a deliberately
failing probe added), and either maps the runner onto a built-in format or writes a translator
script. This guide does not run `--agent` — it spends real money on a real agent session, which
[section 5](#5-see-what-a-workflow-would-do-without-running-it) already explained this guide
deliberately stops short of. What follows instead is the identical artifact `--agent` would produce,
written by hand, so the one closed-source part of this story (what the agent actually does) does not
leave the rest of it undemonstrated.

### Writing a translator by hand

A **translator** is a small, project-committed script that reads a runner's raw output and prints
`forge-test-report` v1 (`09` §9.5) on stdout — one JSON object,
`{"forgeTestReport": 1, "tests": [{"name", "status": "pass"|"fail"|"skip", "file"?, "kind"?, "acId"?}]}`,
`name` and `status` the only required fields. For `tests/run.mjs` above, whose own output is two
kinds of line (`PASS <name>`/`FAIL <name>: <reason>`), the translator is a small regex over each
line:

```bash
mkdir -p .forge/test-translators
cat > .forge/test-translators/unit.mjs <<'EOF'
#!/usr/bin/env node
// Translates tests/run.mjs's own "PASS <name>" / "FAIL <name>: <reason>" lines into a
// forge-test-report v1 document (specs/09 S9.5). Reads the runner's raw output from the file named
// by argv[2] -- the real path a structured testCommands.<layer> entry's own {output} placeholder is
// substituted with (reporter.ts's own substituteOutputPlaceholder).
import { readFileSync } from 'node:fs';

const raw = readFileSync(process.argv[2], 'utf8');
const tests = [];
for (const line of raw.split('\n')) {
  const pass = /^PASS (.+)$/.exec(line);
  if (pass) {
    tests.push({ name: pass[1], status: 'pass' });
    continue;
  }
  const fail = /^FAIL (.+?): (.+)$/.exec(line);
  if (fail) tests.push({ name: fail[1], status: 'fail', kind: 'assertion' });
}
process.stdout.write(JSON.stringify({ forgeTestReport: 1, tests }));
EOF
node tests/run.mjs > /tmp/raw-output.txt
node .forge/test-translators/unit.mjs /tmp/raw-output.txt
```

```
{"forgeTestReport":1,"tests":[{"name":"add works","status":"pass"},{"name":"subtract works","status":"pass"}]}
```

Real output, really produced by running both scripts — not retyped from memory — and it really is a
valid `forge-test-report`: piping it through this repository's own `parseForgeTestReport` (the exact
function every built-in parser and every translator's output is checked against) confirms
`{"ok": true, ...}`. The translator proof's own check 3 (the injected-failure probe) needs one more
thing: a deliberately failing test added, so there is a real failure for the translator to report
correctly (the probe `adopt-tests` itself would write and remove again automatically; here, added by
hand, as a second copy of the runner rather than editing the first, so both remain runnable):

```bash
cat > tests/run-with-probe.mjs <<'EOF'
#!/usr/bin/env node
// tests/run.mjs, plus one deliberately failing test (the injected-failure probe).
const TESTS = {
  'add works': () => {
    const sum = 2 + 2;
    if (sum !== 4) throw new Error(`expected 4, got ${sum}`);
  },
  'subtract works': () => {
    const diff = 5 - 2;
    if (diff !== 3) throw new Error(`expected 3, got ${diff}`);
  },
  'probe always fails': () => {
    throw new Error('deliberately injected failure');
  },
};
let failed = 0;
for (const [name, fn] of Object.entries(TESTS)) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    failed += 1;
    console.log(`FAIL ${name}: ${error.message}`);
  }
}
process.exit(failed > 0 ? 1 : 0);
EOF
node tests/run-with-probe.mjs > /tmp/raw-output-with-probe.txt
node .forge/test-translators/unit.mjs /tmp/raw-output-with-probe.txt
```

```
{"forgeTestReport":1,"tests":[{"name":"add works","status":"pass"},{"name":"subtract works","status":"pass"},{"name":"probe always fails","status":"fail","kind":"assertion"}]}
```

The probe is reported as `"fail"`, by its exact name, with the other two tests' statuses undisturbed
— exactly what the translator proof's own check 3 looks for.

**The one real gap in this story.** Having confirmed the translator works, the natural next step
would be `execution.testCommands.unit` set to
`{run: "node tests/run.mjs", output: {source: stdout}, format: forge-json, translate: "node .forge/test-translators/unit.mjs {output}"}`
and the real proof run against it. As shipped today, there is no CLI command that does this for a
hand-staged, non-agent proposal: `runTranslatorProof`'s only production caller is
`forge test adopt --agent`'s own workflow (`packages/cli/src/commands/loop/test/adopt-agent.ts`) —
confirmed directly by reading every real caller of `writeStagedProposal`, not inferred. Hand-staging
the proposal anyway and asking for the real promotion or approval check both refuse honestly, naming
exactly what is missing, never pretending a translator that was never actually proven is good
enough:

```bash
mkdir -p .forge/test-adopt
cat > .forge/test-adopt/unit.proposal.yaml <<'EOF'
layer: unit
source: human
command:
  run: node tests/run.mjs
  output:
    source: stdout
  format: forge-json
  translate: node .forge/test-translators/unit.mjs {output}
reason: >-
  Hand-written translator for this project's own in-house runner; no built-in format recognises
  its bespoke output.
EOF
forge test adopt --write --json
forge test adopt --check-proof unit
```

```
{"v":1,"outcome":"proof-not-passing","layer":"unit","detail":"no translator proof has been recorded for this layer's staged proposal yet."}
{"v":1,"layer":"unit","unapproved":1,"detail":"no translator proof has been recorded for this layer's staged proposal yet."}
```

The honest path from here, today, is `forge test adopt --agent` — it will find this already-written
translator, run the real proof against it, and stage the result with a real, recorded verdict,
rather than this guide (or you) fabricating one by hand. See
[`method-guide.md`'s Test adoption section](method-guide.md#test-adoption-bringing-an-existing-projects-tests-into-forge)
for the conceptual shape of what the agent does and why the proof exists at all.

## 13. Retrying a transient failure

An ordinary agent-session hiccup — a dropped connection, a provider outage — is retried
automatically rather than failing the whole run; `method-guide.md`'s own
[Retrying a transient step failure](method-guide.md#retrying-a-transient-step-failure) section has
the full mechanism (the `retry:` policy, the never-retry-twice-identical-failure rule, real backoff
with jitter). This guide does not run a real agent session, so it cannot show a live model-level
transient failure retried end to end through the `forge` CLI — that is exactly the kind of thing
[section 5](#5-see-what-a-workflow-would-do-without-running-it) already explained this guide
deliberately stops short of, and the real, live version of it is P21's own job, not this guide's.

What can be shown directly, right now, with no live session and no spend, is that the mechanism is
real: this repository's own engine test suite exercises it with a scripted adapter that fails once
and succeeds on retry, and asserts the real event sequence rather than merely describing it. From a
checkout of this repository (substitute its real path for `$FORGE_REPO`, as in sections 2 and 9):

```bash
cd "$FORGE_REPO"
node scripts/run-tests.mjs run packages/engine/test/run/run-engine.test.ts -t "driveToCompletion retry wiring"
```

Real output (abridged — per-test timings are omitted since they vary run to run; the test names and
the pass count do not):

```
 ✓ packages/engine/test/run/run-engine.test.ts (22 tests | 18 skipped)
       ✓ a transient (adapter) failure is retried, and the run completes once the retry succeeds
       ✓ a repeated, byte-identical failure signature escalates after exactly two attempts (the never-retry rule), never reaching the compiled default’s own third
       ✓ retry spend is attributed per step: a failed first attempt and a paid, successful retry each leave their own UsageRecorded entry under the one step id, summable
       ✓ resume mid-retry is deterministic: a crash right after StepRetried (before the fresh attempt it authorises ever runs) still reaches the identical, completed final state on resume

 Test Files  1 passed (1)
      Tests  4 passed | 18 skipped (22)
```

And the real, disclosed boundary of that mechanism — that it only ever applies to an `agent`-kind
step, never a `command`-kind one — is just as directly checkable, with a real `forge run` and no
agent at all. A one-step workflow whose only step is a `command` that fails once and would succeed
on a second try:

```bash
mkdir /tmp/forge-retry-demo && cd /tmp/forge-retry-demo
ANTHROPIC_API_KEY=<your key> forge init --name "Retry Demo" --level L0 --yes
git add -A && git commit -q -m "scaffold: forge init"
cat > /tmp/retry-demo-flaky.mjs <<'EOF'
// Fails exactly once, then succeeds on every later invocation. The counter file lives outside any
// FORGE lane worktree, so it survives even if a retry got a fresh lane.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
const counterPath = '/tmp/retry-demo-counter.txt';
const attempt = existsSync(counterPath) ? Number(readFileSync(counterPath, 'utf8')) + 1 : 1;
writeFileSync(counterPath, String(attempt));
if (attempt === 1) { console.error('simulated transient failure (attempt 1)'); process.exit(1); }
console.log('succeeded'); process.exit(0);
EOF
cat > .forge/workflows/retry-demo.workflow.yaml <<'EOF'
id: retry-demo
name: Retry Demo
version: 1.0.0
description: A scratch workflow, not a shipped one.
levels: [L0, L1, L2, L3, L4]
steps:
  - id: flaky
    kind: command
    run: 'node /tmp/retry-demo-flaky.mjs'
EOF
git add -A && git commit -q -m "add a retry-demo workflow"
forge run retry-demo --json
```

```
{"v":1,"runId":"run-retry-demo-20261020133126244","runState":{"runId":"run-retry-demo-20261020133126244","planRef":"retry-demo","runStatus":"failed","stepStatuses":{},"unresolvedStepIds":[],"laneStatuses":{},"spentUsd":0,"sessionIds":{},"laneOrigins":{},"artifactPaths":{},"runFailure":{"reason":"step-failed","message":"1 step(s) failed (retry-demo:flaky)","failedSteps":["retry-demo:flaky"],"failedTotal":1,"unfinished":[],"unfinishedTotal":0}}}
The run failed: 1 step(s) failed (retry-demo:flaky).
Run `forge logs` to read each failed step and fix what it names, then start the workflow again with `forge run`: `forge resume` continues steps that were interrupted or never started, not steps that failed.
```

(`runId` embeds a real timestamp, so yours will legitimately differ — everything else above is the
real, deterministic shape.) The run fails after exactly one attempt — reading the real event log for
this run shows why: `StepScheduled` → `StepStarted` → `LaneCreated` → `LaneReady` → `StepFailed` →
`RunFailed`, with no `StepRetried` anywhere. A `command`-kind step's own compiled retry policy
defaults to `maxAttempts: 1` (`packages/engine/src/plan/compile.ts`'s own
`NON_AGENT_DEFAULT_MAX_ATTEMPTS`), and the workflow schema has no `retry:` field on a `command` step
at all to override it with — confirmed here by actually running it, not merely read off the source.
Retrying a flaky shell command is the workflow author's own job today (loop it with `&&` inside the
command, or wrap it in a script), not something this mechanism does outside an `agent`-kind step.

## 14. Worktree location: where lane and integration worktrees live

The run just above created a real lane worktree (`LaneCreated`/`LaneReady`, in its own event log) —
`forge doctor`, run against the same `/tmp/forge-retry-demo` project, reports on it directly, now
that the run has finished and left it behind:

```bash
forge doctor
```

Real output, abridged to the three worktree-related lines (`forge doctor` also checks Node/pnpm
versions, the platform adapter, config validity, and more — see section 1):

```
ok git-version: git version 2.39.5 (Apple Git-154) satisfies the 2.30 worktree-support floor.
warning orphaned-worktrees: 2 real orphaned lane worktree(s).
ok legacy-in-tree-worktrees: No legacy in-tree worktrees (pre-M17 `.forge/state/worktrees/`).
```

(Two, not one: the failed step's own lane, plus the run's own integration worktree, both finished
and unclaimed. A project with no finished run yet reads
`ok orphaned-worktrees: No orphaned lane worktrees.` instead — not a sign anything is wrong.)
Post-`specs/22` M17 (Decision 6, P8), every one of these worktrees lives outside the project tree
entirely, under the platform's own real cache directory, keyed by a stable hash of the project's own
real, resolved path: `~/Library/Caches/forge/<hash>/worktrees/` on macOS,
`%LOCALAPPDATA%/forge/<hash>/worktrees/` on Windows, `~/.cache/forge/<hash>/worktrees/` on Linux (or
`$XDG_CACHE_HOME/forge/<hash>/worktrees/` wherever that is set).

```bash
find ~/Library/Caches/forge -maxdepth 3 -type d
```

```
/Users/you/Library/Caches/forge/becd95eb221b9af2
/Users/you/Library/Caches/forge/becd95eb221b9af2/worktrees
/Users/you/Library/Caches/forge/becd95eb221b9af2/worktrees/integration-forge-integration-current
/Users/you/Library/Caches/forge/becd95eb221b9af2/worktrees/run-retry-demo-20261020133126244-retry-demo-flaky-79f28903
```

(the real output above was captured on macOS, against this exact walkthrough, with only the home
directory itself replaced by `/Users/you` — the project-hash directory name, and everything below
it, is real: it is specific to this one project's own real path and will legitimately differ for
you, as will anything else your own machine's cache directory already held before this section, but
this project's own real output genuinely was exactly these two worktree directories, matching
`forge doctor`'s own count above.) Before this, a lane lived at `<project>/.forge/state/worktrees/`
— inside the tree a project's own test runner globs when looking for its own test files, which is
the real, confirmed bug this moved away from: a runner's own glob could wander into a lane's
in-progress copy of the project and get confused by code that was never meant to be running yet.
`forge doctor`'s `legacy-in-tree-worktrees` check (above) is what still watches for a worktree left
behind at the old location by a pre-M17 run, or a project upgraded mid-run — `ok` here because this
project was created fresh, post-M17.

## Where to go next

- [`docs/method-guide.md`](method-guide.md) — the stage/gate/workflow model this walkthrough only
  touched the surface of.
- [`docs/authoring-guide.md`](authoring-guide.md) — writing your own agents, skills, workflows and
  overlays once the built-ins don't fit.
- [`docs/adapter-guide.md`](adapter-guide.md) — the Claude Code adapter you just used, the generic
  declarative adapter for driving a different coding-agent CLI, and why there's no third, named
  adapter.
