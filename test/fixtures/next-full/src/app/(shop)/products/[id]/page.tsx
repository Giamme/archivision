import { getProduct } from '@/lib/catalog';
import { format } from '@/lib/format';
import { Cart } from '@/components/Cart';

export default async function ProductPage({ params }: { params: { id: string } }) {
  const p = await getProduct(params.id);
  return <main>{p ? format(p.price) : 'missing'}<Cart /></main>;
}
