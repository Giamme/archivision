import { listOrders } from '@mono/core';

export async function loadOrders() {
  const orders = await listOrders();
  return orders.length;
}
