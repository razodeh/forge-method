You are implementing a pipeline whose design has already been decided. The step brief sets the
deliverable; this is the pipeline-specific practice to apply, and the module conventions its checks
enforce.

**Start from the recorded approach.** Find the decision that chose batch, change-data-capture or
stream, and its freshness, quality and cost targets, and implement that. If the source or the
numbers no longer support it, do not switch on your own: revisit it against the
analytical-pipeline-design framework, raise the conflict with the decision, and build only what does
not depend on the approach until the decision has been amended or superseded.

**Structure each stage for safe re-runs.** Separate extraction, staging and transformation. Make
each stage idempotent over a defined window (replace a partition or merge on a key), parameterise
the window so a backfill is the same code path as the daily run, and record per run the window, row
counts in and out, and the source high-water mark. For change capture, handle deletes and updates
explicitly and define what replaying the stream does. For streaming, state the delivery semantics
you rely on, the windowing and watermark, and where state lives and how it survives a restart.

**Handle the awkward records on purpose.** Decide and implement what happens to late arrivals,
duplicates, out-of-order events, schema drift in the source, and rows that fail validation. A
rejected row goes to a quarantine with a reason and a count that raises an alert, never to nowhere.
Assert row counts across every join or filter instead of trusting them.

**Quality tests must satisfy the module's own check.** The `data-quality:tests` check reads
`docs/forge/kb/data/pipelines/*.md` and requires, for each pipeline document, a non-empty file
directly inside `test/data-quality/` (not in a subdirectory) whose name is the document's basename
followed by a dot, for example `orders.dq.test.ts` for `orders.md`; `orders_quality.test.ts` does
not match, and two documents with the same basename in different folders share one test file. If
tests for the story already exist, satisfy them and flag a missing or misnamed one with a change
request; write them yourself only when your step's claim includes them, covering key uniqueness and
not-null, referential integrity between layers, value ranges, source-to-target reconciliation,
freshness against the target and a deliberately bad fixture the tests must reject. If
`test/data-quality/` is outside your claim, request the path instead of skipping the tests.

**Lineage must satisfy its check.** The `lineage:coverage` check requires each pipeline document to
contain a `## Lineage` section with a `Source:` line and a `Target:` line naming real datasets on
the same line, comma-separated when there are several (for example `Source: postgres.orders` and
`Target: warehouse.fct_orders`). Make sure every pipeline you implement has such a document. If that
path is not yours to write in this step, request the change from the owner of the pipeline documents
with the text you would add, rather than leaving the pipeline undocumented.

**Diagram.** The pipeline flow view is produced by the pipeline-to-flow generator from a stage list
(names and dependencies) that must match the stages in your code. You cannot run the generator
yourself: give the stage list and name the generator as the diagram's source, and ask for it to be
generated; if you author the view by hand, mirror the stage list exactly and never label it as
generated.

**Before you finish:** no credentials in code, connection details from configuration, personal data
masked or excluded downstream as the design says, and the run structured so it can be re-run end to
end on a fixture, with the command listed in your verification note along with the commands for the
quality tests and the two module checks. Report only what you observed, and label the rest unrun.
