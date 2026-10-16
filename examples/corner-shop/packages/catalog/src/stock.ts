import { prisma, recordAudit } from '@corner/db';
import { publish, SUBJECTS, type StockChanged } from '@corner/events';

export interface StockLine {
  sku: string;
  quantity: number;
}

export interface StockRow {
  sku: string;
  productName: string;
  variantName: string;
  onHand: number;
  reserved: number;
  available: number;
  updatedAt: Date;
}

export class OutOfStockError extends Error {
  constructor(
    readonly sku: string,
    readonly requested: number,
    readonly available: number,
  ) {
    super(`Only ${available} left of ${sku} (asked for ${requested})`);
    this.name = 'OutOfStockError';
  }
}

const MAX_RETRIES = 3;

export async function getAvailability(sku: string): Promise<number> {
  const row = await prisma.stock.findUnique({ where: { sku }, select: { onHand: true, reserved: true } });
  return row ? Math.max(0, row.onHand - row.reserved) : 0;
}

/** Back office list, lowest availability first so the counts that need attention come up top. */
export async function listStock(query?: string): Promise<StockRow[]> {
  const rows = await prisma.stock.findMany({
    where: query ? { OR: [{ sku: { contains: query.toUpperCase() } }, { variant: { product: { name: { contains: query, mode: 'insensitive' } } } }] } : undefined,
    include: { variant: { select: { name: true, product: { select: { name: true } } } } },
    take: 200,
  });
  return rows
    .map(r => ({ sku: r.sku, productName: r.variant.product.name, variantName: r.variant.name, onHand: r.onHand, reserved: r.reserved, available: r.onHand - r.reserved, updatedAt: r.updatedAt }))
    .sort((a, b) => a.available - b.available);
}

export async function listLowStock(threshold = 5) {
  return prisma.stock.findMany({ where: { onHand: { lte: threshold } }, orderBy: { onHand: 'asc' }, take: 10 });
}

/** Sets the quantity on hand after a count in the warehouse. Staff only; every change is audited and announced. */
export async function setStock(sku: string, onHand: number, staffId: string): Promise<StockChanged> {
  if (!Number.isInteger(onHand) || onHand < 0) throw new RangeError('onHand must be a whole number, 0 or more');
  const before = await prisma.stock.findUnique({ where: { sku } });
  if (!before) throw new Error(`No stock row for ${sku}`);
  if (onHand < before.reserved) throw new RangeError(`${before.reserved} of ${sku} are held for open checkouts`);
  const row = await prisma.stock.update({
    where: { sku },
    data: { onHand, version: { increment: 1 } },
    include: { variant: { select: { product: { select: { slug: true } } } } },
  });
  await recordAudit({ action: 'stock.set', entity: 'stock', entityId: sku, staffId, data: { from: before.onHand, to: onHand } });
  return announce(row.sku, row.variant.product.slug, row.onHand, row.reserved);
}

/**
 * Holds stock for a checkout: all lines or none. Each row is updated only if nobody changed it since it was read
 * (its version), and a conflict is retried, so two checkouts never hold the same last item.
 */
export async function reserveStock(lines: StockLine[]): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      await prisma.$transaction(async tx => {
        for (const line of lines) {
          const row = await tx.stock.findUnique({ where: { sku: line.sku } });
          const available = row ? row.onHand - row.reserved : 0;
          if (!row || available < line.quantity) throw new OutOfStockError(line.sku, line.quantity, Math.max(0, available));
          const held = await tx.stock.updateMany({
            where: { sku: line.sku, version: row.version },
            data: { reserved: { increment: line.quantity }, version: { increment: 1 } },
          });
          if (held.count === 0) throw new StockConflict(line.sku);
        }
      });
      return;
    } catch (err) {
      if (err instanceof StockConflict && attempt < MAX_RETRIES) continue;
      throw err;
    }
  }
}

/** Gives held stock back: a payment failed or a hold ran out. */
export async function releaseStock(lines: StockLine[]): Promise<void> {
  if (!lines.length) return;
  await prisma.$transaction(
    lines.map(line => prisma.stock.update({ where: { sku: line.sku }, data: { reserved: { decrement: line.quantity }, version: { increment: 1 } } })),
  );
}

/** The order was kept: held stock leaves the shelf. */
export async function commitStock(lines: StockLine[]): Promise<void> {
  const rows = await prisma.$transaction(
    lines.map(line =>
      prisma.stock.update({
        where: { sku: line.sku },
        data: { onHand: { decrement: line.quantity }, reserved: { decrement: line.quantity }, version: { increment: 1 } },
        include: { variant: { select: { product: { select: { slug: true } } } } },
      }),
    ),
  );
  await Promise.all(rows.map(r => announce(r.sku, r.variant.product.slug, r.onHand, r.reserved)));
}

class StockConflict extends Error {
  constructor(readonly sku: string) {
    super(`Stock row ${sku} changed while reserving`);
  }
}

async function announce(sku: string, productSlug: string, onHand: number, reserved: number): Promise<StockChanged> {
  const event: StockChanged = { sku, productSlug, onHand, reserved, available: onHand - reserved, changedAt: new Date().toISOString() };
  await publish(SUBJECTS.stockChanged, event);
  return event;
}
