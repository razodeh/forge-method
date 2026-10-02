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
Note that `forge status` itself only succeeds once a run has actually started — on a fresh project
with no run yet, it exits non-zero with
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
line (each is a disclosed, deliberate scope boundary, not an oversight — see
`packages/cli/src/bin.ts`'s own top-of-file doc comment for the authoritative, current list):

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

```js
// src/add.js
export function add(a, b) {
  return a + b;
}
```

```js
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

```js
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

## Where to go next

- [`docs/method-guide.md`](method-guide.md) — the stage/gate/workflow model this walkthrough only
  touched the surface of.
- [`docs/authoring-guide.md`](authoring-guide.md) — writing your own agents, skills, workflows and
  overlays once the built-ins don't fit.
- [`docs/adapter-guide.md`](adapter-guide.md) — the Claude Code adapter you just used, the generic
  declarative adapter for driving a different coding-agent CLI, and why there's no third, named
  adapter.
