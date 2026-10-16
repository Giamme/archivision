// Seeds a local database with a few categories, products and one staff member. Safe to run twice.
import { prisma } from '../src/client';

const CATALOG = [
  { category: 'kitchen', name: 'Kitchen', products: [
    { slug: 'stoneware-mug', name: 'Stoneware mug', variants: [['MUG-SAND', 'Sand', 380, 1400], ['MUG-SLATE', 'Slate', 380, 1400]] },
    { slug: 'linen-tea-towel', name: 'Linen tea towel', variants: [['TOWEL-OAT', 'Oat', 120, 1200]] },
  ] },
  { category: 'bags', name: 'Bags', products: [
    { slug: 'canvas-tote', name: 'Canvas tote', variants: [['TOTE-NAT', 'Natural', 260, 2400], ['TOTE-INK', 'Ink', 260, 2400]] },
  ] },
] as const;

async function main() {
  const list = await prisma.priceList.upsert({
    where: { id: 'default-eur' },
    update: {},
    create: { id: 'default-eur', name: 'Default (EUR)', currency: 'EUR', active: true },
  });
  for (const [i, c] of CATALOG.entries()) {
    const category = await prisma.category.upsert({ where: { slug: c.category }, update: {}, create: { slug: c.category, name: c.name, position: i } });
    for (const p of c.products) {
      const product = await prisma.product.upsert({
        where: { slug: p.slug },
        update: {},
        create: { slug: p.slug, name: p.name, description: `${p.name}, made in small batches.`, published: true, featured: i === 0, categoryId: category.id },
      });
      for (const [sku, name, grams, cents] of p.variants) {
        const variant = await prisma.variant.upsert({ where: { sku }, update: {}, create: { sku, name, weightGrams: grams, productId: product.id } });
        await prisma.stock.upsert({ where: { sku }, update: {}, create: { sku, onHand: 25 } });
        await prisma.price.upsert({
          where: { priceListId_variantId: { priceListId: list.id, variantId: variant.id } },
          update: {},
          create: { priceListId: list.id, variantId: variant.id, amountCents: cents },
        });
      }
    }
  }
  await prisma.staffMember.upsert({ where: { email: 'staff@example.com' }, update: {}, create: { email: 'staff@example.com', name: 'Shop Staff', role: 'ADMIN' } });
}

main()
  .then(() => prisma.$disconnect())
  .catch(async err => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
