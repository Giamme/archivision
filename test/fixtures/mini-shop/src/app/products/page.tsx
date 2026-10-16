import { listProducts } from '@/lib/products';

export default async function ProductsPage() {
  const products = await listProducts();
  return <ul>{products.map((p: any) => <li key={p.id}>{p.name}</li>)}</ul>;
}
