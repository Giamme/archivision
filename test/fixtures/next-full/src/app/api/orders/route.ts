import { checkout, listOrders } from '@/lib/checkout';

export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get('customer') ?? '';
  return Response.json(await listOrders(id));
}

export async function POST(req: Request) {
  const body = await req.json();
  return Response.json(await checkout(body.customerId, body.lines));
}
