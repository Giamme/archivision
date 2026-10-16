import { PrismaClient, type Prisma } from '@prisma/client';

// One client per process. In development Next.js reloads modules on every change, so the client is kept on
// globalThis; otherwise each reload would open a new connection pool and Postgres runs out of slots.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma: PrismaClient =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['query', 'warn', 'error'] : ['warn', 'error'],
  });

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

export interface AuditEntry {
  action: string;
  entity: string;
  entityId: string;
  /** The staff member who did it; empty for system steps (webhooks, workers). */
  staffId?: string | null;
  data?: Prisma.InputJsonValue;
}

/** Records who changed what. Never throws for the caller's sake: a failed audit write is logged, not fatal. */
export async function recordAudit(entry: AuditEntry): Promise<void> {
  try {
    await prisma.auditLog.create({ data: { ...entry, staffId: entry.staffId ?? null } });
  } catch (err) {
    console.error('[audit] could not record', entry.action, entry.entityId, err);
  }
}

/** The latest changes to one thing, newest first, with the staff member's name. */
export async function listAudit(entity: string, entityId: string, take = 50) {
  return prisma.auditLog.findMany({
    where: { entity, entityId },
    orderBy: { createdAt: 'desc' },
    take,
    include: { staff: { select: { name: true, email: true } } },
  });
}
