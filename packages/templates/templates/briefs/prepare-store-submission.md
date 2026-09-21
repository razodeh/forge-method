Write the store submission record for the release build that just passed the store-readiness gate.
Someone will use it to complete the submission, so every fact in it must come from the project, not
from you.

### Inputs

`kb:delivery/**`: the release plan and notes, the environment and pipeline decisions and the changes
since the last release. It does not hold everything you need, so also find: the `Task` the
release-build step wrote under `docs/forge/specs/tasks/` (version, build number, commands), the
device matrix at `docs/forge/kb/mobile/device-matrix.md`, and the `G-Deliver` report under
`docs/forge/reports/gates/`. The build target is the `buildTarget` input of this run.

### Produce

One Markdown document at `docs/forge/kb/delivery/release/store-submission-<buildTarget>.md`, in the
release area you own, and one `HandoffRecord` entry that registers it in the handoff register
`docs/forge/reports/handoffs.md` (leave every other entry as it is); no other document. The entry
has subtype `store-submission-record`, `from: release`, `to: human`,
`step: prepare-store-submission → merge-submission`. There is no `subtype` key, so the first string
in `delivered` is `subtype: store-submission-record`, the second is the record's path, and every
open item that blocks submission goes in `open_questions`. Include in the document:

- Identity: app name, bundle or package id, version, build number, target platforms and minimum OS
  versions. Copy them from the build record; do not compute or guess them.
- Release notes for the store, written for the people who use the app: what changed for them and
  what they must do, if anything. Do not paste commit subjects. For a breaking or removed behaviour,
  state the action the user takes.
- Store metadata checklist: for each store, what must be provided and its current state: category,
  age rating answers, privacy disclosures and data-safety answers consistent with what the app
  collects, permission justifications for each requested permission, screenshots per required device
  size, and support and privacy-policy links.
- Review notes: how a reviewer signs in or reaches gated features, without writing any real
  credential; refer to where the secret is held.
- Evidence: the device-matrix results and the `G-Deliver` gate report this record rests on, with
  paths. Say which devices and OS versions were tested.
- Rollout: staged or phased release percentages if the store supports them, what would make you halt
  it (crash rate, ratings, error rate) with thresholds, and how to withdraw or supersede the build.
- Open items: each thing that is not ready, who owns it, and whether it blocks submission.

### Acceptance

- Every stated fact traces to a KB entry or report you read; anything missing is in Open items, not
  invented.
- The privacy and permission answers match the app's real data collection and requested permissions.
- The release notes contain no internal ticket ids, commit hashes or codenames.
- No secret, token or credential appears in the record.

### Do not

- Do not mark a checklist item done because it is usually done. Mark it done only with the evidence.
- Do not claim device coverage the matrix does not show.
- Do not submit the app; you prepare the record.
