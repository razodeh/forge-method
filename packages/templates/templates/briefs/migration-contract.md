Remove the old structure the migration replaced. This is the irreversible half of expand-contract,
so your first job is to establish whether it is safe. You act only if the evidence is in front of
you, and stopping is a correct and expected outcome when it is not.

### Inputs

- The migration plan ADR: the contract-phase changes, its change set, and above all the
  preconditions it lists for the point of no return and the release boundary it requires.
- The output of the previous step, the data migration (`forge migrate run --phase expand --json`):
  what ran, what it reported, whether it completed, and the counts or checksums it returned.
- The repository, to find every remaining reference to the old structure, and the evidence file the
  plan ADR names under `delivery/` for the reader switch, the deployment and the restore point.

### Verify first, then act

Before you change anything, check each precondition from the ADR against the evidence in these
inputs, and record the source of each conclusion (the file, the search you ran and its result, the
report line):

1. The data migration completed, and the new structure matches the old according to the counts or
   checksums the migration output reports.
2. No reader or writer outside migration code and its tests still references the old structure.
   Search the code, jobs, reports, configuration and contract files, and quote the search and its
   empty result.
3. The release in which readers switched to the new structure has been deployed and the previous
   code version is no longer running, as the ADR's release boundary requires. That evidence must
   exist in the file the ADR names; you cannot infer it from the code.
4. The reversal path the ADR describes for the point of no return exists (a backup or snapshot
   reference, or the documented restore procedure).

If any precondition fails or cannot be evidenced from these inputs, stop. Do not perform the
contract change. Report which precondition failed and why (`FORGE_HANDOFF: architect` or
`FORGE_ASK:` with specific options). This workflow contains no step that switches readers or deploys
a release, so missing evidence for precondition 2 or 3 is a likely result, and stopping is the right
response.

### Produce, when every precondition holds

Code and tests in the lane, limited to the change set in the ADR:

- The removal of exactly the old structure the ADR names: old columns, tables, endpoints or
  dependencies, the dual-write and fallback code, the temporary switch, and the tests that only
  exercised the old structure.
- A contract migration with its irreversibility stated in its own header and a pointer to the
  restore procedure.

### Acceptance criteria

- Each precondition appears with the evidence you gathered, in the change description.
- No reference to the removed structure remains, and you name the commands that should prove the
  suite is still green. The next step runs `forge test run --json` to verify; you cannot run it
  yourself.
- The change touches only what the ADR names, so it reviews as one small, separate change.

### Do not

- Do not "tidy" unrelated code, or remove anything the ADR does not list.
- Do not perform the contract change in the same release as the last reader switch.
- Do not treat a passing suite as proof that no reader remains: tests do not cover jobs, reports or
  outside consumers.
