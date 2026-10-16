import { describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  prisma: {
    priceList: { findFirst: vi.fn() },
    price: { findMany: vi.fn() },
    discount: { findUnique: vi.fn() },
  },
}));
vi.mock('@corner/db', () => db);

import { FREE_SHIPPING_FROM_CENTS, SHIPPING_CENTS, applyDiscount, priceCart, shippingFor, totals, type DiscountRule, type PricedLine } from '../src/price';

const line = (sku: string, unitPriceCents: number, quantity = 1): PricedLine => ({
  variantId: `v_${sku}`,
  sku,
  name: sku,
  quantity,
  weightGrams: 100,
  unitPriceCents,
  discountCents: 0,
  totalCents: unitPriceCents * quantity,
});
const percent = (value: number, minTotalCents = 0): DiscountRule => ({ id: 'd1', code: 'SPRING', kind: 'PERCENT', value, minTotalCents });

describe('applyDiscount', () => {
  it('leaves the lines alone without a rule', () => {
    const lines = [line('A', 1000)];
    expect(applyDiscount(lines, null)).toBe(lines);
  });

  it('spreads a percentage so the lines add up to the order discount', () => {
    const out = applyDiscount([line('A', 999), line('B', 333, 2), line('C', 1)], percent(15));
    const total = out.reduce((s, l) => s + l.discountCents, 0);
    expect(total).toBe(Math.round(((999 + 666 + 1) * 15) / 100));
    expect(out.every(l => l.totalCents === l.unitPriceCents * l.quantity - l.discountCents)).toBe(true);
  });

  it('never takes off more than the subtotal', () => {
    const out = applyDiscount([line('A', 500)], { id: 'd2', code: 'BIG', kind: 'FIXED', value: 2000, minTotalCents: 0 });
    expect(out[0]?.totalCents).toBe(0);
  });

  it('ignores a code below its minimum total', () => {
    const lines = [line('A', 1000)];
    expect(applyDiscount(lines, percent(10, 5000))).toEqual(lines);
  });
});

describe('totals and shipping', () => {
  it('ships free from the threshold, after the discount', () => {
    expect(shippingFor(FREE_SHIPPING_FROM_CENTS)).toBe(0);
    expect(shippingFor(FREE_SHIPPING_FROM_CENTS - 1)).toBe(SHIPPING_CENTS);
  });

  it('adds up subtotal, discount and shipping', () => {
    const lines = applyDiscount([line('A', 2000, 2)], percent(10));
    const cart = totals('EUR', lines, percent(10));
    expect(cart).toMatchObject({ subtotalCents: 4000, discountCents: 400, shippingCents: SHIPPING_CENTS, totalCents: 3600 + SHIPPING_CENTS });
    expect(cart.discount).toEqual({ id: 'd1', code: 'SPRING' });
  });
});

describe('priceCart', () => {
  it('prices from the active list and applies a valid code', async () => {
    db.prisma.priceList.findFirst.mockResolvedValueOnce({ id: 'pl1', currency: 'EUR' });
    db.prisma.price.findMany.mockResolvedValueOnce([
      { variantId: 'v1', amountCents: 1400, variant: { sku: 'MUG-SAND', name: 'Sand', weightGrams: 380, product: { name: 'Stoneware mug' } } },
    ]);
    db.prisma.discount.findUnique.mockResolvedValueOnce({ id: 'd1', code: 'SPRING', kind: 'PERCENT', value: 10, minTotalCents: 0, active: true, startsAt: null, endsAt: null, maxRedemptions: null, redemptions: 0 });
    const cart = await priceCart([{ sku: 'MUG-SAND', quantity: 2 }], 'spring');
    expect(db.prisma.discount.findUnique).toHaveBeenCalledWith({ where: { code: 'SPRING' } });
    expect(cart.totalCents).toBe(2800 - 280 + SHIPPING_CENTS);
  });

  it('refuses a SKU the price list does not have', async () => {
    db.prisma.priceList.findFirst.mockResolvedValueOnce({ id: 'pl1', currency: 'EUR' });
    db.prisma.price.findMany.mockResolvedValueOnce([]);
    await expect(priceCart([{ sku: 'GONE-1', quantity: 1 }])).rejects.toThrow('GONE-1 is not for sale');
  });
});
