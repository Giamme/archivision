import { prisma } from '@corner/db';

export interface AddressInput {
  id?: string;
  label?: string | null;
  name: string;
  line1: string;
  line2?: string | null;
  city: string;
  postalCode: string;
  country: string;
  phone?: string | null;
  isDefault?: boolean;
}

export async function listAddresses(userId: string) {
  return prisma.address.findMany({ where: { userId }, orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }] });
}

/** Adds or edits an address of an account. Making one the default unsets the others in the same transaction. */
export async function saveAddress(userId: string, input: AddressInput) {
  const data = {
    label: input.label ?? null,
    name: input.name.trim(),
    line1: input.line1.trim(),
    line2: input.line2?.trim() || null,
    city: input.city.trim(),
    postalCode: input.postalCode.trim().toUpperCase(),
    country: input.country.toUpperCase(),
    phone: input.phone?.trim() || null,
    isDefault: input.isDefault ?? false,
  };
  if (input.id) {
    // updateMany with the user id, so one account can never edit another's address by guessing an id
    const [, updated] = await prisma.$transaction([
      prisma.address.updateMany({ where: { userId, isDefault: true, NOT: { id: input.id } }, data: data.isDefault ? { isDefault: false } : {} }),
      prisma.address.updateMany({ where: { id: input.id, userId }, data }),
    ]);
    if (updated.count === 0) throw new Error('Address not found');
    return input.id;
  }
  const [, created] = await prisma.$transaction([
    prisma.address.updateMany({ where: { userId, isDefault: true }, data: data.isDefault ? { isDefault: false } : {} }),
    prisma.address.create({ data: { ...data, userId } }),
  ]);
  return created.id;
}

export async function deleteAddress(userId: string, id: string): Promise<boolean> {
  const { count } = await prisma.address.deleteMany({ where: { id, userId } });
  return count > 0;
}
