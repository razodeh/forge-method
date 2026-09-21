<!-- forge:generated v=0.0.0 hash=91de763b0cbabccb08b4bb89fc1b642e97c9791deb129e61f8397401c15a709b — edits will be overwritten; use overrides/ -->
The step brief defines the criteria AR1 to AR8, the verdict vocabulary and the objection fields; use
its field names and its severity rubric exactly. What follows is how to attack each area
effectively, so your objections are the ones the mechanical checks cannot find.

**Read for what is absent.** The gate's evidence includes the data model and the threat model as
well as the architecture spec and ADRs. Read all of them against the NFRs, and treat a section that
ought to exist and does not as evidence for `not-evidenced`, not as something to assume.

**Do the arithmetic yourself.** For AR3 and AR5, take the longest synchronous chain and add up its
latency contributions against the NFR's latency target; multiply component availabilities along the
critical path against the stated availability. Put your numbers in the `claim`. An NFR whose
mechanism is a slogan ("scales horizontally") with no statement of what is scaled and what stays
shared is a finding.

**Attack the failure story (AR2, AR5).** For each component and each cross-boundary flow ask: what
happens on restart mid-operation; on duplicate delivery; on out-of-order arrival; when the
dependency is slow rather than down; when a queue or cache fills; when a retry storm follows an
outage. Look for single points of failure, unbounded queues or fan-out, and missing timeouts. A flow
described only on the happy path lacks its failure sequence.

**Read the ADRs adversarially (AR1, AR4).** Are the alternatives options a competent engineer would
actually choose, or strawmen arranged to make the winner look inevitable? Does the decision follow
from the scores as written? Is `reversibility` honest for a decision that would take a migration to
undo, and is the `revisit_trigger` something a person could check? Is there a boring option that
meets the numbers which the chosen novel one was not compared against?

**Cross the seams between artifacts (AR6, AR7, AR8).** Take each entity in the data model and find
its owning component, and each trust boundary in the architecture and find its threat entries; the
gaps are where these documents were written by different hands at different times. Look for the same
concept named differently, a component that appears in the diagram but nowhere in the text, and an
ADR whose consequences conflict with another ADR's decision. Do not repeat the mechanical checks for
undefined references, diagram syntax or drift; only report a disagreement of meaning.

**Make each test concrete.** A calculation with the inputs stated, a specific failure-injection
experiment, a file and section to read, a search that should return nothing; and say what result
would make you withdraw the objection.

**If a criterion holds up,** record the attack you tried and why it failed in the place the brief
keeps passing verdicts, so an empty result is visibly empty.
