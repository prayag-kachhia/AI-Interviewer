import { Request, Response } from 'express';
import { createClient } from '@supabase/supabase-js';
import prisma from '../utils/db';
import { hashPassword, verifyPassword, generateLocalToken } from '../utils/token';

const supabase = createClient(
  process.env.SUPABASE_URL || 'https://dummy.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY || 'dummy-key'
);

/**
 * Check if a user with the provided email exists in the database
 * Used by frontend to dynamically suggest Sign In (existing user) or Sign Up (new user)
 */
export const checkUser = async (req: Request, res: Response): Promise<void> => {
  try {
    const { email } = req.body;
    if (!email || typeof email !== 'string') {
      res.status(400).json({ success: false, message: 'Valid email is required' });
      return;
    }

    const normalizedEmail = email.trim().toLowerCase();
    const existingUser = await prisma.user.findUnique({
      where: { email: normalizedEmail },
      select: { id: true, name: true, email: true },
    });

    res.status(200).json({
      success: true,
      exists: !!existingUser,
      name: existingUser?.name,
    });
  } catch (error) {
    console.error('Check user error:', error);
    res.status(500).json({ success: false, message: 'Error checking user' });
  }
};

/**
 * Register a new user
 * If user already exists, returns an error suggesting they sign in
 */
export const register = async (req: Request, res: Response): Promise<void> => {
  try {
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
      res.status(400).json({ 
        success: false, 
        message: 'Name, email, and password are required' 
      });
      return;
    }

    const normalizedEmail = email.trim().toLowerCase();

    // Check if user already exists
    const existingUser = await prisma.user.findUnique({
      where: { email: normalizedEmail },
    });

    if (existingUser) {
      res.status(400).json({
        success: false,
        message: 'An account with this email already exists. Please sign in instead.',
        exists: true,
      });
      return;
    }

    // Create user in database
    const newUser = await prisma.user.create({
      data: {
        name: name.trim(),
        email: normalizedEmail,
        passwordHash: hashPassword(password),
      },
    });

    const token = generateLocalToken(newUser.id, newUser.email);

    res.status(201).json({
      success: true,
      message: 'Account created successfully',
      data: {
        token,
        user: {
          id: newUser.id,
          name: newUser.name,
          email: newUser.email,
        },
      },
    });
  } catch (error) {
    console.error('Register error:', error);
    res.status(500).json({ success: false, message: 'Failed to create account' });
  }
};

/**
 * Sign In / Login an existing user
 * If user does not exist, returns 404 with isNewUser: true to suggest Sign Up
 */
export const login = async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      res.status(400).json({ 
        success: false, 
        message: 'Email and password are required' 
      });
      return;
    }

    const normalizedEmail = email.trim().toLowerCase();
    const user = await prisma.user.findUnique({
      where: { email: normalizedEmail },
    });

    if (!user) {
      res.status(404).json({
        success: false,
        message: 'No account found with this email. You appear to be a new user—please sign up!',
        isNewUser: true,
      });
      return;
    }

    // Verify password if not placeholder
    if (user.passwordHash !== 'supabase-auth') {
      const isValid = verifyPassword(password, user.passwordHash);
      if (!isValid) {
        res.status(401).json({
          success: false,
          message: 'Incorrect password. Please verify and try again.',
        });
        return;
      }
    }

    const token = generateLocalToken(user.id, user.email);

    res.status(200).json({
      success: true,
      message: 'Signed in successfully',
      data: {
        token,
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
        },
      },
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ success: false, message: 'Failed to sign in' });
  }
};

/**
 * Logout
 * Explicitly leaves all user database records (resumes, profiles) completely intact!
 */
export const logout = async (req: Request, res: Response): Promise<void> => {
  res.status(200).json({ 
    success: true, 
    message: 'Logged out successfully. All candidate profile and resume data is safely preserved in the database.' 
  });
};

/**
 * Delete User Account & All Associated Data
 * Explicitly removes all resumes and user record belonging to this specific user.
 */
export const deleteAccount = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ success: false, message: 'Unauthorized' });
      return;
    }

    // 1. Delete all resumes belonging to this user
    const deletedResumes = await prisma.resume.deleteMany({
      where: { userId },
    });

    // 2. Delete user record from SQLite
    const deletedUser = await prisma.user.delete({
      where: { id: userId },
    });

    // 3. If connected to Supabase, attempt to delete Supabase auth user as well
    if (req.user?.supabaseUserId) {
      try {
        await supabase.auth.admin.deleteUser(req.user.supabaseUserId);
      } catch (err) {
        // Ignored if offline/dummy Supabase
      }
    }

    res.status(200).json({
      success: true,
      message: 'Account and all associated resume data deleted successfully',
      deletedResumesCount: deletedResumes.count,
      deletedUserId: deletedUser.id,
    });
  } catch (error) {
    console.error('Delete account error:', error);
    res.status(500).json({ success: false, message: 'Failed to delete account' });
  }
};

/**
 * Get current user profile
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
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};
