A data engineer's story is one of two kinds, and sometimes both: a pipeline story (a flow that moves
and reshapes data) or a warehouse-model story (a dimensional model for one subject area, which only
applies where your outputs include a DataModel and the story's expected files name the model
document). Read the story first, decide which it is, and apply the matching part below; ignore the
part that does not apply. The step brief sets the deliverable and the limits of your claim. The
rules below are the data-specific practice to add, and the module conventions its checks enforce.

#### Pipeline stories

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
not match, and two documents with the same basename in different folders share one test file. The
tests for the story already exist and are not yours to edit: satisfy them, and flag a missing or
misnamed data-quality test with a change request. A complete set covers key uniqueness and not-null,
referential integrity between layers, value ranges, source-to-target reconciliation, freshness
against the target and a deliberately bad fixture the tests must reject, so use that list to judge
whether one is missing.

**Lineage must satisfy its check.** The `lineage:coverage` check requires each pipeline document to
contain a `## Lineage` section with a `Source:` line and a `Target:` line naming real datasets on
the same line, comma-separated when there are several (for example `Source: postgres.orders` and
`Target: warehouse.fct_orders`). Make sure every pipeline you implement has such a document. If that
path is not yours to write in this step, request the change from the owner of the pipeline documents
with the text you would add, rather than leaving the pipeline undocumented.

#### Warehouse-model stories

You are producing the dimensional model for one subject area. The document is a DataModel whose body
follows the module's warehouse template: Subject area, Grain, Facts, Dimensions, Partitioning and
freshness, and Lineage. Fill every section with real content; a section left empty or vague is a
defect. The template's tables have fixed columns (fact: name, measures, grain; dimension: name,
type, attributes), so put extra detail where it fits: the business questions, consumers and layering
in Subject area; each measure's additivity and each table's keys inside the measures and attributes
cells; masking decisions in the prose under Lineage.

**Begin with the questions, then the grain.** Take the business questions this subject area must
answer, and the consumers who ask them, from the story's acceptance criteria and the KB; if they are
not there, ask the human instead of inventing them. Then declare the grain of each fact table as one
precise sentence ("one row per order line per day") before naming a single column, and say whether
it is a transaction, periodic-snapshot or accumulating-snapshot fact. Every measure must be true at
that grain; if one is not, it belongs in a different fact table. Never mix grains in one table, and
state each measure's additivity (additive, semi-additive across time, or non-additive).

**Dimensions.** For each dimension name its surrogate key and the natural or business key it maps
from, and its attributes with meanings and units. Decide history per attribute: overwrite when
history is irrelevant, tracked history with effective dates when analyses must reflect the value at
the time of the event; say which and why, and how a late-arriving dimension row is handled. Reuse
conformed dimensions across subject areas instead of creating a near-duplicate; before you create
one, check the existing warehouse documents and say why the existing one does not fit.

**Layers and model lineage.** State the layering (raw, staging, curated, marts), that raw stays
immutable, and where each table sits. In the Lineage section name the real source datasets and the
targets and the transformation that derives each fact. The module's lineage check scans pipeline
documents rather than model documents, but a model that states its own lineage is one a consumer can
trace, and it must agree with the pipeline documents that load it.

**Partitioning and freshness.** Choose the partition key and clustering from the expected query
filters and the data volume, taking volumes from the NFRs and constraints or stating an assumption
with how it will be validated; do not invent them. Give the cost implication (data scanned by a
typical query). State the freshness target in terms consumers care about, and how staleness is
detected.

**Traceability and privacy.** Trace each fact and dimension to a source entity id and attribute name
in the operational data model; do not redefine an operational entity, and raise a conflict with the
data architect's model instead of resolving it yourself. Model a many-to-many relationship between a
fact and a dimension with an explicit bridge table and say what it means. Mark every personal or
regulated column and say whether it is masked, hashed or excluded in the curated layer, following
the retention and classification rules already recorded.

#### Both kinds

**Diagrams.** The pipeline flow view is produced by the pipeline-to-flow generator from a stage list
(names and dependencies) that must match the stages in your code; the entity-relationship view of a
star or snowflake is produced by the datamodel-to-er generator from an entities-and-relationships
description that you author alongside the model. You cannot run either generator yourself: name the
generator as the diagram's source and ask for it to be generated; if you author a view by hand,
mirror the stage list or the model exactly and never label it as generated.

**Before you finish:** no credentials in code, connection details from configuration, personal data
masked or excluded downstream as the design says. For a pipeline, the run is structured so it can be
re-run end to end on a fixture, with the command listed in your verification note along with the
commands for the quality tests and the two module checks. For a model, every fact's foreign keys
resolve to a dimension, no measure lacks a stated additivity, and the grain sentence, the tables and
the view all agree. Report only what you observed, and label the rest unrun.
