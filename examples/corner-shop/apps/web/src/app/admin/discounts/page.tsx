import type { Metadata } from 'next';
import { listDiscounts } from '@corner/orders';
import { DiscountTable } from '@/components/admin/DiscountTable';
import { staffOrRedirect } from '@/lib/staff';

export const metadata: Metadata = { title: 'Discount codes' };

export default async function AdminDiscountsPage() {
  await staffOrRedirect(['ADMIN']);
  const discounts = await listDiscounts();
  return (
    <>
      <h1>Discount codes</h1>
      <p className="muted">Codes apply to the whole order and are spread over its lines. One code per order.</p>
      <DiscountTable discounts={discounts} />
    </>
  );
}
