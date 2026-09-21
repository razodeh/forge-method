### Specialisation for writing the product requirements (the PRD)

This step turns the Vision and the capability brainstorm into the product's requirements: the
prioritised, staged Capabilities and the numeric NFRs that bound them. Each artifact constrains the
next, so work from the discovery findings and the Vision in your context and from what the earlier
steps recorded, and do not write capabilities from memory of similar products. The step brief says
what to produce and where; this is the product-management judgement to apply while producing it. The
scope and priority decisions are yours, and stories are not: the product owner writes those after
the stage plan exists.

1. Reconcile with discovery first. List every finding, user need and risk from discovery, and mark
   each as addressed by a named capability, deferred with a reason, or rejected with a reason. A
   finding with no disposition is an omission, and the list is your completeness check.
2. Prioritise with a stated method and show the inputs (value, cost, risk, dependency, urgency) in
   the body of the capability, while the priority field itself takes the schema's values. Two
   capabilities cannot both be first. Use the wont priority, with the deferred stage value, for
   something you deliberately are not building now, with the reason and the condition that would
   bring it back, so the out-of-scope list is a real record and not an absence.
3. Test capability size. A capability that cannot be delivered inside one stage should be split by
   user outcome; one that reads like a single story is a story for the product owner. Every
   capability traces to a target user and to a metric it moves, or says which capability it enables.
4. When you propose target stages, make stage one a thin end-to-end slice that exercises the
   riskiest assumption, not the safest features; make each later stage independently valuable and
   dependent only on earlier ones; and leave slack, since a stage planned to full capacity will
   slip. The stage plan itself comes from the decomposition step, so propose and do not
   over-specify.
5. Derive non-functional requirements from the capabilities (latency of the critical flow,
   availability, retention, accessibility level, compliance obligations), each with a number and a
   named verification method. Where the inputs give no figure, propose one with its reason, keep it
   as a draft, and record the assumption with how it will be validated.
6. Close every open question before the product gate: resolve it, or convert it to a recorded
   assumption with a way to validate it. No open question may remain, because one blocks the gate
   and, later, every story.
7. At a lower project level where a product already exists, write only the delta against the
   existing product requirements and name the existing capabilities the change touches.

Check before finishing: every capability has an observable acceptance summary, a priority, a stage
and a link to a target user and a metric; no requirement names a technology; no two capabilities
duplicate each other; every non-functional requirement has a number; the list of wont capabilities
is non-empty unless you can say why nothing was cut.

Common mistakes: solution-shaped requirements; every capability marked highest priority; competitor
parity added with no user need behind it; a first stage of safe, easy work; capabilities so coarse
that nobody can say when they are done.
