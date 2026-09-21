<!-- forge:generated v=0.0.0 hash=f1a341b8df6cd3425adf34cab2bf8f8c2a5d3ec4d042f873026f3b768b5fa60b — edits will be overwritten; use overrides/ -->
Propose the scale level (L0 to L4) for this project, with reasoning a human can accept or override
in one read. The next step, `confirm-level`, shows your proposal to the human verbatim and asks them
to confirm or change it, so write for that reader.

### Inputs

- The two answers from `elicit-idea`: `ideaSummary` (what is being built) and `greenfield` (new
  project or a change to an existing one).
- The KB constraints (`constraints/**`): business, technical, regulatory and operational
  constraints, when present.

### What the levels mean

Use this table to explain the cost of your proposal to the human.

- L0 Patch (a bug fix, copy change or dependency bump): implementation and verification only; the
  verification gate.
- L1 Feature (one to three stories inside an existing system): adds a light design pass,
  stabilization and a short plan; design (light), verification and delivery gates.
- L2 Capability (a new subsystem or service in an existing product): adds product and design deltas
  and delivery; product, design, ready, verification and delivery gates.
- L3 Product (a new product, greenfield): every lifecycle phase from discovery to operations; all
  gates.
- L4 Platform (multi-service or multi-team, migrations, compliance): everything in L3, plus domain
  decomposition and an integration gate.

### What to do

1. Extract the seven level signals from the inputs: greenfield vs brownfield; number of new
   user-facing capabilities; number of deployable units; presence of persistent state; presence of
   external integrations; regulatory flags; more than one runtime or language.
2. For each signal write the value and the sentence or constraint file it came from. If the inputs
   do not settle a signal, mark it `unknown`. An empty or missing constraints directory means the
   regulatory signal is unknown, not "none".
3. Apply the project's level heuristic to the known signals and stop at the first rule that matches.
   The table above is the spec; the rule order is the implementation's choice. Regulatory flag set,
   more than one runtime, or more than one deployable unit gives L4; greenfield gives L3; otherwise
   (brownfield) two or more user-facing capabilities, persistent state, or an external integration
   gives L2; exactly one user-facing capability gives L1; nothing else gives L0. An unknown signal
   does not trigger a rule, but the proposal is then conditional on it.
4. For every unknown signal that would raise the level if true (most often the regulatory,
   multi-runtime and deployable-unit signals), say which level it would move the project to. If you
   propose a level that differs from the heuristic's result, say so and give the reason.
5. State in two lines what the proposed level implies, using the table, so the human can judge the
   cost of the choice.

### What to produce

One `HandoffRecord` entry (subtype `level-proposal`) with `from: analyst`, `to: human`,
`step: propose-level → confirm-level`. The entry has no `subtype` key, so the first string in
`delivered` is `subtype: level-proposal`, which is how the output check and a reader recognise the
record (`step` names the next node and does not carry the subtype). The second string is the
proposed level and the one-paragraph reasoning, followed by one string per signal in the form
`signal: value (source)`. Every unknown signal goes in `open_questions`, and every signal you
inferred rather than read goes in `assumptions` with its confidence and how to validate it.

### Acceptance criteria

- Exactly one level, one of L0, L1, L2, L3, L4, is proposed.
- All seven signals appear, each with a value and a source or `unknown`.
- The reasoning names the deciding signal and the rule it triggered.
- The reasoning names at least one alternative level and what would move the project to it.
- The entry is readable on its own, without opening any other file.

### Do not

- Do not write the level to `.forge/config.yaml` or any KB file. Recording the level is done after
  the human confirms it.
- Do not treat a signal as absent because the idea summary is silent about it.
- Do not propose a lower level to make the work look cheaper. An under-levelled project skips gates
  it needs.
