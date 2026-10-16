'use server';
import { addItem } from '@/lib/store';
import { tagItem } from '@/lib/tags.mjs';

export async function createItem(form) {
  const item = await addItem(form.get('name'), Number(form.get('price')));
  await tagItem(item.id, 'new');
  return item;
}
