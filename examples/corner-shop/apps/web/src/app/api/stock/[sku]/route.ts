import { NextResponse, type NextRequest } from 'next/server';
import { setStock } from '@corner/catalog';
import { staffForApi } from '@/lib/staff';

/** PATCH /stock/:sku { onHand }: the handheld scanner in the warehouse posts its counts here. */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ sku: string }> }) {
  const staff = await staffForApi(['STOCK']);
  if (!staff) return NextResponse.json({ error: 'Staff sign-in required' }, { status: 401 });
  const { sku } = await params;
  const body = (await request.json().catch(() => null)) as { onHand?: unknown } | null;
  if (typeof body?.onHand !== 'number') return NextResponse.json({ error: 'Send { "onHand": <number> }' }, { status: 400 });
  try {
    const changed = await setStock(decodeURIComponent(sku), body.onHand, staff.staffId);
    return NextResponse.json(changed);
  } catch (err) {
    if (err instanceof RangeError) return NextResponse.json({ error: err.message }, { status: 422 });
    throw err;
  }
}
