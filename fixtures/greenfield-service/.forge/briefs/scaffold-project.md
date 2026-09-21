<!-- forge:generated v=0.0.0 hash=182c3d2a9ae43eb74094c2549b538de863dc43b216bcaee214d798a195ad120e — edits will be overwritten; use overrides/ -->
Generate the real project scaffold from the repository, layout and stack decisions already made,
ending in a smoke path that builds and tests from a clean clone. `G-Foundation` will check exactly
this: a clean build, a reproducible install, a CI skeleton, and a working test command.

### Inputs

- The repo-strategy ADR and `delivery/repo-strategy.md` from `decide-repo-strategy`.
- The architecture and stack ADRs, `architecture/components.md`, the "Deployable units and runtimes"
  table in the architecture spec, the data model, and `engineering/standards.md`.
- The KB constraints (`constraints/**`): licence, mandated tooling, and environments available.

### What to produce

Files in the repository, following the repo strategy exactly. If the repository already contains a
project, add only what is missing and never overwrite an existing file; report any file you could
not add for that reason. Every KB document below is a KB entry in its section, except
`engineering/dod-profiles.yaml`, which is plain YAML with no front matter.

- Root files: `README.md` (how to install, build, test, run and deploy), `FORGE.md` (how this
  project is run by agents), `.editorconfig`, `.gitignore`, `.gitattributes`, `CONTRIBUTING.md`, the
  ownership file (CODEOWNERS) from the repo strategy, and a `LICENSE` only if a constraint names the
  licence.
- A task runner (`Makefile`, `justfile` or the native equivalent) with one command each for
  `install`, `build`, `test`, `format`, `lint`, `typecheck`, `scan` (dependency and secret
  scanning), `run`, a `verify` target that runs the whole local gate suite, one command per test
  layer (`test:unit`, `test:integration`, `test:contract`, `test:e2e`, `test:nfr`), and
  `test:preflight`, which prints exactly what is missing to run each layer. A layer with no tests
  yet still has its command; it runs zero tests and says so. Tests run in randomized order where the
  framework supports it. Record all these commands in the KB entry `delivery/build.md`; every gate
  uses them. FORGE's own test runner reads its layer commands from `execution.testCommands` in
  `.forge/config.yaml` (layers unit, integration, contract, e2e, nfr, smoke, lint, typecheck;
  `smoke` is the small suite `G-Deliver` runs against a deployed environment, so map it only when
  one exists), which you may not edit: end your closing message with that exact map, written as one
  `forge config set execution.testCommands.<layer> "<command>"` line per layer so the human can
  apply each with one command, and request the change (`forge doctor --rule test-command` fails
  `G-Foundation` until the `unit` command is set). Each mapped command must be a single test-runner
  invocation (chained shell commands, `*` wildcards and a leading `VAR=value` are refused), and a
  layer with no command is reported as unable to verify. The agents that run tests are granted
  exactly these commands and no others.
- Reproducibility: the toolchain version pinned (`.nvmrc`, `.tool-versions` or the ecosystem's
  equivalent), the dependency lockfile committed, and installation from the lockfile alone.
- The directory layout, chosen with the directory-layout method (feature or domain first by default
  at L2 and above), with its dependency rules enforced by a lint check wired into `lint`. A layout
  convention nobody checks will be violated. Write the layout convention and the formatter, linter,
  type-check strictness, and error and logging conventions into `engineering/standards.md`,
  extending the technology step's entry and never overwriting it, and make each convention a
  configuration file that the `format`, `lint` and `typecheck` commands run.
- `engineering/ways-of-working.md`: branching model (trunk-based by default), commit convention,
  merge strategy, protected branches, and what an agent may do with git (commit, push, open PRs,
  merge).
- `engineering/dod-profiles.yaml` and `engineering/definition-of-done.md`. The YAML has a top-level
  `profiles:` map; each profile (`backend-default` at least, plus any other a story type here needs)
  has a `ready` list and a `done` list. A plain string in either list is a condition expression,
  never a shell command. Use exactly these `ready` entries for `backend-default`:
  `story.acceptance.length > 0`, `story.files_expected.length > 0`,
  `{ check: spec:story-refs-resolve }` and `{ check: spec:no-blocking-open-questions }`. Each `done`
  entry is a `{ check: <id> }` such as `build:typecheck`, `build:lint`, `test:unit --scope story`,
  and each id is mapped to its task-runner command in `delivery/build.md`. A malformed file makes
  every ready story fail the readiness gate.
- `src/` and `tests/` per the layout and the testing conventions in `engineering/standards.md`,
  environment `config/`, `scripts/` (including `scripts/dev-setup`), the local dependencies
  integration tests need (a compose file or the ecosystem equivalent), and observability bootstrap
  (logger and tracer initialization).
- The scaffold smoke path: one trivial path through every layer of the architecture (request,
  handler, repository, store, response), with one passing unit test, one integration test and one
  end-to-end test.
- An `ADR` (category `delivery`, with the score table) for each build-toolchain or layout choice
  that had a real alternative, and one each for the version-control conventions (including what
  agents may commit, push and merge) and the development environment.
- The local development environment as an `Environment` entry (in `kb/delivery/environments.md`)
  with `purpose`, `url`, `deploy_trigger`, `data_policy`, `secrets_source`, `owner` and `access`,
  plus `.env.example` listing every variable without secret values.

### Acceptance criteria

Give in your closing message the exact commands that should prove each item.

- On a clean clone, `install`, then `build`, then `test` succeed, and `test` runs at least one real
  test.
- Installing twice from the lockfile gives an identical dependency tree.
- The layout lint fails on a deliberate boundary violation, and passes on the smoke path.
- The smoke path contains no unfinished markers, no stub returns and no hard-coded responses
  standing in for real behaviour.
- The commands listed in `delivery/build.md` match the task runner, name for name.
- `engineering/dod-profiles.yaml` parses, and every `done` check id has a command in
  `delivery/build.md`.

### Do not

- Do not touch `.forge/`, or KB and spec sections other than the ones named above.
- Do not implement product features beyond the smoke path.
- Do not commit secrets, generated build output or real credentials.
- Do not add tooling the stack ADRs do not call for.
