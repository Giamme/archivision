import { total } from '@/lib/pricing';

test('total', () => { expect(total([{ price: 2, qty: 3 }])).toBe(6); });
