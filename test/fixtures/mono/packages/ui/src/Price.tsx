import { total } from '@mono/core';

export function Price({ lines }: { lines: { price: number; qty: number }[] }) {
  return <span>{total(lines)}</span>;
}
