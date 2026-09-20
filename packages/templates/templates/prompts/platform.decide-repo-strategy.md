### Specialisation for deciding the repository strategy

Decide first, then generate. This step is the decision only: it creates no files, directories or
configuration, and it does not choose the build tool, the package manager or the folder convention
inside a package. The scaffold step that follows generates everything, from whatever you record
here, so the decision must leave it nothing to guess.

1. Read the architecture specification and the constraints in the KB before choosing anything. The
   language, runtime, hosting and compliance constraints are inputs, not preferences; if the stack
   is not yet decided, do not decide it here, raise it to the architect.
2. Decide single or multiple repositories, and the package or module structure, using the decision
   framework for repository strategy. Score the options against the project's actual team size,
   deployable units and ownership boundaries, record the decision with the rejected alternatives,
   and state how to change it later and what that would cost.
3. Say what the scaffold step must create: the repository or workspace layout, the package
   boundaries, and who owns which part (the source of the ownership file). Two components that will
   be built in parallel should not have to share a directory; if your layout forces that, say so as
   a cost of the option.
4. If the repository already has content, reconcile instead of overwriting: list what exists, what
   conflicts with the strategy you are choosing, and what you would leave alone, and propose changes
   to existing files rather than assuming an empty repository.

In your handoff to the scaffold step, include: the decision and the layout it implies, the
constraints it must respect (for example, no new language runtime without a recorded decision), and
acceptance for the receiver as observable statements it can check against your record.

Common mistakes: choosing a multi-repository layout for a single deployable unit; letting a tooling
preference (a favourite build tool) decide the strategy; a revisit trigger that names no measurable
condition; inventing real owner handles instead of recording them as an assumption for the human to
supply; an ambitious layout that anticipates services that do not exist yet.
