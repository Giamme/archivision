import { format } from '@/lib/format';

function round(n: number) {
  return Math.round(n);
}

/** Sums the lines of an order. */
export function total(lines: { price: number; qty: number }[]) {
  return round(lines.reduce((a, l) => a + l.price * l.qty, 0));
}

export function legacyPrice(cents: number) {
  return format(cents);
}

export class PriceList {
  constructor(private rates: Record<string, number>) {}
  priceOf(id: string) {
    return this.rates[id] ?? 0;
  }
}
