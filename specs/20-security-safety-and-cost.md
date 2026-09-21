# 20 — Security, Safety and Cost Governance

FORGE runs autonomous processes that write code, execute shell commands, reach external systems and
spend money on someone else's machine and someone else's repository. This file defines the
constraints that make that acceptable.

**Threat framing.** The adversaries are not only malicious humans. In order of realistic likelihood:

1. **A confused agent** — the most common by far. Deletes the wrong directory, force-pushes, commits
   a secret, runs a destructive migration against the wrong database.
2. **Poisoned context** — a prompt injection arriving through an MCP result, a fetched web page, a
   dependency README, a GitHub issue, or a file in a brownfield repo.
3. **A malicious or careless overlay/module** — third-party customization requesting broad
   capabilities.
4. **A compromised dependency** in FORGE itself or in the host project.
5. **A hostile user** trying to make FORGE do something to a machine they don't own.

Design consequence: **defences must work against accidents, not just attacks.** A control that
depends on the agent choosing to comply is not a control.

---

## 20.1 The permission model

Three independent layers; an action requires all three to permit it.

```
1. Agent grant     — what this role may ever do            (agent definition + ceiling, 05/15)
2. Step grant      — what this step needs                  (workflow step; ≤ agent grant)
3. Runtime policy  — what the environment permits right now (autonomy level, taint, environment)
```

Effective permission = intersection. **Fail closed:** if any layer cannot express a restriction, the
action is denied rather than allowed (`07` §7.2).

### Capability classes

| Class | Sub-capabilities | Default |
|---|---|---|
| `read` | repo files, KB, specs | granted to all agents |
| `write` | file creation/modification within the step's claim | implementation roles. Authoring roles hold the grant on the agent (it is not per step); a step of theirs that declares `outputs` has a claim of those outputs plus its `produces` (the documents its brief names), enforced `strict` at every autonomy level (`06` §6.7), while a step that declares none takes the autonomy-default claim policy. `reviewer` and `critic` never receive it; the engine writes the review report (`05` §5.7). |
| `exec` | shell commands matching an allowlist pattern | narrow per role |
| `network` | `none` / `allowlist` / `full` | `none` by default |
| `git` | `none` / `docs-only` / `lane` / `full` | `lane` for implementers |
| `mcp` | per-server, per-tool | none by default |
| `deploy` | invoke deployment tooling | `sre` only, `alwaysHuman` for production |
| `secrets` | specific named secrets | none by default |

**`network: none` by default is deliberate and load-bearing.** An agent that cannot reach the network
cannot exfiltrate a repository, and cannot fetch instructions from a URL an injected prompt supplied.
Package installation is the common exception and is handled as a **specific allowlist** of registry
hosts, not by opening the network.

### The exec allowlist

- Patterns are matched against the **parsed** command, not the raw string. Shell metacharacters
  (`;`, `&&`, `|`, backticks, `$(…)`, newlines) in a command that would chain to an unlisted
  executable cause denial, and the attempt is logged as a `PolicyViolation`.
- Patterns are anchored (`pnpm test*` does not match `rm -rf / # pnpm test`).
- A **hard denylist** overrides every allowlist and every autonomy level:
  `rm -rf /`, `rm -rf ~`, operations on paths outside the project root, `git push --force` to a
  protected branch, `git reset --hard` on the integration branch, `history` rewriting on shared
  branches, `chmod -R 777`, `curl … | sh`, `sudo`, package publish, disk formatting, killing
  processes outside the lane's process group.
- Commands that read as destructive but are legitimate in context (`docker rm`, `DROP TABLE` in a
  migration, `terraform destroy` against a preview env) route to the **destructive-operation flow**
  (§20.3) rather than being blanket-denied — blanket denial produces workarounds.

---

## 20.2 Filesystem and repository safety

1. **Path containment.** Every write is resolved (symlinks included) and must land inside the project
   root or the lane's worktree. Escapes are denied and logged. Symlinks pointing outside the project
   are not followed for writes.
2. **Deny list**, always: `.git/` internals, `.forge/state/`, `.env*`, `node_modules/`, any path
   matching the secret-file patterns, and anything in `.gitignore` unless explicitly claimed.
3. **Claim enforcement.** Out-of-claim writes are reverted (`strict`) or flagged (`warn`) per
   `06` §6.7.
4. **Git safety.** FORGE never force-pushes, never rewrites published history, never pushes to a
   remote unless `vcs.allowPush` is on and the branch matches an allowed pattern. Lane branches are
   namespaced `forge/<runId>/…` so they can never collide with human branches.
5. **The user's uncommitted work is sacred.** Before any run, if the working tree is dirty, FORGE
   stops and offers: stash, commit, or abort. It never discards uncommitted changes, and it never
   starts a run that could produce a conflict with work it cannot see.
6. **Pre-run snapshot.** A run records the starting SHA and dirty-file list, so `forge doctor` can
   always tell the user exactly what state to return to.

---

## 20.3 Destructive operations

A destructive operation is one whose effect cannot be undone by `git revert`.

| Category | Examples |
|---|---|
| Data | dropping tables, truncating, destructive migrations, deleting buckets/objects |
| Infrastructure | destroying environments, deleting clusters, removing DNS records |
| External | sending email, posting to third-party systems, publishing packages, creating public repos |
| Financial | anything that provisions billable resources |
| Repository | deleting branches with unmerged work, deleting tags, closing PRs |

**Flow:** classify → block → present (exact command, target, blast radius, reversibility, what
evidence exists that it is safe) → require **typed confirmation** from a human (never a keypress,
never an agent's assent) → execute with the outcome recorded → verify.

Rules:
- `security.destructiveOps: deny` blocks entirely; `confirm` (default) uses the flow above;
  `allow-in-lane` permits only within an ephemeral lane/preview environment, never against shared
  or production resources.
- **Production is never a target for an autonomous destructive operation** at any autonomy level.
- The confirmation prompt must name the *environment* and the *resource*, because the failure mode is
  a correct command against the wrong target.

---

## 20.4 Secrets

**Invariant:** secrets exist in exactly two places — the secret source, and the environment of the
process that needs them. Never in prompts, artifacts, the KB, logs, event records, transcripts,
diagrams, test fixtures, or the index.

| Control | Implementation |
|---|---|
| Reference syntax | `${secret:name}` in config; resolved at session launch only |
| Sources | env var, OS keychain, `secrets.local.yaml` (0600, gitignored, warned), or a command (`op read …`) |
| Delivery | Child process environment, scoped to the step's `secrets` grant. Never argv (visible in `ps`), never stdin-echoed, never a file in the worktree |
| Redaction | A redactor runs on every event payload, log line and transcript chunk **before serialisation**, using both the configured patterns and the *known values* of resolved secrets |
| Pre-commit | A secret scanner runs on every lane diff before commit; a hit blocks the commit and is a `PolicyViolation`, not a warning |
| Verification | `forge doctor` confirms each referenced secret resolves without printing it (reports length + a non-reversible fingerprint only) |
| Rotation | If a secret is detected in a diff or artifact, FORGE marks it compromised, refuses to proceed, and instructs rotation — scrubbing the file is not sufficient and FORGE says so |

**Test obligation:** a repository-wide scan over a completed fixture run asserting that no known
secret value appears in any file under `.forge/` or `docs/forge/` (`21`).

---

## 20.5 Untrusted content and prompt injection

Any content not authored by the user or by FORGE is untrusted: MCP results, fetched pages,
dependency files, brownfield source, issue trackers, logs from third-party systems.

**Controls:**

1. **Delimit and label.** Untrusted content is wrapped in a labelled block declaring it is data, not
   instructions, and never interpolated directly into an instruction position in the prompt.
2. **Strip control tokens.** `FORGE_*` tokens appearing inside untrusted content are removed and
   logged as `InjectionAttemptBlocked`. This is done in the adapter layer, at the boundary.
3. **Taint propagation.** A step whose context includes untrusted content is marked `taint: external`
   and loses privileged actions: it cannot escalate grants, approve gates, write ADRs without human
   confirmation, target production, or perform destructive operations (`15` §15.5.4).
4. **Structural defence over detection.** Do not rely on detecting malicious text. Rely on the fact
   that a tainted step has no dangerous capabilities to abuse. Detection is a signal; capability
   restriction is the control.
5. **Output scanning.** Agent output is checked before it becomes an artifact: no secrets, no
   attempts to modify `.forge/config.yaml` or overlays from within a lane, no additions to allowlists.
6. **Brownfield caution.** `forge adopt` reads a repository FORGE did not write. Its analysis steps
   run tainted and read-only by construction (`17`).

---

## 20.6 Supply chain

For FORGE itself:
- Lockfile committed; dependencies pinned; `pnpm audit` in CI; provenance on publish
  (`npm publish --provenance`); no `postinstall` scripts in FORGE's own package.
- Minimal dependency surface; every new runtime dependency requires justification in the PR (this is
  a rule for the implementer, and it is why `02` §2.1 hand-rolls small utilities).
- The bundled Mermaid script used for diagram rendering is version-pinned and integrity-checked.

For host projects (enforced via `14` and gate checks):
- SBOM generation, dependency scanning, licence policy, signed artifacts, pinned CI actions by SHA,
  federated short-lived credentials instead of static keys.

For overlays/modules (`15` §15.11, `19`):
- Capability declaration and explicit consent before installation.
- Static scan of skill bodies and templates for injection-shaped content and for grant-widening.
- Checksums recorded in `manifest.yaml`; drift detected at `forge doctor`.
- Third-party overlays run with the same ceilings as everything else — installation does not grant
  capability, only *requests* it.

---

## 20.7 Privacy and data handling

- **Local-first, no telemetry** (`03` §3.8). No analytics, no phone-home, no version ping unless
  requested.
- Code and prompts go only to the configured model provider through the adapter. FORGE adds no other
  destination. If a user enables OTLP export or a remote diagram renderer, that is an explicit,
  documented egress decision surfaced at the time of enabling.
- Transcripts contain source code and live in gitignored state. `forge state prune` removes runs
  older than a retention window (default 30 days), and `forge state export --redacted` produces a
  shareable bundle with secrets and PII removed for support purposes.
- Host-project PII controls (classification, retention, deletion, data map) are the `12` F-DATA-7
  framework's job; this file governs FORGE's own handling.

---

## 20.8 Cost governance

Cost is a safety property here: an unbounded autonomous loop is a financial hazard as much as an
engineering one.

### The ledger

Every session records into `ledger.ndjson` and the index: run, step, agent, model, platform, input /
output / cache-read tokens, cost, whether the cost is **reported or estimated**, duration. Adapter
figures are treated as client-side estimates and labelled accordingly (`07` §7.3) — reports never
present an estimate as an invoice.

### Enforcement points

| Level | Control | On breach |
|---|---|---|
| Step | `limits.max_cost_usd`; adapter told the cap where supported; supervisor aborts the session when exceeded | Step fails as `budget`; escalation policy applies |
| Run | `budget.perRunUsd` + admission control (a step is not launched unless the remaining budget covers its cap) | `budget.onBreach`: pause / finish-lanes / abort |
| Period | `budget.dailyUsd` tracked in the ledger | New runs refused until reset or override |

Breaches always **pause and ask** by default. Silent continuation past a budget is never acceptable;
silent abandonment of in-flight work is nearly as bad, hence `finish-lanes` as an option.

### Cost hygiene requirements

- **Admission control before launch**, not detection after the fact.
- **Context packing budgets** (`kb.packBudgetTokens`, `skills.packBudgetTokens`) exist as much for
  cost as for quality; over-budget packing is a warning with the top consumers named.
- **Retry accounting:** retries are attributed to the original step so a step that costs $6 across
  three attempts reports $6, not $2.
- **Reporting:** `forge cost` shows spend by run/stage/agent/model, the ten most expensive steps, and
  **cost per merged story** — the metric that tells the user whether the method is economical.
- **Runaway detection:** a step whose token consumption grows monotonically across retries without
  progress (no file changes, no artifact produced) is halted as a suspected loop.

---

## 20.9 Audit

Everything privileged is recorded and reportable:

- Every gate decision, approval, rejection and waiver (with reason, owner, expiry).
- Every tool-ceiling escalation, with approver and expiry, shown in the TUI header while active.
- Every policy violation, blocked injection, redacted secret, and destructive-operation confirmation.
- Every MCP call (server, tool, argument digest, outcome).
- Every artifact write with the run and agent that produced it.

`forge audit --since <date> [--json]` produces the consolidated report. For regulated projects this
is the evidence trail; for everyone else it is how you answer "why is this line here?" six months
later.

---

## 20.10 Safety invariants (test obligations)

Each has a corresponding test in `21`:

| # | Invariant |
|---|---|
| S1 | No write ever lands outside the project root or lane worktree, including via symlink or `..` |
| S2 | Hard-denylist commands are refused at every autonomy level, including when composed with shell operators |
| S3 | Secrets never appear in any file under `.forge/` or `docs/forge/` after a fixture run |
| S4 | A step granted `network: none` cannot reach the network |
| S5 | Control tokens embedded in MCP/fetched content are stripped and logged, never executed |
| S6 | A tainted step cannot approve a gate, escalate a grant, or target production |
| S7 | Destructive operations require typed human confirmation naming environment and resource |
| S8 | Uncommitted user work is never discarded; a dirty tree halts the run with options |
| S9 | Budget caps abort or pause runs; retries are attributed to the originating step |
| S10 | An overlay requesting capabilities beyond its ceiling is refused at compile time |
| S11 | `forge doctor` verifies secret resolution without exposing values |
| S12 | Killing the supervisor at any point leaves no orphaned child processes or worktrees that block a resume |
