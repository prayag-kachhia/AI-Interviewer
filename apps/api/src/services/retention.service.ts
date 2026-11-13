import prisma from '../db';

export const RETENTION_DAYS = 30;

export async function purgeExpiredSessions(now: Date = new Date()) {
  const cutoff = new Date(
    now.getTime() - RETENTION_DAYS * 24 * 60 * 60 * 1000
  );

  return prisma.session.deleteMany({
    where: {
      status: 'ENDED',
      keep: false,
      endedAt: {
        lt: cutoff,
      },
    },
  });
}