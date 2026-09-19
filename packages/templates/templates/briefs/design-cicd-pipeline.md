# Design the CI/CD pipeline

Decide the platform and the stage graph that carries this stage's changes from a pull request to
production, and record the decision. The stages after you (`deploy`, `smoke-test`, rehearsed
rollback, then `G-Deliver`) all run against what you specify here.

## Inputs

This step declares no inputs. Read the KB: `constraints/**` (hosting, compliance, budget), the build
and artifact strategy in `delivery/`, the architecture spec's deployable units, the stage's
non-functional requirements, and any existing pipeline or CI files in the repository. Decide from
what is there. If the repository already has a working pipeline, design the change to it; do not
design a replacement from scratch.

## Produce

An `ADR` in category `delivery`, framework `cicd-pipeline-design`, with the headings the ADR schema
requires, `## Context`, `## Options considered`, `## Decision`, `## Diagram`, `## Consequences` and
`## Reversal plan`, plus `## Score table` and `## Killer risk` from the framework. Artifact
validation fails an ADR missing a required heading.

- Platform: choose from the candidates (GitHub Actions, GitLab CI, CircleCI, Buildkite, Jenkins) or
  the one already in use, and score them on the framework's criteria: fit to the VCS host, parallel
  stage support, OIDC federated identity support, cost, and team familiarity. State the killer risk
  of the winner.
- Stage graph, for both triggers, as concrete stages with what each may block:
  - on pull request: setup and cache, static checks (format, lint, typecheck), unit, integration and
    contract tests in parallel, security scans (dependencies, static analysis, secrets), a build
    with no publish, end-to-end tests in a preview environment, and `forge gate check --json`;
  - on merge to trunk: a full verify, build with SBOM and signing, publish, deploy to staging,
    migrate then smoke and end-to-end tests, the `G-Deliver` approval, progressive production
    deploy, post-deploy verification and soak, and automatic rollback on a service-level breach.
- Adapt the graph to this project, and say which stage you dropped or added and why.
- Diagram: draw the pipeline in the project's notation as a `Diagram` file under
  `docs/forge/kb/delivery/pipeline/`, the area you own, with a caption. Reference it from the ADR's
  `diagrams` and its `## Diagram` section. `G-Deliver` fails on a missing or stale pipeline diagram.

## Acceptance

State each of these explicitly in the ADR; each is checkable.

- The pipeline is the only path to production. If a break-glass path exists it is documented,
  audited and leaves a record.
- The pipeline runs the same commands as the local gate suite, so "works locally" and "works in CI"
  cannot diverge.
- Fast checks run first; independent stages run in parallel; the target for the pull-request
  pipeline is under 10 minutes and the ADR says how it will be met.
- Pipeline definitions live in the repository, and third-party actions or plugins are pinned by
  commit SHA, not a floating tag.
- Pipeline credentials use short-lived federated identity where the platform supports it; no
  long-lived static keys. Secrets are referenced by name, never written into the ADR or a file.
- Every stage writes machine-readable results under `docs/forge/reports/` so gates read the verdict.
- Reversibility, blast radius and a revisit trigger are filled in.

## Do not

- Do not write the pipeline configuration files themselves in this step; you decide the design.
- Do not choose a platform because it is fashionable. Use the scores, and cite the constraints.
- Do not design a stage that has no owner of its failure or no stated effect on the gate.
