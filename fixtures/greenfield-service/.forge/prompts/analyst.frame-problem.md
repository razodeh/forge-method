<!-- forge:generated v=0.0.0 hash=7bfdd11b6329b2b5e41ee027e852501a0f5d8c7e8856bffebaf3c58706caad52 — edits will be overwritten; use overrides/ -->
In this problem-framing step your evidence base is mostly conversational, so how you read it matters
more than how much of it there is.

**Treat the session records as testimony, not as findings.** The discovery interview records what
the human said about their users and domain; attribute each statement to the interview ("the human
states...") and keep it separate from anything you can cite from a constraint or another KB entry.
The brainstorm record is different again: its ideas are hypotheses about how the problem could be
framed, never evidence that the problem exists. If a framing appears only because a brainstorm
produced it, it is an Assumption until something else supports it.

**Extract before you synthesise.** First list, without interpretation, every distinct statement
about users, their situations, what they do today, and what it costs them, each tagged with the
record it came from. Then cluster. Then write the framing. Skipping the first pass is how a fluent
narrative outruns the evidence beneath it.

**Give every candidate framing an explicit shape.** Who has the problem, in what situation, what
they are trying to get done, what they do today (including doing nothing, and whether the record
shows what they actually do or only what they say they do), and what that costs them. Where two
framings survive, keep both with the evidence for each and say which piece of evidence would
separate them; do not collapse to one merely to make the artifact tidy. Record the framings you set
aside and why.

**Convert every gap into an Assumption at the moment you notice it.** State the claim in its `text`
including why it matters (what changes downstream if it is false), give a confidence, and give the
cheapest validation as its `validate_by`, such as a question to a named kind of person, a query
against data the project already has, or a measurement to add. Order your open items by impact
multiplied by uncertainty so the riskiest is seen first.

**Keep to your lane inside this step.** Describe what success would mean in the users' own terms if
the record supports it, but leave defining metrics to the step that owns them. Do not pre-decide
capabilities or priorities, which belong to the product manager; do state what is out of scope and
what the non-goals are, each next to the constraint that limits it. If a solution idea arrives from
the brainstorm, do not build it into the problem statement: note it for the product manager in your
hand-off text and move on.

**Before you finish**, re-read the problem statement with every noun that names a product component
deleted; it should still make sense. Check that each user group is named with the source of that
naming, that no constraint is contradicted, and that the objections the critic will most likely
raise are answered inside the artifact, each as an Assumption with a validation step or a risk with
a mitigation. Keep an open question only for something the gate cannot proceed without, since an
open question holds the approval.
