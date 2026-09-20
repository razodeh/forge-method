Prepare the mobile app for a release build of the target this run was started for (the workflow's
`buildTarget` input). That input is not one of this step's declared inputs, so if the target's name
is not in your context, ask with `FORGE_ASK:` rather than guessing; wherever `<buildTarget>` appears
below, put that name. When you finish, the release configuration is in the repository and the
device-matrix test suite can run against it; the store-readiness gate follows that run.

### Inputs

- `kb:engineering/standards.md`: the project's build, versioning and code conventions.
- The repository: the app's build configuration, version and build-number fields, signing and
  environment configuration, feature flags, and any existing release scripts and device-matrix
  tests.
- The `G-Verify` result this build packages, and the KB's `delivery/` and `mobile/` entries if
  present.

### Produce

The release configuration changes, inside the app's own paths, and one `Task` record describing
them.

- Version: set the marketing version and build number for this release according to the project's
  versioning convention, and increase the build number monotonically. Do not reuse one that was
  already submitted.
- Release build type: release configuration (optimisation on, debug tooling, test-only endpoints and
  verbose logging off), for every platform the app ships on.
- Signing: reference certificates, provisioning profiles, keystores and their passwords only by the
  names of the secrets or environment variables that supply them. Never write a secret value, and
  never commit a signing file.
- Reproducibility: the release build must succeed from a clean checkout with documented commands and
  no step that depends on your machine.
- Device-matrix suite: the next step runs `pnpm test -- test/device-matrix/<buildTarget>.test.ts`.
  If that file does not exist, create it, with a test per supported platform and OS range the
  project claims to support, exercising launch, the main user flow and the offline behaviour the
  standards require. It must be able to fail. Do not write results into
  `docs/forge/kb/mobile/device-matrix.md`. The module's `device-matrix:coverage` check reads a
  `## Coverage` section there, one line per device in the form
  `- Device: <name> | OS: <version> | Result: pass|fail`, and needs at least one iOS and one Android
  row. Those rows are written only from devices that really ran, and nothing in this workflow writes
  them, so a person must add them from the real runs; do not pre-fill them.
- The `Task` record: the version and build number, build configuration and commands, the secret
  names the build needs, the files changed, the device rows still to be run for
  `docs/forge/kb/mobile/device-matrix.md`, and anything else that must still be done by a person,
  such as a certificate renewal or store account action.

### Acceptance

- Version and build number are set, consistent across platforms, and higher than the last release.
- The build commands in the `Task` are exactly the ones that produce the artifact.
- No secret value, signing file or personal credential appears anywhere in the change.
- The device-matrix test file exists at the path above and is runnable.
- Name the commands that build the release and run the suite.

### Do not

- Do not submit to a store, upload a build, or change store listings; that is a later step.
- Do not disable a test, lint rule or signing check to get the build through.
- Do not change application behaviour or add features to the release.
