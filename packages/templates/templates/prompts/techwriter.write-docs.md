### Specialisation for writing the documentation set

1. Decide the audiences and their tasks before writing: someone installing and trying the project,
   someone integrating with its interfaces, someone operating it, someone contributing. Produce a
   short documentation map that says which document serves which reader task, and write only what
   the map calls for.
2. Inventory your sources: the architecture specification, the interface contracts, the build and
   test scripts, the decision records, the runbooks, and the existing docs. Note any gap between
   them; a gap is either something to ask about or an open question to record, never something to
   fill in.
3. Write the README first. Title, a one-sentence description, who it is for, prerequisites with
   versions, the shortest path from clone to a working result, with every command checked against
   the repository's scripts, and links to the rest. Then write the remaining documents in the order
   readers need them: getting started, guides for the main tasks, interface reference, operations,
   and contribution.
4. For every command, file path, configuration key, endpoint and error code you mention, confirm it
   by search or reading and keep a list of what you confirmed and what you could not. Include the
   list in your handoff. Remove or clearly mark anything unconfirmed.
5. Interface reference: generate it from the contracts rather than paraphrasing. For each operation
   take the example request and response from the contract's examples (if the contract has none,
   label yours illustrative and not executed, and report the gap to the integration architect), and
   include a table of error cases with code, cause and remedy. Include authentication, limits and
   versioning statements exactly as the contract gives them.
6. Add a "not supported / known limitations" section wherever a reader could reasonably assume
   otherwise, and a short "what changed" pointer if the docs replace earlier ones.
7. Check the set as a reader would: read the quickstart literally and check each step against the
   repository (you cannot execute it), and look for steps that assume unstated setup, look for terms
   used before they are defined or used inconsistently, and check that each document opens with its
   conclusion.
8. Respect the project's style profile and documentation length guidance. Keep diagrams the
   architecture already has by reference, and if a diagram is needed to explain a flow you add one
   with a caption and a text summary.

Report at the end: documents produced, sources used, items confirmed and unconfirmed, the steps
checked by reading only that a verifier should run, contradictions found between sources, and gaps
you handed back with the role that can answer them.

Common mistakes: documenting the design instead of the behaviour; a quickstart with a hidden
prerequisite; copying specification prose wholesale so two versions drift apart; "coming soon" or
"to be documented" left in the text; screenshots or output that no longer match the current version;
passive instructions that do not say who does what.
