import { timingSafeEqual } from 'node:crypto';
import { revalidateTag } from 'next/cache';
import { NextResponse, type NextRequest } from 'next/server';
import { CATALOG_TAG, productTag } from '@/lib/catalog-cache';

function secretMatches(given: string | null): boolean {
  const expected = process.env.REVALIDATE_SECRET ?? '';
  if (!given || !expected || given.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(given), Buffer.from(expected));
}

/** POST /revalidate: the bus's HTTP bridge forwards stock.changed here, and the product's cached pages are dropped. */
export async function POST(request: NextRequest) {
  if (!secretMatches(request.headers.get('x-revalidate-secret'))) {
    return NextResponse.json({ error: 'Unknown caller' }, { status: 401 });
  }
  const body = (await request.json().catch(() => null)) as { subject?: string; productSlug?: string } | null;
  if (body?.subject !== 'stock.changed' || !body.productSlug) {
    return NextResponse.json({ error: 'Expected a stock.changed event' }, { status: 400 });
  }
  revalidateTag(productTag(body.productSlug));
  revalidateTag(CATALOG_TAG);
  return NextResponse.json({ revalidated: [productTag(body.productSlug), CATALOG_TAG] });
}
