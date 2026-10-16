'use server';

import { revalidatePath } from 'next/cache';
import { setStock } from '@corner/catalog';
import { integer, text } from '@/lib/format';
import { staffOrRedirect } from '@/lib/staff';

export type StockState = { ok: true; sku: string; onHand: number } | { ok: false; sku: string; error: string } | null;

/** The stock editor's save: sets the counted quantity of one SKU. */
export async function updateStock(_prev: StockState, formData: FormData): Promise<StockState> {
  const staff = await staffOrRedirect(['STOCK']);
  const sku = text(formData, 'sku');
  const onHand = integer(formData, 'onHand');
  if (onHand === null || onHand < 0) return { ok: false, sku, error: 'Enter a whole number, 0 or more.' };
  try {
    const changed = await setStock(sku, onHand, staff.staffId);
    revalidatePath('/admin/stock');
    return { ok: true, sku, onHand: changed.onHand };
  } catch (err) {
    if (err instanceof RangeError) return { ok: false, sku, error: err.message };
    throw err;
  }
}
