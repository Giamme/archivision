import { listOrders, placeOrder } from '@mono/core';

export async function GET() {
  return Response.json(await listOrders());
}

export async function POST(req: Request) {
  return Response.json(await placeOrder(await req.json()));
}
