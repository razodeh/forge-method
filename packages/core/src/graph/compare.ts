/** Code-unit-order comparison — not `localeCompare`; see `fs/operations.ts`'s `byteCompare`. */
export function compareStrings(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}
