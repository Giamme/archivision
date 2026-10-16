import { cancelOrder } from '@/lib/checkout';

export const DELETE = async (_req: Request, { params }: { params: { id: string } }) => {
  return Response.json(await cancelOrder(params.id));
};
