<!-- forge:generated v=0.0.0 hash=8f15fe56cc7cd8c99f5952094ffe7fe38c228cb2ef30604dfbfce76138fd7ef3 — edits will be overwritten; use overrides/ -->
Build the additive half of the migration exactly as the migration plan ADR specifies. When you are
done, the old structure still works, the new structure exists next to it, and the data migration
step that follows can populate it. Nothing that the currently deployed code depends on may go away
or change meaning.

### Inputs

- The migration plan ADR from the previous step. It is your specification: the expand-phase changes,
  its change set (the paths and globs you may touch), the readers and writers inventory, the
  backfill strategy, the compatibility guarantee and the verification oracle. If it is missing,
  contradicts itself, or leaves the expand phase ambiguous, stop and ask (`FORGE_ASK:`) or hand back
  (`FORGE_HANDOFF: architect`); do not fill the gap yourself.
- The repository and its coding standards (`engineering/standards.md`), and the existing migration
  directory and its conventions.
- The workflow input `migrationGoal`, for context only.

### Produce

Code and tests in the lane, limited to the change set in the ADR (request any other path with
`FORGE_REQUEST_CHANGE:`):

- The additive schema or platform changes: new tables, columns, indexes, endpoints or dependencies.
  New columns are nullable or defaulted; new constraints are added in a way that existing rows and
  the old code satisfy.
- Whatever lets old and new coexist: dual writes, or reads that fall back from new to old, behind
  the switch the ADR names.
- The migration script or backfill routine that the data migration step
  (`forge migrate run --phase expand`) runs. Build it at the path and with the arguments the ADR
  names for the data migration, so a runner can execute it non-interactively, and state in the
  change how it reports completion. It is idempotent (a second run changes nothing), resumable after
  a crash, batched and throttled.
- A down migration where one is possible, and an explicit flag on the migration where it is not.
- Tests: the existing suite unchanged, which is what shows backward compatibility; the ADR's
  verification oracle (differential or round-trip between old and new representation); the script
  applied twice; the script interrupted and resumed; the script against a seeded copy with realistic
  volume shape.

You cannot run the suite yourself, so state the exact commands that should prove each of the above
(operating contract: you claim ready for verification, not done).

### Acceptance criteria

- No existing test was edited to make it pass. A test change means a compatibility break: stop and
  report it.
- The old code path, unmodified, is expected to work against the expanded structure, and you name
  the command that proves it.
- Every expand-phase item in the ADR is implemented and traceable to a test; nothing from the
  contract phase is present.
- The migration can be re-run and interrupted without corrupting or duplicating data, and a test
  says so.

### Do not

- Do not drop, rename, retype or narrow anything, add a NOT NULL without a default, tighten a
  constraint on populated data, or delete a reader, writer or feature flag. Those belong to the
  contract phase, and only after every reader has moved.
- Do not run the migration against real data or change the environment. The next step does that.
- Do not weaken the ADR (skip the backfill, drop the dual write) to make your work easier.
