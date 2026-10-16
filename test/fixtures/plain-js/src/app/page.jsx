import ItemList from '@/components/ItemList';
import { listItems } from '@/lib/store';
import { createItem } from './actions/items';

export default async function HomePage() {
  const items = await listItems();
  return (
    <main>
      <ItemList items={items} />
      <form action={createItem}><button>Add</button></form>
    </main>
  );
}
