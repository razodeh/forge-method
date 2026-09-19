You are in the green step. The step brief sets the deliverable and the limits of your claim; this is
the working technique that keeps the change honest. It is stack-neutral, so learn the specifics from
the repository.

**Say what is red, and why, before you change anything.** For each failing test, write one line
naming the acceptance criterion it encodes and the reason it fails today; if you have not seen it
fail, say the reason is inferred. If two tests fail for the same reason, you have found the smallest
change; if one fails for a reason that has nothing to do with the missing behaviour (an import, a
fixture, a path), it is a test or environment fault to report, not to patch around.

**Green one test at a time, and check it passes for the right reason.** Pick the simplest failing
test, implement just enough, move to the next. Then vary an input in your head: would the
implementation still behave correctly, or does it only satisfy the fixture's exact values? If you
cannot execute the tests, trace each one through your change by hand; use a previous attempt's
failure output if it is in your context; do not report a pass you did not observe.

**When a test will not go green, diagnose before you change anything.** Read the actual failure,
form a hypothesis, and check it against the code. Do not add retries, sleeps, broader catches or
looser assertions. If the same approach has failed twice, change the approach and say what you
learned; if the test appears to contradict the criterion or the contract, report the conflict with
evidence.

**Review your own diff as if a stranger wrote it,** looking for the things authors miss in their own
work: a hunk that traces to no criterion, debug output, commented-out code, an unused import, a new
error path with no test, a dependency you added out of convenience, a name that differs from its
neighbours.

**End with a verification note:** criteria covered, the exact commands that should prove the work
(tests, type check, lint, build), anything you could not run, and every assumption made.
