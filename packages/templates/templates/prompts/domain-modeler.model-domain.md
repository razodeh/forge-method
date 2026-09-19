You are producing two artifacts together, a domain model and a context map, and they must agree with
each other and with the data and contracts around them. Work in this order.

1. **Collect the language.** From the capabilities, the glossary and the data you have been given,
   list the domain terms that carry business meaning. Mark terms whose meaning you can source and
   terms you are proposing. For any term used in two ways, split it and note which capability or
   source uses each sense.
2. **Propose contexts.** Group the capabilities and terms into bounded contexts using seams of
   meaning, ownership and change rate. For each context write its responsibility in one sentence,
   the language it owns, what it explicitly does not own, and the capabilities it serves. If a
   capability straddles two contexts, say so and decide which context owns it and how the other
   reaches it, rather than duplicating it.
3. **Design aggregates per context.** For each aggregate give its root, the invariant(s) it
   protects, its members, the commands it accepts, the events it emits, and the boundary of a single
   transaction. Reference other aggregates by identity only. Where a business rule spans aggregates,
   model it as a saga and write the compensation step for each forward step and the intermediate
   states visible to users. Reject aggregates that protect no invariant; treat them as plain
   entities or as separate concerns.
4. **Draw the context map.** For each pair of related contexts record the relationship pattern,
   which side is upstream, what is translated at the boundary, and which context can change the
   shared model. Prefer an anti-corruption layer where the upstream model is foreign or unstable.
   Avoid a shared kernel unless the two contexts genuinely share a team and a release cadence, and
   say why if you use one.
5. **Tie the map to contracts.** For every operation or event that crosses a boundary, name the
   InterfaceContract that will carry it. If one does not exist, list it as required and describe its
   operations and failure behaviour in enough detail for the integration architect to write it. The
   contract-test workflow of this module verifies these, so an interaction with no contract is a gap
   you must report, not leave implicit.
6. **Check consistency.** Every aggregate belongs to exactly one context; every context has at least
   one capability; each term is defined once per context; each cross-context flow can be traced from
   trigger to outcome, including its failure path; the entities in the data model line up with your
   aggregates, and any disagreement is stated as a conflict for the data architect, not silently
   resolved.

Where the domain is genuinely simple, say so and keep the model small: a single context with a
handful of entities is a legitimate answer. A bounded context is a boundary of meaning, not a
deployment unit; leave the choice of services and modules to the architect, and say only which
contexts would be costly to split apart. Put the ubiquitous language in the domain model itself, one
definition per term per context. Terms that should join the project glossary go in your hand-off, or
as a change request to the glossary's owner, since the glossary is not a place you write; put your
own KB proposals under the domain namespace you are allowed to propose into. Your DataModel is the
domain model of aggregates and invariants; if a data architect's logical model exists, refer to its
entity ids rather than restating its entities, and report any disagreement as a conflict. Record the
questions you need a domain expert to answer, and the assumptions you made in the meantime with how
each could be validated. Include a Mermaid diagram of the context map, and one flow diagram for the
riskiest cross-context interaction, embedded in the body of the artifact it belongs to with a
caption and alt text; if the design gate requires them registered as separate diagram artifacts, say
so in your hand-off so someone with that output registers them.
