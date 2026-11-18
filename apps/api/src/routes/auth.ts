import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { createClient } from '@supabase/supabase-js';
import prisma from '../db';

const router = Router();

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

// All application auth/profile operations are protected by Supabase Auth.
// Sign-in, sign-up, and sign-out happen directly through Supabase in the
// browser and never send passwords to this API.

/**
 * Return the current application's user profile.
 * Authentication is handled by Supabase before this handler runs.
 */
router.get('/me', authenticate, async (req, res) => {
  const userId = req.user?.id;
  if (!userId) {
    res.status(401).json({ success: false, message: 'Unauthorized' });
    return;
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      supabaseUserId: true,
      name: true,
      email: true,
    },
  });

  if (!user) {
    res.status(404).json({ success: false, message: 'User not found' });
    return;
  }

  res.status(200).json({
    success: true,
    data: user,
  });
});

/**
 * Delete the application user, their resumes, and their Supabase Auth user.
 * The browser only calls this endpoint with its Supabase access token.
 */
router.delete('/account', authenticate, async (req, res) => {
  const userId = req.user?.id;
  const supabaseUserId = req.user?.supabaseUserId;

  if (!userId || !supabaseUserId) {
    res.status(401).json({ success: false, message: 'Unauthorized' });
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
      const { error } = await supabase.auth.admin.deleteUser(supabaseUserId);

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

export default router;
