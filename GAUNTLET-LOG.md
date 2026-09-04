# GAUNTLET-LOG

Unsanitised, per `BUILD-PROMPT.md` Step 3. This log exists to calibrate the bar, so what the critic
caught that I missed is recorded plainly.

---

## P1 — workspace scaffold and deterministic floor

**Rounds: 3. Outcome: BLOCKED** (see `BLOCKED-P1.md`). Not committed, not marked done.

### Round 1 — 5 blocking, 7 major

What the critic caught that I missed:

- **The network guard was theatre.** I swapped `globalThis.fetch` and wrote six tests around it. A
  `node:http` probe reached a real server with HTTP 200 while the suite reported green. I had even
  written a comment justifying the fetch-only approach on the false premise that `specs/02` §2.1
  forbids an HTTP client. `specs/21` §21.1 says "undici/fetch interceptor" — I implemented the
  narrowest reading of the spec text and called it done.
- **The guard installed in `beforeAll`**, i.e. after the test file and its imports were evaluated.
  Import-time requests escaped entirely.
- **Coverage thresholds were aggregate-only.** An entirely untested module passed if a sibling file
  was large enough. I had "verified" the thresholds worked using a probe with *one* file.
- **Colocated `src/*.test.ts` was never collected** — a planted failing test reported green. My own
  `QUALITY-BAR.md` §1.3 names that layout as the required style.
- **`pnpm boundaries` did not exist** though the plan's own check named it.
- No `.gitattributes`: all three Windows CI legs would have failed `prettier --check` on first push.
- Six git env vars pinned, but not `core.autocrlf`, `gpgsign`, `init.defaultBranch`. My git tests
  were `expect(process.env.X).toBeDefined()` — tautologies asserting the line above them.
- Nothing enforced R10. `Date.now`, `Math.random`, `crypto.randomUUID`, `process.env` all lint-clean.
- CI forced `TZ: UTC`, so every timezone assertion passed because of the runner, not the code.

Caught during my own BUILD phase (test-first paid): the guard threw synchronously where real `fetch`
rejects, which would escape any caller with only a `.catch()`.

### Round 2 — 5 blocking, 4 major

- **CI could not install.** I edited `@types/node` without regenerating the lockfile;
  `--frozen-lockfile` fails on all seven legs. Local runs passed on stale `node_modules`.
- **The declared Node 20.10 floor was uninstallable** — changesets 3 needs `^22.11`, rolldown needs
  `styleText` (20.12+), `import.meta.dirname` needs 20.11. I had added `engine-strict=true` in round
  1 *with a comment about protecting contributors*, which is what made it fatal.
- **Three more network escapes**: `dns.resolve4`/`lookup`, `dgram.connect()`-then-`send()` (my guard
  read the address off `send`, which a connected socket does not carry), and **worker threads** —
  fully open, and not in my own "what this cannot cover" list.
- **The locale pin was a no-op.** ICU resolves the locale at startup, so `process.env.LC_ALL` in a
  setup file did nothing. The test meant to prove it compared `['b','A','a','B']`, which orders
  identically in every locale. Decorative test guarding a non-existent mechanism.
- **I edited P1's own acceptance criteria** (five floor commands → four) without recording it. The
  substance was right; doing it under my own signature was not. Now `SPEC-QUESTIONS.md` Q7.
- Lint rules had holes exactly where their comments were most confident: `Date` via alias,
  `globalThis.crypto.randomUUID()`, bare `process.env` destructuring, `readdir` from `node:fs/promises`.

Closing the worker hole took three attempts; the two failures are worth keeping. Subclassing `Worker`
does not work — Node snapshots a builtin's named exports when building the ESM facade, so
`import { Worker }` holds a binding namespace reassignment never reaches. Pushing onto
`process.execArgv` does not work — Node captured the real list at startup. Vitest overrides
`poolOptions.execArgv`. Only `NODE_OPTIONS`, set before Node starts, works.

### Round 3 — 2 blocking, 5 major

- **A failing test outside the four scanned roots is silently uncollected** — `./root-escape.test.ts`
  and `./scripts/hidden.test.ts` both invisible. The floor test I added in round 2 to prevent exactly
  this scans the same four roots the globs use, so it can never observe the gap. Reproduced.
- **`127.0.0.1.nip.io` is treated as loopback** — a real DNS name, answered by a public nameserver.
  My allow-list prefix-matches a host *string*. Reproduced: connect allowed, DNS query left the box.
- **Child processes are not "out of reach"** as `SPEC-QUESTIONS.md` Q6 claims — the child already
  loads the guard via inherited `NODE_OPTIONS` and no-ops only because `isMainThread` is true in a
  child process. Reproduced: HTTP 200 while the suite was green. My *declared divergence* had a false
  rationale, which is worse than an undeclared one.
- **`/* v8 ignore */` defeats coverage entirely** and nothing detects it, though `QUALITY-BAR.md` §3
  names adding an ignore pragma as a review failure in itself.
- **Deleting the whole `no-restricted-syntax` block leaves `pnpm test` green.** The floor's own rules
  are the one thing in the piece with no test — which is why rounds 2 and 3 both found live holes.
- The locale pin is a no-op on Windows (ICU reads `GetUserDefaultLocaleName`, not `LC_ALL`), so the
  assertion passes on the CI Windows legs by luck.
- `scripts/run-tests.mjs` is typechecked by nothing; `tsconfig.json` omits `scripts/`.

### Calibration note

The bar is doing its job — every round found real, reproducible defects, and severity is falling
(5 → 5 → 2 blocking). But the three rounds found the same three *classes* each time: an allow-list
that fails open, an enforcement claim with no test, and each new mechanism arriving as unguarded
surface. That is the signature of a security control being built as scaffolding. `BLOCKED-P1.md` §4
proposes making the allow-list positive and closed, which collapses the first class by construction
rather than by anticipation.

---

## P1b — the hermetic test environment

Created by the approved option B in `BLOCKED-P1.md`. **Rounds: 2 (4th and 5th overall). Outcome:
BLOCKED** — see `BLOCKED-P1b.md`.

### Round 4 — 3 blocking, 3 major

- **The "closed" allow-list was still open.** `resolveTcpTarget` treated every string first argument
  as a unix pipe, so `socket.connect('80', '1.1.1.1')` skipped the allow-list and completed a real
  TCP connection. Node's own test is `typeof s === 'string' && toNumber(s) === false`. Every existing
  test used numeric ports, so the whole shape was untested — I had written the tests to match the
  implementation I had in mind rather than the API's actual surface.
- **Every R10 rule was off for `.mjs` repo-wide.** I scoped an exemption `**/*.mjs` for two harness
  files, while `vitest.config.ts` treats `.mjs` under `packages/*/src/` as production source. No test
  could see it because every lint case hard-coded a `.ts` fixture.
- **The source-layout walk was non-recursive** — only files directly in a package root were checked,
  so a module in `lib/` carried no coverage floor.
- A false denial: the DNS guard blocked `dgram`'s implicit bind, which resolves `0.0.0.0` locally
  with no packet. Loopback UDP was unusable while preventing nothing, and blamed `channel: 'dns'`.

Self-inflicted, worth recording: fixing the child-process gap by patching `node:child_process` hung
vitest before any test ran, because replacing `exec` dropped the symbol `util.promisify` reads. I
bisected it, fixed that, and then found the patch never worked anyway — a named import holds the
snapshot Node takes when it builds a builtin's ESM facade. I had hit that exact mechanism in round 2
with `Worker` and did not recognise it.

### Round 5 — 4 blocking, 3 major

- **The `dns` guard is defeated by `import { resolve4 } from 'node:dns'`** — the third channel lost to
  the ESM-facade snapshot, and the first one where I had already written the correct diagnosis down
  (`SPEC-QUESTIONS.md` Q12, for `child_process`) and failed to apply it to the code next to it.
- **A worker with an explicit `env` is unguarded**, because `NODE_OPTIONS` is the whole delivery
  mechanism. Q12 declares this for child processes and not for workers, while `PLAN-M1.md` P1b lists
  workers as covered — an inaccurate declaration, worse than an undeclared gap.
- **`pnpm test` fails on Node 20**: global `WebSocket` is flag-gated there, so 2 of 7 CI legs are red.
  I added that test without ever running the floor on the floor.
- **A failing test under any `specs/` or `fixtures/` directory is invisible to both the globs and the
  walk that exists to prove nothing is invisible** — the exclusions match at any depth, so the two
  share a blind spot by construction. Same shape as the round-3 finding, in a new place.
- R10 lint gaps: `Date()` without `new`, `process.hrtime`, and `toLocaleString(undefined)` — the
  locale rules use argument *count* as a proxy for "explicit locale", and the lint tests codify the
  proxy.
- False denial: `net.connect(port)` with no host, whose documented default is `localhost`.

### Calibration note

The bar is calibrated correctly — every round found reproducible defects and the critic has never
padded. What the log shows is a *builder* failure, not a bar failure: one root cause produced a
blocking finding in three consecutive rounds, and I patched symptoms each time. Twice I told the user
a round would converge and was wrong. `BLOCKED-P1b.md` §3 states the conclusion plainly: an
in-process monkey-patch cannot be closed against a hostile reader, and I have been reporting closure
it does not have.

### Rounds 6-10, and the conclusion

Rounds 6 through 10 each found real defects, and the blocking count did not reach zero: 2, 0, 2, 2,
and round 10 never completed — it died on a spend limit, which is its own finding.

What they caught, briefly: `dns.lookupService` unconditionally permitted (it is `getnameinfo` and
always sends a PTR query); the `scripts/**` R10 exemption reintroduced one glob over from where it
had just been removed, with a comment in the adjacent block explaining why that would be wrong;
`0.0.0.0` denied, which is what `dgram.bind(0)` always reports, so the canonical UDP round-trip was
impossible; a `tsc` race that made the suite green only in parallel; the allow-list applied to the
queried DNS *name* rather than the nameserver it is sent to, so `dns.reverse('127.0.0.1')` sent real
packets; and the same `NODE_OPTIONS` fail-open shipped three times — substring, then token scan, then
finally a real parse.

**The calibration finding is about the loop, not the bar.** Every round found something, and that
felt like justification for another. `BLOCKED-P1b.md` §3 had already concluded that an in-process
monkey-patch cannot be closed against a hostile reader; the loop ran seven more rounds after that
conclusion was written down. By round nine the findings required hand-crafting hostile values —
`--title <guardUrl>` — which no contributor writes by accident, while `@forge/core` and
`@forge/schemas`, the actual M1 deliverables, still did not exist.

`QUALITY-BAR.md` §4 is the amendment: findings gate a commit only when they are accidental-reachable,
adversarial-only findings become recorded residual risk, and the loop caps at two critic rounds with
a scoped verify pass rather than an open-ended re-hunt. The bar itself is unchanged.

---

## P3 — ForgeError taxonomy

**Rounds: 2 (one critic, one scoped verify — the amended loop). Outcome: WON.** Committed `47ba1ea`.

### Round 1 — 3 blocking, 6 major, all accidental-reachable

- **`JSON.stringify(error)` threw** on a cyclic or `bigint` detail, so the event log could not persist
  the errors this package produces. `render.ts` exists precisely because a renderer that throws while
  something has already gone wrong replaces a diagnosable failure with an undiagnosable one — and I
  had applied that reasoning to the message path and not the serialisation path.
- **`exitCodeFor` returned `undefined`**, typed as `ExitCode`, for `{...error, context}` — the
  ordinary way to add context in a catch block. `process.exit(undefined)` exits 0, so a failed run
  would report success.
- **`fromJSON` took a typed argument at an untrusted boundary** and crashed with a `TypeError` from
  inside a message template on a truncated log line, which is the input resume reads.
- **`details` was untyped per code**, so a wrong key compiled and rendered `<missing>`. The critic
  named this the expensive-in-five-years finding, correctly.
- The `ErrorCodePrefix` union was decorative; a `PERF-001` row typechecked. `formatForTerminal`
  honoured neither `ascii` nor `color` for detail values. The warning-severity branch was dead and
  its test would have passed with the colour hardcoded. The coverage ratchet P3 owned did not exist.
- **The brand's doc comment was false**: it claimed the value survived a worker boundary, and
  `structuredClone` drops symbol-keyed properties, so an error silently downgraded to exit 1 — the
  precise failure the comment claimed to prevent.

### Round 2 — scoped verify: all nine fixed, seven smaller findings

The verify pass reproduced each original defect before confirming the fix, which caught things a
re-hunt would not have: templates interpolating `${d.key}` directly still rendered the literal string
`"undefined"` where a key was absent (the `<missing>` assertion passed); `fromJSON` accepted an array,
since `typeof [] === 'object'`; the circular-detail encoder dropped the *whole* key rather than the
one offending field, losing the status and body a debugger wants; and `pnpm typecheck` never reached
`packages/core` at all, because the package declared no `typecheck` script — it was being checked
incidentally by a test shelling out to `tsc`.

It also flagged, correctly, that adding the ratchet's CLI wrapper to the coverage `exclude` glob is
the shape `QUALITY-BAR.md` §3 names as a review failure. The mitigation is real — the decision logic
moved to `scripts/lib/`, is unit tested, and the wrapper is driven as a subprocess — but it wanted
explicit sign-off rather than passing silently, and it got it.

### Calibration note

The amended loop worked. One critic, one scoped verify, two rounds, committed — against P1b's ten.
The verify pass being *scoped* is what made it useful: asked "were these fixed", it reproduced each
defect first and found four residuals in the same families, which an open-ended re-hunt would have
spent its budget elsewhere. Two of round 1's nine findings were mine to have caught: both were cases
where a doc comment stated a guarantee and the test named after it asserted something weaker.
