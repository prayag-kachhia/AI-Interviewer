import { Request, Response } from 'express';
import { createClient } from '@supabase/supabase-js';
import prisma from '../utils/db';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

/**
 * Return the current application's user profile.
 * Authentication is handled by Supabase before this controller runs.
 */
export const getMe = async (req: Request, res: Response): Promise<void> => {
  try {
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
  } catch (error) {
    console.error('Get me error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

/**
 * Delete the application user, their resumes, and their Supabase Auth user.
 * The browser only calls this endpoint with its Supabase access token.
 */
export const deleteAccount = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const userId = req.user?.id;
    const supabaseUserId = req.user?.supabaseUserId;

    if (!userId || !supabaseUserId) {
      res.status(401).json({ success: false, message: 'Unauthorized' });
      return;
    }

    const deletedResumes = await prisma.resume.deleteMany({
      where: { userId },
    });

    const deletedUser = await prisma.user.delete({
      where: { id: userId },
    });

    try {
      const { error } = await supabase.auth.admin.deleteUser(supabaseUserId);
      if (error) {
        console.error('Supabase Auth user deletion failed:', error);
      }
    } catch (error) {
      console.error('Supabase Auth user deletion failed:', error);
    }

    res.status(200).json({
      success: true,
      message: 'Account and all associated resume data deleted successfully',
      deletedResumesCount: deletedResumes.count,
      deletedUserId: deletedUser.id,
    });
  } catch (error) {
    console.error('Delete account error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete account',
    });
  }
};
