import { listItems, removeItem } from '@/lib/store';

export async function GET() {
  return Response.json(await listItems());
}

export async function DELETE(req) {
  const { id } = await req.json();
  return Response.json(await removeItem(id));
}
