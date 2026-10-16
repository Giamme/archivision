/** Formats a price in cents as euros. */
export function format(cents: number) {
  return `€ ${(cents / 100).toFixed(2)}`;
}
