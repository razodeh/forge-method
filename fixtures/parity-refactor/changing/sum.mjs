// A behaviour-CHANGING refactor of `reference/sum.mjs`: a deliberate off-by-one defect the refactor
// introduced (`+ 1`), so the observable output differs from the reference for every input. `forge
// parity check` against this variant must exit 1, naming the surface/case/stream that differs —
// never the differing text itself.
function sum(x, y) {
  return x + y + 1;
}
const args = process.argv.slice(2).map(Number);
process.stdout.write(String(sum(args[0], args[1])));
