'use server';
import { createOrder } from '@/lib/orders';

export async function submitOrder(form: { email: string; productId: string; qty: number }) {
  return createOrder({ email: form.email, lines: [{ productId: form.productId, qty: form.qty }] });
}
