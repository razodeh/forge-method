You are in the green step: failing tests for this story already exist. The step brief sets the
deliverable and the limits of your claim; the standing accessibility and bundle practices are in
your role instructions. This is what is specific to making browser-facing tests pass.

**Read the tests and the design inputs together.** For each failing test, identify the acceptance
criterion and the user-visible behaviour it asserts, then read the UX or design material for the
states and copy around it. If a test fails for an unrelated reason, or can only pass with
inaccessible markup (for example a selector that demands a non-semantic element), do not edit it and
do not leave inaccessible markup in place for good: emit `FORGE_REQUEST_CHANGE:` against that test
stating which assertion is at fault and what the criterion actually requires, and carry on with the
parts that do not depend on it.

**Build outside-in, one behaviour at a time.** Semantic structure and states first, then behaviour.
For each new component: roles and labels, keyboard operation, focus management, then styling.
Implement the states the criteria and tests cover. A state they leave open (an empty list, a failed
request, a permission variation) is a question or a recorded assumption for the story's owner, not
extra behaviour you add on your own.

**Contract fidelity.** Consume the InterfaceContract as written: paths, field names, types, error
shapes, pagination. Treat every documented error as a state a user can recover from. If the contract
cannot support what the story needs, report the gap; do not add a client-side workaround that hides
it.

**Check the finished diff for the mistakes browser code invites:**

- A control built from a generic element with a click handler, or a focus indicator removed.
- Focus lost or misplaced after navigation, dialog open and dialog close.
- Layout that breaks at narrow widths, under zoom or with long strings.
- Server data shown from a superseded request because inputs changed quickly; requests should be
  cancelled or ignored when stale.
- User-supplied content rendered as raw markup instead of through the framework's escaping.
- A dependency added without weighing its size against what an existing one covers, or heavy
  route-specific code loaded eagerly. State the change to built size if you can measure it, and
  otherwise say it was not measured.

**Component specifications.** A reusable component you create or materially change needs a component
spec (its props, its states and its accessibility notes). Write it if the specification path is part
of this step's claim; if it is not, request that it be added or leave it to the documentation step,
and keep your notes consistent with the code so the spec can be produced from them.

**Finish with a verification note:** the criteria covered, the commands to run (tests, type check,
lint, and a build followed by the accessibility and bundle-size checks, which read only `dist/` and
pass vacuously if it is absent or the build emits elsewhere, so name the output directory), and what
you could not run. Where you cannot run a browser, say that your accessibility review was by reading
the markup and tests.
