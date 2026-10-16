import { prisma } from '@corner/db';

export interface CartLine {
  sku: string;
  quantity: number;
}

export interface PricedLine {
  variantId: string;
  sku: string;
  name: string;
  quantity: number;
  weightGrams: number;
  unitPriceCents: number;
  discountCents: number;
  /** unitPriceCents × quantity − discountCents */
  totalCents: number;
}

export interface DiscountRule {
  id: string;
  code: string;
  kind: 'PERCENT' | 'FIXED';
  value: number;
  minTotalCents: number;
}

export interface PricedCart {
  currency: string;
  lines: PricedLine[];
  subtotalCents: number;
  discountCents: number;
  shippingCents: number;
  totalCents: number;
  discount: { id: string; code: string } | null;
}

export const FREE_SHIPPING_FROM_CENTS = 6000;
export const SHIPPING_CENTS = 495;

export class PricingError extends Error {
  constructor(message: string, readonly sku?: string) {
    super(message);
    this.name = 'PricingError';
  }
}

/** The price list in force now: active, and inside its dates when it has them. The latest start wins. */
export async function activePriceList(at = new Date()) {
  const list = await prisma.priceList.findFirst({
    where: {
      active: true,
      AND: [{ OR: [{ startsAt: null }, { startsAt: { lte: at } }] }, { OR: [{ endsAt: null }, { endsAt: { gt: at } }] }],
    },
    orderBy: { startsAt: 'desc' },
  });
  if (!list) throw new PricingError('No active price list');
  return list;
}

async function pricesFor(priceListId: string, skus: string[]) {
  const prices = await prisma.price.findMany({
    where: { priceListId, variant: { sku: { in: skus } } },
    include: { variant: { include: { product: { select: { name: true } } } } },
  });
  return new Map(prices.map(p => [p.variant.sku, p]));
}

/** Unit prices from the active price list. A SKU the list does not price cannot be sold. */
export async function applyPriceList(lines: CartLine[], at = new Date()): Promise<{ currency: string; lines: PricedLine[] }> {
  const list = await activePriceList(at);
  const bySku = await pricesFor(list.id, lines.map(l => l.sku));
  return {
    currency: list.currency,
    lines: lines.map(line => {
      const price = bySku.get(line.sku);
      if (!price) throw new PricingError(`${line.sku} is not for sale`, line.sku);
      return {
        variantId: price.variantId,
        sku: line.sku,
        name: `${price.variant.product.name} – ${price.variant.name}`,
        quantity: line.quantity,
        weightGrams: price.variant.weightGrams,
        unitPriceCents: price.amountCents,
        discountCents: 0,
        totalCents: price.amountCents * line.quantity,
      };
    }),
  };
}

/** A discount code that can be used now, or null: unknown, switched off, outside its dates or used up. */
export async function findDiscount(code: string, at = new Date()): Promise<DiscountRule | null> {
  const d = await prisma.discount.findUnique({ where: { code: code.trim().toUpperCase() } });
  if (!d || !d.active) return null;
  if ((d.startsAt && d.startsAt > at) || (d.endsAt && d.endsAt <= at)) return null;
  if (d.maxRedemptions !== null && d.redemptions >= d.maxRedemptions) return null;
  return { id: d.id, code: d.code, kind: d.kind, value: d.value, minTotalCents: d.minTotalCents };
}

/**
 * Takes a discount off the lines. The order's discount is worked out on the subtotal, then spread over the lines in
 * proportion to their totals; the last line takes what rounding leaves, so the lines add up to the order's discount.
 */
export function applyDiscount(lines: PricedLine[], rule: DiscountRule | null): PricedLine[] {
  if (!rule || !lines.length) return lines;
  const subtotal = lines.reduce((sum, l) => sum + l.unitPriceCents * l.quantity, 0);
  if (subtotal === 0 || subtotal < rule.minTotalCents) return lines;
  const off = rule.kind === 'PERCENT' ? Math.round((subtotal * Math.min(rule.value, 100)) / 100) : Math.min(rule.value, subtotal);
  let left = off;
  return lines.map((line, i) => {
    const gross = line.unitPriceCents * line.quantity;
    const share = i === lines.length - 1 ? left : Math.round((off * gross) / subtotal);
    left -= share;
    return { ...line, discountCents: share, totalCents: gross - share };
  });
}

export function shippingFor(subtotalAfterDiscountCents: number): number {
  return subtotalAfterDiscountCents >= FREE_SHIPPING_FROM_CENTS ? 0 : SHIPPING_CENTS;
}

/** The cart's totals from its priced lines. Pure, so the cart page and the checkout always agree. */
export function totals(currency: string, lines: PricedLine[], rule: DiscountRule | null): PricedCart {
  const subtotalCents = lines.reduce((sum, l) => sum + l.unitPriceCents * l.quantity, 0);
  const discountCents = lines.reduce((sum, l) => sum + l.discountCents, 0);
  const shippingCents = shippingFor(subtotalCents - discountCents);
  return {
    currency,
    lines,
    subtotalCents,
    discountCents,
    shippingCents,
    totalCents: subtotalCents - discountCents + shippingCents,
    discount: rule && discountCents > 0 ? { id: rule.id, code: rule.code } : null,
  };
}

/** The money columns a priced cart fills on a checkout (and, once paid, on its order). */
export function checkoutColumns(cart: PricedCart) {
  return {
    currency: cart.currency,
    subtotalCents: cart.subtotalCents,
    discountCents: cart.discountCents,
    shippingCents: cart.shippingCents,
    totalCents: cart.totalCents,
    discountId: cart.discount?.id ?? null,
  };
}

/** Price step: the price list, then the discount code, then shipping. */
export async function priceCart(lines: CartLine[], discountCode?: string | null): Promise<PricedCart> {
  const listed = await applyPriceList(lines);
  const rule = discountCode ? await findDiscount(discountCode) : null;
  return totals(listed.currency, applyDiscount(listed.lines, rule), rule);
}
