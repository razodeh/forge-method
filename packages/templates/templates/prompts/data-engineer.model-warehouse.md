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

**Layers and lineage.** State the layering (raw, staging, curated, marts), that raw stays immutable,
and where each table sits. In the Lineage section name the real source datasets and the targets and
the transformation that derives each fact. The module's lineage check scans pipeline documents
rather than these model documents, but a model that states its own lineage is one a consumer can
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

**The entity-relationship view** of the star or snowflake is produced by the datamodel-to-er
generator from an entities-and-relationships description, so author that description alongside the
model, mapping facts and dimensions into it. You cannot run the generator yourself: name it as the
view's source and ask for it to be generated, or, if you author the view by hand, mirror the model
exactly and never label it as generated. Before finishing, check that every fact's foreign keys
resolve to a dimension, no measure lacks a stated additivity, and the grain sentence, the tables and
the view all agree.
