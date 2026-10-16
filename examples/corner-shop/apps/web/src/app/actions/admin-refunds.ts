'use server';

import { revalidatePath } from 'next/cache';
import { RefundError, refundOrder } from '@corner/payments';
import { parseEuros, text } from '@/lib/format';
import { staffOrRedirect } from '@/lib/staff';

export type RefundState = { ok: true; refundId: string } | { ok: false; error: string } | null;

/** Refunds part or all of an order. Support and admins only. */
export async function issueRefund(_prev: RefundState, formData: FormData): Promise<RefundState> {
  const staff = await staffOrRedirect(['SUPPORT']);
  const orderId = text(formData, 'orderId');
  const amountCents = parseEuros(text(formData, 'amount'));
  if (amountCents === null) return { ok: false, error: 'Enter an amount like 12.50' };
  try {
    const refund = await refundOrder({ orderId, amountCents, reason: text(formData, 'reason'), staffId: staff.staffId });
    revalidatePath(`/admin/orders/${orderId}`);
    revalidatePath('/admin/refunds');
    return { ok: true, refundId: refund.id };
  } catch (err) {
    if (err instanceof RefundError) return { ok: false, error: err.message };
    throw err;
  }
}
