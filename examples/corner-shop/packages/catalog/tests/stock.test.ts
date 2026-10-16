import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => {
  const stock = { findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() };
  return {
    stock,
    prisma: { stock, $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn({ stock })) },
    recordAudit: vi.fn(),
  };
});
const bus = vi.hoisted(() => ({ publish: vi.fn() }));

vi.mock('@corner/db', () => ({ prisma: db.prisma, recordAudit: db.recordAudit }));
vi.mock('@corner/events', () => ({ publish: bus.publish, SUBJECTS: { stockChanged: 'stock.changed' } }));

import { OutOfStockError, getAvailability, reserveStock, setStock } from '../src/stock';

beforeEach(() => vi.clearAllMocks());

describe('getAvailability', () => {
  it('is on hand minus reserved, never below zero', async () => {
    db.stock.findUnique.mockResolvedValueOnce({ onHand: 3, reserved: 5 });
    expect(await getAvailability('MUG-SAND')).toBe(0);
  });
});

describe('reserveStock', () => {
  it('holds every line when there is enough', async () => {
    db.stock.findUnique.mockResolvedValue({ sku: 'MUG-SAND', onHand: 10, reserved: 2, version: 4 });
    db.stock.updateMany.mockResolvedValue({ count: 1 });
    await reserveStock([{ sku: 'MUG-SAND', quantity: 3 }]);
    expect(db.stock.updateMany).toHaveBeenCalledWith({
      where: { sku: 'MUG-SAND', version: 4 },
      data: { reserved: { increment: 3 }, version: { increment: 1 } },
    });
  });

  it('refuses the whole checkout when one line is short', async () => {
    db.stock.findUnique.mockResolvedValue({ sku: 'TOTE-INK', onHand: 1, reserved: 0, version: 0 });
    await expect(reserveStock([{ sku: 'TOTE-INK', quantity: 2 }])).rejects.toBeInstanceOf(OutOfStockError);
    expect(db.stock.updateMany).not.toHaveBeenCalled();
  });
});

describe('setStock', () => {
  it('audits the change and publishes stock.changed', async () => {
    db.stock.findUnique.mockResolvedValueOnce({ sku: 'MUG-SAND', onHand: 4, reserved: 1 });
    db.stock.update.mockResolvedValueOnce({ sku: 'MUG-SAND', onHand: 12, reserved: 1, variant: { product: { slug: 'stoneware-mug' } } });
    const event = await setStock('MUG-SAND', 12, 'staff_1');
    expect(event).toMatchObject({ sku: 'MUG-SAND', productSlug: 'stoneware-mug', available: 11 });
    expect(db.recordAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'stock.set', staffId: 'staff_1' }));
    expect(bus.publish).toHaveBeenCalledWith('stock.changed', event);
  });

  it('will not count below what open checkouts hold', async () => {
    db.stock.findUnique.mockResolvedValueOnce({ sku: 'MUG-SAND', onHand: 4, reserved: 3 });
    await expect(setStock('MUG-SAND', 2, 'staff_1')).rejects.toThrow(RangeError);
  });
});
