# QUALITY-BAR.md

The standard every piece of FORGE is judged against. This file is normative for review. It is not a
style guide — every criterion below is binary and answerable by a hostile reader who does not know
who wrote the code, from the diff, the tests, and the spec pack alone.

Nothing merges until the floor passes **and** every rubric criterion is `yes`.

---

## 1. Exemplars

Three real, installable TypeScript CLI/monorepo projects. Each was inspected directly (published
tarball and/or a clone) before being named here; the properties below are the ones observed, not
remembered.

### 1.1 pnpm (`pnpm@9.15.9`, published bundle inspected)

**Property A — every failure has a stable machine code and a human remedy.**
pnpm raises `PnpmError(code, message, { hint })`. Inspection of the shipped bundle yields a closed
taxonomy of codes (`ERR_PNPM_UNSUPPORTED_ENGINE`, `ERR_PNPM_LOCKFILE_BREAKING_CHANGE`,
`ERR_PNPM_TARBALL_INTEGRITY`, `ERR_PNPM_NO_MATCHING_VERSION`, `ERR_PNPM_RECURSIVE_RUN_NO_SCRIPT`, …),
and the `hint` field carries the *next action*, not a restatement of the failure — e.g. the lockfile
error's hint is "This issue is probably caused by a badly resolved merge conflict. To fix the
lockfile…". That is exactly the shape `ForgeError.remedy` must have (`specs/02` §2.6).

**Property B — the CLI states what it found, not only what it wanted.**
pnpm's errors attach the observed state alongside the expectation (e.g. the workspace-package list is
printed with the "no matching version" failure). FORGE errors are judged the same way: an error that
says a check failed without saying what value it saw fails review.

### 1.2 Zod (`zod@4.5.4`, `src/` shipped in the tarball and inspected)

**Property A — untrusted input is `unknown`, never `any`; failures are a closed discriminated union.**
`src/v4/core/errors.ts` defines `$ZodIssueBase` with `readonly input?: unknown` and `readonly path:
PropertyKey[]`, and every issue subtype narrows a literal `code`. There is no `any` on the parse
surface. FORGE parses user-authored YAML, overlay files, adapter output and event-log lines — all of
it is `unknown` at the boundary and a validated type after it, with a discriminated failure type.

**Property B — the public type is precise enough that the docs are redundant.**
Zod's exported types (`$ZodInvalidTypeExpected` as a literal union rather than `string`) make invalid
states unrepresentable rather than documented-as-invalid. FORGE's exported unions — error codes,
severities, step states, merge operators, gate outcomes — are literal unions, never `string`.

### 1.3 Changesets (`changesets/changesets`, cloned and inspected)

**Property A — many small packages with a real dependency graph, each independently testable.**
21 packages (`errors`, `config`, `parse`, `assemble-release-plan`, `apply-release-plan`, `git`, …)
where the interesting logic sits in pure packages that never touch the filesystem. FORGE's
`specs/02` §2.2 graph is the same idea with lint enforcement added; a piece that can only be tested
by standing up the whole system is a design failure, not a testing inconvenience.

**Property B — tests exercise the public entry point with a builder, and assert whole results.**
`packages/assemble-release-plan/src/index.test.ts` builds state via a `FakeFullState` helper, calls
the package's exported `assembleReleasePlan`, and asserts the entire returned release object with
`toEqual` — not intermediate calls, not spies on internals. Rewriting the implementation from scratch
leaves those tests valid. That is the test style FORGE requires.

---

## 2. Rubric

Twelve binary criteria. A hostile reader answers each `yes`/`no` from the artifact alone. Any `no`
means the piece loses — there is no partial credit, and "acceptable for now" is not an answer.

| # | Criterion | How a `no` is proven |
|---|---|---|
| **R1** | **No imprecise public types.** Every exported symbol has an explicit type annotation. No `any` anywhere in non-test source; every `as` has a comment naming the invariant that makes it sound; every `@ts-expect-error` cites a tracked issue. Boundary input (`YAML`, `JSON`, adapter stdout, event-log lines) is typed `unknown` until validated. | `grep -n '\bany\b\|as unknown as\|@ts-expect-error' ` over the diff's non-test files returns an unexplained hit, or an exported symbol's type is inferred as `any`/`{}`/`Function`. |
| **R2** | **Every error is a typed `ForgeError`.** It carries `code` (from the `specs/02` §2.6 prefix taxonomy), `severity`, `docsUrl`, and a `remedy` that names a concrete next action and includes the offending value or path. No bare `throw new Error`, no rejected promise with a string, no error whose remedy restates the message. | A thrown value in the diff is not a `ForgeError`, or a `remedy` contains no imperative verb / no observed value. |
| **R3** | **Module boundaries hold.** The imports in the diff are a subset of the package's allowed dependencies in `specs/02` §2.2. No upward imports, no deep imports into another package's internals, no `../../<other-package>` path escapes. | `pnpm boundaries` fails, or an import in the diff is absent from that package's row in the §2.2 table. |
| **R4** | **No platform concept above `adapter-kit`.** The strings `claude`, `mcp`, `subagent`, and any model identifier do not appear in source outside `packages/adapter-*` — except where a spec explicitly places them there (the MCP *registry* schema, per `specs/15`, is named by spec and is the sole exception; it names servers, it does not know what Claude is). | A grep for those tokens hits a file outside `packages/adapter-*` with no spec citation permitting it. |
| **R5** | **Tests are written against the spec, not the implementation.** Each test file cites the spec section it enforces. Tests call the package's public entry point; they do not import internal modules, spy on private functions, or assert call counts on collaborators. Deleting the implementation and rewriting it differently keeps every test valid and meaningful. | A test imports a path not exported by the package's `index.ts`, asserts on a mock's call order, or would need editing after a pure refactor. |
| **R6** | **Failure paths are tested.** For every failure mode the piece's spec sections describe, there is a test asserting the specific error `code` — not merely that it threw. The set must include, where applicable: malformed input, abort/`AbortSignal`, timeout, mid-write crash, path escape, and concurrent access. | A documented failure mode in the cited spec sections has no test asserting its code, or a test asserts only `expect(fn).toThrow()`. |
| **R7** | **No unfinished work in production code.** No `TODO`, `FIXME`, `XXX`, `HACK`, no function that returns a placeholder value, no branch that silently no-ops, no business logic implemented as a mock outside `packages/testkit` and `*.test.ts`. Unimplemented-by-design surfaces (embeddings retrieval, PlantUML/D2) throw a `ForgeError` naming the deferral and its spec section. | Any such marker or placeholder in a non-test file. |
| **R8** | **Public API doc comments explain *why*.** Every exported symbol has a TSDoc comment stating the guarantee it makes and the reason for a non-obvious choice, with a `@see specs/NN §N.N` link. A comment that restates the signature in prose counts as absent. | An exported symbol has no TSDoc, or its TSDoc adds no information beyond its name and parameter types. |
| **R9** | **Resumability and idempotence are proven, not asserted.** Where the spec requires a step to be resumable or idempotent, a test kills the operation at a boundary and shows the retry converges to the same state. Where the spec requires durability, the fsync-before-side-effect ordering (`specs/18` §18.10) is present and a test proves the side-effect cannot precede the flush. | The spec requires resumability for this piece and no test kills-and-resumes it; or a side-effect is issued before its authorising append is flushed. |
| **R10** | **Determinism.** No `Date.now()`, `new Date()`, `Math.random()`, `crypto.randomUUID()`, or `process.env` read outside an injected clock / seeded RNG / config layer. No reliance on `readdir` ordering — every directory listing is explicitly sorted. Running the piece's tests twice with different `--seed` and under `TZ` set to a non-UTC zone gives identical results. | A direct clock/RNG/env call in non-test source, an unsorted `readdir` feeding output, or a test that fails on a second seed. |
| **R11** | **Cross-platform correctness.** All disk paths are composed with `node:path`; `path.posix` is used only for repo-relative artifact IDs. No symlinks are created. No shell string interpolation of paths. Path handling has a test covering a Windows-shaped path (drive letter, backslashes) and a `..`/absolute-path escape attempt. | A string-concatenated path, a `/`-literal separator on a disk path, or no path-escape test. |
| **R12** | **Atomicity and containment on every write.** Every write to a host project goes through the `@forge/core/fs` helpers: containment-checked against the project root or lane worktree, denied for `.git/`, `.forge/state/`, `node_modules/`, and performed as write-temp → fsync → rename. No partially-written file is observable after a crash. | A direct `fs.writeFile` to a host-project path in the diff, or a write path with no containment check. |

**Judging rules.** Judge the artifact, not the effort: difficulty, time spent, and "this is fine for
now" are not evidence. Each criterion is scored with a quoted evidence line (file:line) for `yes` and
a quoted counter-example for `no`. A criterion that does not apply to the piece is marked `n/a` with
one sentence saying why — `n/a` may not be used to dodge R1, R2, R5, R7, or R10, which apply to every
piece.

---

## 3. The floor

Deterministic checks. These run **before** anything is judged. A piece with a failing floor check is
not reviewed, not discussed, and not committed.

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm boundaries
```

Plus, on every package the piece changes:

| Package | Lines | Branches |
|---|---|---|
| `core`, `schemas`, `kb`, `engine`, `extensions`, `vcs` | ≥ 90% | ≥ 85% |
| every other package | ≥ 85% | ≥ 80% |

Coverage is **ratchet-only** (`specs/13` F-TEST-5): the committed threshold rises to meet the
achieved number and never falls. Lowering a threshold, weakening an assertion, adding an
`/* istanbul ignore */`, or narrowing a glob to get past a failing check is a review failure in
itself, independent of the code.

> **Threshold note.** `specs/21` §21.1 sets 90/85 on the correctness-critical packages and 80/70
> elsewhere; `BUILD-PROMPT.md` §0.3 sets 85/80 on changed packages. The table above takes the
> stricter of the two per package, which satisfies both. Recorded in `SPEC-QUESTIONS.md` §Q1.

Additionally, and enforced as part of `pnpm test`:

- **No network in unit or integration tests.** A `fetch`/undici interceptor throws on any outbound
  request (`specs/21` §21.1). A test that needs the network is in the `live` suite or does not exist.
- **`TZ=UTC` and a pinned git identity** in test setup.
- **Emitted JSON Schemas match the committed ones** (`scripts/assert-schema-drift.mjs`).
