<!-- forge:generated v=0.0.0 hash=754b7c9eef0997a7a7e33a32f32713090b699e03f3466c1f36a906ded5fa5f90 — edits will be overwritten; use overrides/ -->
The story's tests pass. Improve the structure of what you just wrote without changing what it does.
This is the third step of red, green, refactor, and the rule that makes it safe is that behaviour is
held fixed by the tests you were not allowed to touch.

### Inputs

- `diff:lane`: everything this story has changed in its lane so far. Refactor only what is in this
  diff. Code the story did not write is not yours to reshape here.
- The story's tests and the project standards in your context. The tests define which behaviour must
  not change.

### Produce

A cleaner version of your own change, still inside the story's file claim. Look for the things a
reviewer will flag in this diff:

- duplication that has now appeared twice or more, and names that no longer describe what the code
  does;
- functions doing several jobs, deep nesting, and long parameter lists;
- structure that departs from the project's standards or the surrounding code's conventions;
- dead code, leftover debugging, unused imports and parameters, commented-out code;
- error handling that hides failures instead of reporting them.

Make each change small and independently understandable. Run the story's tests after each one if you
can, and stop as soon as a test fails: undo that change rather than adjusting a test.

### Acceptance

- The whole suite that was green before is green after, with no test edited, skipped or removed.
- No observable behaviour changes: same inputs, outputs, errors, side effects and performance
  characteristics. If you are unsure a change is behaviour-preserving, do not make it.
- Every changed file is a production file inside the story's `files_expected`; test files are not
  yours to change.
- The diff is smaller in concept than before: fewer places to change for the same idea, not merely
  different code.
- Name the commands that show the tests still pass. If your grant does not let you run them, say so
  and give the command and the outcome you expect; never report a result you did not observe.

### Do not

- Do not add features, fix newly noticed bugs, or change a contract. Note anything you find and
  leave it for a request or a new story.
- Do not rename or reshape a public interface the contracts define.
- Do not refactor code outside this diff, or reformat whole files so the diff becomes unreviewable.
- If nothing in the diff is worth changing, say so and change nothing. A no-op refactor is a valid
  result; churn for its own sake is not.
