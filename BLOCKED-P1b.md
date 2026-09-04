# BLOCKED — P1b (the hermetic test environment)

> **STATUS: RESOLVED.** Resolved: option A was approved and applied — the guard reaches builtins through
`process.getBuiltinModule` before their ESM facade exists, which closed the defect class this
document identified. Residual adversarial risk is recorded in `SPEC-QUESTIONS.md` Q14. Retained as
the record of the analysis.

Second escalation. P1b was created by the approved option B in `BLOCKED-P1.md`; it has now run two
BUILD → CRITIC → JUDGE rounds (the fourth and fifth on this work overall) and lost both. Not marked
done, nothing committed.

---

## 1. The finding that matters

Three separate network channels have now been defeated by **one mechanism**, discovered three times,
in three different rounds:

| Round | Channel | How it escaped |
|---|---|---|
| 2 | `worker_threads` | Subclassing `Worker` did not affect `import { Worker } from 'node:worker_threads'` |
| 4 | `child_process` | Patching the export did not affect `import { execFileSync } from 'node:child_process'` |
| 5 | `dns` | Patching the export did not affect `import { resolve4 } from 'node:dns'` |

Node builds a builtin's ESM facade **once**, snapshotting the current values of its exports. Any patch
applied after that facade exists is invisible to every named and namespace import — which is the
spelling ordinary code uses. Reproduced this round inside a green suite:

```
RESULT: ESCAPED ["104.20.23.154","172.66.147.243"]
      Tests  1 passed (1)
```

That is a completed query to a public nameserver, from a test that passed.

I recorded this exact mechanism in `SPEC-QUESTIONS.md` Q12 when I abandoned the `child_process`
patch — and did not go back and apply it to `dns`, which is patched the same way. The guard's
"positive and closed" claim has been false in each of the last three rounds, for the same reason each
time.

A second, independent delivery gap: `NODE_OPTIONS` is how the guard reaches another realm, and any
realm that controls its own environment drops it. `new Worker(code, { env: { PATH } })` is unguarded.
`Q12` declares this for child processes and **not** for workers, while `PLAN-M1.md` P1b lists workers
as covered — an inaccurate declaration, which is worse than an undeclared gap.

## 2. The other findings this round

Ordinary bugs, fixable under either option below, listed so nothing is lost:

- **`pnpm test` fails on Node 20**, so 2 of 7 CI legs are red and `main` is unmergeable as it stands.
  `test/network-guard.test.ts` uses global `WebSocket`, which Node 20 has only behind a flag. This
  also falsifies Q9's rationale, which asserts the floor runs on 20/22/24.
- **A failing test under any `specs/` or `fixtures/` directory is invisible** to both the collection
  globs and the walk that exists to prove nothing is invisible — the two exclusion lists match at any
  depth and share the blind spot by construction. For a spec-driven product, `packages/<pkg>/specs/`
  is not a hypothetical directory name.
- **False denials on the most ordinary loopback spelling.** `net.connect(port)` with no host — Node
  documents the default as `localhost` — is denied with an error naming `<undefined>`. Every future
  integration test that writes `net.connect(server.address().port)` hits it.
- **R10 lint gaps**: `Date()` without `new`; `process.hrtime()`/`process.uptime()`; and
  `toLocaleString(undefined)` / `localeCompare(b, undefined)` / `new Intl.NumberFormat(undefined)`,
  because the rules use argument *count* as a proxy for "an explicit locale" — and
  `test/lint-rules.test.ts` codifies that proxy by asserting the two-argument form is clean.
- **`scripts/**` is blanket-exempt from R10**, and `PLAN-M1.md` P9 puts the schema emitter there with
  a mandate of byte-stable output and "no timestamps". The rule that would catch `new Date()` in it is
  already switched off, by a config that is not P9's to change.

## 3. Why I am stopping rather than fixing

I have twice told you a round would converge, and been wrong both times. The count is not falling:
5 → 5 → 2 → 3 → 4 blocking. More importantly, the *same* root cause produced a blocking finding in
three consecutive rounds, and on the middle occasion I wrote the correct diagnosis down and still did
not generalise it.

The honest conclusion: **an in-process monkey-patch cannot be a closed guarantee against a hostile
reader.** It can be strong against accidents, which is what `specs/21` §21.1 actually asks for
("catches accidental network dependencies"). I have been holding it to a standard it cannot meet, and
reporting closure it does not have.

## 4. The two options

**Option A — one mechanism that addresses the root cause, then match the claim to it.**
Load the guard with **no static imports** of the modules it patches, and reach them through
`process.getBuiltinModule('node:dns')` (available from Node 20.16; the floor is 20.19). That returns
the CJS object *without* causing the ESM facade to be built, so patching happens before the snapshot
exists and named imports see the guarded functions. One change closes the `dns` escape, the
`worker_threads` escape and the abandoned `child_process` case together, because all three are the
same defect. Then fix §2's ordinary bugs and **rewrite the claim**: the guard denies accidental access
on every channel it names; a `{ env: … }` realm and a non-Node binary stay declared limitations.

This is materially different from the previous two rounds: a single mechanism aimed at the cause,
not three patches aimed at three symptoms. It is still a monkey-patch, so I will not claim it is
closed against a determined bypass.

**Option B — move the guarantee out of process and downgrade the in-process guard to advisory.**
Enforce denial where it cannot be patched around: a network-denied sandbox for the suite in CI
(a container with no egress, or a proxy that refuses everything). The in-process guard stays as a
fast, friendly local signal with an explicitly advisory contract. This is the only version that is
genuinely closed, and `specs/20` §20.1 already establishes capability restriction as FORGE's control
model — so it is the design the spec pack's own philosophy points at. Cost: CI-only enforcement, a
local/CI behaviour split, and a piece of infrastructure P1b did not budget for.

## 5. What I need from you

Which option. My recommendation is **A now, B later** — A because it is one bounded change that
provably addresses the cause of three findings and unblocks the milestone, B recorded as the design
for the piece that adds CI infrastructure, since it is the only form the guarantee can take that
survives a hostile reader. Say the word and I will also cap it: if a sixth round finds another
escape of this same class, that is the signal to take B rather than a seventh round.

I have applied none of round 5's fixes while this is open.
