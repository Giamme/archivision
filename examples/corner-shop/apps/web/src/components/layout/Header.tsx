import Link from 'next/link';
import { SearchBox } from '@/components/catalog/SearchBox';
import { readCartCount } from '@/lib/cart-cookie';

interface HeaderProps {
  categories: Array<{ id: string; slug: string; name: string }>;
}

export async function Header({ categories }: HeaderProps) {
  const count = await readCartCount();
  return (
    <header className="site-header">
      <div className="container header-row">
        <Link href="/" className="logo">
          Corner Shop
        </Link>
        <nav aria-label="Categories">
          <ul className="nav-list">
            {categories.map(c => (
              <li key={c.id}>
                <Link href={`/categories/${c.slug}`}>{c.name}</Link>
              </li>
            ))}
          </ul>
        </nav>
        <SearchBox />
        <Link href="/account" className="header-link">
          Account
        </Link>
        <Link href="/cart" className="header-link" aria-label={`Cart, ${count} items`}>
          Cart{count > 0 && <span className="badge">{count}</span>}
        </Link>
      </div>
    </header>
  );
}
