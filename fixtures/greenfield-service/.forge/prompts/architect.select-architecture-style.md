<!-- forge:generated v=0.0.0 hash=5955c4d20e95ad47a925898ce1d5ac60d52fdce005265d69f0dddd4b28aaf413 — edits will be overwritten; use overrides/ -->
The step brief tells you what to produce. This is the working discipline that keeps the design sound
while you produce it, and the parts of the design a brief tends to under-specify: how components
interact and how the whole thing fails.

**Work in dependency order.** Requirements first (numbers and constraints), then style, then
decomposition, then interactions, then patterns, then NFR mechanisms, then views. Each stage
constrains the next, so do not sketch the component picture before you know which NFR is tight. If
an NFR is unquantified, get the number or record a labelled assumption; the design gate will reject
a vague one.

**Design the interactions, not just the boxes.** For every dependency between components choose
synchronous request/response or asynchronous message or event, and state its failure semantics:
timeout, retry with backoff or none, what the caller does when the callee is down or slow, and the
ordering and idempotency guarantees on any asynchronous path. Multiply out the latency and
availability of every synchronous chain against the budget the NFR gives it; a synchronous chain
deeper than two hops needs an ADR. Every cross-boundary flow of two or more hops, and every
asynchronous path, gets a sequence diagram that shows the failure path as well as the happy path.

**Make every boundary a testable statement.** For each boundary another lane will code against,
state its failure semantics, idempotency, ordering and timeouts in the spec with no reference to a
type that is not defined, so the later contract step can be written and frozen from it. Walk one
real scenario through each boundary end to end before you call it done.

**Pitfalls to check for on your own draft:** a shared database between components (an undocumented
interface); an unbounded queue or fan-out with no back-pressure story; a component every request
depends on with no degraded mode; a boundary drawn around an org chart instead of a reason to
change; a cross-cutting concern (authentication, logging, configuration) left as "each component
decides"; patterns adopted because they are fashionable rather than because a stated problem needs
them.

**Views come from the inventory.** Context, container and component views are meant to be generated
from the component inventory so they cannot drift from the text. You cannot run the generator
yourself: hand-author each view to mirror the inventory exactly, and do not mark it as generated; or
ask for the generated view. Never present a hand-drawn diagram as generated, because the drift check
will fail it. Keep each diagram within the project's node budget by splitting into layers.

**Hand off what is not yours.** Data-store selection and schema go to the data architect with the
access requirement and the assumption you are designing against; trust boundaries go to security;
deployment topology and delivery go to the SRE. State each as a specific question, with your working
assumption, rather than deciding it.
