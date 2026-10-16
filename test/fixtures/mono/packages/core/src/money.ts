export function total(lines: { price: number; qty: number }[]) {
  return lines.reduce((sum, l) => sum + l.price * l.qty, 0);
}
