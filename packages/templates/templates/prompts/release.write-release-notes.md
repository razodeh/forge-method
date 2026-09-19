### Specialisation for writing release notes

1. Fix the range first. Identify the last released version and the candidate, using the history
   commands your grant allows (log with decoration and tag information shows tags; log with patch or
   stat output shows the changes in a range), and check your constraints for which other git
   subcommands you may run, and state the exact range you are describing. If there is no prior
   release, say so and describe the release as an initial one. Do not describe changes outside the
   range.
2. Build the change inventory from evidence: read the history in the range, but also read the diffs
   of the files that matter to readers (interface contracts, configuration, migrations, command-line
   definitions, error catalogues, documentation). Map each change to the story or decision that
   justifies it. A commit you cannot map to a reader-visible effect is either internal (omit it) or
   a sign of an undocumented change (raise it).
3. Classify each entry by audience and type, and collapse related commits into single entries. When
   a reader would say "what does that mean for me?", the entry is not finished.
4. Breaking changes get a full block each: what breaks, who is affected, the ordered migration steps
   (checked against the repository so every command, key and path exists), the announcement version,
   and the removal timeline. Include compatibility and default-value changes here; a changed default
   is a breaking change for anyone who relied on the old one.
5. Update the deprecation ledger inside the release record, marked internal (not for user-facing
   text), and read the minimum announce, deprecate and sunset windows from the project's own
   deprecation policy: list everything currently deprecated with its announcement version and
   planned removal, adding this release's new deprecations and dropping only what is actually
   removed.
6. When the step asks for a version recommendation, give it with a one-line justification tied to
   the change classification, and say what would change it; when the version is supplied, copy it
   and check it against your classification instead.
7. State what did not change where a reader could reasonably worry: for example, no data migration
   is required, or the configuration format is unchanged.
8. Add upgrade notes (order of operations, required minimum versions, rollback guidance, known
   issues) and mark anything you could not verify as unverified rather than omitting it.

Check before finishing: no entry is a raw commit subject; every breaking change has migration steps
and a timeline; every entry traces to the internal record (and none of the user-facing text carries
ticket ids or commit hashes); dates are written as complete dates; no empty group is present; the
version recommendation is consistent with the breaking-change list.

Common mistakes: hiding a breaking change inside a "Changed" bullet; "performance improvements" with
no recorded measurement behind them (cite a measured effect only from a recorded report); migration
steps with commands that do not exist in the repository; forgetting the previous release's
deprecations; writing for the team's memory of the work instead of the reader's need.
