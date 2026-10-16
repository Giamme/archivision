'use client';
import { useCart } from '@/hooks/useCart';
import { addToCart } from '@/app/actions/cart';

export function Cart() {
  const cart = useCart();
  return <button onClick={() => { cart.add('p1'); void addToCart('c1', 'p1'); }}>{cart.ids.length}</button>;
}
