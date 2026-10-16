'use server';

import { revalidatePath } from 'next/cache';
import { saveDiscount, setDiscountActive } from '@corner/orders';
import { checkbox, integer, optional, parseEuros, text } from '@/lib/format';
import { staffOrRedirect } from '@/lib/staff';

export type DiscountFormState = { ok: true } | { ok: false; error: string } | null;

function date(formData: FormData, name: string): Date | null {
  const value = optional(formData, name);
  return value ? new Date(value) : null;
}

export async function saveDiscountAction(_prev: DiscountFormState, formData: FormData): Promise<DiscountFormState> {
  const staff = await staffOrRedirect(['ADMIN']);
  const kind = formData.get('kind') === 'FIXED' ? 'FIXED' : 'PERCENT';
  const value = kind === 'FIXED' ? parseEuros(text(formData, 'value')) : integer(formData, 'value');
  if (value === null) return { ok: false, error: 'Enter the discount as a percentage or an amount.' };
  try {
    await saveDiscount(
      {
        id: optional(formData, 'id') ?? undefined,
        code: text(formData, 'code'),
        kind,
        value,
        minTotalCents: parseEuros(text(formData, 'minTotal') || '0') ?? 0,
        maxRedemptions: integer(formData, 'maxRedemptions'),
        startsAt: date(formData, 'startsAt'),
        endsAt: date(formData, 'endsAt'),
      },
      staff.staffId,
    );
  } catch (err) {
    if (err instanceof RangeError) return { ok: false, error: err.message };
    throw err;
  }
  revalidatePath('/admin/discounts');
  return { ok: true };
}

export async function toggleDiscount(formData: FormData): Promise<void> {
  const staff = await staffOrRedirect(['ADMIN']);
  await setDiscountActive(text(formData, 'id'), checkbox(formData, 'active'), staff.staffId);
  revalidatePath('/admin/discounts');
}
