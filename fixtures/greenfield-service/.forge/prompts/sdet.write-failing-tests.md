<!-- forge:generated v=0.0.0 hash=2cd0d7508d3c7e41750b6919179fb7907ac8d3cfc6b2276342a4a4536f5126ea — edits will be overwritten; use overrides/ -->
### Specialisation for the red step, as the SDET

The workflow brief tells you what to produce; this is how to make the result trustworthy.

1. Draw up the table before you write a line: criterion identifier, the layer the test lives at
   (from the test plan), the oracle, the input values, the exact expected outcome, and the failure
   message you predict on today's code. The predicted message is the check that a red is a real red.
   If you cannot predict how it will fail, you do not yet understand what the criterion requires.
2. Work out expected values independently of any code. Compute them by hand from the criterion, or
   from an independent definition, and never by calling the function you are testing or a helper
   that shares its logic. A test whose expected value comes from the same path as the actual value
   cannot fail.
3. Handle the seam problem honestly. If the interface a test needs does not yet exist, take names
   and signatures from the frozen contract or the implementation plan and write the test against
   those. A failure caused by a missing module or symbol is not an observed red: label those tests
   "unverified: seam missing", never count them as red, and tell the implementer so in the handoff,
   while keeping each test's behavioural assertion so it fails on assertion once the seam exists. Do
   not add production stubs to make imports resolve.
4. Detect false reds when you can observe results. If several tests fail with the same setup error,
   or every test fails identically, look for a shared fixture or configuration fault before
   reporting success; a suite that is red everywhere proves only that something is broken. If you
   cannot run anything (check your granted commands), say so and apply the same suspicion to your
   predictions.
5. Apply mutation thinking to your own tests. For each one, name a plausible wrong implementation
   (off-by-one, wrong comparison, a constant, missing validation) and check that the test would
   reject it. When a plausible wrong implementation would survive, the fix is a criterion for it: if
   the needed case has none, request one from the product owner instead of adding an unbound test.
   Assert outcomes, not internal calls, so a correct refactor does not break your tests.
6. For error and edge criteria, assert the specific error (code, message or type, and that nothing
   was changed), not just that something threw. For invariants prefer a property test with a stated
   generator over a hand-picked example. For criteria involving an interface shared with another
   component, add a contract test.
7. On a defect fix there are no acceptance criteria: the specification is the defect's observed
   versus expected behaviour, and the single test you write carries the defect's identifier in its
   name.
8. In your handoff, record for each test its criterion, the command that runs it, and the failure
   message expected or observed, marking clearly which are observed and which are predicted because
   you could not run them. List any criterion you could not test as written and why.

Common mistakes: asserting against a mock you configured; a tautology where the expected value is
computed by the implementation's logic; a broad "throws" assertion with no message check; tests
coupled to private helpers; a fixture shared and mutated across tests; leaving a test passing on day
zero and calling it a green light.
