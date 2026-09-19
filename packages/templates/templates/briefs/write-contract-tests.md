# Write the contract tests

Write the tests that hold both sides of the interaction to the frozen contract. They are written
from the contract, not from any implementation, and they must be able to catch a provider or a
consumer that drifts from it. `G-Integration` has already passed on the merged contract before you
start. Your tests run after they merge, and `G-Verify` follows that run.

## Inputs

The `InterfaceContract` for this run's `interfaceName`, at
`docs/forge/specs/interfaces/<interfaceName>.yaml` (the input names it by interface name, not by
`INT-###` id): its operations and messages, schemas, error codes and retry rules, delivery and
idempotency guarantees, timeouts, versioning and examples.

## Produce

One test file at `test/contract/<interfaceName>.contract.test.ts`, and no other file.

- Provider side: for every operation, a valid request produces a response that validates against the
  contract's response schema. Each documented error condition produces the documented error code,
  and a request that violates the schema is rejected as the contract says.
- Consumer side: every request the consumer sends validates against the contract's request schema,
  and the consumer handles each documented error, including retry versus no retry.
- Guarantees: a repeated call with the same idempotency key has the effect once. Where the contract
  states timeouts, ordering or size limits, test them.
- Examples: every example in the contract validates against its schema.
- Compatibility: if a previous version of the contract exists, test that the change is not breaking
  for the consumers it says it is safe for.
- Name each test with the contract id and the operation and case it covers, so a failure says what
  broke, for example `INT-004 createInvoice returns INVOICE_EMPTY for zero line items`.
- Run against the real provider or a real consumer where one exists in the repository. Where none
  exists yet, test the contract document itself (schema validity, examples, completeness of error
  and guarantee coverage) and say in the file's header comment that no provider was available.

## Acceptance

- Every operation, error code and guarantee in the contract is covered by at least one test.
- Each test can fail: where a provider or consumer exists, one that returns a wrong shape, a wrong
  code or a duplicate side effect would turn one red; where none exists, a contract whose example,
  error entry or guarantee is malformed or missing would.
- The file runs with the one command `pnpm test -- test/contract/<interfaceName>.contract.test.ts`,
  is deterministic, and needs no network beyond what the project's test setup provides.
- If the contract is ambiguous where a test would need a decision, say exactly where and stop asking
  the test to guess.

## Do not

- Do not build a fake provider that returns whatever the contract says and then test that. That
  checks nothing.
- Do not modify the contract to make a test pass.
- Do not use `toBeDefined`, snapshots of current behaviour, or skipped tests in place of real
  assertions.
