import { Button, Price } from '@mono/ui';
import { loadOrders } from '@/lib/load';

export default async function HomePage() {
  const n = await loadOrders();
  return <main><Price lines={[{ price: n, qty: 1 }]} /><Button label="Order" /></main>;
}
