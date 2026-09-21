<!-- forge:generated v=0.0.0 hash=14f57b5c20b308e6c83c9d7210f207c533138e928e464492616a70b7e205c186 — edits will be overwritten; use overrides/ -->
Create the continuous-integration skeleton on top of the scaffold, so that every pull request runs
the same checks a developer runs locally. `G-Foundation` checks that the skeleton exists and that
the test command it calls works.

### Inputs

- The scaffold from `scaffold-project`: the task runner and the commands in the KB entry
  `delivery/build.md`.
- The repo-strategy ADR, the stack ADRs, and `engineering/standards.md`.
- The KB constraints (`constraints/**`): hosting or CI platform already mandated, secrets policy,
  licence constraints.

### What to produce

Files under `.github/**` and `ci/**`. Use the platform the constraints mandate; if the host or
platform is unstated, ask the human before choosing, and record the choice as an `ADR` of category
`delivery` with alternatives and a score table. If the platform is not GitHub, its files fall
outside this step's file claim, so request a change to the claim instead of writing elsewhere.

- A pull-request pipeline with these stages in order of cost: setup with dependency cache; static
  checks (format, lint, typecheck); the unit, integration and contract test commands, run in
  parallel where independent; dependency and secret scanning; a build that does not publish; an
  end-to-end stage using the scaffold's `test:e2e`; and a job that runs the project's gate check.
- A trunk pipeline that reruns the full verification, builds the artifact, generates an SBOM and
  signs the artifact where the platform supports it (scripts for these live under `ci/`), and then
  deploys the scaffold's smoke path to the development environment the scaffold recorded, using the
  deployment platform from the stack ADRs, followed by a smoke request. If no development deployment
  target is defined yet, do not invent one: leave that stage as a documented, disabled job, record
  why in a short `ci/README.md`, and raise it with the platform role. Publishing to a registry and
  deploying to staging or production belong to the delivery phase.
- A record of that deployment, for the gate's `skeleton:deployed` check
  (`forge doctor --rule skeleton-deployed`): after the smoke request, the deploy job writes
  `docs/forge/reports/deployments/<ENV-id>.json` (the `ENV-###` of the development `Environment`
  entry) as JSON with `v: 1`, `environment`, `outcome` (`succeeded` only when the deploy and the
  smoke request both passed), `sha` (the deployed commit), `deployed_at`, and `health` (`url` on the
  environment's host, `status`, `checked_at`). Say in `ci/README.md` how that file reaches the
  repository. Until a real deployment has produced it the check fails, and the honest way through is
  a recorded Waiver, never a hand-written record.
- Machine-readable output from every stage, so gates can read the verdict instead of re-running
  everything. Test results go to `docs/forge/reports/test-results.json`, the file FORGE's own test
  reporter writes, so do not invent another format at that path; write lint and coverage results
  elsewhere under `docs/forge/reports/` in a documented format.

### Rules the pipeline must follow

- It calls the same commands as `make verify` or the local equivalent. Do not duplicate command
  lines into the workflow file; call the task runner, so that local and CI behaviour cannot diverge.
- Third-party actions and plugins are pinned by full commit SHA, not by a floating tag. If you
  cannot verify a SHA, list that action as unpinned in your closing message; never invent one.
- Credentials are short-lived and federated where the platform supports it; no long-lived secret is
  written into the repository.
- The pull-request pipeline is designed to finish in under 10 minutes; note the expected slowest
  stage and how it is parallelized.

### Acceptance criteria

- Each pipeline stage names the exact task-runner command it runs, and each command exists in the
  scaffold.
- The workflow file is valid configuration for its platform; state which command or tool should
  confirm that, since you may not be able to run it.
- No secret values, tokens or private URLs appear in any file.
- `delivery/pipeline.md` in the KB (a KB entry) lists the stages, what each is allowed to block, and
  how a developer runs the identical set locally.

### Do not

- Do not deploy to staging or production, define environments beyond what the scaffold recorded, or
  add release automation.
- Do not add stages for tools the project does not use.
- Do not change the scaffold's commands to suit the pipeline. If one is wrong, report it and hand it
  off.
