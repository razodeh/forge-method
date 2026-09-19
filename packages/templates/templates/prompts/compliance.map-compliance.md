Producing the compliance matrix is a fixed sequence. Do not skip to the table; the earlier steps
decide what goes in it.

1. **Applicability statement.** For each candidate regime, write the fact that makes it apply or not
   (for example: EU residents' personal data is processed; no cardholder data touches our systems
   because the payment provider's hosted fields are used) and the KB entry or constraint that
   establishes that fact. Facts you cannot source become explicit assumptions with a validation
   step. Do not map obligations for a regime you have not established applies, and do not drop a
   regime because mapping it is inconvenient.
2. **Obligation list.** For each applicable regime, list only the obligations relevant to how this
   system behaves, in the project's own terms. Typical clusters worth checking: lawful basis and
   consent; data subject rights (access, export, correction, erasure); retention and deletion;
   breach detection and notification; access control and audit logging of access to regulated data;
   encryption in transit and at rest; vendor and sub-processor management; change management and
   evidence retention (for SOC 2-style trust criteria); scope reduction and segmentation (for
   cardholder or health data). Treat this as a prompt for what to look for, not as a complete
   checklist for any regime.
3. **Enforcement mapping.** For each obligation give the control, where it is enforced, and the
   evidence. Prefer evidence that regenerates: an automated check ID, a test, a generated report,
   over a static assertion in prose. Point at the data model for every regulated field and record
   which stores, indexes, caches, logs and backups hold it.
4. **Status and gaps.** Assign each row a status using the vocabulary in your role instructions.
   Sort gaps and partials by exposure (regulatory penalty or harm if it goes wrong multiplied by
   likelihood) and give the smallest concrete change that would close each, addressed to the role
   that owns it.
5. **Cross-checks.** If a data model is available, confirm that every personal-data field in it
   appears in some row; if none was provided, ask for it or mark every data-dependent obligation
   unknown. Confirm that every "satisfied" row's evidence pointer resolves to something that exists
   in your context, that nothing in the matrix contradicts the threat model or an accepted ADR, and
   that anything you could not determine is marked unknown, not omitted.

Two cautions specific to this step. First, an absent artifact is not proof of absence of the
control: if you cannot find the evidence in your context, mark the row unknown with "no evidence
found in the provided context", name where to look and request it; use gap only when the design or
KB shows the control is required and missing. Second, the matrix may be cited as evidence at a later
gate, so a wrongly satisfied row is worse than an honest gap, and a row is satisfied only with a
cited passing result. Close by listing the open questions the human or counsel must answer before
anyone relies on the matrix.
