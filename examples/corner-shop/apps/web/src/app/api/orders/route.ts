import { NextResponse, type NextRequest } from 'next/server';
import { OutOfStockError } from '@corner/catalog';
import { OrderInputError, PricingError, type ReceiveOrderInput } from '@corner/orders';
import { beginCheckout } from '@/lib/checkout';

/**
 * POST /orders: the Receive step over JSON, for the express checkout (wallet buttons) and the integration tests.
 * The checkout page goes through the startCheckout server action; both begin the checkout the same way.
 */
export async function POST(request: NextRequest) {
  let input: ReceiveOrderInput;
  try {
    input = (await request.json()) as ReceiveOrderInput;
  } catch {
    return NextResponse.json({ error: 'Send the order as JSON' }, { status: 400 });
  }
  try {
    const begun = await beginCheckout({ ...input, userId: null, addressId: null });
    return NextResponse.json(begun, { status: 201 });
  } catch (err) {
    if (err instanceof OrderInputError) return NextResponse.json({ error: err.message, field: err.field }, { status: 422 });
    if (err instanceof OutOfStockError) return NextResponse.json({ error: err.message, sku: err.sku, available: err.available }, { status: 409 });
    if (err instanceof PricingError) return NextResponse.json({ error: err.message, sku: err.sku }, { status: 422 });
    throw err;
  }
}
