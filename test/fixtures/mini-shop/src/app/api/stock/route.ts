import { updateStock } from '@/lib/products';

export async function POST(req: Request) {
  const { sku, stock } = await req.json();
  return Response.json(await updateStock(sku, stock));
}
