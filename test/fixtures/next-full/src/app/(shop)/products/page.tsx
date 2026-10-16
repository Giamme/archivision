import { listProducts } from '@/lib/catalog';

async function ProductsPage() {
  const ps = await listProducts();
  return <ul>{ps.map((p: any) => <li key={p.id}>{p.name}</li>)}</ul>;
}

export default ProductsPage;
