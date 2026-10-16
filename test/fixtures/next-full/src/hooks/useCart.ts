'use client';
import { useState } from 'react';

export function useCart() {
  const [ids, setIds] = useState<string[]>([]);
  return { ids, add: (id: string) => setIds([...ids, id]) };
}
