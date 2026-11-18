import { Router } from 'express';
import { createClient } from '@supabase/supabase-js';
import { authenticate } from '../middleware/auth';
import prisma from '../db';

const router = Router();

// Server-side Supabase Admin client. Never expose the service-role key to the frontend.
const supabaseAdmin = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

/**
 * Delete the authenticated user's application data and Supabase Auth account.
 */
router.delete('/', authenticate, async (req, res) => {
  const userId = req.user?.id;
  const supabaseUserId = req.user?.supabaseUserId;

  if (!userId || !supabaseUserId) {
    res.status(401).json({
      success: false,
      message: 'Unauthorized',
    });
    return;
  }

  try {
    await prisma.$transaction(async (tx) => {
      // User relations are configured with onDelete: Cascade.
      // deleteMany also avoids a Prisma "record not found" error if
      // the local record has already been removed or on repeated retries.
      await tx.user.deleteMany({
        where: { id: userId },
      });

      // Delete Supabase Auth user last. If this fails, throwing causes
      // Prisma to roll back the application-data deletion.
      // Note on cross-system transaction limitation:
      // PostgreSQL and Supabase Auth are separate distributed systems without two-phase commit (2PC).
      // Placing Supabase deletion as the final operation inside the Prisma transaction ensures that
      // any Supabase failure rolls back the local database deletion, leaving the user's data intact.
      // If Supabase deletion were to succeed but the database commit phase subsequently failed,
      // the Auth user would be deleted while local data remained; scoped deleteMany makes retries
      // safe and idempotent.
      const { error } = await supabaseAdmin.auth.admin.deleteUser(
        supabaseUserId
      );

      if (error) {
        throw error;
      }
    });

    res.status(204).send();
  } catch (error) {
    console.error('Account deletion failed:', error);

    res.status(500).json({
      success: false,
      message: 'Failed to delete account. Please try again.',
    });
  }
});

/**
 * Export the authenticated user's application data as a JSON file.
 */
router.get('/export', authenticate, async (req, res) => {
  const userId = req.user?.id;

  if (!userId) {
    res.status(401).json({
      success: false,
      message: 'Unauthorized',
    });
    return;
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      email: true,
      createdAt: true,
      updatedAt: true,
      resumes: true,
      improvementPlan: true,
      sessions: {
        orderBy: { createdAt: 'desc' },
        include: {
          turns: {
            orderBy: { turnIndex: 'asc' },
          },
          feedback: true,
        },
      },
    },
  });

  if (!user) {
    res.status(404).json({
      success: false,
      message: 'User not found',
    });
    return;
  }

  res.setHeader('Content-Type', 'application/json');
  res.setHeader(
    'Content-Disposition',
    'attachment; filename="my-data-export.json"'
  );

  res.status(200).json({
    exportedAt: new Date().toISOString(),
    profile: {
      id: user.id,
      name: user.name,
      email: user.email,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    },
    resumes: user.resumes,
    improvementPlan: user.improvementPlan,
    sessions: user.sessions,
  });
});

export default router;
