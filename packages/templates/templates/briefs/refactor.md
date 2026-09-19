# Carry out the refactor

Change the structure of the code to meet the stated goal while every invariant holds. The earlier
step wrote down what must not change; the test run after you decides whether it did not.

## Inputs

The invariants handoff (goal, scope, invariants and the commands that guard them). This step
declares no inputs, so find it: it is the latest `HandoffRecord` in `docs/forge/reports/handoffs.md`
whose `step` is `state-invariants`. Also the code in scope, the project standards, and the frozen
contracts the scope touches.

## Produce

The refactored code, inside the scope the handoff lists.

- Where the handoff says a path is unguarded, first add characterisation tests that pin its current
  behaviour, then refactor. New test files may sit outside the scope list, and you must list each
  one. If you can run them, confirm they pass against the unchanged code before you refactor; if you
  cannot, say so and give the command.
- Change in small steps and keep the guarding tests green between them if you can run them. Prefer
  mechanical, reversible moves (extract, inline, rename, move) over rewrites.
- If a step breaks a test, undo that step and find a smaller one.
- Where the handoff named a differential check, run it on the same inputs before and after.

## Acceptance

- The commands the handoff names pass, and no existing test was edited, deleted, skipped or loosened
  to get there. Mechanical updates to a test that a rename made necessary are permitted only if you
  list each one and the rename that required it.
- Public signatures, contracts, observable behaviour, data formats and performance are unchanged.
- Only files inside the stated scope changed, plus the new characterisation tests you listed. If the
  goal cannot be met without leaving it, stop and raise `FORGE_REQUEST_CHANGE:` rather than widening
  the scope.
- The goal is actually met: the structure the goal described is now what the code looks like.
- Name the commands that prove the invariants hold.

## Do not

- Do not fix bugs, add features or change behaviour along the way. Record what you notice for later.
- Do not delete a test because it now fails or seems redundant.
- If an earlier attempt failed the tests, do not retry the same change. Read the failure and take a
  different route.
