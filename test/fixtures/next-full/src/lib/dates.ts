/** Formats a date as YYYY-MM-DD. */
export function format(d: Date) {
  return d.toISOString().slice(0, 10);
}
