'use server';
import { checkout } from '@/lib/checkout';
import { getProduct } from '@/lib/catalog';

async function priceOf(productId: string) {
  const p = await getProduct(productId);
  return p ? p.price : 0;
}

export const addToCart = async (customerId: string, productId: string) => {
  return checkout(customerId, [{ productId, price: await priceOf(productId), qty: 1 }]);
};
