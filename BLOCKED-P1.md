# BLOCKED — P1 (workspace scaffold and deterministic floor)

> **STATUS: RESOLVED.** Resolved: option B was approved and applied. P1 was split, and the hermetic test
environment became P1b. See `GAUNTLET-LOG.md`. Retained as the record of why the split happened.

Escalated per `BUILD-PROMPT.md` Step 2, *Escalation*: three full BUILD → CRITIC → JUDGE rounds, three
losses. Not marked done. No threshold lowered, no assertion weakened, no test edited to pass.

---

## 1. What the bar demands

P1's mandate is the deterministic floor: `specs/21` §21.1's guarantees — denied network, pinned
timezone, pinned locale, pinned git, no reliance on filesystem ordering — established such that the
rest of the build inherits them. `QUALITY-BAR.md` R10 restates it as a rubric criterion, and R5/R6
require the guarantees be proven by tests rather than asserted by configuration.

Read precisely, that mandate contains a **negative universal**: *no* test can reach the network, *no*
failing test can go uncollected, *no* uncovered line can pass. Sections 3 and 4 below are about that
phrase, because it is the thing that is actually blocking.

## 2. What I produced

Floor commands green (`build`, `typecheck`, `lint`, `test`); 27 tests; `--frozen-lockfile` verified
from a clean copy; green under `TZ=Asia/Kathmandu` and under shuffled seeds. Verified closed across
the three rounds, each with a test that fails without its fix:

- `node:http`/`https`/`net`/`tls`/`http2`, undici-backed `fetch` in all three input shapes, IPv6
  literals, `dgram` addressed *and* connected, `dns`/`dns.promises`/`Resolver`, dynamic
  `import('node:net')`, and **worker threads** — default, explicit `execArgv: []`, and nested.
- Per-file coverage thresholds, including never-imported files and the `packages/core/src/**` group.
- Collection of `.spec`, `.tsx` and `modules/*`, each proven by a planted failing test.
- A fixed-SHA git commit assertion that catches identity, dates, `autocrlf`, `gpgsign` and default
  branch in one line.

Round 3's critic independently confirmed all of the above still holds.

## 3. Why the gap persists

Blocking findings per round: **5 → 5 → 2**. Converging, but not to zero, and the three rounds found
the *same three classes* of defect in different places each time:

**(a) The allow-list fails open.** `isLoopbackHost` (`test/network-guard.mjs:75`) tests
`host.startsWith('127.')` against a raw host *string*, so `127.0.0.1.nip.io` — a real DNS name
answered by a public nameserver — is treated as loopback. I reproduced it: the TCP connect is allowed
and the DNS query leaves the machine. `resolveTcpTarget` has the same shape: an unrecognised `host`
option defaults to `'localhost'`, i.e. *allowed*. Round 1 found the fetch-only hole, round 2 found
dns/dgram/workers, round 3 found this. Each is a different instance of one root cause — a guard whose
unknown case is permissive.

**(b) Enforcement claims with no test.** `SPEC-QUESTIONS.md` Q6 declares child processes "out of
reach of any in-process guard". Execution contradicts the *rationale*: the child already loads the
guard through the inherited `NODE_OPTIONS` and no-ops only because `isMainThread` is `true` in a
child process. I reproduced a spawned child completing HTTP 200 while the suite was green. Deleting
`!isMainThread &&` closes it. Separately: deleting the entire `no-restricted-syntax` block leaves
`pnpm test` green — the lint rules that carry the most confident comments have no test at all, which
is why rounds 2 and 3 both found live holes in them (`globalThis.Math.random()`,
`import proc from 'node:process'`, `const { env } = process`).

**(c) Each mechanism becomes new unguarded surface.** `scripts/run-tests.mjs` was added in round 2 to
fix the locale and worker holes. Round 3 found it is typechecked by nothing (`tsconfig.json` omits
`scripts/`), and that its locale mechanism is a no-op on Windows, where ICU reads
`GetUserDefaultLocaleName` rather than `LC_ALL` — so `test/setup.ts:73`'s assertion passes on the CI
Windows legs only because the runner happens to be en-US, and a Windows contributor on a non-English
system locale gets a hard throw on every test file with a message that misdirects.

The pattern is not that the fixes are wrong. It is that "no bypass exists" cannot be discharged by
inspection or by a fixed number of adversarial passes: each critic samples a different region and
finds a real hole. That is the property of a **security control**, and I have been building it as
scaffolding — a deny-list extended reactively, one channel per round.

## 4. The two options

**Option A — one more round, same shape.** Fix round 3's seven findings (fail-closed
`isLoopbackHost` gated on `net.isIP`; drop `!isMainThread`; extension-agnostic collection and
coverage globs asserted by set *equality* against `vitest list`; ban coverage-ignore pragmas; an
`ESLint#lintText` fixture test per R10 spelling; `scripts/` into `tsconfig` include; explicit ICU
default instead of `LC_ALL`) and run a fourth critic. Every finding is concrete and none is
architectural — I estimate this converges. It requires your agreement to exceed the three-round
limit, and a fifth critic could still find an eighth channel.

**Option B — reframe the guarantee, then fix (recommended).** Split P1's mandate:

1. **P1 keeps** the toolchain, configs, CI, and the guarantees that already have failing-without-the-
   fix tests. Judgeable and close to done.
2. **The network denial becomes its own piece with a threat model**, because that is what it is. Its
   allow-list becomes *positive and closed*: permit unix sockets, `::1`, and IP literals in `127/8`
   as validated by `net.isIP` — deny everything else, including every hostname, with no string
   prefixes anywhere. That single change collapses class (a): there is no unknown case left to fail
   open, so `127.0.0.1.nip.io`, a `String` object host, and any future spelling are all denied by
   construction rather than by having been anticipated. Child processes move from "out of reach" to
   covered, since the delivery channel demonstrably works. Coverage is then one test per *declared*
   channel, which is a finite, reviewable list — not an open hunt.
3. **The lint rules get a test**, per the discipline `PLAN-M1.md` P2 already requires of the boundary
   rules: `ESLint#lintText` over a fixture per spelling, asserting the message. Class (b) becomes
   mechanically checkable.

Option B costs one extra piece boundary and makes the remaining work finite. Option A is faster if it
converges and has no bound if it does not.

## 5. What I need from you

Which option — and if B, confirmation that adding a piece to `PLAN-M1.md` mid-milestone is acceptable
rather than a scope change you want to see first. I have not applied any round 3 fix while this is
open.
