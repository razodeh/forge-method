<!-- forge:generated v=0.0.0 hash=9634f1462280c3142f6dcba408be264e1b400069a57ae462b3668ad83c68f0a4 — edits will be overwritten; use overrides/ -->
### Specialisation for the threat model step

This step runs after the technology stack has been chosen, so the model can and must be specific to
it. Read the architecture specification, the diagrams, the data model if one exists, and the stack
decisions before you write anything.

1. Scope and assets. List what is being protected (data classes, credentials, money, availability,
   reputation) and who the actors are (anonymous, authenticated, privileged, other services,
   insiders, the CI and deployment pipeline, third parties). State what is out of scope and why.
2. Data-flow diagram, at the location and in the form the step brief gives. Draw the components,
   stores, external entities and flows, with trust boundaries marked, in the project's diagram
   notation, with a caption and a text summary. Every boundary crossing in the architecture must
   appear; if you find an interaction the architecture does not show, raise it.
3. Threat table. For each boundary crossing, store and external integration, work through the six
   STRIDE categories and write a row for each real threat: identifier, element, asset, category,
   exploit path in two or three sentences, impact, likelihood, rating, mitigation (control and
   location), residual risk, the test that proves it, and status (control specified with story and
   test pending, accepted pending approval, or open). Nothing is marked mitigated because a
   technology is "secure by default"; name the control and how it is verified. Write "not
   applicable" with a reason for categories that do not apply.
4. Stack-specific threats. Use the chosen framework, database, hosting and libraries (marking as
   unverified any default you cannot see in your context): unsafe defaults, raw-query escape
   hatches, deserialisation, session and cross-origin configuration, template injection,
   infrastructure-as-code misconfiguration, and how the chosen packages are obtained and updated.
5. Abuse cases. Add the business-logic misuse the system permits: enumeration, replay, race
   conditions on balances or quotas, bypass of a workflow step, and excessive cost or resource
   consumption.
6. Authentication, authorisation, secrets and supply chain. Summarise the design in a short section
   each, and, where an alternative is genuinely still open, record the decision with its rejected
   options.
7. Requirements and stories. For every mitigation that is not already true by design, write the
   requirement as a specific, testable statement and name the role that should implement it, so the
   product owner can create a story bound to a test. List unresolved questions that block a rating.
   Every residual risk above low gets a risk entry with an owner, and a high one is put to the human
   before you close, since you cannot accept risk on anyone's behalf.
8. Coverage check. Reconcile: every trust-boundary crossing, store and integration in the
   architecture has at least one threat row or a reasoned "no threats"; no threat refers to a
   component that does not exist; every open or accepted row names who must decide.

Common mistakes: category-only rows with no exploit path; one mitigation pasted into every row;
treating internal services or third parties as trusted without saying what enforces it; forgetting
the delivery pipeline as an attack surface; a mitigation with no test; risk ratings that never say
"low".
