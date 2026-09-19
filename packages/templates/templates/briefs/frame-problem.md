Synthesize the discovery sessions into a written problem framing: who is affected, what hurts, how
much, what already exists, and what is in and out of scope. Every downstream product decision will
trace to a claim you record here, so each claim needs a source or an explicit "assumption,
unvalidated" label.

### Inputs

- The records of the two sessions that precede you: `discovery-interview` (what is not yet known
  about users, domain and problem) and `problem-brainstorm` (the range of ways the problem could be
  framed). Read both fully, including their open questions.
- The KB constraints (`constraints/**`), the glossary, and any existing `Assumption` entries.
- You have no research of your own. Facts about users, the market or competitors count only if a
  session record, a constraint file or the human supplied them.

### What to produce

- Problem framing in the KB `product/` section, each a KB entry: `problem.md` (the problem
  statement, who is affected, how they cope today, how much it costs them, and the framings you
  considered and rejected, with the reason), `users.md` (each user group as a persona with a stable
  id of the form `persona:<slug>`, its distinguishing traits, the situation in which it meets the
  problem, and its jobs to be done), and `scope.md` (in scope, out of scope, explicit non-goals).
  Cite each session record in `sources` as `kind: human` with the record's id as `ref`.
- A short competitive and alternatives scan inside `problem.md`: what people use today, including
  doing nothing, and why it falls short. Label anything not sourced from your inputs as an
  assumption.
- Risks you found, as `Risk` entries in `kb/risks.md`, each with `statement`, likelihood, impact,
  mitigation and owner.
- One `Assumption` entry per unvalidated claim about users, the market, or feasibility, each with
  `confidence` and `validate_by`.

### Acceptance criteria

These map to the `G-Problem` checks that run after the next step.

- At least one user group is identified by persona id, name and role, with the job it is trying to
  get done (`user-identified`).
- The problem statement can be read without knowing the solution, and names who has the problem.
- Scope and non-goals do not contradict any constraint in `constraints/**`. State each relevant
  constraint next to the scope item it limits (`scope-contradicts-constraints`).
- Every factual claim is either cited to a session record or constraint file, or covered by an
  `Assumption` entry.
- A question the sessions left open is either answered from the inputs, recorded as an `Assumption`
  with `validate_by`, or, only if discovery cannot be approved without its answer, recorded as an
  `OpenQuestion` in `kb/open-questions.md`. An open `OpenQuestion` blocks the `G-Problem` approval,
  so do not use it for things that can be validated later.

### Do not

- Do not propose features, capabilities or technology. Framing describes the problem, and the
  solution comes in product definition.
- Do not round an assumption up to a fact, and do not invent statistics, market sizes or competitor
  details.
- Do not choose one framing from the brainstorm and drop the others without saying why.
- Do not define success metrics. The next step owns them.
