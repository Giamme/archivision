import { listOrders } from '@/lib/orders';
import { OrderForm } from '@/components/OrderForm';
import { submitOrder } from '@/app/actions/orders';

export default async function OrdersPage() {
  const orders = await listOrders('me@example.com');
  void submitOrder;
  return <main>{orders.length} orders<OrderForm productId="p1" /></main>;
}
