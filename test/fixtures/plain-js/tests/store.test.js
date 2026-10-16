import { describe, it, expect } from 'vitest';
import { cents } from '../src/lib/format.cjs';

describe('cents', () => {
  it('writes two decimals', () => expect(cents(150)).toBe('1.50'));
});
