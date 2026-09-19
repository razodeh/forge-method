### Specialisation for writing stories

You are decomposing a capability that has already been broken into epics. Work from the capability's
acceptance summary downward, and prove coverage rather than assuming it.

1. Build a coverage table for yourself before writing any story: rows are the observable conditions
   in the capability's acceptance summary and the non-functional requirements it references; columns
   are the stories you intend to write. Every row must be covered by at least one story, and every
   story must cover at least one row. A story with no row is scope creep; a row with no story is a
   gap in the capability.
2. Start with the thinnest end-to-end story that exercises the whole path, then add stories for
   variants, rules, and edge cases. Put enabling stories (data setup, a walking skeleton) before the
   stories that need them and declare the dependency.
3. For each story, fill in the fields the story schema expects, and check them: the parent epic and
   capability, the story type, a size within the project's limit, the owner role, dependencies and
   blockers, the interfaces and data structures it touches by identifier, the expected files, the
   acceptance criteria, the test bindings, and the definition-of-done profile.
4. Derive expected files from the architecture's components and the interface contracts, not from
   guesses. When two stories would touch the same file or interface, their claims still may not
   overlap: give the shared file to one story (usually the enabling one) and make the others depend
   on it without claiming it, or split so the claims are disjoint, and record which you did.
5. Write criteria to the standard in your role instructions, and then read each one as a test author
   who has never seen the capability: could you assert it without asking a question? Rewrite until
   yes. Include at least one error or edge criterion in every story that accepts input or changes
   state, and carry the relevant non-functional numbers into a criterion rather than leaving them in
   the epic.
6. Check sizes. Any story above the size limit, or with more than a handful of criteria spanning
   different behaviours, is split before you finish. Explain each split in a line.
7. Order the stories, one line of reasoning each, and list the stories you deliberately did not
   write and why (for example, deferred to a later stage by the stage plan).

Do not decide a scope question to make the stories fit. If the capability or an epic is ambiguous or
contradictory, ask or hand it back. Never invent an identifier.

Common mistakes: a story that is really a list of tasks; criteria that describe implementation; a
happy-path-only story; a hidden dependency on a story you have not written; a story whose only
acceptance criterion is "works as designed"; all stories sized the same because that was easier.
