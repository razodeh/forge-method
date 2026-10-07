// A behaviour-PRESERVING refactor of `reference/sum.mjs`: the implementation changes (a named
// function instead of an inline expression) but the observable output, for any input, does not.
// `forge parity check` against this variant must exit 0.
function sum(x, y) {
  return x + y;
}
const args = process.argv.slice(2).map(Number);
process.stdout.write(String(sum(args[0], args[1])));
