'use client';
import { submitOrder } from '@/app/actions/orders';

export function OrderForm({ productId }: { productId: string }) {
  return <form action={async (fd: any) => { await submitOrder({ email: String(fd.get('email')), productId, qty: 1 }); }}><button>Buy</button></form>;
}
