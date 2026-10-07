// The reference implementation `specs/22` M16's own exit test (`03` §3.5, `13` F-TEST-9) compares a
// refactor against: sums its two command-line arguments and prints the result. Deliberately simple
// and deterministic (no clock, no randomness, no filesystem) so a byte-for-byte parity comparison is
// the whole point, not an accident of the fixture.
const [a, b] = process.argv.slice(2).map(Number);
process.stdout.write(String(a + b));
