### Specialisation for the release notes in a store submission

The step brief lists everything the submission record contains. This is how to write its release
notes well, and how to keep them consistent with the build the rest of the record describes.

1. Fix the range first. Identify the last released version and the candidate build, taking the
   candidate's version and build number from the build record, and use the history commands your
   grant allows (log with decoration and tag information shows tags; log with patch or stat output
   shows the changes in a range); check your constraints for which other git subcommands you may
   run. State the exact range you are describing. If there is no prior release, say so and describe
   the release as an initial one. Do not describe changes outside the range.
2. Build the change inventory from evidence: read the history in the range, but also read the diffs
   of the files that matter to users of the app (permissions and their justifications,
   configuration, migrations, screens, error messages, documentation). Map each change to the story
   or decision that justifies it, and keep that mapping in your closing message; the ids do not go
   into the store text. A commit you cannot map to a user-visible effect is either internal (omit
   it) or a sign of an undocumented change (raise it under Open items).
3. Classify each entry by type (new, changed, fixed, removed) and collapse related commits into
   single entries. When a user would say "what does that mean for me?", the entry is not finished.
4. Breaking changes and removed behaviour get a full block each: what changes, who is affected, the
   ordered steps the user takes (checked against the repository so every setting, screen and path
   exists), and when it takes effect. A changed default is a breaking change for anyone who relied
   on the old one, so include it here.
5. Deprecations: if this release deprecates or removes something a user relies on, say so in the
   notes with the date it takes effect, reading the windows from the project's own deprecation
   policy. If your context holds no policy or earlier deprecation list, list the missing windows
   under Open items instead of inventing them.
6. The version and build number are given by the build record. Copy them, and check them against
   your change classification instead of recommending a new one: a breaking change under a
   patch-level version is a finding for Open items.
7. State what did not change where a user could reasonably worry: for example, no sign-in again is
   required, or stored data is untouched.
8. Add upgrade notes (minimum OS versions, what a user must do before or after updating, known
   issues) and mark anything you could not verify as unverified rather than omitting it.

Check before finishing: no entry is a raw commit subject; every breaking change has user steps and
an effective date; the store text carries no ticket ids or commit hashes; dates are written as
complete dates; no empty group is present; the version is consistent with the breaking-change list.

Common mistakes: hiding a breaking change inside a "Changed" bullet; "performance improvements" with
no recorded measurement behind them (cite a measured effect only from a recorded report); user steps
with settings or screens that do not exist in the app; forgetting the previous release's
deprecations; writing for the team's memory of the work instead of the user's need.
