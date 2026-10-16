import { prisma, recordAudit } from '@corner/db';

export interface DiscountInput {
  id?: string;
  code: string;
  kind: 'PERCENT' | 'FIXED';
  value: number;
  minTotalCents?: number;
  maxRedemptions?: number | null;
  startsAt?: Date | null;
  endsAt?: Date | null;
}

const CODE = /^[A-Z0-9-]{3,24}$/;

export async function listDiscounts() {
  return prisma.discount.findMany({ orderBy: [{ active: 'desc' }, { createdAt: 'desc' }] });
}

/** Creates or edits a discount code. Codes are upper case; a percent is 1–100, a fixed amount is in cents. */
export async function saveDiscount(input: DiscountInput, staffId: string) {
  const code = input.code.trim().toUpperCase();
  if (!CODE.test(code)) throw new RangeError('Codes are 3–24 letters, digits or dashes');
  if (input.kind === 'PERCENT' && (input.value < 1 || input.value > 100)) throw new RangeError('A percentage is between 1 and 100');
  if (input.kind === 'FIXED' && input.value < 1) throw new RangeError('A fixed discount is at least 1 cent');
  const data = {
    code,
    kind: input.kind,
    value: input.value,
    minTotalCents: input.minTotalCents ?? 0,
    maxRedemptions: input.maxRedemptions ?? null,
    startsAt: input.startsAt ?? null,
    endsAt: input.endsAt ?? null,
  };
  const saved = input.id
    ? await prisma.discount.update({ where: { id: input.id }, data })
    : await prisma.discount.create({ data });
  await recordAudit({ action: 'discount.saved', entity: 'discount', entityId: saved.id, staffId, data });
  return saved;
}

export async function setDiscountActive(id: string, active: boolean, staffId: string) {
  const saved = await prisma.discount.update({ where: { id }, data: { active } });
  await recordAudit({ action: active ? 'discount.enabled' : 'discount.disabled', entity: 'discount', entityId: id, staffId });
  return saved;
}
