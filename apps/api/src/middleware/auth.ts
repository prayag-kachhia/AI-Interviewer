import { Request, Response, NextFunction } from 'express';
import { createClient } from '@supabase/supabase-js';
import prisma from '../utils/db';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

/**
 * Authenticate every protected API request with the Supabase access token
 * supplied by the browser as: Authorization: Bearer <access_token>.
 *
 * No application-generated/local tokens are accepted here. Supabase Auth is
 * the single authentication authority for the application.
 */
export const authenticate = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ success: false, message: 'Authentication required' });
    return;
  }

  const token = authHeader.slice('Bearer '.length).trim();
  if (!token) {
    res.status(401).json({ success: false, message: 'Authentication required' });
    return;
  }

  try {
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser(token);

    if (error || !user) {
      res.status(401).json({
        success: false,
        message: 'Invalid or expired token',
      });
      return;
    }

    const email = user.email?.trim().toLowerCase();
    if (!email) {
      res.status(401).json({
        success: false,
        message: 'Authenticated user has no email address',
      });
      return;
    }

    // Link the Supabase identity to the application's users table. This keeps
    // resume ownership in the application DB without making the browser query
    // that table directly.
    let localUser = await prisma.user.findUnique({
      where: { supabaseUserId: user.id },
    });

    if (!localUser) {
      const existingEmailUser = await prisma.user.findUnique({
        where: { email },
      });

      if (existingEmailUser) {
        if (
          existingEmailUser.supabaseUserId &&
          existingEmailUser.supabaseUserId !== user.id
        ) {
          res.status(401).json({
            success: false,
            message: 'This email is linked to another authentication account',
          });
          return;
        }

        localUser = await prisma.user.update({
          where: { id: existingEmailUser.id },
          data: { supabaseUserId: user.id },
        });
      } else {
        localUser = await prisma.user.create({
          data: {
            supabaseUserId: user.id,
            email,
            name:
              user.user_metadata?.full_name ||
              user.user_metadata?.name ||
              'Candidate',
            // Passwords belong to Supabase Auth and are never stored by the
            // application.
            passwordHash: 'supabase-auth',
          },
        });
      }
    }

    req.user = {
      id: localUser.id,
      supabaseUserId: localUser.supabaseUserId,
      email: localUser.email,
      name: localUser.name,
    };

    next();
  } catch (error) {
    console.error('Supabase authentication error:', error);
    res.status(401).json({
      success: false,
      message: 'Invalid or expired token',
    });
  }
};
