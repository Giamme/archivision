import { describe, it, expect } from 'vitest';
import { total } from '../src/money';

describe('total', () => it('adds', () => expect(total([{ price: 2, qty: 3 }])).toBe(6)));
